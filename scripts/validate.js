// Cross-checks the in-house engine against NREL PVWatts v8 and PVGIS 5.3 for a
// handful of climates. Run with: npm run validate
//
// For an apples-to-apples comparison with PVWatts the engine is fed the exact
// NSRDB weather PVWatts used, with terrain horizon disabled (PVWatts ignores it).

import { estimate } from '../server/services/estimate.js';

const SITES = [
  { name: 'Los Angeles, CA', lat: 34.05, lon: -118.25 },
  { name: 'Phoenix, AZ', lat: 33.45, lon: -112.07 },
  { name: 'Seattle, WA', lat: 47.61, lon: -122.33 },
  { name: 'Boston, MA', lat: 42.36, lon: -71.06 },
  { name: 'Madrid, ES', lat: 40.42, lon: -3.7 },
  { name: 'Berlin, DE', lat: 52.52, lon: 13.4 },
];

const SYSTEMS = [
  { label: 'roof 20°', system: { capacityKw: 5, tilt: 20, azimuth: 180, arrayType: 'fixed-roof' } },
  { label: '1-axis bt', system: { capacityKw: 5, arrayType: '1-axis-backtrack' } },
];

const pct = (a, b) => (b ? (((a - b) / b) * 100).toFixed(1).padStart(6) + '%' : '    n/a');

// Optional filter, e.g. `node scripts/validate.js roof` (DEMO_KEY allows ~50 calls/day).
const only = process.argv[2];

for (const site of SITES) {
  for (const { label, system } of SYSTEMS.filter((s) => !only || s.label.includes(only))) {
    const south = site.lat >= 0 ? 180 : 0;
    try {
      const r = await estimate({
        lat: site.lat,
        lon: site.lon,
        system: { ...system, azimuth: south },
        weatherSource: 'auto',
        useHorizon: false,
        compare: true,
      });
      const pvw = r.references.find((x) => x.source.startsWith('NREL'));
      const pvg = r.references.find((x) => x.source.startsWith('PVGIS'));
      console.log(
        `${site.name.padEnd(16)} ${label.padEnd(10)} engine ${String(Math.round(r.annual.acKwh)).padStart(6)} kWh` +
          ` [${r.weather.source.split(' ')[0]}]` +
          ` | PVWatts ${String(Math.round(pvw?.acKwh ?? 0)).padStart(6)} (${pct(r.annual.acKwh, pvw?.acKwh)})` +
          ` | PVGIS ${String(Math.round(pvg?.acKwh ?? 0)).padStart(6)} (${pct(r.annual.acKwh, pvg?.acKwh)})`
      );
    } catch (e) {
      console.log(`${site.name.padEnd(16)} ${label.padEnd(10)} ERROR ${e.message}`);
    }
  }
}
