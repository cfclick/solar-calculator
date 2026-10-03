// NREL PVWatts v8 API (now served from developer.nlr.gov). A single hourly
// call returns both PVWatts' own estimate and the NSRDB TMY weather it used,
// which the engine can reuse as a higher-resolution (4 km satellite) source.
// https://developer.nlr.gov/docs/solar/pvwatts/v8/

import { fetchJson, UpstreamError } from './http.js';
import { TtlCache } from './cache.js';

const BASE = process.env.NREL_API_BASE || 'https://developer.nlr.gov/api/pvwatts/v8.json';
const HOUR_MS = 3600000;
const REF_YEAR = 2023;

const ARRAY_TYPE = { 'fixed-open': 0, 'fixed-roof': 1, '1-axis': 2, '1-axis-backtrack': 3 };
const MODULE_TYPE = { standard: 0, premium: 1, thinfilm: 2 };

const cache = new TtlCache({ max: 200 });
// After a 429, skip NREL for a while instead of paying a slow failed call per request.
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
let rateLimitedUntil = 0;
// NSRDB weather depends only on location; keep it apart from system-specific results.
const weatherCache = new TtlCache({ max: 200 });
const locKey = (lat, lon) => `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;

// Minimal default system: only the weather part of the response is used.
const WEATHER_PROBE = {
  capacityKw: 1,
  moduleType: 'standard',
  arrayType: 'fixed-open',
  tilt: 20,
  azimuth: 180,
  totalLossPct: 14.08,
  dcAcRatio: 1.2,
  inverterEfficiency: 96,
  gcr: 0.4,
  albedo: 0.2,
};

/** NSRDB TMY weather for a location, reusing any earlier PVWatts call there. */
export function getNsrdbWeather(lat, lon) {
  return weatherCache.wrap(locKey(lat, lon), async () => {
    const { weather } = await runPvwatts(lat, lon, WEATHER_PROBE, 'nsrdb');
    if (!weather) throw new UpstreamError('PVWatts', 'no NSRDB weather returned');
    return { weather };
  });
}

export const hasCustomKey = () => Boolean(process.env.NREL_API_KEY);

/**
 * @returns {Promise<{result, weather}>} result = PVWatts estimate, weather = NSRDB records (or null)
 */
export function runPvwatts(lat, lon, system, dataset = 'nsrdb') {
  const params = new URLSearchParams({
    api_key: process.env.NREL_API_KEY || 'DEMO_KEY',
    lat,
    lon,
    system_capacity: system.capacityKw,
    module_type: MODULE_TYPE[system.moduleType],
    losses: system.totalLossPct.toFixed(2),
    array_type: ARRAY_TYPE[system.arrayType],
    tilt: system.arrayType.startsWith('1-axis') ? 0 : system.tilt,
    azimuth: system.arrayType.startsWith('1-axis') ? 180 : system.azimuth,
    dc_ac_ratio: system.dcAcRatio,
    inv_eff: system.inverterEfficiency,
    gcr: system.gcr,
    albedo: system.albedo,
    dataset,
    radius: 0,
    timeframe: 'hourly',
  });
  const cacheKey = [...params].filter(([k]) => k !== 'api_key').join('&');

  return cache.wrap(cacheKey, async () => {
    if (Date.now() < rateLimitedUntil) {
      throw new UpstreamError('PVWatts', 'NREL API rate limit reached; retrying in a few minutes', 429);
    }
    let body;
    try {
      body = await fetchJson('PVWatts', `${BASE}?${params}`, { retry: false });
    } catch (err) {
      if (err.status === 429) rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      throw err;
    }
    if (body.errors?.length) throw new UpstreamError('PVWatts', body.errors.join('; '));
    const o = body.outputs;
    const st = body.station_info || {};
    const tz = Number(st.tz ?? Math.round(lon / 15));

    let weather = null;
    if (Array.isArray(o.dn) && o.dn.length === 8760) {
      // Hourly values are in local standard time, index 0 = Jan 1 00:00-01:00.
      const records = o.dn.map((dni, i) => ({
        start: Date.UTC(REF_YEAR, 0, 1) + (i - tz) * HOUR_MS,
        ghi: null, // not returned; reconstructed from DNI/DHI and solar geometry
        dni: Math.max(0, dni),
        dhi: Math.max(0, o.df[i]),
        tAmb: o.tamb[i],
        wind: o.wspd[i],
      }));
      weather = {
        records,
        tzOffsetHours: tz,
        meta: {
          source: 'NSRDB TMY (via PVWatts)',
          dataset: st.weather_data_source || 'NSRDB',
          elevation: st.elev,
          stationDistanceM: st.distance,
          horizonApplied: false,
        },
      };
    }

    if (weather && dataset === 'nsrdb' && weatherCache.get(locKey(lat, lon)) === undefined) {
      weatherCache.set(locKey(lat, lon), Promise.resolve({ weather }));
    }

    return {
      result: {
        source: 'NREL PVWatts v8',
        model: 'PVWatts',
        dataset: st.weather_data_source,
        acKwh: o.ac_annual,
        monthly: o.ac_monthly,
        note: 'NREL reference model; no terrain horizon shading.',
      },
      weather,
    };
  });
}
