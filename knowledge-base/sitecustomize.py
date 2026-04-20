"""
knowledge-base 解释器启动时自动注入 huggingface_hub 兼容补丁。

这样无论是 FastAPI 服务、预热脚本还是本地调试命令，只要在 knowledge-base 目录下启动，
sentence-transformers 2.2.2 都不会再因为 cached_download 缺失而直接导入失败。
"""

from ingest.hf_compat import patch_huggingface_hub_cached_download

patch_huggingface_hub_cached_download()

