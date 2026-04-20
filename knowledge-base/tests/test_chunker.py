"""
Test suite for knowledge-base chunker module
"""

import pytest
from ingest.chunker import MarkdownChunker
from ingest.document_loader import DocumentLoader
from unittest.mock import patch

# Test data
TEST_MARKDOWN = """# Header 1

This is a paragraph. It has multiple sentences.

## Header 2

This is another paragraph.

```python
def hello():
    return 'world'
```

### Header 3

This is the final paragraph.
"""

TEST_TEXT = """This is a long text document that should be split into chunks of approximately 500 characters. It contains multiple sentences and should maintain semantic coherence across chunks. The goal is to test that the chunking algorithm works correctly for plain text documents.
""" * 10  # Multiply to make it long enough

@pytest.fixture
def markdown_loader():
    return DocumentLoader.from_string(TEST_MARKDOWN)

@pytest.fixture
def text_loader():
    return DocumentLoader.from_string(TEST_TEXT)

@patch('ingest.chunker.logger')
def test_markdown_chunker(mock_logger):
    """Test Markdown chunker with default settings"""
    chunker = MarkdownChunker(chunk_size=500, overlap=50)
    docs = chunker.chunk({'content': TEST_MARKDOWN, 'metadata': {'source': 'string'}})
    
    assert len(docs) == 4  # Should create 4 chunks
    assert all('content' in doc for doc in docs)
    assert all('metadata' in doc for doc in docs)
    
    # Check first chunk (should contain header 1 and part of first paragraph)
    first_content = docs[0]['content']
    assert 'Header 1' in first_content
    assert 'paragraph. It has multiple sentences.' in first_content
    assert '```python' in first_content  # Code block should be preserved
    
    # Check second chunk (should start with Header 2)
    second_content = docs[1]['content']
    assert 'Header 2' in second_content
    assert 'another paragraph.' in second_content
    
    # Check last chunk (should contain Header 3)
    last_content = docs[-1]['content']
    assert 'Header 3' in last_content
    assert 'final paragraph.' in last_content
    
    # Check metadata
    assert docs[0]['metadata']['source'] == 'string://test'
    assert docs[0]['metadata']['type'] == 'markdown'
    assert docs[0]['metadata']['chunk_index'] == 0
    assert docs[0]['metadata']['total_chunks'] == 4
    
    # Check overlap between chunks
    overlap = set(docs[0]['content'].split()) & set(docs[1]['content'].split())
    assert len(overlap) > 10  # Should have significant overlap

@patch('ingest.chunker.logger')
def test_text_chunker(mock_logger):
    """Test text chunker with different chunk sizes"""
    chunker = MarkdownChunker(chunk_size=300, overlap=30)
    docs = chunker.chunk({'content': TEST_TEXT, 'metadata': {'source': 'text'}})
    
    assert len(docs) == 17  # Should create 17 chunks
    
    # Check first chunk
    first_content = docs[0]['content']
    assert len(first_content) <= 330  # Should be within limit
    assert 'This is a long text document' in first_content
    
    # Check last chunk
    last_content = docs[-1]['content']
    assert 'This is the final paragraph' in last_content
    assert len(last_content) <= 330
    
    # Check overlap
    overlap = set(docs[0]['content'].split()) & set(docs[1]['content'].split())
    assert len(overlap) > 10
    
    # Check metadata
    assert docs[0]['metadata']['source'] == 'text'
    assert docs[0]['metadata']['type'] == 'text'
    assert docs[0]['metadata']['chunk_index'] == 0
    assert docs[0]['metadata']['total_chunks'] == 17

@patch('ingest.chunker.logger')
def test_chunker_with_large_document(mock_logger):
    """Test chunker with very large document"""
    large_text = TEST_TEXT * 50  # Make it huge
    chunker = MarkdownChunker(chunk_size=400, overlap=40)
    docs = chunker.chunk({'content': large_text, 'metadata': {'source': 'large'}})
    
    assert len(docs) > 1000  # Should create many chunks
    assert len(docs[0]['content']) <= 440  # Should respect size limit
    
    # Check first chunk
    first_content = docs[0]['content']
    assert 'This is a long text document' in first_content
    assert len(first_content) <= 440
    
    # Check last chunk
    last_content = docs[-1]['content']
    assert 'This is the final paragraph' in last_content
    assert len(last_content) <= 440

@patch('ingest.chunker.logger')
def test_chunker_with_empty_content(mock_logger):
    """Test chunker with empty content"""
    chunker = MarkdownChunker(chunk_size=500, overlap=50)
    docs = chunker.chunk({'content': '', 'metadata': {'source': 'empty'}})
    
    assert len(docs) == 1  # Should return one empty chunk
    assert docs[0]['content'] == ''
    assert docs[0]['metadata']['chunk_index'] == 0
    assert docs[0]['metadata']['total_chunks'] == 1

@patch('ingest.chunker.logger')
def test_chunker_with_single_paragraph(mock_logger):
    """Test chunker with single paragraph"""
    single_para = "This is a single paragraph with no headers or code blocks. It should be treated as a single chunk." * 10
    chunker = MarkdownChunker(chunk_size=500, overlap=50)
    docs = chunker.chunk({'content': single_para, 'metadata': {'source': 'single'}})
    
    assert len(docs) == 1  # Should be one chunk
    assert len(docs[0]['content']) <= 550
    assert docs[0]['metadata']['chunk_index'] == 0
    assert docs[0]['metadata']['total_chunks'] == 1

if __name__ == '__main__':
    pytest.main([__file__])
