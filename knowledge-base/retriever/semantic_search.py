"""
语义搜索引擎 - 向量相似度检索

用法:
    from retriever.semantic_search import SemanticSearch
    engine = SemanticSearch(dimension=1024)
    
    # 添加文档
    engine.add(ids=["1", "2"], vectors=embeddings, texts=["文本1", "文本2"], metadata=[{}, {}])
    
    # 搜索
    results = engine.search(query_vector, top_k=5)
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
import numpy as np
from loguru import logger


@dataclass
class SearchResult:
    """单次搜索结果"""
    id: str
    score: float
    text: str
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "score": round(self.score, 4),
            "text": self.text,
            "metadata": self.metadata,
        }


class InMemoryVectorStore:
    """
    内存向量存储 - 使用 numpy 计算相似度
    
    适用于小到中等规模的数据集。
    """

    def __init__(self, dimension: int):
        self.dimension = dimension
        self._ids: List[str] = []
        self._vectors: Optional[np.ndarray] = None  # shape: (n, dimension)
        self._texts: List[str] = []
        self._metadata: List[Dict[str, Any]] = []
        self._count = 0

    def add(self, ids: List[str], vectors: np.ndarray, 
            texts: List[str], metadata: Optional[List[Dict]] = None):
        """添加向量到存储"""
        n = len(ids)
        if n == 0:
            return

        if vectors.shape[1] != self.dimension:
            raise ValueError(f"Vector dimension mismatch: expected {self.dimension}, got {vectors.shape[1]}")

        metadata = metadata or [{} for _ in range(n)]

        if self._vectors is None:
            self._vectors = vectors
        else:
            self._vectors = np.vstack([self._vectors, vectors])

        self._ids.extend(ids)
        self._texts.extend(texts)
        self._metadata.extend(metadata)
        self._count += n

        logger.debug(f"Added {n} vectors. Total: {self._count}")

    def search(self, query_vector: np.ndarray, top_k: int = 5) -> List[SearchResult]:
        """
        余弦相似度搜索
        
        Args:
            query_vector: 查询向量, shape (dimension,)
            top_k: 返回结果数量
            
        Returns:
            SearchResult 列表，按相似度降序
        """
        if self._vectors is None or self._count == 0:
            return []

        # 归一化查询向量
        query_norm = np.linalg.norm(query_vector)
        if query_norm > 0:
            query_vector = query_vector / query_norm

        # 计算余弦相似度 (向量已归一化时，点积 = 余弦相似度)
        similarities = self._vectors @ query_vector

        # Top-K
        k = min(top_k, self._count)
        top_indices = np.argsort(similarities)[::-1][:k]

        results = []
        for idx in top_indices:
            results.append(SearchResult(
                id=self._ids[idx],
                score=float(similarities[idx]),
                text=self._texts[idx],
                metadata=self._metadata[idx],
            ))

        return results

    @property
    def count(self) -> int:
        return self._count

    def clear(self):
        """清空存储"""
        self._ids = []
        self._vectors = None
        self._texts = []
        self._metadata = []
        self._count = 0

    def get_collection_info(self) -> Dict[str, Any]:
        return {
            "type": "in_memory",
            "dimension": self.dimension,
            "count": self._count,
        }


class QdrantVectorStore:
    """
    Qdrant 向量存储集成
    
    当 QDRANT_URL 环境变量设置时可用。
    """

    def __init__(self, dimension: int,
                 url: Optional[str] = None,
                 collection_name: str = "knowledge_base"):
        from qdrant_client import QdrantClient

        self.dimension = dimension
        self.collection_name = collection_name
        self._url = url or os.environ.get("QDRANT_URL")
        self._timeout = max(1, int(os.environ.get("QDRANT_TIMEOUT_MS", "30000"))) / 1000.0

        if not self._url:
            raise ValueError("QDRANT_URL environment variable not set")

        # 解析 URL: http://host:port
        host_port = self._url.replace("http://", "").replace("https://", "")
        host, port = host_port.split(":")
        self._client = QdrantClient(host=host, port=int(port), timeout=self._timeout)
        self._ensure_collection()

    def _ensure_collection(self):
        """确保 collection 存在"""
        from qdrant_client.models import Distance, VectorParams

        exists = False
        try:
            if hasattr(self._client, "collection_exists"):
                exists = bool(self._client.collection_exists(self.collection_name))
            else:
                self._client.get_collection(self.collection_name)
                exists = True
        except Exception:
            exists = False

        if not exists:
            self._client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(
                    size=self.dimension,
                    distance=Distance.COSINE,
                ),
            )
            logger.info(f"Created Qdrant collection: {self.collection_name}")

    def add(self, ids: List[str], vectors: np.ndarray,
            texts: List[str], metadata: Optional[List[Dict]] = None):
        """添加向量到 Qdrant"""
        from qdrant_client.models import PointStruct

        metadata = metadata or [{} for _ in range(len(ids))]
        points = []

        for i, (doc_id, vector, text, meta) in enumerate(zip(ids, vectors, texts, metadata)):
            payload = {"text": text, **meta}
            # Qdrant 需要整数 ID
            qdrant_id = int(uuid.UUID(doc_id).int) % (10**15) if not doc_id.isdigit() else int(doc_id)
            points.append(PointStruct(
                id=qdrant_id,
                vector=vector.tolist(),
                payload=payload,
            ))

        self._client.upsert(
            collection_name=self.collection_name,
            points=points,
        )
        logger.debug(f"Added {len(ids)} points to Qdrant")

    def search(self, query_vector: np.ndarray, top_k: int = 5) -> List[SearchResult]:
        """搜索 Qdrant"""
        hits = self._client.search(
            collection_name=self.collection_name,
            query_vector=query_vector.tolist(),
            limit=top_k,
        )

        results = []
        for hit in hits:
            payload = hit.payload or {}
            results.append(SearchResult(
                id=str(hit.id),
                score=hit.score,
                text=payload.get("text", ""),
                metadata={k: v for k, v in payload.items() if k != "text"},
            ))

        return results

    @property
    def count(self) -> int:
        info = self._client.get_collection(self.collection_name)
        return info.points_count

    def clear(self):
        """清空 collection"""
        from qdrant_client.models import Distance, VectorParams
        self._client.delete_collection(self.collection_name)
        self._client.create_collection(
            collection_name=self.collection_name,
            vectors_config=VectorParams(
                size=self.dimension,
                distance=Distance.COSINE,
            ),
        )
        logger.info(f"Cleared Qdrant collection: {self.collection_name}")

    def get_collection_info(self) -> Dict[str, Any]:
        return {
            "type": "qdrant",
            "url": self._url,
            "collection": self.collection_name,
            "dimension": self.dimension,
            "count": self.count,
        }


class DashVectorVectorStore:
    """
    阿里云 DashVector 向量存储集成。

    需要设置:
    - DASHVECTOR_ENDPOINT
    - DASHVECTOR_API_KEY

    参考:
    - 新建 Collection: https://help.aliyun.com/document_detail/2510281.html
    - 插入 Doc: https://help.aliyun.com/document_detail/2510317.html
    - 检索 Doc: https://help.aliyun.com/document_detail/2510319.html
    """

    def __init__(
        self,
        dimension: int,
        endpoint: Optional[str] = None,
        api_key: Optional[str] = None,
        collection_name: str = "knowledge_base",
        partition: Optional[str] = None,
        timeout_ms: Optional[int] = None,
    ):
        self.dimension = dimension
        self.collection_name = collection_name
        self._endpoint = (endpoint or os.environ.get("DASHVECTOR_ENDPOINT", "")).strip().rstrip("/")
        self._api_key = (api_key or os.environ.get("DASHVECTOR_API_KEY", "")).strip()
        self._partition = (partition or os.environ.get("DASHVECTOR_PARTITION", "")).strip() or None
        self._timeout = max(1, int(timeout_ms or os.environ.get("DASHVECTOR_TIMEOUT_MS", "30000"))) / 1000.0

        if not self._endpoint:
            raise ValueError("DASHVECTOR_ENDPOINT environment variable not set")
        if not self._api_key:
            raise ValueError("DASHVECTOR_API_KEY environment variable not set")
        if not self._endpoint.startswith(("http://", "https://")):
            self._endpoint = f"https://{self._endpoint}"

        self._ensure_collection()

    def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self._endpoint}{path}"
        body = None
        headers = {
            "dashvector-auth-token": self._api_key,
            "Accept": "application/json",
        }
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=body, headers=headers, method=method.upper())
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            detail = raw.decode("utf-8", errors="ignore")
            raise RuntimeError(f"DashVector request failed: {method} {path} -> {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"DashVector request failed: {method} {path} -> {exc}") from exc

        if not raw:
            return {}
        data = json.loads(raw.decode("utf-8"))
        if data.get("code", 0) != 0:
            raise RuntimeError(
                f"DashVector request failed: {method} {path} -> code={data.get('code')} message={data.get('message')}"
            )
        return data

    def _describe_collection(self) -> Optional[Dict[str, Any]]:
        collections = self._request("GET", "/v1/collections").get("output") or []
        if self.collection_name not in collections:
            return None
        return self._request(
            "GET",
            f"/v1/collections/{urllib.parse.quote(self.collection_name, safe='')}",
        ).get("output") or {}

    def _wait_until_serving(self) -> Optional[Dict[str, Any]]:
        timeout_ms = max(1000, int(os.environ.get("DASHVECTOR_COLLECTION_READY_TIMEOUT_MS", "20000")))
        deadline = time.time() + (timeout_ms / 1000.0)
        last_info: Optional[Dict[str, Any]] = None
        while time.time() < deadline:
            info = self._describe_collection()
            last_info = info or {}
            status = str((info or {}).get("status") or "").upper()
            partition_statuses = {
                str(key): str(value).upper()
                for key, value in ((info or {}).get("partitions") or {}).items()
            }
            if status == "SERVING" and all(value == "SERVING" for value in partition_statuses.values() or ["SERVING"]):
                return info
            time.sleep(1)
        return last_info

    def _ensure_collection(self):
        info = self._describe_collection()
        if info is not None:
            self._wait_until_serving()
            return
        payload = {
            "name": self.collection_name,
            "dimension": self.dimension,
            "dtype": "FLOAT",
            "metric": "cosine",
            "extra_params": {"auto_id": False},
        }
        self._request("POST", "/v1/collections", payload)
        logger.info(f"Created DashVector collection: {self.collection_name}")
        info = self._wait_until_serving() or {}
        status = str(info.get("status") or "").upper()
        if status != "SERVING":
            logger.warning(
                f"DashVector collection '{self.collection_name}' not SERVING after create (status={status or 'unknown'})"
            )

    @staticmethod
    def _sanitize_field_value(value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, bool):
            return value
        if isinstance(value, int):
            if -(2**63) <= value <= (2**63 - 1):
                return value
            return str(value)
        if isinstance(value, float):
            return value
        if isinstance(value, str):
            return value
        if isinstance(value, (list, tuple)):
            if value and all(isinstance(item, str) for item in value):
                return json.dumps(list(value), ensure_ascii=False)
            if value and all(isinstance(item, int) for item in value):
                return json.dumps(list(value), ensure_ascii=False)
            if value and all(isinstance(item, (int, float)) for item in value):
                return json.dumps(list(value), ensure_ascii=False)
            return json.dumps(value, ensure_ascii=False, default=str)
        return json.dumps(value, ensure_ascii=False, default=str)

    def _build_upsert_payload(self, docs: List[Dict[str, Any]]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"docs": docs}
        if self._partition:
            payload["partition"] = self._partition
        return payload

    def _split_docs_for_upsert(self, docs: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
        max_body_bytes = max(1024, int(os.environ.get("DASHVECTOR_MAX_UPSERT_BYTES", "1800000")))
        batches: List[List[Dict[str, Any]]] = []
        current_batch: List[Dict[str, Any]] = []
        current_size = len(json.dumps(self._build_upsert_payload([]), ensure_ascii=False).encode("utf-8"))

        for doc in docs:
            doc_size = len(json.dumps(doc, ensure_ascii=False).encode("utf-8"))
            # 单文档兜底，避免极端情况下形成空 batch
            if not current_batch:
                current_batch.append(doc)
                current_size = len(json.dumps(self._build_upsert_payload(current_batch), ensure_ascii=False).encode("utf-8"))
                continue

            next_size = current_size + doc_size + 1
            if next_size > max_body_bytes:
                batches.append(current_batch)
                current_batch = [doc]
                current_size = len(json.dumps(self._build_upsert_payload(current_batch), ensure_ascii=False).encode("utf-8"))
            else:
                current_batch.append(doc)
                current_size = next_size

        if current_batch:
            batches.append(current_batch)
        return batches

    def add(self, ids: List[str], vectors: np.ndarray,
            texts: List[str], metadata: Optional[List[Dict]] = None):
        """添加向量到 DashVector"""
        metadata = metadata or [{} for _ in range(len(ids))]
        docs = []
        for doc_id, vector, text, meta in zip(ids, vectors, texts, metadata):
            fields = {"text": text}
            for key, value in (meta or {}).items():
                fields[key] = self._sanitize_field_value(value)
            docs.append(
                {
                    "id": str(doc_id),
                    "vector": vector.tolist(),
                    "fields": fields,
                }
            )

        batches = self._split_docs_for_upsert(docs)
        for batch in batches:
            self._request(
                "POST",
                f"/v1/collections/{urllib.parse.quote(self.collection_name, safe='')}/docs/upsert",
                self._build_upsert_payload(batch),
            )
        logger.debug(f"Added {len(ids)} docs to DashVector in {len(batches)} batch(es)")

    def search(self, query_vector: np.ndarray, top_k: int = 5) -> List[SearchResult]:
        """搜索 DashVector"""
        payload: Dict[str, Any] = {
            "vector": query_vector.tolist(),
            "topk": top_k,
            "include_vector": False,
        }
        if self._partition:
            payload["partition"] = self._partition
        hits = self._request(
            "POST",
            f"/v1/collections/{urllib.parse.quote(self.collection_name, safe='')}/query",
            payload,
        ).get("output") or []

        results = []
        for hit in hits:
            fields = hit.get("fields") or {}
            results.append(
                SearchResult(
                    id=str(hit.get("id", "")),
                    score=float(hit.get("score") or 0.0),
                    text=fields.get("text", ""),
                    metadata={k: v for k, v in fields.items() if k != "text"},
                )
            )
        return results

    @property
    def count(self) -> int:
        try:
            stats = self._request(
                "GET",
                f"/v1/collections/{urllib.parse.quote(self.collection_name, safe='')}/stats",
            ).get("output") or {}
        except RuntimeError as exc:
            if "not serving" not in str(exc).lower():
                raise
            self._wait_until_serving()
            stats = self._request(
                "GET",
                f"/v1/collections/{urllib.parse.quote(self.collection_name, safe='')}/stats",
            ).get("output") or {}
        if self._partition:
            partition_stats = (stats.get("partitions") or {}).get(self._partition) or {}
            return int(partition_stats.get("total_doc_count") or 0)
        return int(stats.get("total_doc_count") or 0)

    def clear(self):
        """清空 collection"""
        self._request(
            "DELETE",
            f"/v1/collections/{urllib.parse.quote(self.collection_name, safe='')}",
        )
        self._ensure_collection()
        logger.info(f"Cleared DashVector collection: {self.collection_name}")

    def get_collection_info(self) -> Dict[str, Any]:
        return {
            "type": "dashvector",
            "endpoint": self._endpoint,
            "collection": self.collection_name,
            "dimension": self.dimension,
            "count": self.count,
            "partition": self._partition,
        }


def resolve_vector_store_provider(use_qdrant: Optional[bool] = None) -> str:
    """
    解析当前应使用的向量存储后端。

    优先级:
    1. VECTOR_STORE_PROVIDER 显式指定
    2. 兼容旧逻辑 use_qdrant=True
    3. QDRANT_URL
    4. DashVector endpoint + api key
    5. memory
    """
    explicit = os.environ.get("VECTOR_STORE_PROVIDER", "").strip().lower()
    if explicit in {"memory", "qdrant", "dashvector"}:
        return explicit
    if use_qdrant is True:
        return "qdrant"
    if use_qdrant is False:
        return "memory"
    if os.environ.get("QDRANT_URL"):
        return "qdrant"
    if os.environ.get("DASHVECTOR_ENDPOINT") and os.environ.get("DASHVECTOR_API_KEY"):
        return "dashvector"
    return "memory"


def list_vector_store_collections(provider: Optional[str] = None) -> List[Dict[str, Any]]:
    provider = (provider or resolve_vector_store_provider()).strip().lower()
    if provider == "qdrant":
        from qdrant_client import QdrantClient

        qdrant_url = os.environ.get("QDRANT_URL", "").strip()
        if not qdrant_url:
            return []
        timeout = max(1, int(os.environ.get("QDRANT_TIMEOUT_MS", "30000"))) / 1000.0
        host_port = qdrant_url.replace("http://", "").replace("https://", "")
        host, port = host_port.split(":")
        client = QdrantClient(host=host, port=int(port), timeout=timeout)
        items = []
        for item in client.get_collections().collections:
            try:
                info = client.get_collection(item.name)
                count = int(info.points_count or 0)
            except Exception:
                count = 0
            items.append({"name": item.name, "count": count, "type": "qdrant"})
        return items
    if provider == "dashvector":
        endpoint = (os.environ.get("DASHVECTOR_ENDPOINT", "") or "").strip().rstrip("/")
        api_key = (os.environ.get("DASHVECTOR_API_KEY", "") or "").strip()
        if not endpoint or not api_key:
            return []
        if not endpoint.startswith(("http://", "https://")):
            endpoint = f"https://{endpoint}"

        def request(method: str, path: str) -> Dict[str, Any]:
            req = urllib.request.Request(
                f"{endpoint}{path}",
                headers={"dashvector-auth-token": api_key, "Accept": "application/json"},
                method=method,
            )
            with urllib.request.urlopen(req, timeout=max(1, int(os.environ.get("DASHVECTOR_TIMEOUT_MS", "30000"))) / 1000.0) as response:
                return json.loads(response.read().decode("utf-8"))

        collection_names = request("GET", "/v1/collections").get("output") or []
        items = []
        for name in collection_names:
            try:
                stats = request("GET", f"/v1/collections/{urllib.parse.quote(name, safe='')}/stats").get("output") or {}
                count = int(stats.get("total_doc_count") or 0)
            except Exception:
                count = 0
            items.append({"name": name, "count": count, "type": "dashvector"})
        return items
    return []


class SemanticSearch:
    """
    语义搜索引擎
    
    自动选择 In-Memory 或 Qdrant 存储后端。
    """

    def __init__(self, dimension: int = 1024,
                 use_qdrant: Optional[bool] = None,
                 collection_name: str = "default"):
        """
        Args:
            dimension: 向量维度
            use_qdrant: 强制使用 Qdrant。None 则根据 QDRANT_URL 环境变量自动选择。
        """
        self.dimension = dimension
        self._collection_name = collection_name or "default"

        provider = resolve_vector_store_provider(use_qdrant=use_qdrant)

        if provider == "qdrant":
            self.store = QdrantVectorStore(dimension=dimension, collection_name=self._collection_name)
            logger.info("Using Qdrant vector store")
        elif provider == "dashvector":
            self.store = DashVectorVectorStore(dimension=dimension, collection_name=self._collection_name)
            logger.info("Using DashVector vector store")
        else:
            self.store = InMemoryVectorStore(dimension=dimension)
            logger.info("Using in-memory vector store")

    def add_documents(self, texts: List[str], 
                      vectors: np.ndarray,
                      metadata: Optional[List[Dict[str, Any]]] = None,
                      ids: Optional[List[str]] = None) -> List[str]:
        """
        添加文档到向量存储
        
        Args:
            texts: 文档文本列表
            vectors: 嵌入向量, shape (n, dimension)
            metadata: 文档元数据列表
            ids: 文档 ID 列表 (自动生成如果未提供)
            
        Returns:
            分配的 ID 列表
        """
        n = len(texts)
        if ids is None:
            ids = [str(uuid.uuid4()) for _ in range(n)]

        metadata = metadata or [{} for _ in range(n)]

        self.store.add(ids=ids, vectors=vectors, texts=texts, metadata=metadata)
        try:
            total_count = self.store.count
            logger.info(f"Added {n} documents. Total in store: {total_count}")
        except Exception as exc:
            logger.warning(f"Added {n} documents, but failed to refresh store count: {exc}")
        return ids

    def search(self, query_vector: np.ndarray, 
               top_k: int = 5,
               min_score: float = 0.0) -> List[SearchResult]:
        """
        语义搜索
        
        Args:
            query_vector: 查询嵌入向量
            top_k: 返回结果数量
            min_score: 最低相似度阈值
            
        Returns:
            SearchResult 列表
        """
        results = self.store.search(query_vector, top_k=top_k)

        if min_score > 0:
            results = [r for r in results if r.score >= min_score]

        return results

    @property
    def count(self) -> int:
        return self.store.count

    def get_collection_info(self) -> Dict[str, Any]:
        try:
            info = self.store.get_collection_info()
        except Exception as exc:
            logger.warning(f"Failed to read collection info for '{self._collection_name}': {exc}")
            info = {"type": type(self.store).__name__.replace("VectorStore", "").lower(), "count": 0}
        info["collection_name"] = self._collection_name
        return info
