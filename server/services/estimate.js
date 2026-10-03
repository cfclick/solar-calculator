// Orchestrates weather retrieval, the in-house hourly model and the
// independent reference models (PVGIS, PVWatts).

import { getTmy, getHorizon, getPvcalc, getLongTermMonthlyGhi } from './pvgis.js';
import { runPvwatts, getNsrdbWeather } from './pvwatts.js';
import { precomputeSun, simulate, normalizeSystem, orientationSweeps } from '../engine/simulate.js';
import { lifetimeAnalysis } from '../engine/financial.js';
import { recommendSize } from '../engine/sizing.js';
import { analyzeShading } from '../engine/shading.js';

const RAD = Math.PI / 180;

export async function estimate(body) {
  const { lat, lon } = parseLocation(body);
  const system = normalizeSystem(body.system);
  const source = parseSource(body.weatherSource);
  const compare = body.compare !== false;
  const useHorizon = body.useHorizon !== false;
  const ltCorrection = body.longTermCorrection !== false;
  const warnings = [];

  // With a comparison we need PVWatts for this exact system anyway (it also returns
  // the NSRDB weather); otherwise reuse location-only cached weather.
  const pvwattsP =
    source === 'pvgis' && !compare
      ? null
      : settle(compare ? runPvwatts(lat, lon, system, 'nsrdb') : getNsrdbWeather(lat, lon));
  const tmyP = source !== 'nsrdb' ? settle(getTmy(lat, lon)) : null;
  const ltP = source !== 'nsrdb' && ltCorrection ? settle(getLongTermMonthlyGhi(lat, lon)) : null;
  const horizonP = useHorizon ? settle(getHorizon(lat, lon)) : null;
  // PVGIS "system loss" covers everything after the module, including the inverter.
  const pvgisLoss = (1 - (1 - system.totalLossPct / 100) * (system.inverterEfficiency / 100)) * 100;
  const pvcalcP = compare ? settle(getPvcalc(lat, lon, system, pvgisLoss)) : null;

  const [pvw, tmy, horizon, pvcalc, lt] = await Promise.all([pvwattsP, tmyP, horizonP, pvcalcP, ltP]);

  const resolved = resolveWeather({ lat, lon, source, ltCorrection, pvw, tmy, lt, warnings });
  const { weather, sun } = resolved;
  let { records } = resolved;

  // --- optional user-specified peak sun hours ---------------------------------
  const scaled = applySunHours(records, weather.tzOffsetHours, body.sunHours, warnings);
  const { siteSun, sunFactor } = scaled;
  records = scaled.records;

  const horizonProfile = horizon?.ok ? horizon.value : null;
  if (useHorizon && !horizon?.ok) warnings.push('Terrain horizon unavailable; shading from terrain ignored.');

  const ctx = { weather: records, sun, horizonProfile, tzOffsetHours: weather.tzOffsetHours };
  const result = simulate(ctx, system);
  const sweeps = orientationSweeps(ctx, system);

  // --- reference models -------------------------------------------------------
  const references = [];
  if (compare) {
    if (pvw?.ok) references.push(pvw.value.result);
    else if (pvw && pvw.error.status !== 429 && pvw.error.status !== 403) {
      const intl = await settle(runPvwatts(lat, lon, system, 'intl'));
      if (intl.ok) references.push({ ...intl.value.result, note: 'International dataset (NSRDB not available).' });
      else references.push({ source: 'NREL PVWatts v8', error: pvw.error.message });
    } else if (pvw) {
      references.push({ source: 'NREL PVWatts v8', error: pvw.error.message });
    }
    if (pvcalc?.ok) references.push(pvcalc.value);
    else if (pvcalc) references.push({ source: 'PVGIS 5.3', error: pvcalc.error.message });
  }

  const financial = lifetimeAnalysis(result.annual.acKwh, {
    ...(body.financial || {}),
    capacityKw: system.capacityKw,
  });

  const h = result.hourly;
  return {
    location: { lat, lon, elevation: weather.meta.elevation, tzOffsetHours: weather.tzOffsetHours },
    weather: weather.meta,
    system,
    annual: result.annual,
    monthly: result.monthly,
    profile: result.profile,
    waterfall: result.waterfall,
    sweeps,
    references,
    financial,
    horizon: horizonProfile,
    sunHours: {
      site: round2(siteSun.daily),
      siteMonthly: siteSun.monthly.map(round2),
      used: round2(siteSun.daily * sunFactor),
      factor: Math.round(sunFactor * 10000) / 10000,
      panelPlane: round2(result.annual.poaKwhM2 / (records.length / 24)),
    },
    hourly: {
      start: records[0].start,
      stepMs: 3600000,
      ghi: records.map((r) => Math.round(r.ghi)),
      dni: records.map((r) => Math.round(r.dni)),
      dhi: records.map((r) => Math.round(r.dhi)),
      tAmb: records.map((r) => round1(r.tAmb)),
      wind: records.map((r) => round1(r.wind)),
      poa: Array.from(h.poa, Math.round),
      tCell: Array.from(h.tCell, round1),
      ac: Array.from(h.ac, Math.round),
    },
    warnings,
  };
}

/**
 * Peak sun hours the weather data gives for a site: average daily horizontal
 * irradiation in kWh/m² (1 kWh/m² = one hour at 1000 W/m²). Location only.
 */
export async function siteSunHours(query) {
  const { lat, lon } = parseLocation(query);
  const source = parseSource(query.weatherSource);
  const ltCorrection = query.longTermCorrection !== 'false' && query.longTermCorrection !== false;
  const warnings = [];
  const [pvw, tmy, lt] = await Promise.all([
    source !== 'pvgis' ? settle(getNsrdbWeather(lat, lon)) : null,
    source !== 'nsrdb' ? settle(getTmy(lat, lon)) : null,
    source !== 'nsrdb' && ltCorrection ? settle(getLongTermMonthlyGhi(lat, lon)) : null,
  ]);
  const { weather, records } = resolveWeather({ lat, lon, source, ltCorrection, pvw, tmy, lt, warnings });
  const s = sunHoursSummary(records, weather.tzOffsetHours);
  return {
    daily: round2(s.daily),
    monthly: s.monthly.map(round2),
    source: weather.meta.source,
    dataset: weather.meta.dataset,
    warnings,
  };
}

/**
 * Recommends an array size (kWp and panel count) that covers a share of the
 * household's annual use. Simulates 1 kWp with the requested orientation,
 * panel and losses; energy scales linearly with capacity at a fixed DC/AC ratio.
 */
export async function sizeFromUsage(body) {
  const { lat, lon } = parseLocation(body);
  const source = parseSource(body.weatherSource);
  const ltCorrection = body.longTermCorrection !== false;
  const useHorizon = body.useHorizon !== false;
  const warnings = [];
  const panel = body.system?.panel;
  const system = normalizeSystem({ ...body.system, capacityKw: 1, panel: panel ? { ...panel, count: 1 } : undefined });

  const [pvw, tmy, lt, horizon] = await Promise.all([
    source !== 'pvgis' ? settle(getNsrdbWeather(lat, lon)) : null,
    source !== 'nsrdb' ? settle(getTmy(lat, lon)) : null,
    source !== 'nsrdb' && ltCorrection ? settle(getLongTermMonthlyGhi(lat, lon)) : null,
    useHorizon ? settle(getHorizon(lat, lon)) : null,
  ]);
  const resolved = resolveWeather({ lat, lon, source, ltCorrection, pvw, tmy, lt, warnings });
  const { records } = applySunHours(resolved.records, resolved.weather.tzOffsetHours, body.sunHours, warnings);
  const result = simulate(
    {
      weather: records,
      sun: resolved.sun,
      horizonProfile: horizon?.ok ? horizon.value : null,
      tzOffsetHours: resolved.weather.tzOffsetHours,
    },
    system
  );

  const sizing = recommendSize({
    monthlyKwh: body.monthlyKwh,
    yieldMonthly: result.monthly.map((m) => m.ac / system.capacityKw),
    offsetPct: body.offsetPct,
    panelW: system.panel?.powerW ?? 440,
  });
  if (sizing.knownMonths < 12) {
    warnings.push(
      `Usage covers ${sizing.knownMonths} of 12 months; the rest use the average of those months. ` +
        'A full year of history (most bills print it) captures seasonal swings.'
    );
  }
  return {
    ...sizing,
    arrayAreaM2: system.panel?.moduleAreaM2 ? round1(system.panel.moduleAreaM2 * sizing.panels) : null,
    weatherDataset: resolved.weather.meta.dataset,
    warnings,
  };
}

/**
 * Scales irradiance so the site's peak sun hours match a user-entered value.
 * Returns the records unchanged when no override is given.
 */
function applySunHours(records, tz, sunHours, warnings) {
  const siteSun = sunHoursSummary(records, tz);
  let sunFactor = 1;
  const requested = Number(sunHours);
  if (sunHours !== null && sunHours !== undefined && sunHours !== '' && Number.isFinite(requested)) {
    if (requested < 0.5 || requested > 12) {
      const err = new Error('Sun hours must be between 0.5 and 12 hours per day.');
      err.status = 400;
      throw err;
    }
    if (Math.abs(requested - siteSun.daily) >= 0.005 && siteSun.daily > 0) {
      sunFactor = requested / siteSun.daily;
      records = records.map((r) => ({ ...r, ghi: r.ghi * sunFactor, dni: r.dni * sunFactor, dhi: r.dhi * sunFactor }));
      const pctTxt = `${sunFactor >= 1 ? '+' : ''}${((sunFactor - 1) * 100).toFixed(1)}%`;
      warnings.push(
        `Irradiance scaled ${pctTxt} to match ${requested} sun hours/day (site data: ${siteSun.daily.toFixed(2)}). ` +
          'The reference models below still use the site data.'
      );
      if (sunFactor > 1.25) warnings.push('The sun hours entered are well above the measured value for this site; double-check the figure.');
    }
  }
  return { records, siteSun, sunFactor };
}

/**
 * Annual near-obstacle shading on a roof outline, weighted by the site's own
 * hourly beam and diffuse irradiance.
 */
export async function shadingAnalysis(body) {
  const { lat, lon } = parseLocation(body);
  const source = parseSource(body.weatherSource);
  const ltCorrection = body.longTermCorrection !== false;
  const roof = Array.isArray(body.roof) ? body.roof.filter(validLatLon) : [];
  if (roof.length < 3 || roof.length > 300) {
    const err = new Error('Roof outline needs 3–300 valid [lat, lon] points.');
    err.status = 400;
    throw err;
  }
  const obstacles = (Array.isArray(body.obstacles) ? body.obstacles : []).slice(0, 3000).filter((o) => {
    if (o?.kind === 'tree') return validLatLon(o.center);
    return Array.isArray(o?.polygon) && o.polygon.length >= 3 && o.polygon.length <= 500 && o.polygon.every(validLatLon);
  });

  const [pvw, tmy, lt] = await Promise.all([
    source !== 'pvgis' ? settle(getNsrdbWeather(lat, lon)) : null,
    source !== 'nsrdb' ? settle(getTmy(lat, lon)) : null,
    source !== 'nsrdb' && ltCorrection ? settle(getLongTermMonthlyGhi(lat, lon)) : null,
  ]);
  const { weather, records, sun } = resolveWeather({ lat, lon, source, ltCorrection, pvw, tmy, lt, warnings: [] });

  const t0 = Date.now();
  const result = analyzeShading({
    roof,
    roofHeight: clamp(Number(body.roofHeight) || 6, 0, 300),
    tilt: clamp(Number(body.tilt) || 0, 0, 90),
    azimuth: clamp(Number(body.azimuth ?? 180), 0, 360),
    obstacles,
    weather: records,
    sun,
    tzOffsetHours: weather.tzOffsetHours,
  });
  return { ...result, computeMs: Date.now() - t0, weatherDataset: weather.meta.dataset };
}

function validLatLon(p) {
  return Array.isArray(p) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Picks the weather source, applies the long-term correction to PVGIS data and
 * reconstructs GHI where missing. Throws a 502 when no data can be had.
 */
function resolveWeather({ lat, lon, source, ltCorrection, pvw, tmy, lt, warnings }) {
  let weather = null;
  if (source !== 'pvgis' && pvw?.ok && pvw.value.weather) {
    weather = pvw.value.weather;
  } else if (source === 'nsrdb') {
    const msg = pvw?.error?.message || 'NSRDB data unavailable';
    const err = new Error(`NSRDB weather is unavailable for this location (${msg}). Try the PVGIS source.`);
    err.status = 502;
    throw err;
  } else if (tmy?.ok) {
    weather = { ...tmy.value, tzOffsetHours: Math.round(lon / 15) };
    if (source === 'auto' && pvw && !pvw.ok) {
      warnings.push(`NSRDB weather unavailable (${pvw.error.message}); using PVGIS TMY instead.`);
    }
    if (lt?.ok) weather = scaleToLongTerm(weather, lt.value);
    else if (ltCorrection) warnings.push('Long-term irradiance correction unavailable; using the raw TMY.');
  } else {
    const err = new Error(`No weather data available: ${tmy?.error?.message || 'unknown error'}`);
    err.status = 502;
    throw err;
  }

  // NSRDB via PVWatts omits GHI; rebuild it from the components.
  const sun = precomputeSun(weather.records, lat, lon);
  const records = weather.records.map((r, i) =>
    r.ghi === null
      ? { ...r, ghi: Math.max(0, r.dni * Math.max(0, Math.cos(sun[i].zenith * RAD)) + r.dhi) }
      : r
  );
  return { weather, records, sun };
}

function sunHoursSummary(records, tz = 0) {
  const sum = new Array(12).fill(0);
  const days = new Array(12).fill(0);
  const seen = new Set();
  let total = 0;
  for (const r of records) {
    const d = new Date(r.start + tz * 3600000);
    const m = d.getUTCMonth();
    const key = `${m}-${d.getUTCDate()}`;
    if (!seen.has(key)) {
      seen.add(key);
      days[m]++;
    }
    sum[m] += r.ghi / 1000;
    total += r.ghi / 1000;
  }
  return {
    daily: total / (records.length / 24),
    monthly: sum.map((s, m) => (days[m] ? s / days[m] : 0)),
  };
}

function parseLocation(q) {
  const lat = Number(q.lat);
  const lon = Number(q.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    const err = new Error('lat/lon are required and must be valid coordinates');
    err.status = 400;
    throw err;
  }
  return { lat, lon };
}

function parseSource(s) {
  return ['auto', 'pvgis', 'nsrdb'].includes(s) ? s : 'auto';
}

/**
 * Scales each TMY month's irradiance so its GHI matches the long-term monthly
 * mean, preserving the hourly shape and diffuse fraction. A TMY is assembled
 * from "typical" months and can sit several percent off the multi-year mean;
 * a P50 estimate should not inherit that bias.
 */
function scaleToLongTerm(weather, lt) {
  const tmyGhi = new Array(12).fill(0);
  for (const r of weather.records) tmyGhi[new Date(r.start).getUTCMonth()] += r.ghi / 1000;
  const factor = tmyGhi.map((g, m) => {
    const target = lt.monthly[m];
    if (!target || g <= 0) return 1;
    return Math.min(1.25, Math.max(0.8, target / g));
  });
  const records = weather.records.map((r) => {
    const f = factor[new Date(r.start).getUTCMonth()];
    return f === 1 ? r : { ...r, ghi: r.ghi * f, dni: r.dni * f, dhi: r.dhi * f };
  });
  const before = tmyGhi.reduce((a, b) => a + b, 0);
  const after = lt.monthly.reduce((a, b, m) => a + (b ?? tmyGhi[m]), 0);
  return {
    ...weather,
    records,
    meta: {
      ...weather.meta,
      longTermCorrection: {
        period: lt.period,
        tmyGhi: Math.round(before),
        longTermGhi: Math.round(after),
        changePct: Math.round((after / before - 1) * 1000) / 10,
      },
    },
  };
}

function settle(p) {
  return p.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error })
  );
}

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
