import sys
from collections.abc import Callable

from app.bootstrap import prepare, reset_demo
from app.config import settings
from app.db import Database
from app.logs import configure_logging

COMMANDS: dict[str, Callable[[Database], None]] = {"migrate": prepare, "reset-demo": reset_demo}


def main(arguments: list[str]) -> int:
    if len(arguments) != 1 or arguments[0] not in COMMANDS:
        print(f"Использование: python -m app.cli {{{'|'.join(COMMANDS)}}}", file=sys.stderr)
        return 2
    configure_logging()
    database = Database(settings.database_url)
    try:
        COMMANDS[arguments[0]](database)
    finally:
        database.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
