<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { Zap, Loader2, MapPin, SlidersHorizontal, Download, AlertTriangle, Satellite, LineChart, ShieldCheck, ReceiptText, ChevronRight } from 'lucide-vue-next';
import { api } from './api.js';
import ThemeToggle from './components/ThemeToggle.vue';
import LocationPicker from './components/LocationPicker.vue';
import SystemForm from './components/SystemForm.vue';
import BillSizing from './components/BillSizing.vue';
import SunHours from './components/SunHours.vue';
import SiteShading from './components/SiteShading.vue';
import KpiTiles from './components/KpiTiles.vue';
import ComparisonPanel from './components/ComparisonPanel.vue';
import MonthlyChart from './components/MonthlyChart.vue';
import LossWaterfall from './components/LossWaterfall.vue';
import ProfileHeatmap from './components/ProfileHeatmap.vue';
import OrientationCharts from './components/OrientationCharts.vue';
import FinancialPanel from './components/FinancialPanel.vue';
import MonthlyTable from './components/MonthlyTable.vue';
import { downloadHourlyCsv } from './utils/csv.js';

const STORAGE_KEY = 'solar-calculator:inputs:v1';

const defaults = ref(null);
const loading = ref(false);
const error = ref('');
const result = ref(null);
const resultPlace = ref('');
const lastRequest = ref({ weatherSource: 'auto', longTermCorrection: true });

const form = reactive({
  lat: 34.0522,
  lon: -118.2437,
  label: 'Los Angeles, California',
  weatherSource: 'auto',
  useHorizon: true,
  longTermCorrection: true,
  compare: true,
  sunHoursOverride: null,
  sizing: 'panels',
  panel: { preset: 'topcon-440', name: 'TOPCon 440 W', count: 14, powerW: 440, lengthMm: 1722, widthMm: 1134, gammaPct: -0.3 },
  system: {
    capacityKw: 6,
    moduleType: 'premium',
    arrayType: 'fixed-roof',
    tilt: 20,
    azimuth: 180,
    dcAcRatio: 1.2,
    inverterEfficiency: 96,
    albedo: 0.2,
    gcr: 0.4,
    maxAngle: 60,
    lowLight: true,
    losses: {},
  },
  financial: {
    costPerWatt: 2.75,
    incentivePct: 30,
    electricityRate: 0.17,
    rateEscalationPct: 2.5,
    degradationPct: 0.5,
    omCostPerKwYear: 15,
    discountRatePct: 5,
    years: 25,
    co2KgPerKwh: 0.37,
  },
  usage: {
    mode: 'monthly',
    monthly: new Array(12).fill(null),
    averageKwh: null,
    billAmount: null,
    offsetPct: 100,
    bill: null,
    useBillRate: false,
  },
});

// Restore last inputs (per-browser convenience only).
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved) {
    Object.assign(form, {
      ...saved,
      panel: { ...form.panel, ...saved.panel },
      system: { ...form.system, ...saved.system },
      financial: { ...form.financial, ...saved.financial },
      usage: { ...form.usage, ...saved.usage },
    });
  }
} catch {
  /* storage unavailable */
}
watch(
  form,
  (v) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
  { deep: true }
);

onMounted(async () => {
  try {
    defaults.value = await api.defaults();
    form.system.losses = { ...defaults.value.losses, ...form.system.losses };
  } catch (e) {
    error.value = `Cannot reach the API: ${e.message}`;
  }
});

// Southern-hemisphere sites should face north by default.
watch(
  () => Math.sign(form.lat),
  (s, prev) => {
    if (prev === undefined || s === prev) return;
    if (s < 0 && form.system.azimuth === 180) form.system.azimuth = 0;
    if (s > 0 && form.system.azimuth === 0) form.system.azimuth = 180;
  }
);

// --- site sun hours (looked up whenever the location or weather source changes) ---
const siteSun = ref(null);
const sunLoading = ref(false);
const sunError = ref('');
let sunTimer;
let sunAbort;

async function loadSunHours() {
  if (!Number.isFinite(form.lat) || !Number.isFinite(form.lon)) return;
  sunAbort?.abort();
  sunAbort = new AbortController();
  sunLoading.value = true;
  sunError.value = '';
  try {
    siteSun.value = await api.sunHours(form, sunAbort.signal);
  } catch (e) {
    if (e.name === 'AbortError') return;
    siteSun.value = null;
    sunError.value = e.message;
  } finally {
    sunLoading.value = false;
  }
}

watch(
  () => [form.lat, form.lon, form.weatherSource, form.longTermCorrection],
  ([lat, lon], [pLat, pLon] = []) => {
    // A custom value belongs to the old site; the new one gets its own default.
    if (pLat !== undefined && (lat !== pLat || lon !== pLon)) form.sunHoursOverride = null;
    clearTimeout(sunTimer);
    sunTimer = setTimeout(loadSunHours, 600);
  }
);
onMounted(loadSunHours);

// The bill section starts open until the user has entered some usage.
const billOpen = ref(!form.usage.bill && form.usage.monthly.every((v) => v === null || v === ''));

const byPanels = computed(() => form.sizing === 'panels');
const capacityKw = computed(() =>
  byPanels.value ? ((Number(form.panel.count) || 0) * (Number(form.panel.powerW) || 0)) / 1000 : form.system.capacityKw
);

async function calculate() {
  if (byPanels.value && !(capacityKw.value > 0)) {
    error.value = 'Enter the number of panels and their rated power.';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    lastRequest.value = { weatherSource: form.weatherSource, longTermCorrection: form.longTermCorrection };
    result.value = await api.estimate({
      lat: form.lat,
      lon: form.lon,
      weatherSource: form.weatherSource,
      useHorizon: form.useHorizon,
      longTermCorrection: form.longTermCorrection,
      compare: form.compare,
      sunHours: form.sunHoursOverride,
      system: {
        ...form.system,
        capacityKw: capacityKw.value,
        panel: byPanels.value ? form.panel : undefined,
      },
      financial: { ...form.financial, systemCost: form.financial.costPerWatt * capacityKw.value * 1000 },
    });
    resultPlace.value = form.label || `${form.lat.toFixed(3)}, ${form.lon.toFixed(3)}`;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

// Replace the generic near-shading loss with the roof analysis and recalculate.
function applyShading(pct) {
  form.system.losses.shading = pct;
  calculate();
}

function applyOrientation({ tilt, azimuth }) {
  form.system.tilt = tilt;
  form.system.azimuth = azimuth;
  calculate();
}
</script>

<template>
  <header class="appbar">
    <div class="appbar-inner">
      <div class="brand">
        <span class="logo" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <defs>
              <linearGradient id="sun" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#fbbf24" />
                <stop offset="1" stop-color="#f97316" />
              </linearGradient>
            </defs>
            <circle cx="16" cy="16" r="7" fill="url(#sun)" />
            <g stroke="url(#sun)" stroke-width="2.4" stroke-linecap="round">
              <path d="M16 3v3M16 26v3M3 16h3M26 16h3M6.8 6.8l2.1 2.1M23.1 23.1l2.1 2.1M6.8 25.2l2.1-2.1M23.1 8.9l2.1-2.1" />
            </g>
          </svg>
        </span>
        <div>
          <h1>Solar Production Estimator</h1>
          <p>Hourly physical model · cross-checked with NREL &amp; EU references</p>
        </div>
      </div>
      <ThemeToggle />
    </div>
  </header>

  <main class="layout">
    <aside class="sidebar card">
      <!-- novalidate: the server clamps every value; native step checks would block silently -->
      <form novalidate @submit.prevent="calculate">
        <div class="side-section">
          <h2 class="side-title"><span class="ic-chip sun"><MapPin /></span>Location</h2>
          <LocationPicker v-model:lat="form.lat" v-model:lon="form.lon" v-model:label="form.label" />
          <SunHours v-model="form.sunHoursOverride" :site="siteSun" :loading="sunLoading" :error="sunError" />
        </div>
        <details class="side-section bill-section" :open="billOpen" @toggle="billOpen = $event.target.open">
          <summary class="side-title">
            <span class="ic-chip"><ReceiptText /></span>
            <span class="bill-title">Size from your power bill<small>How many panels you need</small></span>
            <ChevronRight class="chev" />
          </summary>
          <BillSizing v-model="form" @apply="calculate" />
        </details>
        <div class="side-section">
          <h2 class="side-title"><span class="ic-chip blue"><SlidersHorizontal /></span>System</h2>
          <SystemForm v-model="form" :defaults="defaults" />
        </div>
        <div class="run-bar">
          <button class="btn-primary btn run" type="submit" :disabled="loading">
            <Loader2 v-if="loading" class="spin" />
            <Zap v-else />
            {{ loading ? 'Simulating 8,760 hours…' : 'Calculate production' }}
          </button>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
        </div>
      </form>
    </aside>

    <section class="results" aria-live="polite">
      <!-- Empty state -->
      <div v-if="!result && !loading" class="card empty">
        <div class="empty-art" aria-hidden="true">
          <svg viewBox="0 0 220 120">
            <defs>
              <linearGradient id="e-sun" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#fbbf24" />
                <stop offset="1" stop-color="#f97316" />
              </linearGradient>
              <linearGradient id="e-panel" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#3987e5" />
                <stop offset="1" stop-color="#1c5cab" />
              </linearGradient>
            </defs>
            <circle cx="160" cy="36" r="20" fill="url(#e-sun)" />
            <circle cx="160" cy="36" r="30" fill="url(#e-sun)" opacity="0.15" />
            <path d="M40 98 L80 52 L176 52 L136 98 Z" fill="url(#e-panel)" />
            <g stroke="rgba(255,255,255,.35)" stroke-width="1.2">
              <path d="M72 61.2h96M64 70.4h96M56 79.6h96M48 88.8h96" />
              <path d="M104 52 L64 98M128 52 L88 98M152 52 L112 98" />
            </g>
            <path d="M88 98v12M128 98v12" stroke="var(--axis)" stroke-width="3" stroke-linecap="round" />
          </svg>
        </div>
        <h2 class="empty-title">How much energy will your array produce?</h2>
        <p class="sub">
          Pick a site and describe the system. The calculator simulates a full typical weather year, hour by hour, then
          compares the result with the reference models from NREL and the European Commission.
        </p>
        <ul class="features">
          <li><span class="ic-chip sun"><Satellite /></span><div><strong>Satellite weather</strong><span>NSRDB 4 km or PVGIS SARAH3/ERA5, corrected to the long-term mean</span></div></li>
          <li><span class="ic-chip blue"><LineChart /></span><div><strong>Full physics chain</strong><span>Perez sky, terrain horizon, reflection, cell temperature, inverter clipping</span></div></li>
          <li><span class="ic-chip"><ShieldCheck /></span><div><strong>Cross-validated</strong><span>Side-by-side with PVWatts v8 and PVGIS 5.3</span></div></li>
        </ul>
      </div>

      <!-- First load skeleton -->
      <div v-if="loading && !result" class="skeleton-stack" aria-label="Loading results">
        <div class="sk-row">
          <div class="card sk" style="height: 180px"></div>
          <div class="card sk" style="height: 180px"></div>
        </div>
        <div class="card sk" style="height: 320px"></div>
        <div class="sk-row">
          <div class="card sk" style="height: 300px"></div>
          <div class="card sk" style="height: 300px"></div>
        </div>
      </div>

      <template v-if="result">
        <div :class="{ stale: loading }" class="stack">
          <div v-for="w in result.warnings" :key="w" class="warning"><AlertTriangle /><span>{{ w }}</span></div>
          <KpiTiles :result="result" :place="resultPlace" />
          <SiteShading
            :result="result"
            :request="lastRequest"
            :current-shading-loss="Number(form.system.losses.shading) || 0"
            @apply-shading="applyShading"
          />
          <ComparisonPanel v-if="result.references.length" :result="result" />
          <div class="two">
            <MonthlyChart :result="result" />
            <LossWaterfall :result="result" />
          </div>
          <div class="two">
            <ProfileHeatmap :result="result" />
            <FinancialPanel :result="result" />
          </div>
          <OrientationCharts v-if="result.sweeps" :result="result" @apply="applyOrientation" />
          <MonthlyTable :result="result" />
          <footer class="export">
            <button class="btn" type="button" @click="downloadHourlyCsv(result)"><Download />Hourly CSV · 8,760 rows</button>
            <span class="muted">
              NOAA solar position · Perez 1990 · De Soto IAM · SAPM / PVsyst thermal · PVWatts DC &amp; inverter
            </span>
          </footer>
        </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
/* App bar */
.appbar {
  position: sticky;
  top: 0;
  z-index: 1100;
  background: var(--surface-glass);
  backdrop-filter: saturate(1.6) blur(14px);
  -webkit-backdrop-filter: saturate(1.6) blur(14px);
  border-bottom: 1px solid var(--border);
}
.appbar-inner {
  max-width: 1520px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.logo {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--sun-soft);
  flex: none;
}
.logo svg {
  width: 26px;
  height: 26px;
}
.brand h1 {
  font-size: 1.02rem;
  font-weight: 650;
  letter-spacing: -0.015em;
}
.brand p {
  margin: 0;
  font-size: 0.76rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Layout */
.layout {
  max-width: 1520px;
  margin: 0 auto;
  padding: 22px 24px 48px;
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}
.sidebar {
  position: sticky;
  top: 80px;
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  padding: 0;
  scrollbar-width: thin;
}
.sidebar form {
  display: flex;
  flex-direction: column;
}
.side-section {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.side-section + .side-section {
  border-top: 1px solid var(--grid);
}
.side-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.95rem;
}
.bill-section summary {
  cursor: pointer;
  list-style: none;
}
.bill-section summary::-webkit-details-marker {
  display: none;
}
.bill-section:not([open]) {
  gap: 0;
}
.bill-title {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.bill-title small {
  font-size: 0.74rem;
  font-weight: 400;
  color: var(--text-muted);
}
.chev {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  transition: transform 0.2s var(--ease);
}
.bill-section[open] .chev {
  transform: rotate(90deg);
}
.run-bar {
  position: sticky;
  bottom: 0;
  padding: 14px 20px 18px;
  background: linear-gradient(to top, var(--surface) 70%, transparent);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.run {
  width: 100%;
}
.run svg {
  width: 17px;
  height: 17px;
}

.results,
.stack {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}
.stale {
  opacity: 0.5;
  filter: saturate(0.6);
  transition: opacity 0.25s, filter 0.25s;
  pointer-events: none;
}
.two {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
}

/* Empty state */
.empty {
  padding: 40px 36px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.empty-art svg {
  width: 220px;
  height: 120px;
}
.empty-title {
  font-size: 1.45rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  margin-top: 16px;
}
.empty > .sub {
  max-width: 60ch;
  margin: 10px 0 0;
  font-size: 0.92rem;
}
.features {
  list-style: none;
  padding: 0;
  margin: 28px 0 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  width: 100%;
  max-width: 880px;
  text-align: left;
}
.features li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 14px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.features strong {
  display: block;
  font-size: 0.86rem;
}
.features span:not(.ic-chip) {
  font-size: 0.78rem;
  color: var(--text-muted);
  line-height: 1.4;
}

/* Skeleton */
.skeleton-stack {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.sk-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 20px;
}
.sk-row:last-child {
  grid-template-columns: 1fr 1fr;
}
.sk {
  background: linear-gradient(100deg, var(--surface) 30%, var(--surface-2) 50%, var(--surface) 70%);
  background-size: 300% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: 0 0;
  }
}

.export {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
  padding: 4px 2px;
}

@media (max-width: 1240px) {
  .two {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 960px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
    padding: 16px 16px 32px;
  }
  .appbar-inner {
    padding: 10px 16px;
  }
  .sidebar {
    position: static;
    max-height: none;
  }
  .features {
    grid-template-columns: minmax(0, 1fr);
  }
  .sk-row,
  .sk-row:last-child {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 520px) {
  .brand p {
    display: none;
  }
  .empty {
    padding: 28px 18px;
  }
}
</style>
