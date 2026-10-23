import logging
import re
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from typing import Any

from pydantic import TypeAdapter
from sqlalchemy import Date, DateTime, MetaData, create_engine, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Dialect, make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.types import TypeDecorator

from app.config import settings
from app.fmt import EPOCH, to_ms

logger = logging.getLogger("alpharay")

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}
DATABASE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


class Millis(TypeDecorator[int]):
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: int | None, dialect: Dialect) -> datetime | None:
        return None if value is None else EPOCH + timedelta(milliseconds=value)

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> int | None:
        return None if value is None else to_ms(value)


class IsoDate(TypeDecorator[str]):
    impl = Date
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect: Dialect) -> date | None:
        return None if value is None else date.fromisoformat(value[:10])

    def process_result_value(self, value: date | None, dialect: Dialect) -> str | None:
        return None if value is None else value.isoformat()


class Model(TypeDecorator[Any]):
    impl = JSONB
    cache_ok = True

    def __init__(self, schema: Any) -> None:
        super().__init__()
        self.schema = schema
        self.adapter: TypeAdapter[Any] = TypeAdapter(schema)

    def process_bind_param(self, value: Any, dialect: Dialect) -> Any:
        return None if value is None else self.adapter.dump_python(value, mode="json")

    def process_result_value(self, value: Any, dialect: Dialect) -> Any:
        return None if value is None else self.adapter.validate_python(value)


class Database:
    def __init__(self, url: str) -> None:
        self.url = url
        self.engine = create_engine(
            url,
            pool_pre_ping=True,
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_max_overflow,
        )
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    @contextmanager
    def session(self) -> Iterator[Session]:
        with self.sessions() as session, session.begin():
            yield session

    def ping(self) -> bool:
        try:
            with self.engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except OperationalError:
            return False
        return True

    def dispose(self) -> None:
        self.engine.dispose()


def create_database_if_missing(url: str) -> None:
    target = make_url(url)
    name = target.database or ""
    if not DATABASE_NAME.match(name):
        return
    engine = create_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            exists = connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name}
            ).scalar()
            if not exists:
                connection.execute(text(f'CREATE DATABASE "{name}"'))
                logger.info("Создана база данных %s", name)
    except OperationalError as error:
        logger.warning("Не удалось проверить базу %s: %s", name, error.orig)
    finally:
        engine.dispose()
