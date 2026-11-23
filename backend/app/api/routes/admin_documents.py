import uuid
from typing import Any

from fastapi import APIRouter, Request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import AdminDep, DbDep, SettingsDep, client_ip
from app.api.routes.documents import detail, summarize
from app.models import Document, DocumentFlag, DocumentScan
from app.schemas.common import error_responses
from app.schemas.documents import (
    AttentionItem,
    DocumentDetail,
    DocumentRegisterIn,
    DocumentUpdateIn,
    FlagDismissIn,
    FlagOut,
    ScanOut,
)
from app.services.documents import editing
from app.services.documents.access import get_visible_document, visibility_clause
from app.services.documents.importer import scan_documents

router = APIRouter(prefix="/admin/documents", tags=["admin: documents"])
ERRORS = error_responses(401, 403, 404, 409)
SEVERITY_RANK = {"critical": 0, "warning": 1, "info": 2}


@router.get("/attention", response_model=list[AttentionItem], responses=ERRORS)
async def needs_attention(admin: AdminDep, db: DbDep) -> list[AttentionItem]:
    """Documents with open flags that this Admin is allowed to see, worst first."""
    docs = (
        await db.scalars(
            select(Document)
            .where(visibility_clause(admin))
            .where(Document.flags.any(DocumentFlag.resolved_at.is_(None)))
            .options(selectinload(Document.flags), selectinload(Document.access_group))
        )
    ).all()
    items: list[AttentionItem] = []
    for doc in docs:
        open_flags = sorted(
            (f for f in doc.flags if f.resolved_at is None),
            key=lambda f: (SEVERITY_RANK[f.severity], f.kind),
        )
        items.append(
            AttentionItem(
                **summarize(doc, open_flags=len(open_flags)).model_dump(),
                flags=[FlagOut.model_validate(f) for f in open_flags],
            )
        )
    items.sort(key=lambda i: (SEVERITY_RANK[i.flags[0].severity], -len(i.flags), i.title.lower()))
    return items


@router.patch("/{document_id}", response_model=DocumentDetail, responses=ERRORS)
async def update_document(
    document_id: uuid.UUID, body: DocumentUpdateIn, admin: AdminDep, db: DbDep, request: Request
) -> DocumentDetail:
    doc = await get_visible_document(db, admin, document_id)
    await db.refresh(doc, ["access_group"])
    fields = body.model_fields_set
    kwargs: dict[str, Any] = {k: getattr(body, k) for k in fields}
    await editing.update_document(
        db, actor=admin.user, doc=doc, ip_address=client_ip(request), **kwargs
    )
    await db.commit()
    await db.refresh(doc, ["access_group"])
    return await detail(db, admin, doc)


@router.post("/{document_id}/register", response_model=DocumentDetail, responses=ERRORS)
async def register_document(
    document_id: uuid.UUID, body: DocumentRegisterIn, admin: AdminDep, db: DbDep, request: Request
) -> DocumentDetail:
    doc = await get_visible_document(db, admin, document_id)
    await editing.register_document(
        db,
        actor=admin.user,
        doc=doc,
        title=body.title,
        access_group_id=body.access_group_id,
        owner_name=body.owner_name,
        owner_user_id=body.owner_user_id,
        ip_address=client_ip(request),
    )
    await db.commit()
    await db.refresh(doc, ["access_group"])
    return await detail(db, admin, doc)


@router.post(
    "/{document_id}/flags/{flag_id}/dismiss", response_model=DocumentDetail, responses=ERRORS
)
async def dismiss_flag(
    document_id: uuid.UUID,
    flag_id: int,
    body: FlagDismissIn,
    admin: AdminDep,
    db: DbDep,
    request: Request,
) -> DocumentDetail:
    doc = await get_visible_document(db, admin, document_id)
    await editing.dismiss_flag(
        db,
        actor=admin.user,
        doc=doc,
        flag_id=flag_id,
        note=body.note,
        ip_address=client_ip(request),
    )
    await db.commit()
    await db.refresh(doc, ["access_group"])
    return await detail(db, admin, doc)


@router.post("/scan", response_model=ScanOut, responses=ERRORS)
async def scan(admin: AdminDep, db: DbDep, settings: SettingsDep) -> ScanOut:
    await scan_documents(db, settings.seed_dir, actor=admin.user)
    await db.commit()
    latest = await db.scalar(select(DocumentScan).order_by(DocumentScan.id.desc()).limit(1))
    return ScanOut.model_validate(latest)


@router.get("/scans/latest", response_model=ScanOut | None, responses=ERRORS)
async def latest_scan(_: AdminDep, db: DbDep) -> ScanOut | None:
    latest = await db.scalar(select(DocumentScan).order_by(DocumentScan.id.desc()).limit(1))
    return ScanOut.model_validate(latest) if latest else None
