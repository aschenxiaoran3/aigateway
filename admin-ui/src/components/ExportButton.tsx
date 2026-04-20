import React from 'react';
import { Button, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';

export type ExportColumn = { title: string; dataIndex?: string; key?: string };

type Props = {
  data: Array<Record<string, unknown>>;
  columns: ExportColumn[];
  fileName?: string;
};

const ExportButton: React.FC<Props> = ({ data, columns, fileName }) => {
  const handleExport = () => {
    if (!data?.length) {
      message.warning('没有可导出的数据');
      return;
    }
    const headers = columns.map((c) => c.title);
    const keys = columns.map((c) => String(c.dataIndex || c.key || ''));
    const rows = data.map((row) =>
      keys.map((k) => {
        const v = row[k];
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      })
    );
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'data');
    XLSX.writeFile(wb, fileName || `export-${Date.now()}.xlsx`);
    message.success('已导出');
  };

  return (
    <Button type="default" icon={<DownloadOutlined />} onClick={handleExport}>
      导出
    </Button>
  );
};

export default ExportButton;
