// Nearby buildings and trees from OpenStreetMap (Overpass API), with heights.
// Many OSM buildings carry no height; those are estimated from the number of
// levels or the building type and flagged so the user can correct them.

import { UpstreamError } from './http.js';
import { TtlCache } from './cache.js';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const cache = new TtlCache({ max: 200, ttlMs: 7 * 24 * 3600 * 1000 });

// Typical eave-to-ridge averaged heights (m) by OSM building type.
const TYPE_HEIGHT = {
  house: 7,
  detached: 7,
  semidetached_house: 7,
  terrace: 8,
  residential: 8,
  bungalow: 4.5,
  garage: 3,
  garages: 3,
  shed: 2.5,
  carport: 2.8,
  roof: 4,
  hut: 3,
  cabin: 4,
  apartments: 14,
  commercial: 10,
  retail: 6,
  office: 15,
  industrial: 9,
  warehouse: 9,
  school: 9,
  church: 15,
};
const LEVEL_HEIGHT = 3;

export function getNearbyObstacles(lat, lon, radius = 150) {
  const r = Math.min(300, Math.max(30, Math.round(radius)));
  const key = `${lat.toFixed(4)},${lon.toFixed(4)},${r}`;
  return cache.wrap(key, async () => {
    const query = `[out:json][timeout:25];
(
  way["building"](around:${r},${lat},${lon});
  relation["building"]["type"="multipolygon"](around:${r},${lat},${lon});
  node["natural"="tree"](around:${r},${lat},${lon});
);
out geom tags;`;
    const body = await overpass(query);
    const buildings = [];
    const trees = [];
    for (const el of body.elements || []) {
      if (el.type === 'node' && el.tags?.natural === 'tree') {
        trees.push(tree(el));
      } else if (el.type === 'way' && Array.isArray(el.geometry)) {
        const b = building(el, el.geometry);
        if (b) buildings.push(b);
      } else if (el.type === 'relation' && Array.isArray(el.members)) {
        const outer = el.members.find((m) => m.role === 'outer' && Array.isArray(m.geometry));
        const b = outer && building(el, outer.geometry);
        if (b) buildings.push(b);
      }
    }
    return { buildings, trees, radius: r, source: 'OpenStreetMap contributors (ODbL)' };
  });
}

async function overpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'solar-calculator/1.0' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new UpstreamError('Overpass', `HTTP ${res.status}`, res.status);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof UpstreamError ? lastErr : new UpstreamError('Overpass', lastErr?.message || 'request failed');
}

function building(el, geometry) {
  const ring = geometry.map((p) => [round6(p.lat), round6(p.lon)]);
  if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
  if (ring.length < 3) return null;
  const t = el.tags || {};
  const { height, estimated, basis } = buildingHeight(t);
  return {
    id: `${el.type[0]}${el.id}`,
    kind: 'building',
    type: t.building === 'yes' ? 'building' : t.building,
    name: t.name || [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null,
    polygon: ring,
    height,
    estimated,
    basis,
  };
}

function buildingHeight(t) {
  const h = parseMeters(t.height);
  if (h) return { height: h, estimated: false, basis: 'height tag' };
  const levels = Number(t['building:levels']);
  if (levels > 0) {
    const roofLevels = Number(t['roof:levels']) || 0;
    return { height: round1((levels + roofLevels * 0.5) * LEVEL_HEIGHT + 1), estimated: true, basis: `${levels} levels` };
  }
  const typeH = TYPE_HEIGHT[t.building];
  return { height: typeH ?? 7, estimated: true, basis: typeH ? `typical ${t.building}` : 'default' };
}

function tree(el) {
  const t = el.tags || {};
  const height = parseMeters(t.height) || 8;
  const crown = parseMeters(t.diameter_crown) || Math.max(3, height * 0.6);
  return {
    id: `n${el.id}`,
    kind: 'tree',
    center: [round6(el.lat), round6(el.lon)],
    height,
    crownDiameter: round1(crown),
    estimated: !parseMeters(t.height),
    leafType: t.leaf_type || null,
  };
}

function parseMeters(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  const n = parseFloat(s.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (s.includes("'") || s.includes('ft')) return round1(n * 0.3048);
  return round1(n);
}

const round1 = (v) => Math.round(v * 10) / 10;
const round6 = (v) => Math.round(v * 1e6) / 1e6;
