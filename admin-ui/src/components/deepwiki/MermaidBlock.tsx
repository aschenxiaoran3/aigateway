import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Empty,
  Modal,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CopyOutlined,
  DownloadOutlined,
  ExpandOutlined,
  ShrinkOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';

const { Paragraph, Text } = Typography;

let mermaidLoader: Promise<unknown> | null = null;

type MermaidBlockProps = {
  code: string;
  title?: string;
  summary?: string | null;
  renderSource?: string | null;
  provider?: string | null;
  model?: string | null;
  coveredEvidence?: string[];
  missingEvidence?: string[];
  qualityNotes?: string[];
  downloadName?: string;
  showToolbar?: boolean;
};

function loadMermaidLibrary() {
  if ((window as unknown as { mermaid?: { initialize: (config: Record<string, unknown>) => void } }).mermaid) {
    return Promise.resolve((window as unknown as { mermaid: unknown }).mermaid);
  }
  if (!mermaidLoader) {
    mermaidLoader = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-mermaid-loader="true"]') as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener('load', () => resolve((window as unknown as { mermaid: unknown }).mermaid), { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js';
      script.async = true;
      script.dataset.mermaidLoader = 'true';
      script.onload = () => {
        const mermaid = (window as unknown as { mermaid?: { initialize: (config: Record<string, unknown>) => void } }).mermaid;
        mermaid?.initialize?.({
          startOnLoad: false,
          securityLevel: 'loose',
          theme: 'default',
        });
        resolve(mermaid || null);
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  return mermaidLoader;
}

function sanitizeFileName(value: string) {
  return String(value || 'diagram')
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'diagram';
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function svgToPngBlob(svg: string) {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const objectUrl = URL.createObjectURL(svgBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = objectUrl;
    });
    const svgTag = new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('svg');
    const viewBox = svgTag?.getAttribute('viewBox')?.split(/\s+/).map(Number).filter((n) => Number.isFinite(n)) || [];
    const width = Number(svgTag?.getAttribute('width')?.replace(/px$/, '')) || viewBox[2] || image.width || 1600;
    const height = Number(svgTag?.getAttribute('height')?.replace(/px$/, '')) || viewBox[3] || image.height || 900;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width);
    canvas.height = Math.ceil(height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('canvas unavailable');
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      throw new Error('png export failed');
    }
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function MermaidCanvas({
  svg,
  scale,
  fullscreen,
}: {
  svg: string;
  scale: number;
  fullscreen?: boolean;
}) {
  return (
    <div
      style={{
        overflow: 'auto',
        background: '#fff',
        borderRadius: 8,
        padding: fullscreen ? 16 : 12,
        border: '1px solid #edf2f7',
        minHeight: fullscreen ? '70vh' : 240,
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          width: scale === 1 ? '100%' : `${100 / scale}%`,
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

export function MermaidBlock({
  code,
  title,
  summary,
  renderSource,
  provider,
  model,
  coveredEvidence = [],
  missingEvidence = [],
  qualityNotes = [],
  downloadName,
  showToolbar = true,
}: MermaidBlockProps) {
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const elementId = useMemo(() => `mermaid-${Math.random().toString(36).slice(2, 10)}`, []);
  const fileBaseName = useMemo(
    () => sanitizeFileName(downloadName || title || 'deepwiki-diagram'),
    [downloadName, title]
  );

  useEffect(() => {
    let mounted = true;
    setSvg('');
    setFailed(false);
    setScale(1);
    loadMermaidLibrary()
      .then(async () => {
        const mermaid = (window as unknown as { mermaid?: { render: (id: string, text: string) => Promise<{ svg: string }> } }).mermaid;
        if (!mermaid?.render) {
          throw new Error('mermaid is unavailable');
        }
        const rendered = await mermaid.render(elementId, code);
        if (mounted) {
          setSvg(rendered.svg || '');
        }
      })
      .catch(() => {
        if (mounted) {
          setFailed(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [code, elementId]);

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(code);
      message.success('Mermaid 源码已复制');
    } catch {
      message.error('复制失败');
    }
  };

  const downloadMmd = () => {
    downloadBlob(new Blob([code], { type: 'text/plain;charset=utf-8' }), `${fileBaseName}.mmd`);
  };

  const downloadSvg = () => {
    if (!svg) {
      message.warning('图还没渲染完成');
      return;
    }
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${fileBaseName}.svg`);
  };

  const downloadPng = async () => {
    if (!svg) {
      message.warning('图还没渲染完成');
      return;
    }
    try {
      const blob = await svgToPngBlob(svg);
      downloadBlob(blob, `${fileBaseName}.png`);
    } catch {
      message.error('PNG 导出失败');
    }
  };

  const toolbar = showToolbar ? (
    <Space wrap size={[8, 8]} style={{ width: '100%', justifyContent: 'space-between' }}>
      <Space wrap size={[8, 8]}>
        {renderSource ? (
          <Tag color={renderSource === 'fallback_heuristic' ? 'orange' : 'blue'}>
            {renderSource === 'fallback_heuristic' ? 'draft / fallback' : renderSource}
          </Tag>
        ) : null}
        {provider ? <Tag color="geekblue">{provider}</Tag> : null}
        {model ? <Tag color="cyan">{model}</Tag> : null}
        {coveredEvidence.length ? <Tag color="green">证据 {coveredEvidence.length}</Tag> : null}
        {missingEvidence.length ? <Tag color="volcano">缺证据 {missingEvidence.length}</Tag> : null}
        {qualityNotes.length ? <Tag color="gold">质量备注 {qualityNotes.length}</Tag> : null}
      </Space>
      <Space wrap size={[8, 8]}>
        <Tooltip title="缩小">
          <Button icon={<ZoomOutOutlined />} size="small" onClick={() => setScale((current) => Math.max(0.6, Number((current - 0.1).toFixed(2))))} />
        </Tooltip>
        <Tooltip title="适配视图">
          <Button icon={<ShrinkOutlined />} size="small" onClick={() => setScale(1)} />
        </Tooltip>
        <Tooltip title="放大">
          <Button icon={<ZoomInOutlined />} size="small" onClick={() => setScale((current) => Math.min(2.4, Number((current + 0.1).toFixed(2))))} />
        </Tooltip>
        <Tooltip title="复制 Mermaid">
          <Button icon={<CopyOutlined />} size="small" onClick={() => void copySource()} />
        </Tooltip>
        <Tooltip title="下载 MMD">
          <Button icon={<DownloadOutlined />} size="small" onClick={downloadMmd} />
        </Tooltip>
        <Tooltip title="下载 SVG">
          <Button size="small" onClick={downloadSvg}>
            SVG
          </Button>
        </Tooltip>
        <Tooltip title="下载 PNG">
          <Button size="small" onClick={() => void downloadPng()}>
            PNG
          </Button>
        </Tooltip>
        <Tooltip title="全屏预览">
          <Button icon={<ExpandOutlined />} size="small" onClick={() => setFullscreenOpen(true)} />
        </Tooltip>
      </Space>
    </Space>
  ) : null;

  if (failed) {
    return (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {toolbar}
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="当前 Mermaid 渲染失败，已保留源码供排查或下载"
        />
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
          {code}
        </pre>
      </Space>
    );
  }

  return (
    <>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {summary ? (
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {summary}
          </Paragraph>
        ) : null}
        {toolbar}
        {!svg ? <Spin /> : <MermaidCanvas svg={svg} scale={scale} />}
        {coveredEvidence.length ? (
          <div>
            <Text strong>覆盖证据</Text>
            <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
              {coveredEvidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {missingEvidence.length ? (
          <div>
            <Text strong>待补证据</Text>
            <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
              {missingEvidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {qualityNotes.length ? (
          <div>
            <Text strong>质量备注</Text>
            <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
              {qualityNotes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Space>
      <Modal
        title={title || '图表预览'}
        open={fullscreenOpen}
        onCancel={() => setFullscreenOpen(false)}
        footer={null}
        width="90vw"
        style={{ top: 24 }}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Space wrap size={[8, 8]} style={{ justifyContent: 'space-between', width: '100%' }}>
            <Space wrap size={[8, 8]}>
              {renderSource ? (
                <Tag color={renderSource === 'fallback_heuristic' ? 'orange' : 'blue'}>
                  {renderSource === 'fallback_heuristic' ? 'draft / fallback' : renderSource}
                </Tag>
              ) : null}
              {provider ? <Tag color="geekblue">{provider}</Tag> : null}
              {model ? <Tag color="cyan">{model}</Tag> : null}
              {coveredEvidence.length ? <Tag color="green">覆盖证据 {coveredEvidence.length}</Tag> : null}
              {missingEvidence.length ? <Tag color="volcano">待补证据 {missingEvidence.length}</Tag> : null}
              {qualityNotes.length ? <Tag color="gold">质量备注 {qualityNotes.length}</Tag> : null}
            </Space>
            <Space wrap size={[8, 8]}>
              <Button icon={<ZoomOutOutlined />} onClick={() => setScale((current) => Math.max(0.6, Number((current - 0.1).toFixed(2))))} />
              <Button icon={<ShrinkOutlined />} onClick={() => setScale(1)} />
              <Button icon={<ZoomInOutlined />} onClick={() => setScale((current) => Math.min(2.4, Number((current + 0.1).toFixed(2))))} />
              <Button icon={<CopyOutlined />} onClick={() => void copySource()}>
                复制 Mermaid
              </Button>
              <Button onClick={downloadMmd}>下载 MMD</Button>
              <Button onClick={downloadSvg}>下载 SVG</Button>
              <Button onClick={() => void downloadPng()}>下载 PNG</Button>
            </Space>
          </Space>
          {summary ? (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {summary}
            </Paragraph>
          ) : null}
          {!svg ? (
            <Spin />
          ) : (
            <MermaidCanvas svg={svg} scale={scale} fullscreen />
          )}
          {missingEvidence.length ? (
            <div>
              <Text strong>待补证据</Text>
              <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
                {missingEvidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {coveredEvidence.length ? (
            <div>
              <Text strong>覆盖证据</Text>
              <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
                {coveredEvidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {qualityNotes.length ? (
            <div>
              <Text strong>质量备注</Text>
              <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
                {qualityNotes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Space>
      </Modal>
    </>
  );
}
