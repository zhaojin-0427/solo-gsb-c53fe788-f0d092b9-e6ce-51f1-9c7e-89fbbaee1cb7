"""航标灯质本地 Web 预检台 —— FastAPI 入口。"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import analyzer, db

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"

DEFAULT_DRAFT = {
    "lights": [
        {"name": "灯 A", "code": "11010"},
        {"name": "灯 B", "code": "10011"},
    ],
    "W": 40,
    "k": 0,
}


class AnalyzeRequest(BaseModel):
    lights: list[dict]
    W: int = Field(...)
    k: int = Field(...)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    if db.get_kv("draft") is None:
        db.set_kv("draft", json.dumps(DEFAULT_DRAFT, ensure_ascii=False))
    yield


app = FastAPI(title="航标灯质可辨性预检台", version="1.0.0", lifespan=lifespan)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/draft")
def get_draft() -> dict:
    raw = db.get_kv("draft")
    return json.loads(raw) if raw is not None else DEFAULT_DRAFT


@app.put("/api/draft")
def save_draft(payload: dict) -> dict:
    # 草稿只做轻量保存，不阻断编辑；分析时再做完整校验
    db.set_kv("draft", json.dumps(payload, ensure_ascii=False))
    return {"ok": True}


@app.post("/api/analyses")
def create_analysis(req: AnalyzeRequest) -> JSONResponse:
    payload = req.model_dump()
    errors = analyzer.validate_config(payload)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    result = analyzer.run(payload)
    analysis_id = db.save_analysis(payload, result)
    return JSONResponse({"id": analysis_id, "result": result}, status_code=201)


@app.get("/api/analyses")
def analyses_index() -> list[dict]:
    return db.list_analyses()


@app.get("/api/analyses/{analysis_id}")
def analysis_detail(analysis_id: int) -> dict:
    record = db.get_analysis(analysis_id)
    if record is None:
        raise HTTPException(status_code=404, detail="分析记录不存在")
    return record


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
