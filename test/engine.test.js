import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solarPosition } from '../server/engine/solarPosition.js';
import { makeIam, perez, airMass, makeHorizon } from '../server/engine/irradiance.js';
import {
  inverter,
  combineLosses,
  DEFAULT_LOSSES,
  singleAxisOrientation,
  cellTemperature,
  MOUNTING,
  lowLightFactor,
} from '../server/engine/pvModels.js';
import { precomputeSun, simulate, normalizeSystem } from '../server/engine/simulate.js';
import { lifetimeAnalysis } from '../server/engine/financial.js';
import { analyzeShading, localProjection, shadowVector } from '../server/engine/shading.js';

test('sun is overhead at the Tropic of Cancer at solar noon on the June solstice', () => {
  // Solar noon at lon 0 on 2023-06-21 is ~12:02 UTC (equation of time ≈ -1.8 min).
  const sp = solarPosition(Date.UTC(2023, 5, 21, 12, 2), 23.44, 0);
  assert.ok(sp.zenith < 0.3, `zenith ${sp.zenith}`);
});

test('sun azimuth is east in the morning, west in the afternoon (northern hemisphere)', () => {
  const am = solarPosition(Date.UTC(2023, 2, 20, 15), 40, -75); // 10:00 local
  const pm = solarPosition(Date.UTC(2023, 2, 20, 21), 40, -75); // 16:00 local
  assert.ok(am.azimuth > 90 && am.azimuth < 180, `am ${am.azimuth}`);
  assert.ok(pm.azimuth > 180 && pm.azimuth < 270, `pm ${pm.azimuth}`);
});

test('reference value: Golden, CO 2003-10-17 19:30 UTC (NREL SPA paper)', () => {
  // SPA (Reda & Andreas 2004) example: zenith 50.11162°, azimuth 194.34024° (topocentric).
  const sp = solarPosition(Date.UTC(2003, 9, 17, 19, 30, 30), 39.742476, -105.1786);
  assert.ok(Math.abs(sp.zenith - 50.11) < 0.05, `zenith ${sp.zenith}`);
  assert.ok(Math.abs(sp.azimuth - 194.34) < 0.05, `azimuth ${sp.azimuth}`);
});

test('IAM is 1 at normal incidence and falls to 0 at 90°', () => {
  const iam = makeIam();
  assert.ok(Math.abs(iam(0) - 1) < 1e-6);
  assert.ok(iam(60) > 0.9 && iam(60) < 1);
  assert.equal(iam(90), 0);
});

test('air mass is ~1 at zenith and ~2 at 60°', () => {
  assert.ok(Math.abs(airMass(0) - 1) < 0.01);
  assert.ok(Math.abs(airMass(60) - 2) < 0.01);
});

test('Perez on a horizontal plane returns DHI', () => {
  const r = perez({ dhi: 150, dni: 600, dniExtra: 1361, zenith: 40, airmass: airMass(40), tilt: 0, cosIncidence: Math.cos((40 * Math.PI) / 180) });
  assert.ok(Math.abs(r.isotropic + r.circumsolar + r.horizon - 150) < 0.5);
});

test('default PVWatts losses combine to 14.08 %', () => {
  assert.ok(Math.abs(combineLosses(DEFAULT_LOSSES) * 100 - 14.08) < 0.01);
});

test('inverter clips at AC rating and has ~96 % peak efficiency', () => {
  const r = inverter(12000, 10000, 0.96);
  assert.equal(r.ac, 10000);
  assert.ok(r.clipped > 0);
  const half = inverter(5000, 10000, 0.96);
  assert.ok(half.ac / 5000 > 0.955 && half.ac / 5000 < 0.97);
});

test('backtracking reduces rotation at low sun', () => {
  const plain = singleAxisOrientation(80, 95, { backtrack: false });
  const bt = singleAxisOrientation(80, 95, { backtrack: true, gcr: 0.4 });
  assert.equal(plain.tilt, 60);
  assert.ok(bt.tilt < plain.tilt);
  assert.equal(plain.azimuth, 90);
});

test('roof mount runs hotter than open rack; both near INOCT conditions', () => {
  const open = cellTemperature(800, 20, 1, MOUNTING['fixed-open']);
  const roof = cellTemperature(800, 20, 1, MOUNTING['fixed-roof']);
  assert.ok(open > 40 && open < 47, `open ${open}`);
  assert.ok(roof > open && roof < 52, `roof ${roof}`);
});

test('low-light factor', () => {
  assert.equal(lowLightFactor(1000, 0.015), 1);
  assert.ok(Math.abs(lowLightFactor(200, 0.015) - 0.9759) < 0.001);
});

test('horizon interpolation wraps around north', () => {
  const h = makeHorizon([
    { azimuth: 0, elevation: 10 },
    { azimuth: 180, elevation: 0 },
    { azimuth: 350, elevation: 20 },
  ]);
  assert.equal(h(180), 0);
  assert.ok(Math.abs(h(355) - 15) < 1e-9);
  assert.ok(Math.abs(h(90) - 5) < 1e-9);
});

test('clear-sky synthetic year gives a plausible specific yield', () => {
  // Synthetic weather: simple clear-sky (Haurwitz-like) at 35°N, 20 °C, 2 m/s.
  const lat = 35;
  const lon = 0;
  const weather = [];
  for (let i = 0; i < 8760; i++) {
    const start = Date.UTC(2023, 0, 1) + i * 3600000;
    const sp = solarPosition(start + 1800000, lat, lon);
    const cz = Math.cos((sp.zenith * Math.PI) / 180);
    const ghi = cz > 0 ? 1098 * cz * Math.exp(-0.057 / cz) : 0;
    const dhi = ghi * 0.12;
    const dni = cz > 0.05 ? (ghi - dhi) / cz : 0;
    weather.push({ start, ghi, dni, dhi, tAmb: 20, wind: 2 });
  }
  const sun = precomputeSun(weather, lat, lon);
  const system = normalizeSystem({ capacityKw: 1, tilt: 30, azimuth: 180, arrayType: 'fixed-open' });
  const r = simulate({ weather, sun, tzOffsetHours: 0 }, system);
  // Clear-sky every day → upper bound, roughly 2000-2400 kWh/kWp at 35°N.
  assert.ok(r.annual.specificYield > 1900 && r.annual.specificYield < 2500, `yield ${r.annual.specificYield}`);
  assert.ok(r.annual.performanceRatio > 0.72 && r.annual.performanceRatio < 0.86, `PR ${r.annual.performanceRatio}`);
  const sum = r.waterfall.filter((w) => w.kind !== 'end').reduce((a, w) => a + w.value, 0);
  assert.ok(Math.abs(sum - r.waterfall.at(-1).value) < 1, 'waterfall balances');
});

test('panel count and datasheet define capacity, efficiency and temperature coefficient', () => {
  const s = normalizeSystem({
    capacityKw: 99,
    panel: { count: 20, powerW: 440, lengthMm: 1722, widthMm: 1134, gammaPct: -0.3 },
  });
  assert.equal(s.capacityKw, 8.8);
  assert.ok(Math.abs(s.panel.efficiency - 0.2253) < 0.0005, `eff ${s.panel.efficiency}`);
  assert.equal(s.panel.arrayAreaM2, 39.1);
  assert.equal(s.gamma, -0.003);
  // Without a panel count the kWp input is used and module defaults apply.
  const k = normalizeSystem({ capacityKw: 5, panel: { powerW: 440 } });
  assert.equal(k.capacityKw, 5);
  assert.equal(k.panel, null);
  assert.equal(k.gamma, -0.0037);
});

function clearSkyYear(lat, lon) {
  const weather = [];
  for (let i = 0; i < 8760; i++) {
    const start = Date.UTC(2023, 0, 1) + i * 3600000;
    const sp = solarPosition(start + 1800000, lat, lon);
    const cz = Math.cos((sp.zenith * Math.PI) / 180);
    const ghi = cz > 0 ? 1098 * cz * Math.exp(-0.057 / cz) : 0;
    const dhi = ghi * 0.12;
    weather.push({ start, ghi, dni: cz > 0.05 ? (ghi - dhi) / cz : 0, dhi, tAmb: 20, wind: 2 });
  }
  return { weather, sun: precomputeSun(weather, lat, lon) };
}

test('shading: no obstacles → full solar access; south wall shades, north wall barely does', () => {
  const lat = 40;
  const lon = 0;
  const { weather, sun } = clearSkyYear(lat, lon);
  const proj = localProjection(lat, lon);
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(proj.toLatLon);
  const roof = rect(-5, -4, 5, 4); // 10 m × 8 m
  const base = { roof, roofHeight: 6, tilt: 20, azimuth: 180, weather, sun, tzOffsetHours: 0 };

  const open = analyzeShading({ ...base, obstacles: [] });
  assert.equal(open.shadingLossPct, 0);
  assert.equal(Math.round(open.roofAreaM2), 80);

  // 12 m tall block 6 m south of the roof edge (6 m above the roof plane).
  const south = analyzeShading({ ...base, obstacles: [{ id: 's', kind: 'building', polygon: rect(-15, -20, 15, -10), height: 12 }] });
  // Same block north of the roof.
  const north = analyzeShading({ ...base, obstacles: [{ id: 'n', kind: 'building', polygon: rect(-15, 10, 15, 20), height: 12 }] });
  assert.ok(south.shadingLossPct > 5, `south ${south.shadingLossPct}`);
  assert.ok(north.beamLossPct < 1, `north beam ${north.beamLossPct}`);
  assert.ok(south.shadingLossPct > north.shadingLossPct * 3);
  // Winter (low sun) is shaded more than summer by a southern obstacle.
  assert.ok(south.monthlyLossPct[11] > south.monthlyLossPct[5]);
});

test('shadow vector points away from the sun and scales with 1/tan(elevation)', () => {
  const [x, y] = shadowVector(180, 45, 10); // sun due south at 45°
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y - 10) < 1e-9);
  assert.equal(shadowVector(180, -1, 10), null);
});

test('financials: payback and degradation', () => {
  const f = lifetimeAnalysis(10000, {
    years: 25,
    degradationPct: 0.5,
    systemCost: 20000,
    incentivePct: 30,
    electricityRate: 0.2,
    rateEscalationPct: 0,
    omCostPerKwYear: 0,
    capacityKw: 8,
  });
  assert.equal(f.netCost, 14000);
  assert.equal(f.rows[1].kwh, 9950);
  // 13,790 $ saved after 7 years (2000 + 1990 + ... + 1940); 210 $ of 1930 $ in year 8.
  assert.equal(f.paybackYears, 7.1);
});
