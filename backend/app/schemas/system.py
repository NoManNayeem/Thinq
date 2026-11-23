from typing import Literal

from pydantic import BaseModel


class DatabaseHealth(BaseModel):
    status: Literal["up", "down"]
    latency_ms: float | None = None
    server_version: str | None = None
    pgvector: bool | None = None
    error: str | None = None


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    environment: str
    database: DatabaseHealth
