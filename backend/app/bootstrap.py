import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import func, inspect, select, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from app import clock
from app.config import settings
from app.db import Base, Database, create_database_if_missing
from app.models import UserRecord
from app.repo import Db
from app.seeds import seed_demo

logger = logging.getLogger("alpharay")

ROOT = Path(__file__).resolve().parent.parent
LOCK_KEY = 7_231_046_100
VERSION_TABLE = "alembic_version"


def alembic_config(connection: Connection | None = None) -> Config:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    if connection is not None:
        config.attributes["connection"] = connection
    return config


def head_revision() -> str | None:
    return ScriptDirectory.from_config(alembic_config()).get_current_head()


def current_revision(connection: Connection) -> str | None:
    if not inspect(connection).has_table(VERSION_TABLE):
        return None
    return connection.execute(text(f"SELECT version_num FROM {VERSION_TABLE}")).scalar()


def lock(connection: Connection) -> None:
    connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK_KEY})


def seed_if_empty(connection: Connection) -> bool:
    session = Session(bind=connection)
    try:
        if session.scalar(select(func.count()).select_from(UserRecord)):
            return False
        seed_demo(Db(session), clock.now_ms())
        session.flush()
        logger.info("Загружены демо-данные")
        return True
    finally:
        session.close()


def prepare(database: Database) -> None:
    if settings.database_autocreate:
        create_database_if_missing(database.url)
    with database.engine.begin() as connection:
        lock(connection)
        command.upgrade(alembic_config(connection), "head")
        if settings.demo_seed:
            seed_if_empty(connection)


def clear(connection: Connection) -> None:
    tables = ", ".join(table.name for table in Base.metadata.sorted_tables)
    connection.execute(text(f"TRUNCATE TABLE {tables} RESTART IDENTITY CASCADE"))
    connection.execute(text("ALTER SEQUENCE application_number_seq RESTART WITH 1201"))
    connection.execute(text("ALTER SEQUENCE disbursement_operation_seq RESTART WITH 1"))


def reset_demo(database: Database) -> None:
    with database.engine.begin() as connection:
        lock(connection)
        clear(connection)
        seed_if_empty(connection)
