"""
嵌入模型 - 向量嵌入生成器

用法:
    from ingest.embedder import Embedder
    embedder = Embedder(model_name="BAAI/bge-m3")
    embeddings = embedder.encode(["文本1", "文本2"])
"""

import hashlib
import os
from pathlib import Path
from typing import List, Optional, Union

import numpy as np
from loguru import logger

from ingest.hf_compat import patch_huggingface_hub_cached_download


REQUIRED_MODEL_FILES = [
    "config.json",
    "config_sentence_transformers.json",
    "modules.json",
    "sentence_bert_config.json",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "1_Pooling/config.json",
]


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


class Embedder:
    """
    文本嵌入器

    生产策略:
    1. 优先显式 `EMBED_MODEL_PATH`
    2. 其次复用本地缓存中的完整模型目录
    3. 最后才尝试远端模型名

    若 `ALLOW_FALLBACK_EMBEDDING=false`，模型不可用时直接失败，避免生产环境静默降级。
    """

    def __init__(self, model_name: str = "BAAI/bge-m3", dimension: int = 1024, device: Optional[str] = None):
        self.model_name = model_name
        self.dimension = dimension
        self.device = device or self._auto_device()
        self._model = None
        self._use_fallback = False
        self._fallback_reason = None
        self._allow_fallback = _env_flag("ALLOW_FALLBACK_EMBEDDING", False)
        self.model_source = self._resolve_model_source()

        self._load_model()

    def _auto_device(self) -> str:
        """自动选择计算设备"""
        try:
            import torch

            if torch.cuda.is_available():
                return "cuda"
        except ImportError:
            pass
        return "cpu"

    def _is_complete_model_dir(self, path: Path) -> bool:
        if not path.exists() or not path.is_dir():
            return False
        has_weights = any((path / weight_name).exists() for weight_name in ("model.safetensors", "pytorch_model.bin"))
        return has_weights and all((path / required).exists() for required in REQUIRED_MODEL_FILES)

    def _resolve_model_source(self) -> str:
        explicit_path = os.environ.get("EMBED_MODEL_PATH", "").strip()
        if explicit_path:
            explicit_dir = Path(explicit_path).expanduser()
            if self._is_complete_model_dir(explicit_dir):
                logger.info(f"Using explicit local embedding model path: {explicit_dir}")
                return str(explicit_dir)
            logger.warning(f"Explicit EMBED_MODEL_PATH is incomplete or missing: {explicit_dir}")
            return self.model_name

        named_path = Path(self.model_name).expanduser()
        if self._is_complete_model_dir(named_path):
            logger.info(f"Using embedding model from local path: {named_path}")
            return str(named_path)

        cache_candidates = [
            Path.home() / ".cache" / "torch" / "sentence_transformers" / self.model_name.replace("/", "_"),
            Path("/app/models") / self.model_name.replace("/", "_"),
            Path("/app/models") / self.model_name.split("/")[-1],
        ]
        for candidate in cache_candidates:
            if self._is_complete_model_dir(candidate):
                logger.info(f"Using embedding model from local cache: {candidate}")
                return str(candidate)

        return self.model_name

    def _load_model(self):
        """加载嵌入模型，失败时按策略决定是否回退到 hash-based"""
        try:
            patch_huggingface_hub_cached_download()
            from sentence_transformers import SentenceTransformer

            logger.info(f"Loading embedding model: {self.model_source}")
            self._model = SentenceTransformer(self.model_source, device=self.device)
            self.dimension = self._model.get_sentence_embedding_dimension() or self.dimension
            logger.info(f"Model loaded successfully. Dimension: {self.dimension}, Device: {self.device}")
        except Exception as exc:
            self._fallback_reason = str(exc)
            logger.warning(f"Failed to load model '{self.model_name}': {exc}")
            if not self._allow_fallback:
                raise RuntimeError(
                    f"Embedding model '{self.model_name}' failed to load and ALLOW_FALLBACK_EMBEDDING is disabled"
                ) from exc
            logger.warning("Falling back to hash-based embedding (not suitable for production)")
            self._use_fallback = True
            self._model = None

    def encode(self, texts: Union[str, List[str]], batch_size: int = 32, normalize: bool = True) -> np.ndarray:
        """
        将文本编码为向量
        """
        if isinstance(texts, str):
            texts = [texts]

        if not texts:
            return np.array([], dtype=np.float32).reshape(0, self.dimension)

        if self._use_fallback:
            return self._hash_encode(texts)

        return self._model_encode(texts, batch_size, normalize)

    def _model_encode(self, texts: List[str], batch_size: int, normalize: bool) -> np.ndarray:
        embeddings = self._model.encode(
            texts,
            batch_size=batch_size,
            show_progress_bar=False,
            normalize_embeddings=normalize,
            convert_to_numpy=True,
        )
        return embeddings.astype(np.float32)

    def _hash_encode(self, texts: List[str]) -> np.ndarray:
        embeddings = np.zeros((len(texts), self.dimension), dtype=np.float32)

        for i, text in enumerate(texts):
            hash_bytes = hashlib.sha256(text.encode("utf-8")).digest()
            rng = np.random.RandomState(int.from_bytes(hash_bytes[:8], byteorder="big") % (2**31))
            vec = rng.randn(self.dimension).astype(np.float32)
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec = vec / norm
            embeddings[i] = vec

        logger.debug(f"Generated {len(texts)} hash-based embeddings (dimension={self.dimension})")
        return embeddings

    @property
    def is_fallback(self) -> bool:
        return self._use_fallback

    @property
    def fallback_reason(self) -> Optional[str]:
        return self._fallback_reason

    def encode_single(self, text: str, normalize: bool = True) -> np.ndarray:
        return self.encode(text, normalize=normalize)[0]

    def encode_batch(self, texts: List[str], batch_size: int = 32) -> np.ndarray:
        return self.encode(texts, batch_size=batch_size)


def create_embedder(model_name: Optional[str] = None) -> Embedder:
    name = model_name or os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
    return Embedder(model_name=name)
