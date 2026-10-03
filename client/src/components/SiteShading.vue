<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import L from 'leaflet';
import {
  Satellite, MousePointer2, PenLine, TreePine, Play, Pause, Trash2, Home, Loader2, Check, X, Sunrise, Sunset, Layers,
} from 'lucide-vue-next';
import { api } from '../api.js';
import { solarPosition } from '../../../server/engine/solarPosition.js';
import {
  localProjection, shadowVector, shadowRings, circlePolygon, prepareObstacles, shadedFraction, gridPoints, pointInPolygon,
} from '../../../server/engine/shading.js';
import { fmt, MONTHS, compass } from '../utils/format.js';

const props = defineProps({
  result: { type: Object, required: true },
  request: { type: Object, required: true }, // { weatherSource, longTermCorrection }
  currentShadingLoss: { type: Number, default: 0 },
});
const emit = defineEmits(['apply-shading']);

const REF_YEAR = 2023;
const DAY_MS = 86400000;
const SUN_PATH_R = 28; // metres on the map
// Sequential ramp for solar access: dark (shaded) → bright (full sun).
const ACCESS_RAMP = ['#7c2d12', '#b4410c', '#ea6a12', '#f59e0b', '#fcd34d', '#fef3a3'];
const ACCESS_MIN = 0.5;

// --- non-reactive Leaflet state ------------------------------------------------------
const mapEl = ref(null);
let map, baseSat, baseStreet, obstacleLayer, roofLayer, draftLayer, shadowCanvas, sunLayer, heatLayer, heatRenderer;

// Canvas overlay redrawn by a callback; used for shadows so they can be unioned,
// cut out of rooftops and clipped to the roof with canvas compositing.
const CanvasLayer = L.Layer.extend({
  initialize(draw, pane) {
    this._draw = draw;
    this._paneName = pane;
  },
  onAdd(m) {
    this._canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide');
    this._canvas.style.pointerEvents = 'none';
    m.getPane(this._paneName).appendChild(this._canvas);
    m.on('moveend zoomend resize viewreset', this._reset, this);
    this._reset();
  },
  onRemove(m) {
    L.DomUtil.remove(this._canvas);
    m.off('moveend zoomend resize viewreset', this._reset, this);
  },
  _reset() {
    const size = this._map.getSize();
    const dpr = window.devicePixelRatio || 1;
    L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([0, 0]));
    this._canvas.width = size.x * dpr;
    this._canvas.height = size.y * dpr;
    this._canvas.style.width = `${size.x}px`;
    this._canvas.style.height = `${size.y}px`;
    this.redraw();
  },
  redraw() {
    if (!this._map) return;
    const ctx = this._canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    const origin = this._map.containerPointToLayerPoint([0, 0]);
    const px = (ll) => {
      const p = this._map.latLngToLayerPoint(ll);
      return [p.x - origin.x, p.y - origin.y];
    };
    this._draw(ctx, px);
  },
});

// --- reactive state ---------------------------------------------------------------------
const loc = computed(() => props.result.location);
const tz = computed(() => loc.value.tzOffsetHours ?? Math.round(loc.value.lon / 15));
let proj = localProjection(loc.value.lat, loc.value.lon);

const obstacles = ref([]);
const loadingObstacles = ref(false);
const obstacleError = ref('');
const selectedId = ref(null);
const mode = ref('select'); // select | draw | tree
const draft = ref([]);
const base = ref('satellite');
const show = reactive({ shadows: true, heat: true, sunPath: true });
const roof = reactive({ polygon: null, buildingId: null, height: 6 });

const today = new Date();
const day = ref(Math.round((Date.UTC(REF_YEAR, today.getUTCMonth(), today.getUTCDate()) - Date.UTC(REF_YEAR, 0, 1)) / DAY_MS) + 1);
const minutes = ref(12 * 60);
const playing = ref(false);
let playTimer;

const analysis = ref(null);
const analyzing = ref(false);
const analysisError = ref('');
let analysisTimer;
let analysisAbort;

// --- time & sun --------------------------------------------------------------------------
const utcMs = computed(() => Date.UTC(REF_YEAR, 0, 1) + (day.value - 1) * DAY_MS + minutes.value * 60000 - tz.value * 3600000);
const sun = computed(() => solarPosition(utcMs.value, loc.value.lat, loc.value.lon));
const dateLabel = computed(() => {
  const d = new Date(Date.UTC(REF_YEAR, 0, 1) + (day.value - 1) * DAY_MS);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
});
const timeLabel = computed(() => `${String(Math.floor(minutes.value / 60)).padStart(2, '0')}:${String(minutes.value % 60).padStart(2, '0')}`);

// Sunrise and sunset (local minutes) for the selected day, 5-minute resolution.
const daylight = computed(() => {
  let rise = null;
  let set = null;
  const d0 = Date.UTC(REF_YEAR, 0, 1) + (day.value - 1) * DAY_MS - tz.value * 3600000;
  for (let m = 0; m <= 1440; m += 5) {
    const up = solarPosition(d0 + m * 60000, loc.value.lat, loc.value.lon).elevation > 0;
    if (up && rise === null) rise = m;
    if (up) set = m;
  }
  return { rise, set };
});
const fmtMin = (m) => (m === null ? '—' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

// Typical-year weather and output at the selected hour (from the simulation result).
const hourData = computed(() => {
  const h = props.result.hourly;
  const n = h.ac.length;
  const i = ((Math.floor((utcMs.value - h.start) / h.stepMs) % n) + n) % n;
  return { ghi: h.ghi[i], dni: h.dni[i], dhi: h.dhi[i], poa: h.poa[i], tCell: h.tCell[i], acKw: h.ac[i] / 1000 };
});

// --- roof helpers ---------------------------------------------------------------------------
const roofXY = computed(() => (roof.polygon ? roof.polygon.map(proj.toXY) : null));
const roofCentroid = computed(() => {
  const xy = roofXY.value;
  if (!xy) return [0, 0];
  return [xy.reduce((a, p) => a + p[0], 0) / xy.length, xy.reduce((a, p) => a + p[1], 0) / xy.length];
});
const roofGrid = computed(() => (roofXY.value ? gridPoints(roofXY.value, 160) : null));
const preparedForRoof = computed(() =>
  roofXY.value ? prepareObstacles(proj, obstacles.value, roof.height, roofCentroid.value) : []
);
const roofShadeNow = computed(() => {
  if (!roofGrid.value || sun.value.elevation <= 0) return null;
  return shadedFraction(roofGrid.value.points, preparedForRoof.value, sun.value.azimuth, sun.value.elevation);
});

const selected = computed(() => obstacles.value.find((o) => o.id === selectedId.value) || null);
const roofBuilding = computed(() => obstacles.value.find((o) => o.id === roof.buildingId) || null);

// --- data loading ------------------------------------------------------------------------------
async function loadObstacles() {
  loadingObstacles.value = true;
  obstacleError.value = '';
  try {
    const data = await api.obstacles(loc.value.lat, loc.value.lon, 120);
    obstacles.value = [...data.buildings, ...data.trees];
    autoSelectRoof();
  } catch (e) {
    obstacleError.value = `Building data unavailable (${e.message}). You can still draw your roof and add trees.`;
  } finally {
    loadingObstacles.value = false;
  }
}

// The building under the site marker (or the nearest one within 20 m) becomes the roof.
function autoSelectRoof() {
  const site = [0, 0];
  let best = null;
  let bestD = 20;
  for (const o of obstacles.value) {
    if (o.kind !== 'building') continue;
    const xy = o.polygon.map(proj.toXY);
    if (pointInPolygon(site, xy)) {
      best = o;
      break;
    }
    const c = xy.reduce((a, p) => [a[0] + p[0] / xy.length, a[1] + p[1] / xy.length], [0, 0]);
    const d = Math.hypot(c[0], c[1]);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  if (best) setRoofFromBuilding(best);
}

function setRoofFromBuilding(b) {
  roof.polygon = b.polygon.map((p) => [...p]);
  roof.buildingId = b.id;
  roof.height = b.height;
}

// --- analysis -------------------------------------------------------------------------------------
function scheduleAnalysis() {
  clearTimeout(analysisTimer);
  if (!roof.polygon) {
    analysis.value = null;
    return;
  }
  analysisTimer = setTimeout(runAnalysis, 450);
}

async function runAnalysis() {
  analysisAbort?.abort();
  analysisAbort = new AbortController();
  analyzing.value = true;
  analysisError.value = '';
  const sys = props.result.system;
  const tracking = sys.arrayType.startsWith('1-axis');
  try {
    analysis.value = await api.shading(
      {
        lat: loc.value.lat,
        lon: loc.value.lon,
        weatherSource: props.request.weatherSource,
        longTermCorrection: props.request.longTermCorrection,
        roof: roof.polygon,
        roofHeight: roof.height,
        tilt: tracking ? 0 : sys.tilt,
        azimuth: tracking ? 180 : sys.azimuth,
        obstacles: obstacles.value.map((o) =>
          o.kind === 'tree'
            ? { id: o.id, kind: 'tree', center: o.center, height: o.height, crownDiameter: o.crownDiameter }
            : { id: o.id, kind: 'building', polygon: o.polygon, height: o.height }
        ),
      },
      analysisAbort.signal
    );
  } catch (e) {
    if (e.name !== 'AbortError') analysisError.value = e.message;
  } finally {
    analyzing.value = false;
  }
}

// --- rendering ----------------------------------------------------------------------------------
const toLL = (xy) => proj.toLatLon(xy);

function renderObstacles() {
  obstacleLayer.clearLayers();
  for (const o of obstacles.value) {
    const isSel = o.id === selectedId.value;
    const isRoof = o.id === roof.buildingId;
    let layer;
    if (o.kind === 'tree') {
      layer = L.circle(o.center, {
        radius: (o.crownDiameter || 5) / 2,
        color: isSel ? '#ffffff' : '#86efac',
        weight: isSel ? 2.5 : 1.5,
        fillColor: '#22c55e',
        fillOpacity: 0.35,
      });
    } else {
      layer = L.polygon(o.polygon, {
        color: isRoof ? '#fbbf24' : isSel ? '#ffffff' : 'rgba(255,255,255,0.75)',
        weight: isRoof || isSel ? 2.5 : 1.2,
        fillColor: isRoof ? '#fbbf24' : '#ffffff',
        fillOpacity: isRoof ? 0.12 : isSel ? 0.18 : 0.05,
        dashArray: o.estimated && !isRoof ? '4 3' : null,
      });
    }
    layer.bindTooltip(
      o.kind === 'tree'
        ? `Tree · ${o.height} m${o.estimated ? ' (est.)' : ''}`
        : `${o.name || cap(o.type)} · ${o.height} m${o.estimated ? ' (est.)' : ''}${isRoof ? ' · your roof' : ''}`,
      { sticky: true, direction: 'top', opacity: 0.95 }
    );
    layer.on('click', (e) => {
      if (mode.value !== 'select') return; // let the map handle drawing / tree placement
      L.DomEvent.stopPropagation(e);
      selectedId.value = o.id;
    });
    layer.addTo(obstacleLayer);
  }
}

function renderRoof() {
  roofLayer.clearLayers();
  if (!roof.polygon || roof.buildingId) return; // OSM roofs are drawn with the buildings
  L.polygon(roof.polygon, { color: '#fbbf24', weight: 2.5, fillColor: '#fbbf24', fillOpacity: 0.12, interactive: false }).addTo(roofLayer);
}

function renderDraft() {
  draftLayer.clearLayers();
  if (!draft.value.length) return;
  L.polyline(draft.value, { color: '#fbbf24', weight: 2, dashArray: '5 4', interactive: false }).addTo(draftLayer);
  draft.value.forEach((p, i) =>
    L.circleMarker(p, { radius: i === 0 ? 6 : 4, color: '#fff', weight: 2, fillColor: '#fbbf24', fillOpacity: 1, interactive: false }).addTo(draftLayer)
  );
}

function renderShadows() {
  shadowCanvas?.redraw();
}

function tracePath(ctx, px, ringsXY) {
  for (const ring of ringsXY) {
    ring.forEach((xy, i) => {
      const [x, y] = px(toLL(xy));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

function drawShadows(ctx, px) {
  const s = sun.value;
  if (!show.shadows || s.elevation <= 0) return;
  const shapeXY = (o) => (o.kind === 'tree' ? circlePolygon(proj.toXY(o.center), (o.crownDiameter || 5) / 2, 12) : o.polygon.map(proj.toXY));

  // 1. Ground shadows: union of every obstacle's swept footprint.
  for (const kind of ['building', 'tree']) {
    ctx.beginPath();
    for (const o of obstacles.value) {
      if (o.kind !== kind) continue;
      const v = shadowVector(s.azimuth, s.elevation, o.height);
      if (v) tracePath(ctx, px, shadowRings(shapeXY(o), v));
    }
    ctx.fillStyle = kind === 'tree' ? 'rgba(6, 10, 24, 0.42)' : 'rgba(6, 10, 24, 0.55)';
    ctx.fill('nonzero');
  }

  // 2. Rooftops sit above the ground plane: clear the ground shadow off them.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  for (const o of obstacles.value) if (o.kind === 'building') tracePath(ctx, px, [o.polygon.map(proj.toXY)]);
  if (roofXY.value) tracePath(ctx, px, [roofXY.value]);
  ctx.fill('nonzero');
  ctx.globalCompositeOperation = 'source-over';

  // 3. Shadows at panel height on your roof, from obstacles taller than the panels.
  if (roofXY.value) {
    ctx.save();
    ctx.beginPath();
    tracePath(ctx, px, [roofXY.value]);
    ctx.clip();
    ctx.beginPath();
    for (const o of preparedForRoof.value) {
      const v = shadowVector(s.azimuth, s.elevation, o.dh);
      if (v) tracePath(ctx, px, shadowRings(o.xy, v));
    }
    ctx.fillStyle = 'rgba(6, 10, 24, 0.6)';
    ctx.fill('nonzero');
    ctx.restore();
  }
}

function sunPathPoints(dayOfYear) {
  const [cx, cy] = roof.polygon ? roofCentroid.value : [0, 0];
  const d0 = Date.UTC(REF_YEAR, 0, 1) + (dayOfYear - 1) * DAY_MS - tz.value * 3600000;
  const pts = [];
  for (let m = 0; m <= 1440; m += 10) {
    const sp = solarPosition(d0 + m * 60000, loc.value.lat, loc.value.lon);
    if (sp.elevation <= 0) continue;
    pts.push(polar(cx, cy, sp.azimuth, sp.elevation));
  }
  return pts.map(toLL);
}
function polar(cx, cy, az, el) {
  const r = (SUN_PATH_R * (90 - el)) / 90;
  return [cx + r * Math.sin((az * Math.PI) / 180), cy + r * Math.cos((az * Math.PI) / 180)];
}

function renderSunPath() {
  sunLayer.clearLayers();
  if (!show.sunPath) return;
  const [cx, cy] = roof.polygon ? roofCentroid.value : [0, 0];
  const center = toLL([cx, cy]);
  L.circle(center, { radius: SUN_PATH_R, color: '#ffffff', weight: 1, opacity: 0.5, fill: false, dashArray: '2 4', interactive: false }).addTo(sunLayer);
  // Solstice paths bound the sun's yearly range; a dark casing keeps them visible on bright imagery.
  for (const dd of [172, 355]) {
    const pts = sunPathPoints(dd);
    if (pts.length < 2) continue;
    L.polyline(pts, { color: '#0b1020', weight: 4, opacity: 0.35, interactive: false }).addTo(sunLayer);
    L.polyline(pts, { color: '#ffffff', weight: 1.8, opacity: 0.9, dashArray: '5 4', interactive: false }).addTo(sunLayer);
  }
  const today = sunPathPoints(day.value);
  if (today.length > 1) {
    L.polyline(today, { color: '#0b1020', weight: 5.5, opacity: 0.35, interactive: false }).addTo(sunLayer);
    L.polyline(today, { color: '#fbbf24', weight: 3, opacity: 1, interactive: false }).addTo(sunLayer);
  }
  const s = sun.value;
  if (s.elevation > 0) {
    const p = toLL(polar(cx, cy, s.azimuth, s.elevation));
    L.polyline([center, p], { color: '#fbbf24', weight: 1.5, opacity: 0.8, interactive: false }).addTo(sunLayer);
    L.circleMarker(p, { radius: 9, color: '#ffffff', weight: 2, fillColor: '#f59e0b', fillOpacity: 1, interactive: false }).addTo(sunLayer);
  }
}

// Colour scale floor: follows the roof's worst spot (in 5 % steps) so small
// differences stay visible, but never above 90 % or below 50 %.
const accessMin = computed(() => {
  const pts = analysis.value?.points;
  if (!pts?.length) return ACCESS_MIN;
  const lo = Math.min(...pts.map((p) => p[2]));
  return Math.min(0.9, Math.max(ACCESS_MIN, Math.floor(lo * 20) / 20));
});
function accessColor(a) {
  const lo = accessMin.value;
  const t = Math.max(0, Math.min(1, (a - lo) / (1 - lo)));
  return ACCESS_RAMP[Math.min(ACCESS_RAMP.length - 1, Math.floor(t * ACCESS_RAMP.length))];
}

function renderHeat() {
  heatLayer.clearLayers();
  const a = analysis.value;
  if (!show.heat || !a) return;
  const half = a.spacingM / 2;
  const dLat = half / 110540;
  const dLon = half / (111320 * Math.cos((loc.value.lat * Math.PI) / 180));
  for (const [la, lo, acc] of a.points) {
    L.rectangle(
      [
        [la - dLat, lo - dLon],
        [la + dLat, lo + dLon],
      ],
      { renderer: heatRenderer, stroke: false, fillColor: accessColor(acc), fillOpacity: 0.82, interactive: false }
    ).addTo(heatLayer);
  }
}

// --- interaction ------------------------------------------------------------------------------------
function onMapClick(e) {
  const p = [round6(e.latlng.lat), round6(e.latlng.lng)];
  if (mode.value === 'draw') {
    draft.value = [...draft.value, p];
  } else if (mode.value === 'tree') {
    const t = { id: `u${Date.now()}`, kind: 'tree', center: p, height: 8, crownDiameter: 6, estimated: false, user: true };
    obstacles.value = [...obstacles.value, t];
    selectedId.value = t.id;
  } else {
    selectedId.value = null;
  }
}

function finishDraft() {
  if (draft.value.length >= 3) {
    roof.polygon = draft.value;
    roof.buildingId = null;
  }
  draft.value = [];
  mode.value = 'select';
}
function cancelDraft() {
  draft.value = [];
  mode.value = 'select';
}
function removeSelected() {
  const id = selectedId.value;
  obstacles.value = obstacles.value.filter((o) => o.id !== id);
  selectedId.value = null;
}
function clearRoof() {
  roof.polygon = null;
  roof.buildingId = null;
}
function setDay(d) {
  day.value = d;
}
function togglePlay() {
  playing.value = !playing.value;
  clearInterval(playTimer);
  if (!playing.value) return;
  const { rise, set } = daylight.value;
  if (rise === null) {
    playing.value = false;
    return;
  }
  if (minutes.value < rise || minutes.value >= set) minutes.value = rise;
  playTimer = setInterval(() => {
    const { rise: r, set: s } = daylight.value;
    minutes.value = minutes.value + 10 > s ? r : minutes.value + 10;
  }, 120);
}

// --- lifecycle ----------------------------------------------------------------------------------------
onMounted(() => {
  map = L.map(mapEl.value, { zoomControl: true, maxZoom: 21 }).setView([loc.value.lat, loc.value.lon], 19);
  baseSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 19,
    maxZoom: 21,
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics · Buildings &copy; OpenStreetMap',
  });
  baseStreet = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19,
    maxZoom: 21,
    attribution: '&copy; OpenStreetMap contributors',
  });
  baseSat.addTo(map);
  heatRenderer = L.canvas({ padding: 0.3 });
  heatLayer = L.layerGroup().addTo(map);
  // Shadows sit above the roof sun map and outlines (they're translucent) but below markers.
  map.createPane('shadows').style.zIndex = 450;
  shadowCanvas = new CanvasLayer(drawShadows, 'shadows').addTo(map);
  obstacleLayer = L.layerGroup().addTo(map);
  roofLayer = L.layerGroup().addTo(map);
  sunLayer = L.layerGroup().addTo(map);
  draftLayer = L.layerGroup().addTo(map);
  L.circleMarker([loc.value.lat, loc.value.lon], { radius: 4, color: '#fff', weight: 1.5, fillColor: '#eb6834', fillOpacity: 1, interactive: false }).addTo(map);
  map.on('click', onMapClick);
  map.on('dblclick', (e) => {
    if (mode.value === 'draw') {
      L.DomEvent.stop(e);
      finishDraft();
    }
  });
  renderSunPath();
  loadObstacles();
});

onBeforeUnmount(() => {
  clearInterval(playTimer);
  clearTimeout(analysisTimer);
  analysisAbort?.abort();
  map?.remove();
});

// A new calculation for a different site resets the scene.
watch(
  () => [loc.value.lat, loc.value.lon],
  ([lat, lon], [pl, po]) => {
    if (lat === pl && lon === po) return;
    proj = localProjection(lat, lon);
    map.setView([lat, lon], 19);
    obstacles.value = [];
    clearRoof();
    analysis.value = null;
    loadObstacles();
  }
);
// Orientation or weather changes alter the energy weighting.
watch(
  () => [props.result.system.tilt, props.result.system.azimuth, props.result.system.arrayType, props.request.weatherSource],
  scheduleAnalysis
);

watch(base, (b) => {
  if (b === 'satellite') {
    map.removeLayer(baseStreet);
    baseSat.addTo(map);
  } else {
    map.removeLayer(baseSat);
    baseStreet.addTo(map);
  }
});
watch(mode, (m) => {
  if (m === 'draw') map.doubleClickZoom.disable();
  else map.doubleClickZoom.enable();
  mapEl.value.style.cursor = m === 'select' ? '' : 'crosshair';
});
watch([obstacles, selectedId, () => roof.buildingId], renderObstacles, { deep: true });
watch([obstacles, sun, () => show.shadows, () => roof.polygon, () => roof.height], renderShadows, { deep: true });
watch([sun, day, () => show.sunPath, () => roof.polygon], renderSunPath);
watch(() => roof.polygon, renderRoof);
watch(draft, renderDraft);
watch([analysis, () => show.heat], renderHeat);
watch([() => roof.polygon, () => roof.height, obstacles], scheduleAnalysis, { deep: true });

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : 'Building');
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const shadeCell = (v) => (v === null ? 'transparent' : `color-mix(in srgb, var(--text-primary) ${Math.round(8 + v * 72)}%, transparent)`);
const matrixHours = computed(() => {
  const m = analysis.value?.shadeMatrix;
  if (!m) return [];
  const used = Array.from({ length: 24 }, (_, h) => m.some((row) => row[h] !== null));
  const first = used.indexOf(true);
  const last = used.lastIndexOf(true);
  return first < 0 ? [] : Array.from({ length: last - first + 1 }, (_, i) => first + i);
});
const lossDelta = computed(() => (analysis.value ? analysis.value.shadingLossPct - props.currentShadingLoss : 0));
</script>

<template>
  <section class="card site">
    <div class="card-head">
      <h2><span class="ic-chip sun"><Satellite /></span>Site, shadows &amp; sunlight</h2>
      <div class="modes segmented" role="group" aria-label="Map tool">
        <button type="button" :aria-pressed="mode === 'select'" @click="mode = 'select'"><MousePointer2 />Select</button>
        <button type="button" :aria-pressed="mode === 'draw'" @click="mode = 'draw'; draft = []"><PenLine />Draw roof</button>
        <button type="button" :aria-pressed="mode === 'tree'" @click="mode = 'tree'"><TreePine />Add tree</button>
      </div>
    </div>

    <div class="body">
      <!-- Map -->
      <div class="map-col">
        <div class="map-wrap">
          <div ref="mapEl" class="map" aria-label="Satellite map of the site with shadows"></div>

          <div class="overlay top-left">
            <div class="segmented mini" role="group" aria-label="Base map">
              <button type="button" :aria-pressed="base === 'satellite'" @click="base = 'satellite'">Satellite</button>
              <button type="button" :aria-pressed="base === 'street'" @click="base = 'street'">Map</button>
            </div>
          </div>
          <div class="overlay top-right layers">
            <Layers />
            <label><input v-model="show.shadows" type="checkbox" />Shadows</label>
            <label><input v-model="show.heat" type="checkbox" />Roof sun map</label>
            <label><input v-model="show.sunPath" type="checkbox" />Sun path</label>
          </div>

          <div v-if="mode === 'draw'" class="overlay hint">
            <span>Click the roof corners{{ draft.length ? ` · ${draft.length} points` : '' }}. Double-click or press Finish.</span>
            <button type="button" class="btn sm" :disabled="draft.length < 3" @click="finishDraft"><Check />Finish</button>
            <button type="button" class="btn sm" @click="cancelDraft"><X /></button>
          </div>
          <div v-else-if="mode === 'tree'" class="overlay hint">
            <span>Click the map to place trees, then set their height.</span>
            <button type="button" class="btn sm" @click="mode = 'select'"><Check />Done</button>
          </div>
          <div v-if="loadingObstacles" class="overlay hint"><Loader2 class="spin" /> Loading buildings from OpenStreetMap…</div>

          <div v-if="show.heat && analysis" class="overlay bottom-left legend">
            <span>Roof solar access</span>
            <div class="ramp" :style="{ background: `linear-gradient(90deg, ${ACCESS_RAMP.join(',')})` }"></div>
            <div class="ramp-labels">
              <span>≤{{ Math.round(accessMin * 100) }}%</span>
              <span>{{ Math.round(((accessMin + 1) / 2) * 100) }}%</span>
              <span>100%</span>
            </div>
          </div>
        </div>

        <!-- Time controls -->
        <div class="time">
          <button type="button" class="play" :aria-label="playing ? 'Pause' : 'Play the day'" @click="togglePlay">
            <Pause v-if="playing" /><Play v-else />
          </button>
          <div class="sliders">
            <label class="slider-row">
              <span class="lbl">{{ dateLabel }}</span>
              <input v-model.number="day" type="range" min="1" max="365" aria-label="Day of year" />
            </label>
            <label class="slider-row">
              <span class="lbl">{{ timeLabel }}</span>
              <input v-model.number="minutes" type="range" min="0" max="1435" step="5" aria-label="Time of day" />
            </label>
          </div>
          <div class="quick">
            <button type="button" class="chip-btn" @click="setDay(172)">Jun 21</button>
            <button type="button" class="chip-btn" @click="setDay(79)">Mar 20</button>
            <button type="button" class="chip-btn" @click="setDay(355)">Dec 21</button>
          </div>
        </div>
        <p v-if="obstacleError" class="muted err">{{ obstacleError }}</p>
      </div>

      <!-- Side panel -->
      <aside class="side">
        <div class="panel">
          <div class="sun-row">
            <div>
              <span class="k">Sun</span>
              <strong v-if="sun.elevation > 0">{{ sun.elevation.toFixed(1) }}° high · {{ compass(sun.azimuth) }} {{ Math.round(sun.azimuth) }}°</strong>
              <strong v-else>Below the horizon</strong>
            </div>
            <div class="rs">
              <span><Sunrise />{{ fmtMin(daylight.rise) }}</span>
              <span><Sunset />{{ fmtMin(daylight.set) }}</span>
            </div>
          </div>

          <div class="strength">
            <div class="k">Sunlight on panels (typical weather, this hour)</div>
            <div class="big">{{ fmt(hourData.poa) }} <span>W/m²</span></div>
            <div class="bar"><span :style="{ width: `${Math.min(100, hourData.poa / 10)}%` }"></span></div>
            <dl class="mini">
              <div><dt>Ground (GHI)</dt><dd>{{ fmt(hourData.ghi) }}</dd></div>
              <div><dt>Direct (DNI)</dt><dd>{{ fmt(hourData.dni) }}</dd></div>
              <div><dt>Output</dt><dd>{{ fmt(hourData.acKw, 2) }} kW</dd></div>
            </dl>
            <p v-if="roofShadeNow !== null" class="now-shade">
              <span class="dot" :style="{ background: roofShadeNow > 0.01 ? '#475569' : '#f59e0b' }"></span>
              Roof in shadow right now: <strong>{{ Math.round(roofShadeNow * 100) }}%</strong>
            </p>
          </div>
        </div>

        <!-- Selection -->
        <div v-if="selected" class="panel sel">
          <div class="sel-head">
            <strong>{{ selected.kind === 'tree' ? 'Tree' : selected.name || cap(selected.type) }}</strong>
            <button type="button" class="icon-btn" aria-label="Close" @click="selectedId = null"><X /></button>
          </div>
          <div class="grid-2">
            <label class="field">Height<div class="input-unit"><input v-model.number="selected.height" type="number" min="0.5" max="400" step="0.5" /><span>m</span></div></label>
            <label v-if="selected.kind === 'tree'" class="field">Crown width<div class="input-unit"><input v-model.number="selected.crownDiameter" type="number" min="1" max="40" step="0.5" /><span>m</span></div></label>
          </div>
          <p v-if="selected.estimated" class="muted">Height estimated ({{ selected.basis || 'default' }}). Correct it if you know it.</p>
          <div class="sel-actions">
            <button v-if="selected.kind === 'building' && selected.id !== roof.buildingId" type="button" class="btn sm" @click="setRoofFromBuilding(selected)"><Home />Use as my roof</button>
            <span v-else-if="selected.id === roof.buildingId" class="pill"><Home />Your roof</span>
            <button v-if="selected.kind === 'tree'" type="button" class="btn sm" @click="removeSelected"><Trash2 />Remove</button>
          </div>
        </div>

        <!-- Roof & analysis -->
        <div class="panel">
          <template v-if="roof.polygon">
            <div class="sel-head">
              <strong><Home class="inline" /> Your roof</strong>
              <button type="button" class="icon-btn" aria-label="Clear roof" @click="clearRoof"><Trash2 /></button>
            </div>
            <label class="field">Panel height above ground<div class="input-unit"><input v-model.number="roof.height" type="number" min="0" max="300" step="0.5" /><span>m</span></div></label>

            <div v-if="analyzing && !analysis" class="muted"><Loader2 class="spin inline" /> Analysing a full year of sun positions…</div>
            <p v-if="analysisError" class="muted err">{{ analysisError }}</p>

            <template v-if="analysis">
              <div class="res" :class="{ stale: analyzing }">
                <div class="res-top">
                  <div>
                    <span class="k">Annual solar access</span>
                    <div class="big">{{ (analysis.meanAccess * 100).toFixed(1) }}<span>%</span></div>
                  </div>
                  <div>
                    <span class="k">Shading loss</span>
                    <div class="big loss">{{ analysis.shadingLossPct.toFixed(1) }}<span>%</span></div>
                  </div>
                </div>
                <p class="muted">
                  {{ fmt(analysis.roofAreaM2) }} m² roof footprint · {{ analysis.obstaclesConsidered }} obstacles taller than the panels ·
                  direct {{ analysis.beamLossPct.toFixed(1) }}%, sky {{ analysis.skyLossPct.toFixed(1) }}%
                </p>

                <div class="k">When the roof is shaded (month × hour)</div>
                <div class="matrix" :style="{ gridTemplateColumns: `24px repeat(${matrixHours.length}, minmax(0,1fr))` }">
                  <template v-for="(row, m) in analysis.shadeMatrix" :key="m">
                    <span class="ml">{{ MONTHS[m][0] }}</span>
                    <span
                      v-for="h in matrixHours"
                      :key="h"
                      class="mc"
                      :style="{ background: shadeCell(row[h]) }"
                      :title="row[h] === null ? `${MONTHS[m]} ${h}:00 · no direct sun` : `${MONTHS[m]} ${h}:00 · ${Math.round(row[h] * 100)}% of roof shaded`"
                    ></span>
                  </template>
                  <span></span>
                  <span v-for="h in matrixHours" :key="'l' + h" class="hl">{{ h % 3 === 0 ? h : '' }}</span>
                </div>

                <button type="button" class="btn apply" :disabled="Math.abs(lossDelta) < 0.05" @click="emit('apply-shading', Math.round(analysis.shadingLossPct * 10) / 10)">
                  <Check />Use {{ analysis.shadingLossPct.toFixed(1) }}% as near-shading loss
                </button>
                <p class="muted">
                  Currently {{ currentShadingLoss }}%. With a string inverter, partial shade can cost more than this; with
                  micro-inverters or optimisers it's close to the irradiance loss shown.
                </p>
              </div>
            </template>
          </template>
          <template v-else>
            <strong>No roof selected</strong>
            <p class="muted">Click a building and choose "Use as my roof", or use <em>Draw roof</em> to outline it on the satellite image.</p>
          </template>
        </div>
      </aside>
    </div>
    <p class="muted foot">
      Building heights come from OpenStreetMap where tagged (dashed outlines are estimated), and trees are rarely mapped, so
      check heights and add trees. Shadows are drawn on the ground; the analysis measures them at panel height and weights
      every hour by the site's typical-year sunlight.
    </p>
  </section>
</template>

<style scoped>
.site .card-head {
  margin-bottom: 14px;
}
.modes button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
}
.modes svg {
  width: 14px;
  height: 14px;
}
.body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 330px;
  gap: 16px;
}
.map-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.map-wrap {
  position: relative;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--border);
}
.map {
  height: 520px;
  z-index: 0;
  background: #1b1e23;
}
.overlay {
  position: absolute;
  z-index: 500;
  background: var(--surface-glass);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
}
.top-left {
  top: 10px;
  left: 54px;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}
.segmented.mini {
  background: var(--surface-glass);
  backdrop-filter: blur(10px);
}
.segmented.mini button {
  padding: 5px 10px;
  font-size: 0.74rem;
}
.top-right {
  top: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  font-size: 0.74rem;
}
.layers svg {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
}
.layers label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.layers input {
  accent-color: var(--accent);
  margin: 0;
}
.hint {
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  font-size: 0.78rem;
  white-space: nowrap;
}
.hint svg {
  width: 14px;
  height: 14px;
}
.btn.sm {
  height: 28px;
  padding: 0 10px;
  font-size: 0.76rem;
}
.bottom-left {
  left: 10px;
  bottom: 24px;
  padding: 8px 10px;
  font-size: 0.7rem;
  width: 170px;
}
.legend .ramp {
  height: 8px;
  border-radius: 4px;
  margin: 5px 0 3px;
}
.ramp-labels {
  display: flex;
  justify-content: space-between;
  color: var(--text-muted);
}

.time {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.play {
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 0;
  display: grid;
  place-items: center;
  background: var(--ink-btn);
  color: var(--ink-btn-text);
  cursor: pointer;
}
.play svg {
  width: 16px;
  height: 16px;
}
.sliders {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.slider-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
.slider-row .lbl {
  font-size: 0.8rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.quick {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.chip-btn {
  border: 1px solid var(--border-strong);
  background: var(--surface);
  border-radius: 999px;
  padding: 2px 9px;
  font-size: 0.7rem;
  cursor: pointer;
  white-space: nowrap;
}
.chip-btn:hover {
  background: var(--surface-3);
}

.side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.panel {
  padding: 14px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.k {
  display: block;
  font-size: 0.72rem;
  color: var(--text-muted);
  font-weight: 500;
}
.sun-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-end;
}
.sun-row strong {
  font-size: 0.88rem;
}
.rs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.74rem;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.rs span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rs svg {
  width: 13px;
  height: 13px;
  color: var(--sun-ink);
}
.strength {
  border-top: 1px solid var(--grid);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.big {
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.big span {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-muted);
  margin-left: 3px;
}
.big.loss {
  color: var(--series-2);
}
.bar {
  height: 6px;
  border-radius: 3px;
  background: var(--surface-3);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--sun-1), var(--sun-2));
  transition: width 0.2s var(--ease);
}
.mini {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin: 2px 0 0;
}
.mini dt {
  font-size: 0.66rem;
  color: var(--text-muted);
}
.mini dd {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.now-shade {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0 0;
  font-size: 0.8rem;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.sel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.sel-head strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.88rem;
}
.icon-btn {
  border: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
}
.icon-btn:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}
.icon-btn svg,
svg.inline {
  width: 14px;
  height: 14px;
}
.sel-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.panel input[type='number'] {
  background: var(--surface);
}
.res {
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: opacity 0.2s;
}
.res.stale {
  opacity: 0.55;
}
.res-top {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.matrix {
  display: grid;
  gap: 1.5px;
}
.mc {
  height: 9px;
  border-radius: 2px;
  outline: 1px solid var(--grid);
  outline-offset: -1px;
}
.ml,
.hl {
  font-size: 0.6rem;
  color: var(--text-muted);
  line-height: 9px;
}
.hl {
  text-align: center;
  line-height: 1.2;
}
.apply {
  width: 100%;
  background: var(--ink-btn);
  color: var(--ink-btn-text);
  border-color: transparent;
  height: 38px;
}
.apply:hover {
  background: var(--ink-btn);
  filter: brightness(1.15);
}
.apply:disabled {
  opacity: 0.5;
  cursor: default;
}
p {
  margin: 0;
}
.err {
  color: var(--critical);
}
.foot {
  margin-top: 12px;
}
:deep(.leaflet-tooltip) {
  font: inherit;
  font-size: 0.76rem;
  border-radius: 8px;
  padding: 4px 8px;
}
:deep(.leaflet-control-attribution) {
  font-size: 9px;
}
@media (max-width: 1100px) {
  .body {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 640px) {
  .map {
    height: 380px;
  }
  .top-right {
    top: auto;
    bottom: 24px;
    right: 8px;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  .top-right svg {
    display: none;
  }
  .quick {
    display: none;
  }
  .modes button {
    padding: 7px 8px;
    font-size: 0.74rem;
  }
}
</style>
