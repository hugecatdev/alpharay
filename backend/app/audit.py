from app.fmt import iso
from app.labels import status_title
from app.models import SYSTEM_ACTOR, Db, StoredApplication, StoredUser, uid
from app.schemas import AuditEntry


def record_audit(
    db: Db,
    actor: StoredUser | None,
    action: str,
    entity_type: str,
    entity_id: str,
    summary: str,
    at: int,
) -> None:
    db.audit.append(
        AuditEntry(
            id=uid(),
            created_at=iso(at),
            actor_id=actor.id if actor else None,
            actor_name=actor.full_name if actor else SYSTEM_ACTOR,
            actor_role=actor.role if actor and actor.is_bank else "SYSTEM",
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
        )
    )


def decision_summary(record: StoredApplication) -> str:
    return f"Решение по заявке {record.app.number}: {status_title(record.app.status).lower()}"
