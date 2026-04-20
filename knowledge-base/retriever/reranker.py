"""
检索结果重排
"""

import math
import os
import re
from typing import List, Optional

from loguru import logger

from retriever.semantic_search import SearchResult


def _tokenize(value: str) -> List[str]:
    text = str(value or "").lower()
    tokens = [token for token in re.findall(r"[A-Za-z0-9_./:-]{2,64}", text) if token]
    cjk_chars = [char for char in text if "\u4e00" <= char <= "\u9fff"]
    tokens.extend(cjk_chars)
    return tokens


class SearchReranker:
    def __init__(self, model_name: Optional[str] = None):
        self.model_name = model_name or os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-v2-m3")
        self._model = None
        self._use_fallback = False
        self._load_model()

    def _load_model(self) -> None:
        try:
            from FlagEmbedding import FlagReranker

            self._model = FlagReranker(self.model_name, use_fp16=False)
            logger.info(f"Loaded reranker model: {self.model_name}")
        except Exception as exc:
            self._use_fallback = True
            self._model = None
            logger.warning(f"Failed to load reranker model '{self.model_name}', using heuristic fallback: {exc}")

    @property
    def is_fallback(self) -> bool:
        return self._use_fallback

    def _fallback_scores(self, query: str, results: List[SearchResult]) -> List[float]:
        query_tokens = set(_tokenize(query))
        scores: List[float] = []
        for item in results:
            text_tokens = set(_tokenize(item.text))
            overlap = len(query_tokens & text_tokens)
            denom = max(1, len(query_tokens) + len(text_tokens))
            lexical = (2 * overlap) / denom
            scores.append(float(item.score) * 0.7 + lexical * 0.3)
        return scores

    def rerank(self, query: str, results: List[SearchResult], top_k: int = 5) -> List[SearchResult]:
        if not results:
            return []
        if self._model is not None:
            try:
                pairs = [[query, item.text] for item in results]
                raw_scores = self._model.compute_score(pairs, normalize=True)
                if not isinstance(raw_scores, list):
                    raw_scores = [float(raw_scores)]
                scores = [float(score) for score in raw_scores]
            except Exception as exc:
                logger.warning(f"Reranker inference failed, using fallback ordering: {exc}")
                scores = self._fallback_scores(query, results)
        else:
            scores = self._fallback_scores(query, results)

        ranked = []
        for item, rerank_score in zip(results, scores):
            metadata = dict(item.metadata or {})
            metadata["rerank_score"] = round(float(rerank_score), 6)
            metadata["pre_rerank_score"] = round(float(item.score), 6)
            ranked.append(
                SearchResult(
                    id=item.id,
                    score=float(rerank_score),
                    text=item.text,
                    metadata=metadata,
                )
            )
        ranked.sort(key=lambda item: item.score, reverse=True)
        return ranked[: max(1, int(top_k))]
