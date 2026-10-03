const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae'];

export function fmt(n: number): string {
  if (!isFinite(n)) return '∞';
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n < 10) return sign + (Math.round(n * 10) / 10).toString();
  if (n < 1000) return sign + Math.floor(n).toString();
  const tier = Math.min(SUFFIXES.length - 1, Math.floor(Math.log10(n) / 3));
  const scaled = n / Math.pow(1000, tier);
  const digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return sign + scaled.toFixed(digits) + SUFFIXES[tier];
}

export const credits = (n: number) => `₵${fmt(n)}`;

export function pct(n: number): string {
  const v = Math.round(n * 100);
  return `${v > 0 ? '+' : ''}${v.toLocaleString('en-US')}%`;
}

export function duration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} 小時 ${m} 分`;
  if (m > 0) return `${m} 分鐘`;
  return `${Math.floor(sec)} 秒`;
}
