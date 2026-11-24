import uuid
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import AdminDep, DbDep, SettingsDep, client_ip
from app.api.routes.documents import detail, flag_out, summarize
from app.core.errors import PayloadTooLarge
from app.models import Document, DocumentFlag, DocumentScan
from app.schemas.common import error_responses
from app.schemas.documents import (
    AttentionItem,
    DocumentDetail,
    DocumentRegisterIn,
    DocumentUpdateIn,
    FlagDismissIn,
    ScanOut,
    UploadIn,
)
from app.services.documents import editing
from app.services.documents.access import get_visible_document, visibility_clause
from app.services.documents.sync import run_sync, source_for

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
    mine = {
        str(i)
        for i in (await db.scalars(select(Document.id).where(visibility_clause(admin)))).all()
    }
    items: list[AttentionItem] = []
    for doc in docs:
        open_flags = sorted(
            (f for f in doc.flags if f.resolved_at is None),
            key=lambda f: (SEVERITY_RANK[f.severity], f.kind),
        )
        items.append(
            AttentionItem(
                **summarize(doc, open_flags=len(open_flags)).model_dump(),
                flags=[flag_out(f, mine) for f in open_flags],
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


@router.post("/scan", response_model=ScanOut, responses={**ERRORS, 502: error_responses(502)[502]})
async def scan(admin: AdminDep, db: DbDep, settings: SettingsDep, request: Request) -> ScanOut:
    await run_sync(
        request.app.state.sessionmaker, settings, actor_id=admin.user.id, trigger="manual"
    )
    if request.app.state.knowledge is not None:
        request.app.state.knowledge.nudge()
    latest = await db.scalar(select(DocumentScan).order_by(DocumentScan.id.desc()).limit(1))
    return ScanOut.model_validate(latest)


@router.get("/scans", response_model=list[ScanOut], responses=ERRORS)
async def scan_history(_: AdminDep, db: DbDep) -> list[ScanOut]:
    rows = await db.scalars(select(DocumentScan).order_by(DocumentScan.id.desc()).limit(50))
    return [ScanOut.model_validate(r) for r in rows.all()]


@router.get("/scans/latest", response_model=ScanOut | None, responses=ERRORS)
async def latest_scan(_: AdminDep, db: DbDep) -> ScanOut | None:
    latest = await db.scalar(select(DocumentScan).order_by(DocumentScan.id.desc()).limit(1))
    return ScanOut.model_validate(latest) if latest else None


@router.post(
    "/upload",
    response_model=DocumentDetail,
    status_code=201,
    responses={**ERRORS, 413: error_responses(413)[413]},
)
async def upload(
    body: UploadIn, admin: AdminDep, db: DbDep, settings: SettingsDep, request: Request
) -> DocumentDetail:
    """Add a Markdown or text document without putting it in the synced folder."""
    if len(body.content.encode()) > settings.upload_max_bytes:
        raise PayloadTooLarge(f"Documents can be at most {settings.upload_max_bytes // 1000} KB.")
    doc = await editing.upload_document(
        db,
        actor=admin.user,
        filename=body.filename,
        content=body.content,
        title=body.title,
        access_group_id=body.access_group_id,
        owner_name=body.owner_name,
        owner_user_id=body.owner_user_id,
        status=body.status,
        ip_address=client_ip(request),
    )
    await db.commit()
    if request.app.state.knowledge is not None:
        request.app.state.knowledge.nudge()
    doc = await get_visible_document(db, admin, doc.id)
    await db.refresh(doc, ["access_group"])
    return await detail(db, admin, doc)


class FolderSourceOut(BaseModel):
    kind: str
    path: str | None
    available: bool
    manifest: bool
    sync_interval_s: float
    uploads: int


@router.get("/source", response_model=FolderSourceOut, responses=ERRORS)
async def source_info(_: AdminDep, db: DbDep, settings: SettingsDep) -> FolderSourceOut:
    info = source_for(settings).describe()
    uploads = await db.scalar(
        select(func.count()).select_from(Document).where(Document.source_kind == "upload")
    )
    return FolderSourceOut(
        kind=str(info["kind"]),
        path=str(info["path"]) if info["path"] else None,
        available=bool(info["available"]),
        manifest=bool(info["manifest"]),
        sync_interval_s=settings.sync_interval_s,
        uploads=int(uploads or 0),
    )
