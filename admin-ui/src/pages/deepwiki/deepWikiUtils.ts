export function getRecordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

export function getNumberValue(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function stringifyShortJson(value: unknown) {
  if (value == null) return '-';
  if (typeof value === 'string') return value;
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > 480 ? `${text.slice(0, 480)}...` : text;
  } catch {
    return String(value);
  }
}

export function formatDuration(seconds?: number | null) {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainSeconds = value % 60;
  if (hours > 0) return `${hours}小时${minutes}分钟`;
  if (minutes > 0) return `${minutes}分钟${remainSeconds}秒`;
  return `${remainSeconds}秒`;
}

export function formatEta(seconds?: number | null) {
  if (seconds == null || Number.isNaN(Number(seconds))) return '预估中';
  return `预计剩余 ${formatDuration(seconds)}`;
}
