async function request(url, options) {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  defaults: () => request('/api/defaults'),
  geocode: (q) => request(`/api/geocode?q=${encodeURIComponent(q)}`),
  sunHours: ({ lat, lon, weatherSource, longTermCorrection }, signal) =>
    request(
      `/api/sun-hours?${new URLSearchParams({ lat, lon, weatherSource, longTermCorrection: String(longTermCorrection) })}`,
      { signal }
    ),
  obstacles: (lat, lon, radius = 120) => request(`/api/obstacles?${new URLSearchParams({ lat, lon, radius })}`),
  shading: (payload, signal) =>
    request('/api/shading', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    }),
  health: () => request('/api/health'),
  size: (payload, signal) =>
    request('/api/size', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    }),
  readBill: (payload) =>
    request('/api/bill/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  estimate: (payload) =>
    request('/api/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
};
