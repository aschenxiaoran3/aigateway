import React from 'react';
import { Tag } from 'antd';

const statusColor: Record<string, string> = {
  queued: 'default',
  running: 'processing',
  completed: 'success',
  failed: 'error',
  stalled: 'warning',
  ready: 'success',
  pending: 'default',
  up_to_date: 'success',
  error: 'error',
  rejected: 'error',
  ignored: 'default',
};

export function statusTag(status?: string) {
  return <Tag color={statusColor[status || ''] || 'default'}>{status || '-'}</Tag>;
}
