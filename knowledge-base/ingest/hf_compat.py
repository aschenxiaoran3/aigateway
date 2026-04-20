import os
from typing import Optional, Union

from loguru import logger


def patch_huggingface_hub_cached_download() -> bool:
    """
    为 sentence-transformers 2.2.x 补齐 huggingface_hub.cached_download 兼容层。

    huggingface_hub 新版本已移除 cached_download，但 sentence-transformers 2.2.2 仍在直接导入它。
    """
    try:
        import huggingface_hub

        if hasattr(huggingface_hub, "cached_download"):
            return False

        import requests
        from urllib.parse import urlparse

        def cached_download(
            url: str,
            cache_dir: Optional[str] = None,
            force_filename: Optional[str] = None,
            library_name: Optional[str] = None,
            library_version: Optional[str] = None,
            user_agent: Optional[dict] = None,
            use_auth_token: Optional[Union[str, bool]] = None,
            legacy_cache_layout: bool = False,
            **kwargs,
        ) -> str:
            del library_name, library_version, legacy_cache_layout, kwargs

            target_dir = cache_dir or os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")
            parsed = urlparse(url)
            fallback_name = os.path.basename(parsed.path.rstrip("/")) or "download.bin"
            target_name = force_filename or fallback_name
            destination = os.path.join(target_dir, target_name)
            os.makedirs(os.path.dirname(destination), exist_ok=True)

            if os.path.exists(destination) and os.path.getsize(destination) > 0:
                return destination

            headers = {}
            if user_agent:
                headers["User-Agent"] = " ".join(f"{key}/{value}" for key, value in user_agent.items())
            if isinstance(use_auth_token, str) and use_auth_token.strip():
                headers["Authorization"] = f"Bearer {use_auth_token.strip()}"

            with requests.get(url, headers=headers, stream=True, timeout=120) as response:
                response.raise_for_status()
                with open(destination, "wb") as output:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            output.write(chunk)

            return destination

        huggingface_hub.cached_download = cached_download
        logger.info("Patched huggingface_hub.cached_download compatibility shim")
        return True
    except Exception as exc:
        logger.warning(f"Failed to patch huggingface_hub compatibility shim: {exc}")
        return False

