import React from 'react';
import { CodeOutlined } from '@ant-design/icons';
import { Empty, Typography } from 'antd';
import { MermaidBlock } from '../../components/deepwiki/MermaidBlock';

const { Link, Paragraph, Text, Title } = Typography;

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(<React.Fragment key={`${keyPrefix}-text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</React.Fragment>);
    }
    if (match[2] && match[3]) {
      nodes.push(
        <Link key={`${keyPrefix}-link-${match.index}`} href={match[3]} target="_blank" rel="noreferrer">
          {match[2]}
        </Link>
      );
    } else if (match[4]) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${match.index}`}
          style={{
            padding: '2px 6px',
            borderRadius: 6,
            background: 'rgba(15, 23, 42, 0.06)',
            fontSize: 13,
          }}
        >
          {match[4]}
        </code>
      );
    } else if (match[5]) {
      nodes.push(
        <Text key={`${keyPrefix}-bold-${match.index}`} strong>
          {match[5]}
        </Text>
      );
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(<React.Fragment key={`${keyPrefix}-text-${lastIndex}`}>{text.slice(lastIndex)}</React.Fragment>);
  }

  return nodes.length ? nodes : [text];
}

export function renderMarkdownBlocks(content: string) {
  const lines = String(content || '').replace(/\r/g, '').split('\n');
  const blocks: React.ReactNode[] = [];
  let index = 0;

  const isTableDelimiter = (line: string) => /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line);

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const language = line.replace(/^```/, '').trim();
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !lines[index].startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <div key={`code-${index}`} style={{ marginBottom: 16 }}>
          {language ? (
            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
              <CodeOutlined /> {language}
            </Text>
          ) : null}
          {language.toLowerCase() === 'mermaid' ? (
            <MermaidBlock code={codeLines.join('\n')} />
          ) : (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                margin: 0,
                padding: 16,
                borderRadius: 12,
                background: '#0f172a',
                color: '#e2e8f0',
                overflow: 'auto',
              }}
            >
              {codeLines.join('\n')}
            </pre>
          )}
        </div>
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      blocks.push(
        <Title key={`heading-${index}`} level={Math.min(level + 1, 5) as 1 | 2 | 3 | 4 | 5} style={{ marginTop: level <= 2 ? 8 : 4 }}>
          {renderInlineMarkdown(headingText, `heading-${index}`)}
        </Title>
      );
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDelimiter(lines[index + 1])) {
      const header = line.split('|').map((item) => item.trim()).filter(Boolean);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|')) {
        rows.push(lines[index].split('|').map((item) => item.trim()).filter(Boolean));
        index += 1;
      }
      blocks.push(
        <div key={`table-${index}`} style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead>
              <tr>
                {header.map((cell, cellIndex) => (
                  <th
                    key={`th-${cellIndex}`}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderBottom: '1px solid #dbe4f0',
                      background: '#f8fbff',
                    }}
                  >
                    {renderInlineMarkdown(cell, `table-h-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`tr-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`td-${rowIndex}-${cellIndex}`} style={{ padding: '10px 12px', borderBottom: '1px solid #eef2f7' }}>
                      {renderInlineMarkdown(cell, `table-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const unorderedMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (unorderedMatch) {
      const items: string[] = [];
      while (index < lines.length) {
        const currentMatch = lines[index].match(/^\s*[-*]\s+(.*)$/);
        if (!currentMatch) break;
        items.push(currentMatch[1]);
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`} style={{ paddingLeft: 20, marginTop: 0 }}>
          {items.map((item, itemIndex) => (
            <li key={`li-${itemIndex}`} style={{ marginBottom: 8 }}>
              {renderInlineMarkdown(item, `ul-${index}-${itemIndex}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (orderedMatch) {
      const items: string[] = [];
      while (index < lines.length) {
        const currentMatch = lines[index].match(/^\s*\d+\.\s+(.*)$/);
        if (!currentMatch) break;
        items.push(currentMatch[1]);
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`} style={{ paddingLeft: 20, marginTop: 0 }}>
          {items.map((item, itemIndex) => (
            <li key={`oli-${itemIndex}`} style={{ marginBottom: 8 }}>
              {renderInlineMarkdown(item, `ol-${index}-${itemIndex}`)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const currentMatch = lines[index].match(/^\s*>\s?(.*)$/);
        if (!currentMatch) break;
        quoteLines.push(currentMatch[1]);
        index += 1;
      }
      blocks.push(
        <div
          key={`quote-${index}`}
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            borderLeft: '4px solid #91caff',
            background: '#f7fbff',
            borderRadius: 8,
          }}
        >
          {quoteLines.map((item, quoteIndex) => (
            <Paragraph key={`quote-p-${quoteIndex}`} style={{ marginBottom: quoteIndex === quoteLines.length - 1 ? 0 : 8 }}>
              {renderInlineMarkdown(item, `quote-${index}-${quoteIndex}`)}
            </Paragraph>
          ))}
        </div>
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      const current = lines[index];
      if (
        current.startsWith('```') ||
        /^#{1,6}\s+/.test(current) ||
        /^\s*[-*]\s+/.test(current) ||
        /^\s*\d+\.\s+/.test(current) ||
        /^\s*>\s?/.test(current) ||
        (current.includes('|') && index + 1 < lines.length && isTableDelimiter(lines[index + 1]))
      ) {
        break;
      }
      paragraphLines.push(current.trim());
      index += 1;
    }
    blocks.push(
      <Paragraph key={`p-${index}`} style={{ fontSize: 15, lineHeight: 1.8 }}>
        {renderInlineMarkdown(paragraphLines.join(' '), `p-${index}`)}
      </Paragraph>
    );
  }

  return blocks.length ? blocks : <Empty description="暂无可预览内容" />;
}
