import re
import shutil
from pathlib import Path

from fastapi import UploadFile

from app.config import settings

SAFE_SUFFIX = re.compile(r"^\.[A-Za-z0-9]{1,8}$")


def upload_target(application_id: str, document_id: str, filename: str) -> Path | None:
    root = settings.upload_path
    if not root:
        return None
    suffix = Path(filename).suffix
    return root / application_id / f"{document_id}{suffix if SAFE_SUFFIX.match(suffix) else ''}"


def save_upload(application_id: str, document_id: str, file: UploadFile) -> None:
    target = upload_target(application_id, document_id, file.filename or "")
    if not target:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    file.file.seek(0)
    with target.open("wb") as output:
        shutil.copyfileobj(file.file, output)
