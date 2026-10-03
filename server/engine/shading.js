// Near-obstacle shading on a roof from buildings and trees.
//
// Obstacles are vertical prisms (footprint polygon + height). A roof point at
// height z0 is in beam shadow when the ray toward the sun passes through a
// prism below its top. For a prism of height H that is equivalent to the
// segment from the point to (point − s) intersecting the footprint, where s is
// the horizontal shadow vector of length (H − z0) / tan(elevation) pointing
// away from the sun. Diffuse loss uses the isotropic-sky blocked fraction
// sin²(α) of each obstacle's elevation angle α, averaged over 36 azimuths.
//
// This module is shared with the browser (live shadow drawing), so it only
// depends on the solar-position code.

const RAD = Math.PI / 180;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQ = 111320;
const MAX_SHADOW_M = 400;

// --- geometry --------------------------------------------------------------------

/** Equirectangular projection to local metres around an origin (accurate to <0.1 % within 1 km). */
export function localProjection(lat0, lon0) {
  const kx = M_PER_DEG_LON_EQ * Math.cos(lat0 * RAD);
  return {
    toXY: ([lat, lon]) => [(lon - lon0) * kx, (lat - lat0) * M_PER_DEG_LAT],
    toLatLon: ([x, y]) => [lat0 + y / M_PER_DEG_LAT, lon0 + x / kx],
  };
}

/** Circle approximated as a polygon (for tree crowns), in the same units as the centre. */
export function circlePolygon([cx, cy], r, n = 12) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}

export function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
const cross = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

function bbox(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** True when segment p→q touches the polygon (either end inside or an edge crossing). */
function segmentHitsPolygon(px, py, qx, qy, ob) {
  const [x0, y0, x1, y1] = ob.bbox;
  if (Math.max(px, qx) < x0 || Math.min(px, qx) > x1 || Math.max(py, qy) < y0 || Math.min(py, qy) > y1) return false;
  const poly = ob.xy;
  if (pointInPolygon([qx, qy], poly) || pointInPolygon([px, py], poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentsIntersect(px, py, qx, qy, poly[j][0], poly[j][1], poly[i][0], poly[i][1])) return true;
  }
  return false;
}

/** Distance along a ray from (px,py) in direction (dx,dy) to the first polygon edge, or Infinity. */
function rayDistance(px, py, dx, dy, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const ex = bx - ax;
    const ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - px) * ey - (ay - py) * ex) / den;
    const u = ((ax - px) * dy - (ay - py) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
}

/** Horizontal shadow vector (metres) for an obstacle top `dh` above the receiving plane. */
export function shadowVector(sunAzimuth, sunElevation, dh) {
  if (sunElevation <= 0 || dh <= 0) return null;
  const len = Math.min(MAX_SHADOW_M, dh / Math.tan(sunElevation * RAD));
  return [-Math.sin(sunAzimuth * RAD) * len, -Math.cos(sunAzimuth * RAD) * len];
}

/**
 * Rings whose union is the ground shadow of a prism: the translated footprint
 * plus one quad per edge. All rings are wound counter-clockwise so a
 * "nonzero" fill renders the union without holes.
 */
export function shadowRings(poly, s) {
  const ccw = (ring) => (signedArea(ring) < 0 ? ring.slice().reverse() : ring);
  const moved = poly.map(([x, y]) => [x + s[0], y + s[1]]);
  const rings = [ccw(poly), ccw(moved)];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    rings.push(ccw([poly[j], poly[i], moved[i], moved[j]]));
  }
  return rings;
}
function signedArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
  return a / 2;
}

/**
 * Projects obstacles taller than the receiving plane z0 into local metres.
 * Buildings containing `ownPoint` (the roof's own building) are skipped.
 */
export function prepareObstacles(proj, list, z0, ownPoint, maxDist = 250, roofBox = null) {
  const out = [];
  for (const o of list || []) {
    const h = Number(o.height);
    if (!(h > z0 + 0.1)) continue;
    let xy;
    if (o.kind === 'tree' && o.center) {
      xy = circlePolygon(proj.toXY(o.center), Math.max(0.5, (Number(o.crownDiameter) || 5) / 2), 12);
    } else if (Array.isArray(o.polygon) && o.polygon.length >= 3) {
      xy = o.polygon.map(proj.toXY);
    } else continue;
    if (o.kind !== 'tree' && ownPoint && pointInPolygon(ownPoint, xy)) continue;
    const bb = bbox(xy);
    if (roofBox) {
      const [rx0, ry0, rx1, ry1] = roofBox;
      const dist = Math.max(0, bb[0] - rx1, rx0 - bb[2], bb[1] - ry1, ry0 - bb[3]);
      if (dist > maxDist) continue;
    }
    out.push({
      id: o.id,
      xy,
      bbox: bb,
      dh: h - z0,
      // Trees let some light through; evergreen-ish default, leafless deciduous is lighter.
      opacity: clamp(Number(o.opacity) || (o.kind === 'tree' ? 0.75 : 1), 0, 1),
    });
  }
  return out;
}

/** Fraction (0–1) of the given roof points in beam shadow for one sun position. */
export function shadedFraction(pointsXY, prepared, sunAzimuth, sunElevation) {
  if (sunElevation <= 0 || !pointsXY.length) return sunElevation <= 0 ? 1 : 0;
  const vecs = prepared.map((o) => shadowVector(sunAzimuth, sunElevation, o.dh));
  let sum = 0;
  for (const [px, py] of pointsXY) {
    let lit = 1;
    for (let k = 0; k < prepared.length; k++) {
      const v = vecs[k];
      if (v && segmentHitsPolygon(px, py, px - v[0], py - v[1], prepared[k])) {
        lit *= 1 - prepared[k].opacity;
        if (lit === 0) break;
      }
    }
    sum += 1 - lit;
  }
  return sum / pointsXY.length;
}

/** Sample points on a grid inside a polygon (local metres). */
export function gridPoints(poly, maxPoints = 500) {
  const area = polygonArea(poly);
  const spacing = Math.max(0.5, Math.sqrt(area / maxPoints));
  const [x0, y0, x1, y1] = bbox(poly);
  const pts = [];
  for (let y = y0 + spacing / 2; y < y1; y += spacing) {
    for (let x = x0 + spacing / 2; x < x1; x += spacing) {
      if (pointInPolygon([x, y], poly)) pts.push([x, y]);
    }
  }
  if (!pts.length) pts.push([(x0 + x1) / 2, (y0 + y1) / 2]);
  return { points: pts, spacing, area };
}

// --- analysis ---------------------------------------------------------------------

/**
 * @param {object} p
 *   roof: [[lat,lon]...], roofHeight: m, tilt, azimuth (panel plane),
 *   obstacles: [{ id, kind, polygon?:[[lat,lon]], center?:[lat,lon], crownDiameter?, height, opacity? }],
 *   weather: [{ start, dni, dhi, ghi }], sun: precomputeSun(weather) output, tzOffsetHours
 */
export function analyzeShading(p) {
  const roofLL = p.roof;
  const c = roofLL.reduce((a, [la, lo]) => [a[0] + la / roofLL.length, a[1] + lo / roofLL.length], [0, 0]);
  const proj = localProjection(c[0], c[1]);
  const roof = roofLL.map(proj.toXY);
  const z0 = p.roofHeight;

  // Grid of sample points inside the roof outline (≤ ~500 points).
  const { points, spacing, area: areaM2 } = gridPoints(roof, 500);
  const roofBox = bbox(roof);

  // Obstacles taller than the roof plane, excluding the roof's own building.
  const centroid = [(roofBox[0] + roofBox[2]) / 2, (roofBox[1] + roofBox[3]) / 2];
  const obstacles = prepareObstacles(proj, p.obstacles, z0, centroid, 250, roofBox);

  // Energy bins per (month, local hour): beam on the panel plane and sky diffuse.
  const tilt = p.tilt ?? 0;
  const surfAz = p.azimuth ?? 180;
  const tz = p.tzOffsetHours ?? 0;
  const bins = new Map();
  let beamTotal = 0;
  let diffTotal = 0;
  const monthBeam = new Array(12).fill(0);
  const monthDiff = new Array(12).fill(0);
  for (let i = 0; i < p.weather.length; i++) {
    const w = p.weather[i];
    const s = p.sun[i];
    const local = new Date(w.start + tz * 3600000);
    const m = local.getUTCMonth();
    const h = local.getUTCHours();
    const diff = w.dhi * ((1 + Math.cos(tilt * RAD)) / 2);
    diffTotal += diff;
    monthDiff[m] += diff;
    if (s.elevation <= 0.5 || w.dni <= 0) continue;
    const cosI =
      Math.cos(s.zenith * RAD) * Math.cos(tilt * RAD) +
      Math.sin(s.zenith * RAD) * Math.sin(tilt * RAD) * Math.cos((s.azimuth - surfAz) * RAD);
    const beam = w.dni * Math.max(0, cosI);
    if (beam <= 0) continue;
    const key = m * 24 + h;
    let b = bins.get(key);
    if (!b) bins.set(key, (b = { m, h, beam: 0, sinSum: 0, cosSum: 0, elSum: 0 }));
    // Energy-weighted mean sun position for the bin (azimuth as a vector mean).
    b.beam += beam;
    b.sinSum += beam * Math.sin(s.azimuth * RAD);
    b.cosSum += beam * Math.cos(s.azimuth * RAD);
    b.elSum += beam * s.elevation;
    beamTotal += beam;
    monthBeam[m] += beam;
  }
  const binList = [...bins.values()].map((b) => ({
    m: b.m,
    h: b.h,
    beam: b.beam,
    az: ((Math.atan2(b.sinSum, b.cosSum) / RAD) % 360 + 360) % 360,
    el: b.elSum / b.beam,
  }));

  // Beam shading per point and bin.
  const binShade = new Float64Array(binList.length); // roof-average shaded fraction per bin
  const pointBeamLost = new Float64Array(points.length);
  const pointMonthLost = points.map(() => new Float64Array(12));
  binList.forEach((b, bi) => {
    const vecs = obstacles.map((o) => shadowVector(b.az, b.el, o.dh));
    let sum = 0;
    for (let pi = 0; pi < points.length; pi++) {
      const [px, py] = points[pi];
      let lit = 1;
      for (let k = 0; k < obstacles.length; k++) {
        const v = vecs[k];
        if (!v) continue;
        // Segment from the point toward the sun, as long as the obstacle's shadow.
        if (segmentHitsPolygon(px, py, px - v[0], py - v[1], obstacles[k])) {
          lit *= 1 - obstacles[k].opacity;
          if (lit === 0) break;
        }
      }
      const shaded = 1 - lit;
      sum += shaded;
      pointBeamLost[pi] += shaded * b.beam;
      pointMonthLost[pi][b.m] += shaded * b.beam;
    }
    binShade[bi] = sum / points.length;
  });

  // Diffuse (sky-view) loss per point.
  const N_AZ = 36;
  const pointSkyLoss = points.map(([px, py]) => {
    let loss = 0;
    for (let k = 0; k < N_AZ; k++) {
      const a = ((k + 0.5) / N_AZ) * 2 * Math.PI;
      const dx = Math.sin(a);
      const dy = Math.cos(a);
      let blocked = 0;
      for (const o of obstacles) {
        const d = rayDistance(px, py, dx, dy, o.xy);
        if (!Number.isFinite(d)) continue;
        const alpha = Math.atan2(o.dh, Math.max(d, 0.3));
        blocked = Math.max(blocked, Math.sin(alpha) ** 2 * o.opacity);
      }
      loss += blocked;
    }
    return loss / N_AZ;
  });

  // Results.
  const total = beamTotal + diffTotal;
  const access = points.map((_, i) => (total > 0 ? 1 - (pointBeamLost[i] + pointSkyLoss[i] * diffTotal) / total : 1));
  const meanAccess = mean(access);
  const monthlyLossPct = monthBeam.map((mb, m) => {
    const t = mb + monthDiff[m];
    if (t <= 0) return 0;
    const lost = mean(points.map((_, i) => pointMonthLost[i][m] + pointSkyLoss[i] * monthDiff[m]));
    return round((lost / t) * 100, 1);
  });

  const matrix = Array.from({ length: 12 }, () => new Array(24).fill(null));
  binList.forEach((b, i) => {
    matrix[b.m][b.h] = round(binShade[i], 3);
  });

  return {
    roofAreaM2: round(areaM2, 1),
    spacingM: round(spacing, 2),
    obstaclesConsidered: obstacles.length,
    meanAccess: round(meanAccess, 4),
    shadingLossPct: round((1 - meanAccess) * 100, 2),
    beamLossPct: round((beamTotal > 0 ? mean([...pointBeamLost]) / beamTotal : 0) * 100, 2),
    skyLossPct: round(mean(pointSkyLoss) * 100, 2),
    monthlyLossPct,
    shadeMatrix: matrix,
    points: points.map((pt, i) => {
      const [la, lo] = proj.toLatLon(pt);
      return [round(la, 7), round(lo, 7), round(access[i], 3)];
    }),
  };
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
