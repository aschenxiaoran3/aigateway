from pathlib import Path
import sys
import types

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ingest.embedder import Embedder
from retriever.hybrid_search import LexicalSearchIndex, reciprocal_rank_fusion
from retriever.reranker import SearchReranker
from retriever.semantic_search import SearchResult


def test_embedder_blocks_silent_fallback_when_disabled(monkeypatch):
    fake_module = types.ModuleType("sentence_transformers")

    class BrokenSentenceTransformer:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("boom")

    fake_module.SentenceTransformer = BrokenSentenceTransformer
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake_module)
    monkeypatch.setenv("ALLOW_FALLBACK_EMBEDDING", "0")

    with pytest.raises(RuntimeError):
        Embedder(model_name="BAAI/bge-m3")


def test_embedder_allows_explicit_fallback(monkeypatch):
    fake_module = types.ModuleType("sentence_transformers")

    class BrokenSentenceTransformer:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("boom")

    fake_module.SentenceTransformer = BrokenSentenceTransformer
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake_module)
    monkeypatch.setenv("ALLOW_FALLBACK_EMBEDDING", "1")

    embedder = Embedder(model_name="BAAI/bge-m3")

    assert embedder.is_fallback is True
    assert "boom" in str(embedder.fallback_reason)


def test_lexical_index_persists_across_restarts(tmp_path):
    sqlite_path = tmp_path / "lexical.sqlite"
    index = LexicalSearchIndex(str(sqlite_path))
    index.upsert_documents(
        "deepwiki_assets",
        ["chunk-1", "chunk-2"],
        [
            "销售订单接口负责创建销售单并校验客户信息",
            "库存服务处理扣减与可用量校验",
        ],
        [{"page_slug": "orders/api"}, {"page_slug": "inventory/service"}],
    )

    first_results = index.search("销售订单接口", "deepwiki_assets", top_k=3)
    assert first_results
    assert first_results[0].id == "chunk-1"

    reopened = LexicalSearchIndex(str(sqlite_path))
    second_results = reopened.search("销售订单接口", "deepwiki_assets", top_k=3)
    assert second_results
    assert second_results[0].id == "chunk-1"
    assert reopened.list_collections()[0]["count"] == 2


def test_reciprocal_rank_fusion_prefers_items_supported_by_multiple_retrievers():
    dense = [
        SearchResult(id="a", score=0.91, text="订单接口", metadata={"source": "dense"}),
        SearchResult(id="b", score=0.85, text="库存接口", metadata={"source": "dense"}),
    ]
    lexical = [
        SearchResult(id="b", score=0.9, text="库存接口", metadata={"source": "lexical"}),
        SearchResult(id="c", score=0.82, text="结算流程", metadata={"source": "lexical"}),
    ]

    fused = reciprocal_rank_fusion({"dense": dense, "lexical": lexical}, limit=3)

    assert [item.id for item in fused][:2] == ["b", "a"]
    assert fused[0].metadata["source_ranks"] == {"dense": 2, "lexical": 1}


def test_reranker_fallback_prefers_higher_token_overlap():
    original_load_model = SearchReranker._load_model
    SearchReranker._load_model = lambda self: None
    reranker = SearchReranker(model_name="BAAI/bge-reranker-v2-m3")
    SearchReranker._load_model = original_load_model
    reranker._model = None
    reranker._use_fallback = True

    results = [
        SearchResult(id="a", score=0.9, text="销售订单创建接口支持客户与商品校验", metadata={}),
        SearchResult(id="b", score=0.95, text="这是一个通用说明文档", metadata={}),
    ]

    ranked = reranker.rerank("销售订单接口", results, top_k=2)

    assert ranked[0].id == "a"
    assert ranked[0].metadata["rerank_score"] >= ranked[1].metadata["rerank_score"]
