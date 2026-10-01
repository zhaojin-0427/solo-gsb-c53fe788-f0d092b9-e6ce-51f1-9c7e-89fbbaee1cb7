"""SQLite 持久层：分析记录（不可变快照）+ 草稿（可反复编辑）。"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "beacon.db"
_write_lock = threading.Lock()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS analyses (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
                config_json TEXT    NOT NULL,   -- 分析时固定的灯串与 W/k 快照
                result_json TEXT    NOT NULL,   -- 穷举分析完整结果
                n_star      INTEGER,            -- 最短可辨窗口；NULL 表示 W 位内无解
                solvable    INTEGER NOT NULL,
                light_count INTEGER NOT NULL,
                W           INTEGER NOT NULL,
                k           INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS kv (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )


def save_analysis(config: dict[str, Any], result: dict[str, Any]) -> int:
    """保存一条不可变分析记录，返回其 id。"""
    with _write_lock, get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO analyses
                (config_json, result_json, n_star, solvable, light_count, W, k)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                json.dumps(config, ensure_ascii=False),
                json.dumps(result, ensure_ascii=False),
                result["n_star"],
                1 if result["solvable"] else 0,
                result["light_count"],
                result["W"],
                result["k"],
            ),
        )
        return int(cur.lastrowid)


def list_analyses() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, created_at, n_star, solvable, light_count, W, k
            FROM analyses
            ORDER BY id DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def get_analysis(analysis_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM analyses WHERE id = ?", (analysis_id,)
        ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "config": json.loads(row["config_json"]),
        "result": json.loads(row["result_json"]),
    }


def get_kv(key: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
    return None if row is None else row["value"]


def set_kv(key: str, value: str) -> None:
    with _write_lock, get_conn() as conn:
        conn.execute(
            "INSERT INTO kv(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
