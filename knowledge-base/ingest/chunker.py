"""
文档分块器 - Markdown-aware chunking strategy

用法:
    from ingest.chunker import MarkdownChunker
    chunker = MarkdownChunker(chunk_size=500, overlap=50)
    chunks = chunker.chunk(document_content, metadata={...})
"""

import re
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field
from loguru import logger


@dataclass
class Chunk:
    """单个文本块"""
    text: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    chunk_index: int = 0
    total_chunks: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "metadata": self.metadata,
            "chunk_index": self.chunk_index,
            "total_chunks": self.total_chunks,
        }


class MarkdownChunker:
    """
    Markdown 感知分块器
    
    尊重 Markdown 结构:
    - 按标题层级自然分割
    - 保护代码块不被截断
    - 支持可配置的块大小和重叠
    """

    def __init__(self, chunk_size: int = 500, overlap: int = 50):
        """
        Args:
            chunk_size: 每个块的目标字符数 (default 500)
            overlap: 相邻块之间的重叠字符数 (default 50)
        """
        if chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        if overlap < 0:
            raise ValueError("overlap must be non-negative")
        if overlap >= chunk_size:
            raise ValueError("overlap must be less than chunk_size")

        self.chunk_size = chunk_size
        self.overlap = overlap

        # 代码块正则: ```...``` 或 ~~~...~~~
        self._code_block_re = re.compile(r'^(```|~~~)\s*\w*\n.*?\n\1\s*$', re.MULTILINE | re.DOTALL)
        # 标题正则: # ## ### 等
        self._header_re = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)

    def chunk(self, content: str, metadata: Optional[Dict[str, Any]] = None) -> List[Chunk]:
        """
        将文档内容分块
        
        Args:
            content: 文档文本内容
            metadata: 附加元数据，会合并到每个 chunk 中
            
        Returns:
            Chunk 对象列表
        """
        if not content or not content.strip():
            logger.warning("Empty content provided, returning empty chunks")
            return []

        metadata = metadata or {}
        sections = self._split_by_headers(content)
        chunks: List[Chunk] = []

        for section_header, section_content in sections:
            section_chunks = self._chunk_section(section_header, section_content, metadata)
            chunks.extend(section_chunks)

        # 更新索引
        for i, chunk in enumerate(chunks):
            chunk.chunk_index = i
            chunk.total_chunks = len(chunks)

        logger.info(f"Split document into {len(chunks)} chunks "
                     f"(size={self.chunk_size}, overlap={self.overlap})")
        return chunks

    def _split_by_headers(self, content: str) -> List[tuple]:
        """
        按标题分割文档，保留标题层级信息
        
        Returns:
            List of (header_text, content) tuples.
            header_text 是累积的父级标题路径。
        """
        lines = content.split('\n')
        sections: List[tuple] = []
        current_header_path = ""
        current_lines: List[str] = []
        in_code_block = False
        code_fence = None

        for line in lines:
            # 跟踪代码块状态
            if not in_code_block:
                fence_match = re.match(r'^(```|~~~)\s*\w*$', line)
                if fence_match:
                    in_code_block = True
                    code_fence = fence_match.group(1)
                    current_lines.append(line)
                    continue
            else:
                current_lines.append(line)
                if line.strip().startswith(code_fence) and line.strip() == code_fence:
                    in_code_block = False
                    code_fence = None
                continue

            # 检测标题行
            header_match = re.match(r'^(#{1,6})\s+(.+)$', line)
            if header_match and not in_code_block:
                # 保存前一个 section
                if current_lines:
                    sections.append((current_header_path, '\n'.join(current_lines)))
                    current_lines = []

                # 更新标题路径
                level = len(header_match.group(1))
                title = header_match.group(2).strip()
                # 对于同级或更高级标题，重置路径
                current_header_path = self._update_header_path(current_header_path, level, title)
                continue

            current_lines.append(line)

        # 保存最后一个 section
        if current_lines:
            sections.append((current_header_path, '\n'.join(current_lines)))

        # 如果没有任何标题，整个文档作为一个 section
        if not sections and content.strip():
            sections.append(("", content))

        return sections

    def _update_header_path(self, current_path: str, level: int, title: str) -> str:
        """更新标题路径，保持层级结构"""
        parts = current_path.split(' > ') if current_path else []
        # 移除比当前级别低或同级的所有部分
        # 假设每级标题用 / 标记层级（# = 1级, ## = 2级...）
        # 简化：我们跟踪最大级别
        parts = parts[:level - 1]
        parts.append(title)
        return ' > '.join(parts)

    def _chunk_section(self, header: str, content: str, base_metadata: Dict) -> List[Chunk]:
        """
        对单个 section 进行分块，尊重代码块边界
        """
        content = content.strip()
        if not content:
            return []

        # 尝试按代码块分割
        code_blocks = list(self._code_block_re.finditer(content))

        if not code_blocks:
            # 没有代码块，简单按大小分块
            return self._simple_chunk(header, content, base_metadata)

        # 有代码块，需要保护它们
        chunks: List[Chunk] = []
        current_text = ""

        pos = 0
        for cb in code_blocks:
            # 代码块前的文本
            before = content[pos:cb.start()]
            # 代码块本身
            code = cb.group()

            # 处理代码块前的文本
            if before.strip():
                current_text += before
                if len(current_text) > self.chunk_size:
                    sub_chunks = self._simple_chunk(header, current_text, base_metadata)
                    chunks.extend(sub_chunks)
                    # 保留重叠
                    if sub_chunks:
                        last = sub_chunks[-1]
                        current_text = last.text[-self.overlap:] if self.overlap > 0 else ""
                    else:
                        current_text = ""

            # 检查代码块是否太大
            if len(code) > self.chunk_size:
                # 先保存当前累积的文本
                if current_text.strip():
                    chunk_text = (f"# {header}\n\n{current_text}" if header else current_text).strip()
                    chunk_meta = {**base_metadata, "section": header, "has_code": False}
                    chunks.append(Chunk(text=chunk_text, metadata=chunk_meta))
                    current_text = ""

                # 代码块单独成块
                chunk_text = (f"# {header}\n\n{code}" if header else code).strip()
                chunk_meta = {**base_metadata, "section": header, "has_code": True, "code_block": True}
                chunks.append(Chunk(text=chunk_text, metadata=chunk_meta))
            else:
                current_text += '\n' + code

            pos = cb.end()

        # 处理剩余的文本
        if pos < len(content):
            current_text += content[pos:]

        if current_text.strip():
            sub_chunks = self._simple_chunk(header, current_text, base_metadata)
            chunks.extend(sub_chunks)

        return chunks

    def _simple_chunk(self, header: str, content: str, base_metadata: Dict) -> List[Chunk]:
        """
        简单的固定大小分块，在句子/段落边界分割
        """
        content = content.strip()
        if not content:
            return []

        # 如果内容小于 chunk_size，直接返回
        if len(content) <= self.chunk_size:
            chunk_text = (f"# {header}\n\n{content}" if header else content).strip()
            chunk_meta = {**base_metadata, "section": header, "has_code": False}
            return [Chunk(text=chunk_text, metadata=chunk_meta)]

        chunks: List[Chunk] = []
        start = 0

        while start < len(content):
            end = start + self.chunk_size

            if end >= len(content):
                # 最后一块
                chunk_text = content[start:]
            else:
                # 尝试在句子边界或段落边界切割
                chunk_text = self._find_break_point(content, start, end)

            # 添加标题前缀
            full_text = (f"# {header}\n\n{chunk_text}" if header else chunk_text).strip()

            chunk_meta = {**base_metadata, "section": header, "has_code": False}
            chunks.append(Chunk(text=full_text, metadata=chunk_meta))

            # 移动起始位置（考虑重叠）
            start = start + self.chunk_size - self.overlap
            if start >= len(content):
                break

        return chunks

    def _find_break_point(self, content: str, start: int, end: int) -> str:
        """
        在接近 end 的位置寻找合适的断点（段落 > 句子 > 空格 > 字符）
        """
        segment = content[start:end]

        # 1. 尝试在段落边界（双换行）切割
        last_double_newline = segment.rfind('\n\n')
        if last_double_newline > len(segment) * 0.5:
            return segment[:last_double_newline].strip()

        # 2. 尝试在句子边界切割
        for punct in ['。', '！', '？', '.', '!', '?']:
            last_punct = segment.rfind(punct)
            if last_punct > len(segment) * 0.5:
                return segment[:last_punct + 1].strip()

        # 3. 尝试在单换行切割
        last_newline = segment.rfind('\n')
        if last_newline > len(segment) * 0.5:
            return segment[:last_newline].strip()

        # 4. 尝试在空格切割
        last_space = segment.rfind(' ')
        if last_space > len(segment) * 0.5:
            return segment[:last_space].strip()

        # 5. 硬切割
        return segment.strip()
