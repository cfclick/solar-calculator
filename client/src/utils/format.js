export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const nf = (d) => new Intl.NumberFormat(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

export const fmt = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '—' : nf(d).format(v));

export const pct = (v, d = 1) => (v === null || v === undefined ? '—' : `${nf(d).format(v * 100)}%`);

export const money = (v, currency = 'USD') =>
  v === null || v === undefined
    ? '—'
    : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);

export const signedPct = (a, b) => {
  if (!b) return '—';
  const d = ((a - b) / b) * 100;
  return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}%`;
};

export function compass(az) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}
