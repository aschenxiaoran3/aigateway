"""
文档加载器 - 支持 Markdown/PDF/Word 等格式

用法:
    python -m ingest.document_loader --file /path/to/doc.md
    python -m ingest.document_loader --dir /path/to/docs/
"""

import os
import sys
import argparse
from pathlib import Path
from typing import List, Dict, Any
from loguru import logger

# 配置日志
logger.remove()
logger.add(sys.stderr, level="INFO", format="{time} {level} {message}")


class DocumentLoader:
    """文档加载器基类"""
    
    def __init__(self, file_path: str):
        self.file_path = Path(file_path)
        if not self.file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
    
    def load(self) -> Dict[str, Any]:
        """加载文档，返回内容和元数据"""
        raise NotImplementedError
    
    def get_metadata(self) -> Dict[str, Any]:
        """提取元数据"""
        return {
            "source": str(self.file_path),
            "filename": self.file_path.name,
            "size": self.file_path.stat().st_size,
            "modified_time": self.file_path.stat().st_mtime,
        }


class MarkdownLoader(DocumentLoader):
    """Markdown 文档加载器"""
    
    def load(self) -> Dict[str, Any]:
        logger.info(f"Loading markdown file: {self.file_path}")
        
        with open(self.file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # 提取标题作为元数据
        metadata = self.get_metadata()
        metadata["type"] = "markdown"
        
        # 提取一级标题
        lines = content.split('\n')
        for line in lines[:20]:  # 只检查前 20 行
            if line.startswith('# '):
                metadata["title"] = line[2:].strip()
                break
        
        return {
            "content": content,
            "metadata": metadata,
        }


class PDFLoader(DocumentLoader):
    """PDF 文档加载器"""
    
    def load(self) -> Dict[str, Any]:
        logger.info(f"Loading PDF file: {self.file_path}")
        
        try:
            import PyPDF2
        except ImportError:
            raise ImportError("PyPDF2 not installed. Run: pip install PyPDF2")
        
        content_parts = []
        with open(self.file_path, 'rb') as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    content_parts.append(text)
        
        content = '\n\n'.join(content_parts)
        
        metadata = self.get_metadata()
        metadata["type"] = "pdf"
        metadata["pages"] = len(content_parts)
        
        return {
            "content": content,
            "metadata": metadata,
        }


class WordLoader(DocumentLoader):
    """Word 文档加载器"""
    
    def load(self) -> Dict[str, Any]:
        logger.info(f"Loading Word file: {self.file_path}")
        
        try:
            import docx
        except ImportError:
            raise ImportError("python-docx not installed. Run: pip install python-docx")
        
        doc = docx.Document(self.file_path)
        content_parts = []
        
        for paragraph in doc.paragraphs:
            if paragraph.text.strip():
                content_parts.append(paragraph.text)
        
        content = '\n\n'.join(content_parts)
        
        metadata = self.get_metadata()
        metadata["type"] = "word"
        
        return {
            "content": content,
            "metadata": metadata,
        }


def get_loader(file_path: str) -> DocumentLoader:
    """根据文件类型返回合适的加载器"""
    ext = Path(file_path).suffix.lower()
    
    loaders = {
        '.md': MarkdownLoader,
        '.markdown': MarkdownLoader,
        '.pdf': PDFLoader,
        '.docx': WordLoader,
        '.doc': WordLoader,  # 注意：.doc 可能需要其他库
    }
    
    if ext not in loaders:
        raise ValueError(f"Unsupported file type: {ext}")
    
    return loaders[ext](file_path)


def load_directory(dir_path: str, extensions: List[str] = None) -> List[Dict[str, Any]]:
    """加载整个目录的文档"""
    if extensions is None:
        extensions = ['.md', '.markdown', '.pdf', '.docx']
    
    dir_path = Path(dir_path)
    documents = []
    
    logger.info(f"Loading documents from directory: {dir_path}")
    
    for ext in extensions:
        for file_path in dir_path.rglob(f'*{ext}'):
            try:
                loader = get_loader(str(file_path))
                doc = loader.load()
                documents.append(doc)
                logger.info(f"✓ Loaded: {file_path}")
            except Exception as e:
                logger.error(f"✗ Failed to load {file_path}: {e}")
    
    logger.info(f"Total loaded: {len(documents)} documents")
    return documents


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Document Loader for Knowledge Base')
    parser.add_argument('--file', type=str, help='Single file to load')
    parser.add_argument('--dir', type=str, help='Directory to load')
    parser.add_argument('--output', type=str, help='Output file (JSON)')
    
    args = parser.parse_args()
    
    documents = []
    
    if args.file:
        loader = get_loader(args.file)
        doc = loader.load()
        documents = [doc]
    elif args.dir:
        documents = load_directory(args.dir)
    else:
        parser.print_help()
        sys.exit(1)
    
    # 输出结果
    if args.output:
        import json
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(documents, f, ensure_ascii=False, indent=2)
        logger.info(f"Saved to: {args.output}")
    else:
        # 打印摘要
        for doc in documents[:3]:  # 只显示前 3 个
            print(f"\n{'='*60}")
            print(f"Source: {doc['metadata']['source']}")
            print(f"Type: {doc['metadata']['type']}")
            print(f"Content preview: {doc['content'][:200]}...")
    
    logger.info(f"Done. Total: {len(documents)} documents")
