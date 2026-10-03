// Module temperature, DC power, inverter and tracker geometry.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// Thermal models. Ventilated arrays use the Sandia (SAPM) open-rack coefficients
// (King et al. 2004). Roof mounts with a standoff use the PVsyst semi-integrated
// value Uc = 20 W/m²K, which reproduces the INOCT of ~49 °C PVWatts assumes;
// the SAPM "close roof" coefficients describe near-flush mounting and run ~10 °C hotter.
const SAPM_OPEN = { model: 'sapm', a: -3.56, b: -0.075, dT: 3 };
export const MOUNTING = {
  'fixed-open': { ...SAPM_OPEN, label: 'Fixed, open rack' },
  'fixed-roof': { model: 'pvsyst', uc: 20, uv: 0, label: 'Fixed, roof mount' },
  '1-axis': { ...SAPM_OPEN, label: 'Single-axis tracking' },
  '1-axis-backtrack': { ...SAPM_OPEN, label: 'Single-axis, backtracking' },
};

// Temperature coefficients and glass refractive index per PVWatts v8.
// lowLight: relative efficiency slope vs ln(G/1000); 0.015 gives -2.4 % at 200 W/m²,
// in line with typical mono-PERC/TOPCon datasheets (≤ 3 % at 200 W/m²).
export const MODULES = {
  standard: { gamma: -0.0037, n: 1.526, lowLight: 0.015, label: 'Standard (crystalline Si)' },
  premium: { gamma: -0.0035, n: 1.3, lowLight: 0.01, label: 'Premium (AR-coated, high efficiency)' },
  thinfilm: { gamma: -0.0032, n: 1.526, lowLight: 0.008, label: 'Thin film (CdTe)' },
};

/**
 * Cell temperature (°C). poa in W/m², wind at 10 m in m/s.
 * efficiency: module STC efficiency; energy converted to electricity doesn't heat the cell.
 */
export function cellTemperature(poa, tAmb, wind, mount, efficiency = 0.2) {
  if (mount.model === 'pvsyst') {
    // alpha = 0.9 absorptance
    return tAmb + (0.9 * poa * (1 - efficiency)) / (mount.uc + mount.uv * wind);
  }
  const tMod = poa * Math.exp(mount.a + mount.b * wind) + tAmb;
  return tMod + (poa / 1000) * mount.dT;
}

/** Relative module efficiency at low irradiance (1 at and above 1000 W/m²). */
export function lowLightFactor(effectiveIrr, k) {
  if (effectiveIrr >= 1000 || effectiveIrr <= 0 || !k) return 1;
  return Math.max(0, 1 + k * Math.log(effectiveIrr / 1000));
}

/** PVWatts DC model: linear in effective irradiance with a temperature coefficient. */
export function dcPower(pdc0, effectiveIrr, tCell, gamma, lowLight = 1) {
  if (effectiveIrr <= 0) return 0;
  return pdc0 * (effectiveIrr / 1000) * lowLight * (1 + gamma * (tCell - 25));
}

/**
 * PVWatts inverter model (Dobos 2014): part-load efficiency curve normalised
 * to the nominal efficiency, with clipping at the AC rating.
 * @returns {{ac:number, clipped:number}} W
 */
export function inverter(pdc, pac0, etaNom) {
  if (pdc <= 0) return { ac: 0, clipped: 0 };
  const etaRef = 0.9637;
  const pdc0 = pac0 / etaNom;
  const zeta = pdc / pdc0;
  const eta = (etaNom / etaRef) * (-0.0162 * zeta - 0.0059 / zeta + 0.9858);
  const raw = Math.max(0, eta * pdc);
  const ac = Math.min(raw, pac0);
  return { ac, clipped: raw - ac };
}

/**
 * Horizontal north-south single-axis tracker, optionally with backtracking
 * (Lorenzo et al. 2011; same approach as pvlib.tracking.singleaxis).
 * @returns {{tilt:number, azimuth:number}} surface orientation in degrees
 */
export function singleAxisOrientation(zenith, sunAz, { maxAngle = 60, backtrack = false, gcr = 0.4 } = {}) {
  if (zenith >= 90) return { tilt: 0, azimuth: 180 };
  const z = zenith * RAD;
  const a = sunAz * RAD;
  const sx = Math.sin(z) * Math.sin(a); // east component
  const sz = Math.cos(z); // up component

  // Positive rotation tilts the panel toward the east.
  let rot = Math.atan2(sx, sz) * DEG;

  if (backtrack) {
    const temp = Math.abs(Math.cos(rot * RAD)) / gcr;
    if (temp < 1) rot += -Math.sign(rot) * Math.acos(temp) * DEG;
  }
  rot = Math.max(-maxAngle, Math.min(maxAngle, rot));
  return { tilt: Math.abs(rot), azimuth: rot >= 0 ? 90 : 270 };
}

/** Combine individual percentage losses multiplicatively, as PVWatts does. */
export function combineLosses(losses) {
  let keep = 1;
  for (const v of Object.values(losses)) keep *= 1 - (Number(v) || 0) / 100;
  return 1 - keep;
}

export const DEFAULT_LOSSES = {
  soiling: 2,
  shading: 3,
  snow: 0,
  mismatch: 2,
  wiring: 2,
  connections: 0.5,
  lightInducedDegradation: 1.5,
  nameplateRating: 1,
  age: 0,
  availability: 3,
};
