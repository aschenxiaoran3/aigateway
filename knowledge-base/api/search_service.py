"""
知识库搜索服务 - FastAPI 语义检索 API

启动:
    python -m api.search_service
    # 或
    uvicorn api.search_service:app --host 0.0.0.0 --port 8000
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
import hashlib
import uuid
from typing import List, Optional, Dict, Any
from pathlib import Path
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from loguru import logger

# 添加项目根目录到 path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from ingest.document_loader import get_loader, load_directory
from ingest.chunker import MarkdownChunker, Chunk
from ingest.embedder import Embedder
from retriever.hybrid_search import LexicalSearchIndex, reciprocal_rank_fusion
from retriever.reranker import SearchReranker
from retriever.semantic_search import (
    SemanticSearch,
    SearchResult,
    list_vector_store_collections,
    resolve_vector_store_provider,
)

# ---------- 日志配置 ----------
logger.remove()
logger.add(sys.stderr, level="INFO", format="{time:HH:mm:ss} | {level:<7} | {message}")


def _log_rag_query_to_control_plane(payload: Dict[str, Any]) -> None:
    """若设置 CONTROL_PLANE_RAG_LOG_URL（如 http://127.0.0.1:3003/api/v1/knowledge/rag-queries），异步式同步检索日志。"""
    url = os.environ.get("CONTROL_PLANE_RAG_LOG_URL", "").strip()
    if not url:
        return
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        logger.warning(f"control-plane RAG log skipped: {e}")


# ---------- 全局状态 ----------
embedder: Optional[Embedder] = None
collection_engines: Dict[str, SemanticSearch] = {}
collections: Dict[str, Dict[str, Any]] = {}  # collection_name -> metadata


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}
lexical_index: Optional[LexicalSearchIndex] = None
reranker: Optional[SearchReranker] = None


# ---------- Pydantic 模型 ----------
class IngestRequest(BaseModel):
    """入库请求 - 单文档"""
    content: str = Field(..., description="文档内容")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="文档元数据")
    collection: str = Field(default="default", description="集合名称")
    chunk_size: int = Field(default=500, ge=100, le=2000, description="分块大小")
    chunk_overlap: int = Field(default=50, ge=0, le=500, description="分块重叠")


class IngestFileRequest(BaseModel):
    """入库请求 - 文件路径"""
    file_path: str = Field(..., description="文件绝对路径")
    collection: str = Field(default="default", description="集合名称")
    chunk_size: int = Field(default=500, ge=100, le=2000)
    chunk_overlap: int = Field(default=50, ge=0, le=500)


class IngestDirRequest(BaseModel):
    """入库请求 - 目录"""
    dir_path: str = Field(..., description="目录绝对路径")
    collection: str = Field(default="default", description="集合名称")
    extensions: Optional[List[str]] = Field(default=None, description="文件扩展名过滤")
    chunk_size: int = Field(default=500, ge=100, le=2000)
    chunk_overlap: int = Field(default=50, ge=0, le=500)


class SearchRequest(BaseModel):
    """搜索请求"""
    query: str = Field(..., description="搜索查询")
    collection: str = Field(default="default", description="集合名称")
    top_k: int = Field(default=5, ge=1, le=50, description="返回结果数")
    min_score: float = Field(default=0.0, ge=0.0, le=1.0, description="最低相似度")
    filters: Optional[Dict[str, Any]] = Field(default=None, description="元数据过滤条件")
    asset_category: Optional[str] = Field(default=None, description="资产分类过滤")
    domain: Optional[str] = Field(default=None, description="领域过滤")
    module: Optional[str] = Field(default=None, description="模块过滤")
    version: Optional[str] = Field(default=None, description="版本过滤")
    trace_id: Optional[str] = Field(default=None, description="写入 control-plane RAG 日志")
    project_code: Optional[str] = Field(default=None, description="写入 control-plane RAG 日志")
    knowledge_asset_id: Optional[int] = Field(default=None, description="写入 control-plane RAG 日志")
    retrieval_mode: str = Field(default="hybrid", description="检索模式 dense|hybrid")
    candidate_k: int = Field(default=12, ge=1, le=100, description="召回候选数")
    rerank_top_k: int = Field(default=8, ge=1, le=100, description="重排候选数")
    query_mode: str = Field(default="auto", description="查询模式 local|global|auto")


class SearchResponse(BaseModel):
    """搜索响应"""
    query: str
    results: List[Dict[str, Any]]
    total: int
    collection: str
    trace: Dict[str, Any] = Field(default_factory=dict)


class IngestResponse(BaseModel):
    """入库响应"""
    collection: str
    chunks_ingested: int
    document_ids: List[str]
    message: str


class CollectionInfo(BaseModel):
    """集合信息"""
    name: str
    chunk_count: int
    metadata: Dict[str, Any]


class CollectionsResponse(BaseModel):
    collections: List[CollectionInfo]


class HealthResponse(BaseModel):
    status: str
    embedder_model: str
    embedder_fallback: bool
    vector_store: str
    total_documents: int


def build_chunk_document_ids(chunks: List[Chunk], collection_name: str) -> List[str]:
    ids: List[str] = []
    for index, chunk in enumerate(chunks):
        metadata = chunk.metadata or {}
        stable_key_parts = [
            collection_name or "default",
            str(metadata.get("knowledge_asset_id") or ""),
            str(metadata.get("source_uri") or ""),
            str(metadata.get("section") or ""),
            str(index),
            hashlib.sha1(chunk.text.encode("utf-8")).hexdigest(),
        ]
        stable_key = "::".join(stable_key_parts)
        ids.append(str(uuid.uuid5(uuid.NAMESPACE_URL, stable_key)))
    return ids


# ---------- 生命周期 ----------
@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动/关闭生命周期"""
    global embedder, collection_engines, lexical_index, reranker

    # 启动时初始化
    logger.info("Initializing Knowledge Base Search Service...")

    model_name = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
    embedder = Embedder(model_name=model_name)
    logger.info(f"Embedder: {model_name} (fallback={embedder.is_fallback})")
    lexical_index = LexicalSearchIndex()
    if env_flag("ENABLE_RERANKER", True):
        reranker = SearchReranker()
    else:
        reranker = None
        logger.info("Reranker disabled by ENABLE_RERANKER=false")
    if env_flag("SKIP_COLLECTION_HYDRATION", False):
        logger.info("Skipping collection hydration by SKIP_COLLECTION_HYDRATION=true")
    else:
        hydrate_collections_from_store()

    logger.info("Knowledge Base Search Service ready!")

    yield

    # 关闭时清理
    logger.info("Shutting down Knowledge Base Search Service...")


# ---------- FastAPI 应用 ----------
app = FastAPI(
    title="Knowledge Base Search Service",
    description="RAG 知识库语义检索 API",
    version="0.1.0",
    lifespan=lifespan,
)


def hydrate_collections_from_store() -> None:
    try:
        items = list_vector_store_collections()
        if lexical_index is not None:
            items.extend(lexical_index.list_collections())
        seen = {}
        for item in items:
            bucket = seen.setdefault(
                item["name"],
                {
                    "chunk_count": 0,
                    "created_at": time.time(),
                    "vector_store": item.get("type") or resolve_vector_store_provider(),
                },
            )
            bucket["chunk_count"] = max(int(bucket.get("chunk_count") or 0), int(item.get("count") or 0))
            if item.get("type"):
                bucket["vector_store"] = item["type"]
        collections.update(seen)
        if items:
            logger.info(f"Hydrated {len(seen)} collections from existing stores")
    except Exception as e:
        logger.warning(f"Failed to hydrate collections from vector store: {e}")


def get_or_create_collection_engine(collection_name: str) -> SemanticSearch:
    engine = collection_engines.get(collection_name)
    if engine is None:
        engine = SemanticSearch(dimension=embedder.dimension, collection_name=collection_name)
        collection_engines[collection_name] = engine
        info = engine.get_collection_info()
        collections.setdefault(
            collection_name,
            {
                "chunk_count": info.get("count", 0),
                "created_at": time.time(),
                "vector_store": info.get("type"),
            },
        )
        logger.info(f"Initialized collection '{collection_name}' with {type(engine.store).__name__}")
    return engine


def build_search_filters(req: SearchRequest) -> Dict[str, Any]:
    filters: Dict[str, Any] = dict(req.filters or {})
    if req.asset_category:
        filters["asset_category"] = req.asset_category
    if req.domain:
        filters["domain"] = req.domain
    if req.module:
        filters["module"] = req.module
    if req.version:
        filters["version"] = req.version
    if req.knowledge_asset_id is not None:
        filters["knowledge_asset_id"] = req.knowledge_asset_id
    return filters


def apply_metadata_filters(results: List[SearchResult], filters: Dict[str, Any]) -> List[SearchResult]:
    if not filters:
        return results
    filtered: List[SearchResult] = []
    for result in results:
        match = True
        for key, value in filters.items():
            if key not in result.metadata:
                match = False
                break
            current = result.metadata[key]
            if isinstance(value, list):
                if current not in value:
                    match = False
                    break
            elif current != value:
                match = False
                break
        if match:
            filtered.append(result)
    return filtered


def serialize_result(result: SearchResult) -> Dict[str, Any]:
    payload = {
        **result.to_dict(),
        "chunk_id": result.id,
        "knowledge_asset_id": result.metadata.get("knowledge_asset_id"),
        "source_uri": result.metadata.get("source_uri"),
    }
    return payload


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """健康检查"""
    first_engine = next(iter(collection_engines.values()), None)
    store_type = type(first_engine.store).__name__ if first_engine else f"{resolve_vector_store_provider()}(lazy)"
    return HealthResponse(
        status="healthy",
        embedder_model=embedder.model_name if embedder else "unknown",
        embedder_fallback=embedder.is_fallback if embedder else True,
        vector_store=store_type,
        total_documents=sum(engine.count for engine in collection_engines.values()) or sum(
            int(info.get("chunk_count") or 0) for info in collections.values()
        ),
    )


@app.post("/api/v1/ingest", response_model=IngestResponse)
async def ingest_document(req: IngestRequest):
    """
    入库文档内容
    
    将文档分块、嵌入并存入向量存储。
    """
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    chunker = MarkdownChunker(chunk_size=req.chunk_size, overlap=req.chunk_overlap)
    chunks = chunker.chunk(req.content, metadata=req.metadata)

    if not chunks:
        raise HTTPException(status_code=400, detail="No chunks generated from content")

    texts = [c.text for c in chunks]
    chunk_metadata = [c.metadata for c in chunks]

    # 生成嵌入
    vectors = embedder.encode(texts)

    engine = get_or_create_collection_engine(req.collection)

    # 存储
    doc_ids = build_chunk_document_ids(chunks, req.collection)
    engine.add_documents(
        texts=texts,
        vectors=vectors,
        metadata=chunk_metadata,
        ids=doc_ids,
    )
    if lexical_index is not None:
        lexical_index.upsert_documents(req.collection, doc_ids, texts, chunk_metadata)

    # 更新集合信息
    if req.collection not in collections:
        collections[req.collection] = {
            "chunk_count": 0,
            "last_updated": None,
        }
    collections[req.collection]["chunk_count"] += len(chunks)

    logger.info(f"Ingested {len(chunks)} chunks into collection '{req.collection}'")

    return IngestResponse(
        collection=req.collection,
        chunks_ingested=len(chunks),
        document_ids=doc_ids,
        message=f"Successfully ingested {len(chunks)} chunks",
    )


@app.post("/api/v1/ingest/file", response_model=IngestResponse)
async def ingest_file(req: IngestFileRequest):
    """入库单个文件"""
    file_path = Path(req.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {req.file_path}")

    try:
        loader = get_loader(str(file_path))
        doc = loader.load()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load file: {str(e)}")

    content = doc["content"]
    metadata = {**doc["metadata"], "collection": req.collection}

    chunker = MarkdownChunker(chunk_size=req.chunk_size, overlap=req.chunk_overlap)
    chunks = chunker.chunk(content, metadata=metadata)

    if not chunks:
        raise HTTPException(status_code=400, detail="No chunks generated")

    texts = [c.text for c in chunks]
    vectors = embedder.encode(texts)
    doc_ids = build_chunk_document_ids(chunks, req.collection)
    engine = get_or_create_collection_engine(req.collection)

    engine.add_documents(
        texts=texts,
        vectors=vectors,
        metadata=[c.metadata for c in chunks],
        ids=doc_ids,
    )
    if lexical_index is not None:
        lexical_index.upsert_documents(req.collection, doc_ids, texts, [c.metadata for c in chunks])

    if req.collection not in collections:
        collections[req.collection] = {"chunk_count": 0}
    collections[req.collection]["chunk_count"] += len(chunks)

    return IngestResponse(
        collection=req.collection,
        chunks_ingested=len(chunks),
        document_ids=doc_ids,
        message=f"File '{file_path.name}' ingested: {len(chunks)} chunks",
    )


@app.post("/api/v1/ingest/directory", response_model=IngestResponse)
async def ingest_directory(req: IngestDirRequest):
    """入库目录下的所有文档"""
    dir_path = Path(req.dir_path)
    if not dir_path.exists():
        raise HTTPException(status_code=404, detail=f"Directory not found: {req.dir_path}")

    try:
        documents = load_directory(str(dir_path), extensions=req.extensions)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load directory: {str(e)}")

    if not documents:
        raise HTTPException(status_code=400, detail="No documents found in directory")

    all_chunk_ids = []
    total_chunks = 0
    chunker = MarkdownChunker(chunk_size=req.chunk_size, overlap=req.chunk_overlap)

    for doc in documents:
        metadata = {**doc["metadata"], "collection": req.collection}
        chunks = chunker.chunk(doc["content"], metadata=metadata)

        if not chunks:
            continue

        texts = [c.text for c in chunks]
        vectors = embedder.encode(texts)
        doc_ids = build_chunk_document_ids(chunks, req.collection)
        engine = get_or_create_collection_engine(req.collection)

        engine.add_documents(
            texts=texts,
            vectors=vectors,
            metadata=[c.metadata for c in chunks],
            ids=doc_ids,
        )
        if lexical_index is not None:
            lexical_index.upsert_documents(req.collection, doc_ids, texts, [c.metadata for c in chunks])

        all_chunk_ids.extend(doc_ids)
        total_chunks += len(chunks)

    if req.collection not in collections:
        collections[req.collection] = {"chunk_count": 0}
    collections[req.collection]["chunk_count"] += total_chunks

    return IngestResponse(
        collection=req.collection,
        chunks_ingested=total_chunks,
        document_ids=all_chunk_ids,
        message=f"Directory ingested: {len(documents)} files, {total_chunks} chunks",
    )


@app.post("/api/v1/search", response_model=SearchResponse)
async def search(req: SearchRequest):
    """
    语义搜索
    
    将查询文本嵌入后在向量存储中检索最相关的文档块。
    """
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    t0 = time.perf_counter()

    engine = get_or_create_collection_engine(req.collection)
    filters = build_search_filters(req)
    retrieval_mode = str(req.retrieval_mode or "hybrid").strip().lower()
    candidate_k = max(req.top_k, req.candidate_k, req.rerank_top_k)

    dense_results: List[SearchResult] = []
    lexical_results: List[SearchResult] = []
    fused_results: List[SearchResult] = []

    query_vector = embedder.encode_single(req.query)
    dense_results = apply_metadata_filters(
        engine.search(query_vector, top_k=candidate_k, min_score=req.min_score),
        filters,
    )
    if retrieval_mode == "hybrid":
        lexical_results = apply_metadata_filters(
            lexical_index.search(req.query, collection_name=req.collection, top_k=candidate_k) if lexical_index else [],
            filters,
        )
        fused_results = reciprocal_rank_fusion(
            {
                "dense": dense_results,
                "lexical": lexical_results,
            },
            limit=max(candidate_k, req.rerank_top_k),
        )
    else:
        fused_results = dense_results[:candidate_k]

    if req.min_score > 0:
        fused_results = [item for item in fused_results if item.score >= req.min_score]

    final_results = reranker.rerank(req.query, fused_results, top_k=req.top_k) if reranker else fused_results[:req.top_k]

    latency_ms = int((time.perf_counter() - t0) * 1000)
    _log_rag_query_to_control_plane(
        {
            "trace_id": req.trace_id,
            "project_code": req.project_code,
            "knowledge_asset_id": req.knowledge_asset_id,
            "query_text": req.query,
            "result_count": len(final_results),
            "latency_ms": latency_ms,
            "retrieval_mode": retrieval_mode,
            "candidate_k": candidate_k,
            "query_mode": req.query_mode,
        }
    )

    return SearchResponse(
        query=req.query,
        results=[serialize_result(r) for r in final_results],
        total=len(final_results),
        collection=req.collection,
        trace={
            "retrieval_mode": retrieval_mode,
            "query_mode": req.query_mode,
            "candidate_k": candidate_k,
            "rerank_top_k": req.rerank_top_k,
            "dense_hits": len(dense_results),
            "lexical_hits": len(lexical_results),
            "reranker_model": reranker.model_name if reranker else "",
            "reranker_fallback": reranker.is_fallback if reranker else True,
            "embedder_fallback": embedder.is_fallback if embedder else True,
            "latency_ms": latency_ms,
        },
    )


@app.get("/api/v1/collections", response_model=CollectionsResponse)
async def list_collections():
    """列出所有文档集合"""
    collection_list = []

    for name, info in collections.items():
        engine = collection_engines.get(name)
        chunk_count = info.get("chunk_count", 0)
        if engine is not None:
            chunk_count = engine.count
        elif info.get("vector_store") in {"qdrant", "dashvector"}:
            try:
                chunk_count = get_or_create_collection_engine(name).count
            except Exception as e:
                logger.warning(f"Failed to refresh collection '{name}' from store: {e}")
        collection_list.append(CollectionInfo(
            name=name,
            chunk_count=chunk_count,
            metadata=info,
        ))

    return CollectionsResponse(collections=collection_list)


# ---------- 入口 ----------
if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")

    logger.info(f"Starting Knowledge Base Search Service on {host}:{port}")
    uvicorn.run(
        "api.search_service:app",
        host=host,
        port=port,
        reload=os.environ.get("RELOAD", "false").lower() == "true",
        log_level="info",
    )
