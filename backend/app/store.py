import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from app.fmt import now_ms
from app.models import Db
from app.pipeline import advance_all
from app.seeds import DB_VERSION, create_seed

logger = logging.getLogger("alpharay")


@dataclass
class Session:
    db: Db
    now: int


class Store:
    def __init__(self, path: Path | None) -> None:
        self.path = path
        self.lock = asyncio.Lock()
        self._saved: str | None = None
        self.db = self._load()

    def _load(self) -> Db:
        if self.path and self.path.exists():
            try:
                db = Db.model_validate_json(self.path.read_text("utf-8"))
                if db.version == DB_VERSION:
                    self._saved = db.model_dump_json()
                    return db
                logger.info("State version %s is outdated, reseeding", db.version)
            except (ValidationError, ValueError, OSError):
                logger.warning("State file %s is unreadable, reseeding", self.path)
        db = create_seed(now_ms())
        self._write(db)
        return db

    def _write(self, db: Db) -> None:
        if not self.path:
            return
        payload = db.model_dump_json()
        if payload == self._saved:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f"{self.path.name}.tmp")
        temporary.write_text(payload, "utf-8")
        os.replace(temporary, self.path)
        self._saved = payload

    def save(self) -> None:
        self._write(self.db)

    def reset(self) -> None:
        self.db = create_seed(now_ms())
        self.save()

    @asynccontextmanager
    async def session(self) -> AsyncIterator[Session]:
        async with self.lock:
            now = now_ms()
            advance_all(self.db, now)
            try:
                yield Session(self.db, now)
            finally:
                self.save()
