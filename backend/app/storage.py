import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile

from app.config import settings

SAFE_SUFFIX = re.compile(r"^\.[A-Za-z0-9]{1,8}$")
CHUNK = 64 * 1024


@dataclass(frozen=True)
class StoredFile:
    key: str | None
    checksum: str
    size: int


def upload_target(application_id: str, document_id: str, filename: str) -> Path | None:
    root = settings.upload_path
    if not root:
        return None
    suffix = Path(filename).suffix
    return root / application_id / f"{document_id}{suffix if SAFE_SUFFIX.match(suffix) else ''}"


def save_upload(application_id: str, document_id: str, file: UploadFile) -> StoredFile:
    digest = hashlib.sha256()
    size = 0
    target = upload_target(application_id, document_id, file.filename or "")
    file.file.seek(0)
    if not target:
        for chunk in iter(lambda: file.file.read(CHUNK), b""):
            digest.update(chunk)
            size += len(chunk)
        return StoredFile(None, digest.hexdigest(), size)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as output:
        for chunk in iter(lambda: file.file.read(CHUNK), b""):
            digest.update(chunk)
            size += len(chunk)
            output.write(chunk)
    root = settings.upload_path or target.parent
    return StoredFile(str(target.relative_to(root)), digest.hexdigest(), size)
