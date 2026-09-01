function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Format: "01.09.2026" */
export function formatDate(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Format: "01.09.2026 14:05:09" */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
