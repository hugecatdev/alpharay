from typing import Any

from alembic import context
from alembic.autogenerate.api import AutogenContext
from sqlalchemy import create_engine
from sqlalchemy.engine import Connection

from app import models
from app.config import settings
from app.db import IsoDate, Millis, Model

config = context.config


def render_item(kind: str, value: Any, autogen: AutogenContext) -> str | bool:
    if kind != "type":
        return False
    if isinstance(value, Millis):
        return "sa.DateTime(timezone=True)"
    if isinstance(value, IsoDate):
        return "sa.Date()"
    if isinstance(value, Model):
        autogen.imports.add("from sqlalchemy.dialects import postgresql")
        return "postgresql.JSONB()"
    return False


def run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=models.Base.metadata,
        compare_type=True,
        render_item=render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


def main() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        run(connection)
        return
    engine = create_engine(config.get_main_option("sqlalchemy.url") or settings.database_url)
    try:
        with engine.begin() as owned:
            run(owned)
    finally:
        engine.dispose()


main()
