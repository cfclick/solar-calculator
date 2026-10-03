// Plane-of-array irradiance: Perez 1990 transposition, ground reflection,
// horizon shading and incidence-angle modifiers.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const SOLAR_CONSTANT = 1361; // W/m², Kopp & Lean (2011)

// Perez et al. (1990) "allsitescomposite1990" coefficients, the set used by
// SAM, PVWatts and pvlib. Rows are sky-clearness bins.
const F1 = [
  [-0.008, 0.588, -0.062],
  [0.13, 0.683, -0.151],
  [0.33, 0.487, -0.221],
  [0.568, 0.187, -0.295],
  [0.873, -0.392, -0.362],
  [1.132, -1.237, -0.412],
  [1.06, -1.6, -0.359],
  [0.678, -0.327, -0.25],
];
const F2 = [
  [-0.06, 0.072, -0.022],
  [-0.019, 0.066, -0.029],
  [0.055, -0.064, -0.026],
  [0.109, -0.152, -0.014],
  [0.226, -0.462, 0.001],
  [0.288, -0.823, 0.056],
  [0.264, -1.127, 0.131],
  [0.156, -1.377, 0.251],
];
const EPS_BINS = [1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2];

/** Kasten & Young (1989) relative air mass from apparent zenith (degrees). */
export function airMass(apparentZenith) {
  if (apparentZenith >= 90) return NaN;
  return 1 / (Math.cos(apparentZenith * RAD) + 0.50572 * (96.07995 - apparentZenith) ** -1.6364);
}

/** Cosine of the angle of incidence between the sun and the panel normal. */
export function cosAoi(zenith, sunAz, tilt, surfAz) {
  const z = zenith * RAD;
  const t = tilt * RAD;
  return Math.cos(z) * Math.cos(t) + Math.sin(z) * Math.sin(t) * Math.cos((sunAz - surfAz) * RAD);
}

/**
 * Perez sky-diffuse components on a tilted plane.
 * @returns {{isotropic:number, circumsolar:number, horizon:number}} W/m²
 */
export function perez({ dhi, dni, dniExtra, zenith, airmass, tilt, cosIncidence }) {
  if (dhi <= 0) return { isotropic: 0, circumsolar: 0, horizon: 0 };
  const tiltR = tilt * RAD;
  const viewSky = (1 + Math.cos(tiltR)) / 2;

  // At night or without a usable air mass fall back to isotropic sky.
  if (zenith >= 87.5 || !Number.isFinite(airmass)) {
    return { isotropic: dhi * viewSky, circumsolar: 0, horizon: 0 };
  }

  const zR = zenith * RAD;
  const kappa = 1.041;
  const z3 = kappa * zR ** 3;
  const eps = ((dhi + dni) / dhi + z3) / (1 + z3);
  const delta = (dhi * airmass) / dniExtra;

  let bin = 0;
  while (bin < EPS_BINS.length && eps >= EPS_BINS[bin]) bin++;

  const f1c = F1[bin];
  const f2c = F2[bin];
  const f1 = Math.max(0, f1c[0] + f1c[1] * delta + f1c[2] * zR);
  const f2 = f2c[0] + f2c[1] * delta + f2c[2] * zR;

  const a = Math.max(0, cosIncidence);
  const b = Math.max(Math.cos(85 * RAD), Math.cos(zR));

  const isotropic = dhi * (1 - f1) * viewSky;
  const circumsolar = (dhi * f1 * a) / b;
  // The horizon-brightening term can be negative; clamp the total, not the parts.
  let horizon = dhi * f2 * Math.sin(tiltR);
  if (isotropic + circumsolar + horizon < 0) horizon = -(isotropic + circumsolar);
  return { isotropic, circumsolar, horizon };
}

export function groundReflected(ghi, albedo, tilt) {
  return ghi * albedo * ((1 - Math.cos(tilt * RAD)) / 2);
}

/**
 * Physical IAM from Fresnel reflection plus glass absorption (De Soto et al. 2006),
 * the model PVWatts v8 uses. n = 1.526 for plain glass, 1.3 for AR-coated.
 */
export function makeIam(n = 1.526, K = 4, L = 0.002) {
  const tau = (thetaDeg) => {
    const th = Math.max(thetaDeg, 1e-6) * RAD;
    const thr = Math.asin(Math.sin(th) / n);
    const refl =
      0.5 *
      (Math.sin(thr - th) ** 2 / Math.sin(thr + th) ** 2 +
        Math.tan(thr - th) ** 2 / Math.tan(thr + th) ** 2);
    return Math.exp((-K * L) / Math.cos(thr)) * (1 - refl);
  };
  const tau0 = Math.exp(-K * L) * (1 - ((n - 1) / (n + 1)) ** 2);
  return (thetaDeg) => (thetaDeg >= 90 ? 0 : Math.max(0, tau(thetaDeg) / tau0));
}

/**
 * Effective incidence angles for sky and ground diffuse on a tilted plane
 * (Brandemuehl & Beckman 1980).
 */
export function diffuseIncidenceAngles(tilt) {
  return {
    sky: 59.7 - 0.1388 * tilt + 0.001497 * tilt * tilt,
    ground: 90 - 0.5788 * tilt + 0.002693 * tilt * tilt,
  };
}

/**
 * Builds a lookup: given sun azimuth (from north) return horizon elevation in degrees.
 * profile: array of {azimuth (deg from north), elevation (deg)} sorted by azimuth.
 */
export function makeHorizon(profile) {
  if (!profile || profile.length < 2) return () => 0;
  const pts = [...profile].sort((a, b) => a.azimuth - b.azimuth);
  return (az) => {
    const a = ((az % 360) + 360) % 360;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const qa = i + 1 === pts.length ? q.azimuth + 360 : q.azimuth;
      const aa = a < p.azimuth ? a + 360 : a;
      if (aa >= p.azimuth && aa <= qa) {
        const t = qa === p.azimuth ? 0 : (aa - p.azimuth) / (qa - p.azimuth);
        return p.elevation + t * (q.elevation - p.elevation);
      }
    }
    return 0;
  };
}

export { RAD, DEG };
