import logging
import signal
import threading
import time
from types import FrameType

from app import clock
from app.bootstrap import prepare
from app.config import settings
from app.db import Database
from app.logs import configure_logging, correlation_id, new_correlation
from app.pipeline import advance
from app.repo import Db

logger = logging.getLogger("alpharay.worker")

BATCH = 100
RETRY_BASE_MS = 2000
RETRY_MAX_MS = 60_000
IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
CLEANUP_SECONDS = 600


def retry_delay(failures: int) -> int:
    return min(RETRY_MAX_MS, RETRY_BASE_MS * 2**failures)


def process_one(database: Database, now: int) -> bool:
    token = correlation_id.set(new_correlation())
    try:
        with database.session() as session:
            db = Db(session)
            record = db.next_due(now)
            if record is None:
                return False
            application_id, number, failures = record.id, record.number, record.failures
            try:
                with session.begin_nested():
                    advance(db, record, now)
            except Exception:
                logger.exception("Не удалось обработать заявку %s", number, extra={"application_id": application_id})
                db.delay(application_id, now + retry_delay(failures), failures + 1)
            return True
    finally:
        correlation_id.reset(token)


def process_due(database: Database, now: int, limit: int = BATCH) -> int:
    processed = 0
    while processed < limit and process_one(database, now):
        processed += 1
    return processed


def forget_idempotency(database: Database, now: int) -> None:
    with database.session() as session:
        Db(session).forget_idempotency(now - IDEMPOTENCY_TTL_MS)


class PipelineWorker:
    def __init__(self, database: Database) -> None:
        self.database = database
        self.stopping = threading.Event()
        self.thread = threading.Thread(target=self.run, name="pipeline-worker", daemon=True)
        self.cleaned_at = 0.0

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stopping.set()
        if self.thread.is_alive():
            self.thread.join(timeout=5)

    def tick(self) -> None:
        now = clock.now_ms()
        process_due(self.database, now)
        if time.monotonic() - self.cleaned_at > CLEANUP_SECONDS:
            forget_idempotency(self.database, now)
            self.cleaned_at = time.monotonic()

    def run(self) -> None:
        logger.info("Воркер конвейера запущен")
        while not self.stopping.is_set():
            try:
                self.tick()
            except Exception:
                logger.exception("Сбой цикла воркера")
            self.stopping.wait(settings.worker_poll_seconds)
        logger.info("Воркер конвейера остановлен")


def main() -> None:
    configure_logging()
    database = Database(settings.database_url)
    prepare(database)
    worker = PipelineWorker(database)

    def shutdown(_: int, __: FrameType | None) -> None:
        worker.stopping.set()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        worker.run()
    finally:
        database.dispose()


if __name__ == "__main__":
    main()
