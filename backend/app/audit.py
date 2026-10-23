from app.labels import status_title
from app.logs import current_correlation
from app.models import SYSTEM_ACTOR, ApplicationRecord, AuditRecord, UserRecord, uid
from app.repo import Db


def record_audit(
    db: Db,
    actor: UserRecord | None,
    action: str,
    entity_type: str,
    entity_id: str,
    summary: str,
    at: int,
) -> None:
    db.add(
        AuditRecord(
            id=uid(),
            created_at=at,
            actor_id=actor.id if actor else None,
            actor_name=actor.full_name if actor else SYSTEM_ACTOR,
            actor_role=actor.role if actor and actor.is_bank else "SYSTEM",
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary,
            correlation_id=current_correlation(),
        )
    )


def decision_summary(record: ApplicationRecord) -> str:
    return f"Решение по заявке {record.number}: {status_title(record.status).lower()}"
