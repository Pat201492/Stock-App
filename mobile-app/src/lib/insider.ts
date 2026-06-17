// Shared insider-trade formatting, mirroring the web insiders page.
export const INSIDER_TYPE_LABEL: Record<string, string> = {
  P: 'Purchase',
  S: 'Sale',
  A: 'Award',
  M: 'Option Exercise',
  G: 'Gift',
  F: 'Tax Withhold',
  D: 'Disposition',
};

export function insiderTypeLabel(t: string | null | undefined): string {
  if (!t) return '?';
  return INSIDER_TYPE_LABEL[t] ?? t;
}

export function insiderTypeColor(t: string | null | undefined): string {
  if (t === 'P') return '#1b8a3a'; // buy
  if (t === 'S' || t === 'D') return '#c00'; // sell
  return '#8e8e93'; // neutral
}

export function fmtVal(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function fmtShares(n: number | null | undefined): string {
  if (n == null) return '—';
  return Math.round(n).toLocaleString();
}
