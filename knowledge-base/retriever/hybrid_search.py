"""
混合检索工具

提供:
- SQLite FTS5 词法索引
- Dense / lexical 结果的 Reciprocal Rank Fusion
"""

import json
import os
import re
import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

from loguru import logger

from retriever.semantic_search import SearchResult


def _default_index_path() -> str:
    root = Path(__file__).resolve().parents[1]
    storage_dir = root / "storage"
    storage_dir.mkdir(parents=True, exist_ok=True)
    return str(storage_dir / "lexical_index.sqlite")


def _tokenize_query(query: str) -> List[str]:
    tokens = re.findall(r"[\u4e00-\u9fff]{1,8}|[A-Za-z0-9_./:-]{2,64}", str(query or ""))
    return [token.strip() for token in tokens if token.strip()]


class LexicalSearchIndex:
    def __init__(self, sqlite_path: Optional[str] = None):
        self.sqlite_path = sqlite_path or os.environ.get("KNOWLEDGE_BASE_LEXICAL_INDEX_PATH") or _default_index_path()
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.sqlite_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS chunk_documents (
                  chunk_id TEXT PRIMARY KEY,
                  collection_name TEXT NOT NULL,
                  text_content TEXT NOT NULL,
                  metadata_json TEXT NOT NULL DEFAULT '{}',
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_chunk_documents_collection
                  ON chunk_documents(collection_name);

                CREATE VIRTUAL TABLE IF NOT EXISTS chunk_documents_fts
                USING fts5(
                  chunk_id UNINDEXED,
                  collection_name UNINDEXED,
                  text_content,
                  tokenize='unicode61'
                );
                """
            )
            self._conn.commit()

    def upsert_documents(
        self,
        collection_name: str,
        ids: Sequence[str],
        texts: Sequence[str],
        metadata: Optional[Sequence[Dict[str, Any]]] = None,
    ) -> None:
        items = list(zip(ids, texts, metadata or [{} for _ in range(len(ids))]))
        if not items:
            return
        with self._lock:
            self._conn.executemany(
                """
                INSERT INTO chunk_documents (chunk_id, collection_name, text_content, metadata_json, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(chunk_id) DO UPDATE SET
                  collection_name = excluded.collection_name,
                  text_content = excluded.text_content,
                  metadata_json = excluded.metadata_json,
                  updated_at = CURRENT_TIMESTAMP
                """,
                [
                    (
                        str(chunk_id),
                        str(collection_name or "default"),
                        str(text or ""),
                        json.dumps(meta or {}, ensure_ascii=False),
                    )
                    for chunk_id, text, meta in items
                ],
            )
            self._conn.executemany(
                "DELETE FROM chunk_documents_fts WHERE chunk_id = ?",
                [(str(chunk_id),) for chunk_id, _, _ in items],
            )
            self._conn.executemany(
                """
                INSERT INTO chunk_documents_fts (chunk_id, collection_name, text_content)
                VALUES (?, ?, ?)
                """,
                [
                    (
                        str(chunk_id),
                        str(collection_name or "default"),
                        str(text or ""),
                    )
                    for chunk_id, text, _ in items
                ],
            )
            self._conn.commit()

    def list_collections(self) -> List[Dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT collection_name, COUNT(*) AS total
                FROM chunk_documents
                GROUP BY collection_name
                ORDER BY collection_name ASC
                """
            ).fetchall()
        return [
            {
                "name": row["collection_name"],
                "count": int(row["total"] or 0),
                "type": "sqlite_fts",
            }
            for row in rows
        ]

    def _search_fts(self, query: str, collection_name: str, top_k: int) -> List[SearchResult]:
        tokens = _tokenize_query(query)
        if not tokens:
            return []
        match_query = " OR ".join(f'"{token}"' for token in tokens[:12])
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT doc.chunk_id,
                       doc.text_content,
                       doc.metadata_json,
                       bm25(chunk_documents_fts) AS lexical_score
                FROM chunk_documents_fts
                INNER JOIN chunk_documents doc ON doc.chunk_id = chunk_documents_fts.chunk_id
                WHERE chunk_documents_fts MATCH ? AND doc.collection_name = ?
                ORDER BY lexical_score ASC
                LIMIT ?
                """,
                (match_query, str(collection_name or "default"), int(top_k)),
            ).fetchall()
        results: List[SearchResult] = []
        for rank, row in enumerate(rows):
            metadata = json.loads(row["metadata_json"] or "{}")
            metadata["lexical_rank"] = rank + 1
            metadata["lexical_bm25"] = float(row["lexical_score"] or 0.0)
            results.append(
                SearchResult(
                    id=str(row["chunk_id"]),
                    score=max(0.01, 1.0 - (rank / max(len(rows), 1))),
                    text=str(row["text_content"] or ""),
                    metadata=metadata,
                )
            )
        return results

    def _search_like(self, query: str, collection_name: str, top_k: int) -> List[SearchResult]:
        tokens = _tokenize_query(query)
        if not tokens:
            return []
        clauses = []
        params: List[Any] = [str(collection_name or "default")]
        for token in tokens[:8]:
            clauses.append("LOWER(doc.text_content) LIKE ?")
            params.append(f"%{token.lower()}%")
        params.append(int(top_k))
        with self._lock:
            rows = self._conn.execute(
                f"""
                SELECT doc.chunk_id, doc.text_content, doc.metadata_json
                FROM chunk_documents doc
                WHERE doc.collection_name = ? AND ({' OR '.join(clauses)})
                LIMIT ?
                """,
                params,
            ).fetchall()
        results: List[SearchResult] = []
        for rank, row in enumerate(rows):
            metadata = json.loads(row["metadata_json"] or "{}")
            metadata["lexical_rank"] = rank + 1
            metadata["lexical_fallback"] = "like"
            results.append(
                SearchResult(
                    id=str(row["chunk_id"]),
                    score=max(0.01, 0.8 - (rank / max(len(rows), 1))),
                    text=str(row["text_content"] or ""),
                    metadata=metadata,
                )
            )
        return results

    def search(self, query: str, collection_name: str = "default", top_k: int = 5) -> List[SearchResult]:
        try:
            results = self._search_fts(query, collection_name, top_k)
        except sqlite3.OperationalError as exc:
            logger.warning(f"FTS query failed, falling back to LIKE search: {exc}")
            results = []
        if results:
            return results
        return self._search_like(query, collection_name, top_k)


def reciprocal_rank_fusion(
    result_sets: Dict[str, Iterable[SearchResult]],
    limit: int = 10,
    rank_constant: int = 60,
) -> List[SearchResult]:
    merged: Dict[str, Dict[str, Any]] = {}
    for source_name, results in (result_sets or {}).items():
        for rank, item in enumerate(results or []):
            entry = merged.setdefault(
                item.id,
                {
                    "id": item.id,
                    "text": item.text,
                    "metadata": dict(item.metadata or {}),
                    "score": 0.0,
                    "source_ranks": {},
                },
            )
            entry["score"] += 1.0 / (rank_constant + rank + 1)
            entry["source_ranks"][source_name] = rank + 1
            if len(str(item.text or "")) > len(str(entry["text"] or "")):
                entry["text"] = item.text
            entry["metadata"].update(item.metadata or {})
    fused = []
    for entry in merged.values():
        metadata = dict(entry["metadata"] or {})
        metadata["fusion_score"] = round(float(entry["score"]), 6)
        metadata["source_ranks"] = entry["source_ranks"]
        fused.append(
            SearchResult(
                id=entry["id"],
                score=float(entry["score"]),
                text=entry["text"],
                metadata=metadata,
            )
        )
    fused.sort(key=lambda item: item.score, reverse=True)
    return fused[: max(1, int(limit))]
