// Address search via OpenStreetMap Nominatim (usage policy: max 1 req/s,
// identifying User-Agent). Results are cached to stay well within limits.

import { fetchJson } from './http.js';
import { TtlCache } from './cache.js';

const cache = new TtlCache({ max: 500, ttlMs: 7 * 24 * 3600 * 1000 });

export function geocode(query) {
  const q = query.trim().toLowerCase();
  return cache.wrap(q, async () => {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
    const rows = await fetchJson('Nominatim', url, {
      timeoutMs: 10000,
      headers: { 'User-Agent': 'solar-calculator/1.0 (self-hosted PV estimator)' },
    });
    return rows.map((r) => ({
      name: r.display_name,
      lat: Number(r.lat),
      lon: Number(r.lon),
    }));
  });
}
