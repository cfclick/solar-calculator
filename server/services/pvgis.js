// European Commission JRC PVGIS 5.3 API — global typical-meteorological-year
// data (ERA5 / SARAH3), terrain horizon profiles and the PVGIS PV estimate.
// https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en

import { fetchJson, UpstreamError } from './http.js';
import { TtlCache } from './cache.js';

const BASE = 'https://re.jrc.ec.europa.eu/api/v5_3';
const HOUR_MS = 3600000;
const REF_YEAR = 2023; // non-leap reference year for TMY records

const tmyCache = new TtlCache({ max: 100 });
const horizonCache = new TtlCache({ max: 300 });
const ltCache = new TtlCache({ max: 300 });

const key = (lat, lon) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

/** Hourly TMY normalised to the engine's weather-record format. */
export function getTmy(lat, lon) {
  return tmyCache.wrap(key(lat, lon), async () => {
    const url = `${BASE}/tmy?lat=${lat}&lon=${lon}&outputformat=json`;
    const body = await fetchJson('PVGIS', url);
    const rows = body?.outputs?.tmy_hourly;
    if (!Array.isArray(rows) || rows.length < 8760) throw new UpstreamError('PVGIS', 'no TMY data for this location');

    // PVGIS timestamps are UTC; irradiance values are centred at time + offset.
    const offsetH = Number(body.inputs?.location?.irradiance_time_offset ?? 0.5);
    const records = rows.map((r) => {
      const t = r['time(UTC)'];
      const mo = +t.slice(4, 6) - 1;
      const d = +t.slice(6, 8);
      const h = +t.slice(9, 11);
      const center = Date.UTC(REF_YEAR, mo, d, h) + offsetH * HOUR_MS;
      return {
        start: center - HOUR_MS / 2,
        ghi: Math.max(0, r['G(h)']),
        dni: Math.max(0, r['Gb(n)']),
        dhi: Math.max(0, r['Gd(h)']),
        tAmb: r.T2m,
        wind: r.WS10m,
      };
    });
    records.sort((a, b) => a.start - b.start);

    const m = body.inputs?.meteo_data || {};
    return {
      records,
      meta: {
        source: 'PVGIS TMY',
        dataset: m.radiation_db || 'PVGIS',
        period: m.year_min && m.year_max ? `${m.year_min}–${m.year_max}` : undefined,
        elevation: body.inputs?.location?.elevation,
        horizonApplied: Boolean(m.use_horizon),
      },
    };
  });
}

/**
 * Long-term mean monthly GHI (kWh/m²) over the full PVGIS record, used to
 * remove the bias a typical-meteorological-year selection can carry.
 */
export function getLongTermMonthlyGhi(lat, lon) {
  return ltCache.wrap(key(lat, lon), async () => {
    const url = `${BASE}/MRcalc?lat=${lat}&lon=${lon}&horirrad=1&outputformat=json`;
    const body = await fetchJson('PVGIS', url);
    const rows = body?.outputs?.monthly;
    if (!Array.isArray(rows) || !rows.length) throw new UpstreamError('PVGIS', 'no monthly radiation data');
    const sum = new Array(12).fill(0);
    const cnt = new Array(12).fill(0);
    for (const r of rows) {
      sum[r.month - 1] += r['H(h)_m'];
      cnt[r.month - 1]++;
    }
    const years = new Set(rows.map((r) => r.year));
    return {
      monthly: sum.map((s, i) => (cnt[i] ? s / cnt[i] : null)),
      period: `${Math.min(...years)}–${Math.max(...years)}`,
    };
  });
}

/** Terrain horizon profile as [{azimuth (deg from north), elevation (deg)}]. */
export function getHorizon(lat, lon) {
  return horizonCache.wrap(key(lat, lon), async () => {
    const url = `${BASE}/printhorizon?lat=${lat}&lon=${lon}&outputformat=json`;
    const body = await fetchJson('PVGIS', url);
    const prof = body?.outputs?.horizon_profile;
    if (!Array.isArray(prof)) throw new UpstreamError('PVGIS', 'no horizon profile');
    // PVGIS azimuth: 0 = south, -90 = east, +90 = west.
    const seen = new Map();
    for (const p of prof) seen.set(((p.A + 180) % 360 + 360) % 360, p.H_hor);
    return [...seen].map(([azimuth, elevation]) => ({ azimuth, elevation })).sort((a, b) => a.azimuth - b.azimuth);
  });
}

/**
 * PVGIS's own PV estimate, used as an independent cross-check.
 * PVGIS "system loss" includes inverter losses, so the caller passes the combined figure.
 */
export async function getPvcalc(lat, lon, system, combinedLossPct) {
  const params = new URLSearchParams({
    lat,
    lon,
    peakpower: system.capacityKw,
    loss: combinedLossPct.toFixed(2),
    pvtechchoice: system.moduleType === 'thinfilm' ? 'CdTe' : 'crystSi',
    // PVGIS "building" means building-integrated (unventilated); racked roofs behave
    // much closer to free-standing.
    mountingplace: 'free',
    outputformat: 'json',
  });
  if (system.arrayType.startsWith('1-axis')) {
    params.set('fixed', '0');
    params.set('inclined_axis', '1');
    params.set('inclinedaxisangle', '0');
  } else {
    params.set('angle', system.tilt);
    params.set('aspect', system.azimuth - 180);
  }
  const body = await fetchJson('PVGIS', `${BASE}/PVcalc?${params}`);
  const out = body.outputs;
  const series = out.totals.fixed ? 'fixed' : Object.keys(out.totals)[0];
  const monthly = (out.monthly[series] || []).map((m) => m.E_m);
  return {
    source: 'PVGIS 5.3',
    model: 'PVGIS PVcalc',
    dataset: body.inputs?.meteo_data?.radiation_db,
    acKwh: out.totals[series].E_y,
    monthly,
    note: 'Multi-year average; no inverter clipping modelled.',
  };
}
