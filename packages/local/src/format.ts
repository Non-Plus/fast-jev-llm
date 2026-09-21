export function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 10_000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return formatCount(value);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatAgo(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) {
    return "unknown";
  }
  const delta = Math.max(0, now - then);
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function pad(label: string, width: number): string {
  return label.padEnd(width, " ");
}
