// Hourly PV simulation engine.
//
// Chain: solar position -> Perez POA -> horizon shading -> IAM -> SAPM cell
// temperature -> PVWatts DC -> system losses -> PVWatts inverter with clipping.

import { solarPosition } from './solarPosition.js';
import {
  SOLAR_CONSTANT,
  airMass,
  cosAoi,
  perez,
  groundReflected,
  makeIam,
  diffuseIncidenceAngles,
  makeHorizon,
  DEG,
} from './irradiance.js';
import {
  MOUNTING,
  MODULES,
  cellTemperature,
  dcPower,
  lowLightFactor,
  inverter,
  singleAxisOrientation,
  combineLosses,
  DEFAULT_LOSSES,
} from './pvModels.js';

const HOUR_MS = 3600000;
const SUBSTEPS = 12;

/**
 * Solar geometry for every weather record. Independent of the PV system, so it is
 * computed once and reused by tilt/azimuth sweeps.
 *
 * For hours containing sunrise or sunset the sun position is evaluated at the
 * midpoint of the sunlit part of the hour (the approach SAM uses), which avoids
 * large errors from evaluating the geometry while the sun is below the horizon.
 *
 * weather[i] = { start: UTC ms of interval start, ghi, dni, dhi, tAmb, wind }
 */
export function precomputeSun(weather, lat, lon) {
  return weather.map((w) => {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < SUBSTEPS; k++) {
      const t = w.start + ((k + 0.5) / SUBSTEPS) * HOUR_MS;
      if (solarPosition(t, lat, lon).elevation > 0) {
        sum += t;
        n++;
      }
    }
    const t = n > 0 ? sum / n : w.start + HOUR_MS / 2;
    const sp = solarPosition(t, lat, lon);
    return {
      zenith: sp.apparentZenith,
      azimuth: sp.azimuth,
      elevation: sp.elevation,
      sunlitFraction: n / SUBSTEPS,
      airmass: airMass(sp.apparentZenith),
      dniExtra: SOLAR_CONSTANT / sp.earthSunDistance ** 2,
    };
  });
}

export function normalizeSystem(input = {}) {
  const arrayType = MOUNTING[input.arrayType] ? input.arrayType : 'fixed-roof';
  const moduleType = MODULES[input.moduleType] ? input.moduleType : 'standard';
  const losses = { ...DEFAULT_LOSSES, ...(input.losses || {}) };
  const panel = normalizePanel(input.panel, MODULES[moduleType]);
  return {
    // When a panel spec and count are given, they define the DC rating.
    capacityKw: panel ? (panel.count * panel.powerW) / 1000 : clampNum(input.capacityKw, 0.05, 500000, 6),
    panel,
    gamma: panel ? panel.gammaPct / 100 : MODULES[moduleType].gamma,
    moduleEfficiency: panel?.efficiency ?? 0.2,
    tilt: clampNum(input.tilt, 0, 90, 20),
    azimuth: clampNum(input.azimuth, 0, 360, 180),
    arrayType,
    moduleType,
    dcAcRatio: clampNum(input.dcAcRatio, 0.5, 2, 1.2),
    inverterEfficiency: clampNum(input.inverterEfficiency, 90, 99.5, 96),
    albedo: clampNum(input.albedo, 0, 1, 0.2),
    gcr: clampNum(input.gcr, 0.1, 0.9, 0.4),
    maxAngle: clampNum(input.maxAngle, 0, 90, 60),
    lowLight: input.lowLight !== false,
    losses,
    totalLossPct: combineLosses(losses) * 100,
  };
}

/**
 * Panel datasheet values. Returns null unless both a count and a rated power are given.
 * Efficiency comes from rated power over module area when dimensions are known.
 */
function normalizePanel(p, moduleDefaults) {
  if (!p) return null;
  const count = Math.round(Number(p.count));
  const powerW = Number(p.powerW);
  if (!(count >= 1) || !(powerW > 0)) return null;
  const lengthMm = clampNum(p.lengthMm, 200, 4000, null);
  const widthMm = clampNum(p.widthMm, 200, 2500, null);
  const moduleAreaM2 = lengthMm && widthMm ? (lengthMm * widthMm) / 1e6 : null;
  const efficiency = moduleAreaM2
    ? Math.min(0.5, powerW / (moduleAreaM2 * 1000))
    : clampNum(p.efficiencyPct, 5, 50, 20) / 100;
  return {
    name: typeof p.name === 'string' ? p.name.slice(0, 80) : 'Custom panel',
    count: Math.min(count, 2_000_000),
    powerW: clampNum(powerW, 10, 1500, 400),
    lengthMm,
    widthMm,
    moduleAreaM2: moduleAreaM2 && round(moduleAreaM2, 3),
    arrayAreaM2: moduleAreaM2 && round(moduleAreaM2 * count, 1),
    efficiency: round(efficiency, 4),
    gammaPct: clampNum(p.gammaPct, -1, 0, moduleDefaults.gamma * 100),
  };
}

/**
 * Runs the hourly simulation.
 * @param {object} ctx { weather, sun, horizonProfile?, tzOffsetHours }
 * @param {object} system normalized system (see normalizeSystem)
 * @param {object} opts { detail: boolean } detail=false returns only annual AC (for sweeps)
 */
export function simulate(ctx, system, { detail = true } = {}) {
  const { weather, sun } = ctx;
  const mount = MOUNTING[system.arrayType];
  const module = MODULES[system.moduleType];
  const iam = makeIam(module.n);
  const horizon = ctx.horizonFn || makeHorizon(ctx.horizonProfile);
  const tracking = system.arrayType.startsWith('1-axis');
  const backtrack = system.arrayType === '1-axis-backtrack';

  const pdc0 = system.capacityKw * 1000;
  const pac0 = pdc0 / system.dcAcRatio;
  const etaNom = system.inverterEfficiency / 100;
  const lossFactor = 1 - system.totalLossPct / 100;

  // Diffuse IAM depends only on tilt; cache it for fixed arrays.
  const fixedDiffIam = tracking ? null : diffuseIam(iam, system.tilt);

  const n = weather.length;
  const hourly = detail
    ? {
        poa: new Float32Array(n),
        tCell: new Float32Array(n),
        dc: new Float32Array(n),
        ac: new Float32Array(n),
      }
    : null;

  const tot = {
    ghi: 0,
    poaNominal: 0,
    poaShaded: 0,
    poaEffective: 0,
    dcStc: 0,
    dcLowLight: 0,
    dcTemp: 0,
    dcNet: 0,
    acPreClip: 0,
    ac: 0,
  };

  for (let i = 0; i < n; i++) {
    const w = weather[i];
    const s = sun[i];
    if (w.ghi <= 0 && w.dni <= 0 && w.dhi <= 0) continue;

    let tilt = system.tilt;
    let surfAz = system.azimuth;
    if (tracking) {
      const o = singleAxisOrientation(s.zenith, s.azimuth, {
        maxAngle: system.maxAngle,
        backtrack,
        gcr: system.gcr,
      });
      tilt = o.tilt;
      surfAz = o.azimuth;
    }

    const sunUp = s.zenith < 90;
    const cosI = sunUp ? cosAoi(s.zenith, s.azimuth, tilt, surfAz) : 0;
    const dni = sunUp ? w.dni : 0;
    const beam = Math.max(0, dni * cosI);
    const sky = perez({
      dhi: w.dhi,
      dni,
      dniExtra: s.dniExtra,
      zenith: s.zenith,
      airmass: s.airmass,
      tilt,
      cosIncidence: cosI,
    });
    const ground = groundReflected(w.ghi, system.albedo, tilt);

    const poaNominal = beam + sky.isotropic + sky.circumsolar + sky.horizon + ground;

    // Far-horizon (terrain) shading blocks the beam and circumsolar components.
    const blocked = sunUp && s.elevation < horizon(s.azimuth);
    const beamS = blocked ? 0 : beam;
    const circS = blocked ? 0 : sky.circumsolar;
    const poa = beamS + circS + sky.isotropic + sky.horizon + ground;

    const aoi = Math.acos(Math.max(-1, Math.min(1, cosI))) * DEG;
    const dIam = fixedDiffIam || diffuseIam(iam, tilt);
    const beamIam = sunUp ? iam(aoi) : 0;
    const eff =
      (beamS + circS) * beamIam + (sky.isotropic + sky.horizon) * dIam.sky + ground * dIam.ground;

    const tCell = cellTemperature(poa, w.tAmb, w.wind, mount, system.moduleEfficiency);
    const ll = system.lowLight ? lowLightFactor(eff, module.lowLight) : 1;
    const dcStc = (pdc0 * eff) / 1000;
    const dcLl = dcStc * ll;
    const dcT = dcPower(pdc0, eff, tCell, system.gamma ?? module.gamma, ll);
    const dcNet = dcT * lossFactor;
    const inv = inverter(dcNet, pac0, etaNom);

    tot.ghi += w.ghi;
    tot.poaNominal += poaNominal;
    tot.poaShaded += poa;
    tot.poaEffective += eff;
    tot.dcStc += dcStc;
    tot.dcLowLight += dcLl;
    tot.dcTemp += dcT;
    tot.dcNet += dcNet;
    tot.acPreClip += inv.ac + inv.clipped;
    tot.ac += inv.ac;

    if (hourly) {
      hourly.poa[i] = poa;
      hourly.tCell[i] = tCell;
      hourly.dc[i] = dcNet;
      hourly.ac[i] = inv.ac;
    }
  }

  const acAnnualKwh = tot.ac / 1000;
  if (!detail) return { acAnnualKwh };

  return {
    acAnnualKwh,
    ...summarize(ctx, system, hourly, tot, pdc0),
  };
}

function diffuseIam(iam, tilt) {
  const a = diffuseIncidenceAngles(tilt);
  return { sky: iam(a.sky), ground: iam(a.ground) };
}

function summarize(ctx, system, hourly, tot, pdc0) {
  const { weather } = ctx;
  const tz = ctx.tzOffsetHours ?? 0;
  const kw = system.capacityKw;

  const monthly = Array.from({ length: 12 }, (_, m) => ({
    month: m + 1,
    ghi: 0,
    poa: 0,
    dc: 0,
    ac: 0,
  }));
  // Average day profile per month (local standard time), in kW.
  const profile = Array.from({ length: 12 }, () => new Array(24).fill(0));
  const daysInMonth = new Array(12).fill(0);
  const dayKeys = new Set();

  let peakAc = 0;
  for (let i = 0; i < weather.length; i++) {
    const local = new Date(weather[i].start + tz * HOUR_MS);
    const m = local.getUTCMonth();
    const h = local.getUTCHours();
    const key = `${m}-${local.getUTCDate()}`;
    if (!dayKeys.has(key)) {
      dayKeys.add(key);
      daysInMonth[m]++;
    }
    monthly[m].ghi += weather[i].ghi / 1000;
    monthly[m].poa += hourly.poa[i] / 1000;
    monthly[m].dc += hourly.dc[i] / 1000;
    monthly[m].ac += hourly.ac[i] / 1000;
    profile[m][h] += hourly.ac[i] / 1000;
    if (hourly.ac[i] > peakAc) peakAc = hourly.ac[i];
  }
  for (let m = 0; m < 12; m++) {
    const d = daysInMonth[m] || 1;
    profile[m] = profile[m].map((v) => round(v / d, 3));
    const mo = monthly[m];
    mo.days = daysInMonth[m];
    mo.acPerDay = mo.ac / d;
    mo.performanceRatio = mo.poa > 0 ? mo.ac / (kw * mo.poa) : 0;
    for (const k of ['ghi', 'poa', 'dc', 'ac', 'acPerDay', 'performanceRatio']) {
      mo[k] = round(mo[k], k === 'performanceRatio' ? 4 : 2);
    }
  }

  const acKwh = tot.ac / 1000;
  const poaKwhM2 = tot.poaShaded / 1000;
  const hours = weather.length;

  const k = (v) => round(v / 1000, 1);
  const waterfall = [
    { key: 'poaNominal', label: 'POA irradiance (nominal)', kind: 'start', value: k((tot.poaNominal * pdc0) / 1000) },
    { key: 'horizon', label: 'Horizon shading', kind: 'loss', value: k(((tot.poaShaded - tot.poaNominal) * pdc0) / 1000) },
    { key: 'iam', label: 'Reflection (IAM)', kind: 'loss', value: k(tot.dcStc - (tot.poaShaded * pdc0) / 1000) },
    { key: 'lowLight', label: 'Low-irradiance efficiency', kind: 'loss', value: k(tot.dcLowLight - tot.dcStc) },
    { key: 'temperature', label: 'Module temperature', kind: 'loss', value: k(tot.dcTemp - tot.dcLowLight) },
    { key: 'system', label: `System losses (${round(system.totalLossPct, 2)}%)`, kind: 'loss', value: k(tot.dcNet - tot.dcTemp) },
    { key: 'inverter', label: 'Inverter efficiency', kind: 'loss', value: k(tot.acPreClip - tot.dcNet) },
    { key: 'clipping', label: 'Inverter clipping', kind: 'loss', value: k(tot.ac - tot.acPreClip) },
    { key: 'ac', label: 'AC energy to grid', kind: 'end', value: k(tot.ac) },
  ];

  return {
    annual: {
      acKwh: round(acKwh, 1),
      dcKwh: round(tot.dcNet / 1000, 1),
      ghiKwhM2: round(tot.ghi / 1000, 1),
      poaKwhM2: round(poaKwhM2, 1),
      specificYield: round(acKwh / kw, 1),
      capacityFactor: round(acKwh / (kw * hours), 4),
      performanceRatio: round(poaKwhM2 > 0 ? acKwh / (kw * poaKwhM2) : 0, 4),
      peakAcKw: round(peakAc / 1000, 3),
      inverterAcKw: round(pdc0 / system.dcAcRatio / 1000, 3),
      transpositionGain: round(tot.ghi > 0 ? tot.poaNominal / tot.ghi - 1 : 0, 4),
      kwhPerPanel: system.panel ? round(acKwh / system.panel.count, 1) : null,
      kwhPerM2: system.panel?.arrayAreaM2 ? round(acKwh / system.panel.arrayAreaM2, 1) : null,
    },
    monthly,
    profile,
    waterfall,
    hourly,
  };
}

/** Annual AC across tilts (fixed arrays only) and azimuths, for the orientation charts. */
export function orientationSweeps(ctx, system) {
  if (system.arrayType.startsWith('1-axis')) return null;
  const horizonFn = makeHorizon(ctx.horizonProfile);
  const c = { ...ctx, horizonFn };
  const tilt = [];
  let best = { tilt: 0, acKwh: -1 };
  for (let t = 0; t <= 90; t += 1) {
    const r = simulate(c, { ...system, tilt: t }, { detail: false });
    if (t % 5 === 0) tilt.push({ tilt: t, acKwh: round(r.acAnnualKwh, 1) });
    if (r.acAnnualKwh > best.acKwh) best = { tilt: t, acKwh: r.acAnnualKwh };
  }
  const azimuth = [];
  let bestAz = { azimuth: 0, acKwh: -1 };
  for (let a = 0; a < 360; a += 5) {
    const r = simulate(c, { ...system, azimuth: a }, { detail: false });
    if (a % 15 === 0) azimuth.push({ azimuth: a, acKwh: round(r.acAnnualKwh, 1) });
    if (r.acAnnualKwh > bestAz.acKwh) bestAz = { azimuth: a, acKwh: r.acAnnualKwh };
  }
  return {
    tilt,
    azimuth,
    optimalTilt: { tilt: best.tilt, acKwh: round(best.acKwh, 1) },
    optimalAzimuth: { azimuth: bestAz.azimuth, acKwh: round(bestAz.acKwh, 1) },
  };
}

function clampNum(v, lo, hi, dflt) {
  if (v === null || v === '' || v === undefined) return dflt;
  const x = Number(v);
  if (!Number.isFinite(x)) return dflt;
  return Math.min(hi, Math.max(lo, x));
}

function round(v, d) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
