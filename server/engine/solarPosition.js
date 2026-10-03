// Solar position using the NOAA Solar Calculator algorithm (Meeus-based).
// Accuracy is about ±0.01° for years 1800-2100, far below the resolution
// that matters for hourly PV simulation.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * @param {number} unixMs  timestamp in UTC milliseconds
 * @param {number} lat     latitude in degrees (+N)
 * @param {number} lon     longitude in degrees (+E)
 * @returns {{zenith:number, apparentZenith:number, elevation:number, azimuth:number, earthSunDistance:number}}
 *   angles in degrees; azimuth measured clockwise from north (180 = south)
 */
export function solarPosition(unixMs, lat, lon) {
  const jd = unixMs / 86400000 + 2440587.5;
  const jc = (jd - 2451545) / 36525;

  const L0 = mod(280.46646 + jc * (36000.76983 + jc * 0.0003032), 360);
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);

  const Mr = M * RAD;
  const C =
    Math.sin(Mr) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * Mr) * 0.000289;

  const trueLong = L0 + C;
  const trueAnom = M + C;
  const earthSunDistance = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(trueAnom * RAD));

  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(omega * RAD);

  const decl = Math.asin(Math.sin(obliqCorr * RAD) * Math.sin(appLong * RAD));

  const y = Math.tan((obliqCorr / 2) * RAD) ** 2;
  const L0r = L0 * RAD;
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr));

  const d = new Date(unixMs);
  const minutesUtc = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const trueSolarTime = mod(minutesUtc + eqTime + 4 * lon, 1440);
  let hourAngle = trueSolarTime / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;

  const latR = lat * RAD;
  const haR = hourAngle * RAD;
  const cosZ = clamp(
    Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(haR),
    -1,
    1
  );
  const zenith = Math.acos(cosZ) * DEG;

  let azimuth;
  const sinZ = Math.sin(zenith * RAD);
  if (Math.abs(Math.cos(latR) * sinZ) > 1e-9) {
    const a = clamp((Math.sin(latR) * cosZ - Math.sin(decl)) / (Math.cos(latR) * sinZ), -1, 1);
    const azRaw = Math.acos(a) * DEG;
    azimuth = hourAngle > 0 ? mod(azRaw + 180, 360) : mod(540 - azRaw, 360);
  } else {
    azimuth = lat > 0 ? 180 : 0;
  }

  const elevation = 90 - zenith;
  const apparentZenith = zenith - refraction(elevation);

  return { zenith, apparentZenith, elevation: 90 - apparentZenith, azimuth, earthSunDistance };
}

// Atmospheric refraction correction in degrees (NOAA approximation).
function refraction(elev) {
  if (elev > 85) return 0;
  const te = Math.tan(elev * RAD);
  let arcsec;
  if (elev > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (elev > -0.575)
    arcsec = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
  else arcsec = -20.772 / te;
  return arcsec / 3600;
}

function mod(a, n) {
  return ((a % n) + n) % n;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
