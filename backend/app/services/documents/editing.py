"""Admin changes to document metadata. Status changes arrive with the approval flow (Task 4)."""

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, Conflict, NotFound
from app.models import Document, DocumentFlag, Group, User
from app.services import audit
from app.services.documents.flags import reconcile_flags

_UNSET: Any = object()


async def _group(db: AsyncSession, group_id: uuid.UUID) -> Group:
    group = await db.get(Group, group_id)
    if group is None:
        raise NotFound("Group not found.")
    return group


async def _resolve_owner(
    db: AsyncSession, owner_name: str | None, owner_user_id: uuid.UUID | None
) -> tuple[str | None, uuid.UUID | None]:
    if owner_user_id is not None:
        user = await db.get(User, owner_user_id)
        if user is None:
            raise NotFound("User not found.")
        return user.name, user.id
    name = (owner_name or "").strip() or None
    if name is None:
        return None, None
    match = await db.scalar(select(User).where(User.name.ilike(name)))
    return name, match.id if match else None


async def update_document(
    db: AsyncSession,
    *,
    actor: User,
    doc: Document,
    title: str | None = _UNSET,
    owner_name: str | None = _UNSET,
    owner_user_id: uuid.UUID | None = _UNSET,
    access_group_id: uuid.UUID | None = _UNSET,
    ip_address: str | None,
) -> Document:
    changes: dict[str, dict[str, Any]] = {}

    if title is not _UNSET and title and title != doc.title:
        changes["title"] = {"from": doc.title, "to": title}
        doc.title = title

    if owner_name is not _UNSET or owner_user_id is not _UNSET:
        name, user_id = await _resolve_owner(
            db,
            None if owner_name is _UNSET else owner_name,
            None if owner_user_id is _UNSET else owner_user_id,
        )
        if name != doc.owner_name or user_id != doc.owner_user_id:
            changes["owner"] = {"from": doc.owner_name, "to": name}
            doc.owner_name, doc.owner_user_id = name, user_id

    if access_group_id is not _UNSET:
        if access_group_id is None:
            raise AppError(
                "A registered document must belong to an access group.", code="group_required"
            )
        group = await _group(db, access_group_id)
        if group.id != doc.access_group_id:
            before = doc.access_group.name if doc.access_group else None
            doc.access_group_id = group.id
            await audit.record(
                db,
                actor=actor,
                action="document.access_changed",
                target=doc,
                details={"from": before, "to": group.name},
                ip_address=ip_address,
            )

    if changes:
        await audit.record(
            db,
            actor=actor,
            action="document.updated",
            target=doc,
            details=changes,
            ip_address=ip_address,
        )
    await db.flush()
    await reconcile_flags(db)
    return doc


async def register_document(
    db: AsyncSession,
    *,
    actor: User,
    doc: Document,
    title: str,
    access_group_id: uuid.UUID,
    owner_name: str | None,
    owner_user_id: uuid.UUID | None,
    ip_address: str | None,
) -> Document:
    if doc.is_registered:
        raise Conflict("This document is already registered.", code="already_registered")
    group = await _group(db, access_group_id)
    name, user_id = await _resolve_owner(db, owner_name, owner_user_id)
    doc.title = title
    doc.access_group_id = group.id
    doc.owner_name, doc.owner_user_id = name, user_id
    doc.is_registered = True
    await audit.record(
        db,
        actor=actor,
        action="document.registered",
        target=doc,
        details={"access_group": group.name, "owner": name},
        ip_address=ip_address,
    )
    await db.flush()
    await reconcile_flags(db)
    return doc


async def dismiss_flag(
    db: AsyncSession, *, actor: User, doc: Document, flag_id: int, note: str, ip_address: str | None
) -> DocumentFlag:
    flag = await db.get(DocumentFlag, flag_id)
    if flag is None or flag.document_id != doc.id:
        raise NotFound("Flag not found.")
    if flag.resolved_at is not None:
        raise Conflict("This flag is already resolved.", code="flag_resolved")
    if flag.kind in {"unregistered", "unknown_access_group"}:
        raise Conflict("Assign an access group to resolve this.", code="flag_not_dismissable")
    flag.resolved_at = datetime.now(UTC)
    flag.resolution = "dismissed"
    flag.resolved_by_id = actor.id
    flag.resolution_note = note
    await audit.record(
        db,
        actor=actor,
        action="document.flag_dismissed",
        target=doc,
        details={"kind": flag.kind, "note": note},
        ip_address=ip_address,
    )
    await db.flush()
    return flag


async def _visible_to(db: AsyncSession, user: User, doc: Document) -> bool:
    from app.services.access import effective_groups

    if doc.access_group_id is None:
        return user.is_admin
    return doc.access_group_id in {g.id for g in await effective_groups(db, user)}


async def upload_document(
    db: AsyncSession,
    *,
    actor: User,
    filename: str,
    content: str,
    title: str | None,
    access_group_id: uuid.UUID,
    owner_name: str | None,
    owner_user_id: uuid.UUID | None,
    status: str,
    ip_address: str | None,
) -> Document:
    """Add a document directly in Thinq. Uploading the same file name again adds a version."""
    from app.models import DocumentVersion
    from app.services.documents.importer import _hash, _title_from
    from app.services.documents.trust import ensure_families, refresh_proposals

    source_path = f"uploads/{filename}"
    digest = _hash(content)
    group = await _group(db, access_group_id)
    name, user_id = await _resolve_owner(db, owner_name, owner_user_id)
    doc = await db.scalar(select(Document).where(Document.source_path == source_path))
    if doc is not None and not await _visible_to(db, actor, doc):
        # Never touch, or confirm the existence of, a document this Admin can't see.
        raise Conflict(
            "That file name is taken. Rename the file and upload it again.", code="name_taken"
        )
    if doc is None:
        doc = Document(
            source_path=source_path,
            source_kind="upload",
            title=(title or "").strip() or _title_from(content, Path(filename)),
            content=content,
            content_hash=digest,
            current_version=1,
            last_modified=datetime.now(UTC).date(),
            status=status,
            is_registered=True,
            source_present=True,
            access_group_id=group.id,
            owner_name=name,
            owner_user_id=user_id,
            manifest={},
        )
        db.add(doc)
        await db.flush()
        db.add(DocumentVersion(document_id=doc.id, version=1, content=content, content_hash=digest))
        action = "document.uploaded"
    else:
        if digest == doc.content_hash:
            raise Conflict("That file is identical to the current version.", code="unchanged")
        doc.current_version += 1
        doc.content, doc.content_hash = content, digest
        doc.last_modified = datetime.now(UTC).date()
        db.add(
            DocumentVersion(
                document_id=doc.id,
                version=doc.current_version,
                content=content,
                content_hash=digest,
            )
        )
        action = "document.new_version"
    await audit.record(
        db,
        actor=actor,
        action=action,
        target=doc,
        details={"file": filename, "version": doc.current_version, "access_group": group.name},
        ip_address=ip_address,
    )
    await db.flush()
    await ensure_families(db)
    await reconcile_flags(db)
    await refresh_proposals(db)
    return doc
