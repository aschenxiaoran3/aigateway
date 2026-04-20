#!/usr/bin/env python3

"""
预热并校验本地 embedding 模型目录。

默认针对 BAAI/bge-large-zh，将缺失的小文件补齐到本地目录，
避免生产环境在服务启动时依赖 HuggingFace 在线下载。
"""

import os
import shutil
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
KNOWLEDGE_BASE_ROOT = ROOT / "knowledge-base"
if str(KNOWLEDGE_BASE_ROOT) not in sys.path:
    sys.path.insert(0, str(KNOWLEDGE_BASE_ROOT))

from ingest.embedder import REQUIRED_MODEL_FILES  # noqa: E402


MODEL_NAME = os.environ.get("EMBED_MODEL", "BAAI/bge-large-zh").strip()
TARGET_DIR = Path(
    os.environ.get(
        "EMBED_MODEL_PATH",
        str(Path.home() / ".cache" / "torch" / "sentence_transformers" / MODEL_NAME.replace("/", "_")),
    )
).expanduser()

HF_BASE = f"https://huggingface.co/{MODEL_NAME}/resolve/main"


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def download_file(relative_path: str, destination: Path) -> None:
    url = f"{HF_BASE}/{relative_path}"
    ensure_parent(destination)
    req = Request(url, headers={"User-Agent": "ai-platform/embedding-prep"})
    with urlopen(req, timeout=120) as response, open(destination, "wb") as output:
        shutil.copyfileobj(response, output)


def main() -> int:
    TARGET_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Model target: {TARGET_DIR}")

    missing = [item for item in REQUIRED_MODEL_FILES if not (TARGET_DIR / item).exists()]
    if not missing:
        print("All required metadata/tokenizer files already present.")
        return 0

    print(f"Missing files: {missing}")
    for item in missing:
        print(f"Downloading {item} ...")
        download_file(item, TARGET_DIR / item)

    still_missing = [item for item in REQUIRED_MODEL_FILES if not (TARGET_DIR / item).exists()]
    if still_missing:
        print(f"FAILED: still missing files {still_missing}")
        return 1

    print("DONE: embedding model directory is complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

