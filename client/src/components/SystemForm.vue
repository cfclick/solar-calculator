<script setup>
import { computed } from 'vue';
import { Home, LayoutGrid, RotateCw, Sunrise, ChevronRight, Gauge, CloudSun, Wallet } from 'lucide-vue-next';
import { Minus, Plus, PanelTop } from 'lucide-vue-next';
import { compass, money } from '../utils/format.js';
import { PANEL_PRESETS, CUSTOM_ID, panelEfficiency } from '../utils/panels.js';

const model = defineModel({ type: Object, required: true });
defineProps({ defaults: { type: Object, default: null } });

const ARRAY_TYPES = [
  { value: 'fixed-roof', label: 'Roof mount', hint: 'Racked on a roof', icon: Home },
  { value: 'fixed-open', label: 'Open rack', hint: 'Ground, ventilated', icon: LayoutGrid },
  { value: '1-axis', label: 'Tracker', hint: 'Single-axis N–S', icon: RotateCw },
  { value: '1-axis-backtrack', label: 'Backtracking', hint: 'Tracker, no row shade', icon: Sunrise },
];
const MODULE_TYPES = [
  { value: 'standard', label: 'Standard', short: 'Plain glass', title: 'Standard crystalline Si, uncoated glass' },
  { value: 'premium', label: 'Premium', short: 'AR-coated', title: 'High-efficiency n-type with anti-reflective glass' },
  { value: 'thinfilm', label: 'Thin film', short: 'Thin film', title: 'CdTe thin film' },
];

const LOSS_LABELS = {
  soiling: 'Soiling',
  shading: 'Near shading',
  snow: 'Snow',
  mismatch: 'Mismatch',
  wiring: 'DC/AC wiring',
  connections: 'Connections',
  lightInducedDegradation: 'Light-induced degr.',
  nameplateRating: 'Nameplate rating',
  age: 'Age',
  availability: 'Availability',
};

const s = computed(() => model.value.system);

// --- panel sizing -----------------------------------------------------------
const p = computed(() => model.value.panel);
const panelKw = computed(() => ((Number(p.value.count) || 0) * (Number(p.value.powerW) || 0)) / 1000);
const eff = computed(() => panelEfficiency(p.value));
const area = computed(() =>
  p.value.lengthMm && p.value.widthMm ? ((p.value.lengthMm * p.value.widthMm) / 1e6) * (p.value.count || 0) : null
);
const presetTech = computed(() => {
  const preset = PANEL_PRESETS.find((x) => x.id === p.value.preset);
  return preset ? preset.tech : 'Custom values from your datasheet';
});

function applyPreset(id) {
  p.value.preset = id;
  const preset = PANEL_PRESETS.find((x) => x.id === id);
  if (!preset) return;
  Object.assign(p.value, {
    name: preset.name,
    powerW: preset.powerW,
    lengthMm: preset.lengthMm,
    widthMm: preset.widthMm,
    gammaPct: preset.gammaPct,
  });
  model.value.system.moduleType = preset.moduleType;
}
function markCustom() {
  p.value.preset = CUSTOM_ID;
  p.value.name = 'Custom panel';
}
function setTech(t) {
  model.value.system.moduleType = t;
  const preset = PANEL_PRESETS.find((x) => x.id === p.value.preset);
  if (preset && preset.moduleType !== t) markCustom();
}
function step(d) {
  p.value.count = Math.max(1, Math.round((Number(p.value.count) || 0) + d));
}
const tracking = computed(() => s.value.arrayType.startsWith('1-axis'));
const totalLoss = computed(() => {
  let keep = 1;
  for (const v of Object.values(s.value.losses)) keep *= 1 - (Number(v) || 0) / 100;
  return (1 - keep) * 100;
});
const costTotal = computed(
  () => model.value.financial.costPerWatt * (model.value.sizing === 'panels' ? panelKw.value : s.value.capacityKw) * 1000
);
</script>

<template>
  <div class="form">
    <section class="group">
      <div class="field">
        <span>Size the system by</span>
        <div class="segmented" role="group" aria-label="Sizing method">
          <button type="button" :aria-pressed="model.sizing === 'panels'" @click="model.sizing = 'panels'">Number of panels</button>
          <button type="button" :aria-pressed="model.sizing === 'kw'" @click="model.sizing = 'kw'">Total kWp</button>
        </div>
      </div>

      <template v-if="model.sizing === 'panels'">
        <label class="field">
          Panel model
          <select :value="model.panel.preset" @change="applyPreset($event.target.value)">
            <option v-for="p in PANEL_PRESETS" :key="p.id" :value="p.id">{{ p.name }}</option>
            <option :value="CUSTOM_ID">Custom panel…</option>
          </select>
        </label>

        <div class="field">
          <span>Number of panels</span>
          <div class="stepper">
            <button type="button" aria-label="One panel fewer" @click="step(-1)"><Minus /></button>
            <input v-model.number="model.panel.count" type="number" min="1" step="1" aria-label="Number of panels" />
            <button type="button" aria-label="One panel more" @click="step(1)"><Plus /></button>
          </div>
        </div>

        <div class="spec">
          <div class="spec-head">
            <span class="ic-chip blue"><PanelTop /></span>
            <div>
              <strong>Panel specification</strong>
              <small>{{ presetTech }}</small>
            </div>
          </div>
          <div class="grid-2">
            <label class="field">Rated power (STC)<div class="input-unit"><input v-model.number="model.panel.powerW" type="number" min="10" max="1500" step="5" @input="markCustom" /><span>W</span></div></label>
            <label class="field">Temp. coeff. Pmax<div class="input-unit"><input v-model.number="model.panel.gammaPct" type="number" min="-1" max="0" step="0.01" @input="markCustom" /><span>%/°C</span></div></label>
            <label class="field">Length<div class="input-unit"><input v-model.number="model.panel.lengthMm" type="number" min="200" max="4000" step="1" @input="markCustom" /><span>mm</span></div></label>
            <label class="field">Width<div class="input-unit"><input v-model.number="model.panel.widthMm" type="number" min="200" max="2500" step="1" @input="markCustom" /><span>mm</span></div></label>
          </div>
          <div class="field">
            <span>Cell technology</span>
            <div class="segmented" role="group" aria-label="Module technology">
              <button
                v-for="m in MODULE_TYPES"
                :key="m.value"
                type="button"
                :aria-pressed="s.moduleType === m.value"
                :title="m.title"
                @click="setTech(m.value)"
              >
                {{ m.short }}
              </button>
            </div>
          </div>
          <dl class="spec-sum">
            <div><dt>System size</dt><dd>{{ panelKw.toFixed(2) }} kWp</dd></div>
            <div><dt>Efficiency</dt><dd>{{ eff ? (eff * 100).toFixed(1) + '%' : '—' }}</dd></div>
            <div><dt>Array area</dt><dd>{{ area ? area.toFixed(1) + ' m²' : '—' }}</dd></div>
          </dl>
        </div>
      </template>

      <label v-else class="field">
        System size
        <div class="input-unit">
          <input v-model.number="model.system.capacityKw" type="number" min="0.1" step="0.1" />
          <span>kWp</span>
        </div>
      </label>

      <div class="field">
        <span>Mounting</span>
        <div class="options" role="radiogroup" aria-label="Array type">
          <button
            v-for="a in ARRAY_TYPES"
            :key="a.value"
            type="button"
            role="radio"
            class="option"
            :aria-checked="s.arrayType === a.value"
            @click="model.system.arrayType = a.value"
          >
            <component :is="a.icon" class="opt-ic" />
            <span class="opt-label">{{ a.label }}</span>
            <span class="opt-hint">{{ a.hint }}</span>
          </button>
        </div>
      </div>

      <div v-if="model.sizing !== 'panels'" class="field">
        <span>Module</span>
        <div class="segmented" role="group" aria-label="Module type">
          <button
            v-for="m in MODULE_TYPES"
            :key="m.value"
            type="button"
            :aria-pressed="s.moduleType === m.value"
            @click="model.system.moduleType = m.value"
          >
            {{ m.label }}
          </button>
        </div>
      </div>

      <template v-if="!tracking">
        <div class="field slider">
          <div class="slider-head">
            <span>Tilt</span>
            <div class="input-unit mini"><input v-model.number="model.system.tilt" type="number" min="0" max="90" aria-label="Tilt degrees" /><span>°</span></div>
          </div>
          <input v-model.number="model.system.tilt" type="range" min="0" max="90" step="1" aria-label="Tilt" />
        </div>
        <div class="field slider">
          <div class="slider-head">
            <span class="az-label">
              <svg class="dial" viewBox="0 0 40 40" aria-hidden="true">
                <circle cx="20" cy="20" r="18" />
                <text x="20" y="9.5">N</text>
                <g :style="{ transform: `rotate(${s.azimuth}deg)`, transformOrigin: '20px 20px' }">
                  <path d="M20 8 L24 22 L20 19.5 L16 22 Z" />
                </g>
              </svg>
              Azimuth · {{ compass(s.azimuth) }}
            </span>
            <div class="input-unit mini"><input v-model.number="model.system.azimuth" type="number" min="0" max="359" aria-label="Azimuth degrees" /><span>°</span></div>
          </div>
          <input v-model.number="model.system.azimuth" type="range" min="0" max="359" step="1" aria-label="Azimuth" />
        </div>
      </template>
      <div v-else class="grid-2">
        <label class="field">Max rotation<div class="input-unit"><input v-model.number="model.system.maxAngle" type="number" min="10" max="90" /><span>°</span></div></label>
        <label class="field">Ground cover ratio<input v-model.number="model.system.gcr" type="number" min="0.1" max="0.9" step="0.05" /></label>
      </div>

      <div class="grid-2">
        <label class="field">DC/AC ratio<input v-model.number="model.system.dcAcRatio" type="number" min="0.8" max="2" step="0.05" /></label>
        <label class="field">Inverter efficiency<div class="input-unit"><input v-model.number="model.system.inverterEfficiency" type="number" min="90" max="99.5" step="0.1" /><span>%</span></div></label>
      </div>
    </section>

    <details class="group">
      <summary>
        <span class="ic-chip"><Gauge /></span>
        <span class="sum-text"><strong>System losses</strong><small>{{ totalLoss.toFixed(2) }}% combined</small></span>
        <ChevronRight class="chev" />
      </summary>
      <div class="grid-2 inner">
        <label v-for="(label, k) in LOSS_LABELS" :key="k" class="field">
          {{ label }}
          <div class="input-unit"><input v-model.number="model.system.losses[k]" type="number" min="0" max="100" step="0.1" /><span>%</span></div>
        </label>
      </div>
      <p class="muted">Defaults follow NREL PVWatts (14.08% combined). Terrain horizon is modelled separately, so "near shading" covers only nearby trees and buildings.</p>
    </details>

    <details class="group">
      <summary>
        <span class="ic-chip"><CloudSun /></span>
        <span class="sum-text"><strong>Weather &amp; modelling</strong><small>{{ model.weatherSource === 'auto' ? 'Automatic source' : model.weatherSource.toUpperCase() }}</small></span>
        <ChevronRight class="chev" />
      </summary>
      <div class="inner stack">
        <label class="field">
          Weather source
          <select v-model="model.weatherSource">
            <option value="auto">Auto: NSRDB where available, else PVGIS</option>
            <option value="nsrdb">NSRDB TMY, 4 km satellite (Americas)</option>
            <option value="pvgis">PVGIS TMY (global)</option>
          </select>
        </label>
        <label class="field">Ground albedo<input v-model.number="model.system.albedo" type="number" min="0" max="1" step="0.05" /></label>
        <label class="switch"><span>Terrain horizon shading<small>Mountains and hills from elevation data</small></span><input v-model="model.useHorizon" type="checkbox" /></label>
        <label class="switch"><span>Low-irradiance losses<small>Efficiency drop in weak light</small></span><input v-model="model.system.lowLight" type="checkbox" /></label>
        <label class="switch"><span>Long-term irradiance correction<small>Scale PVGIS TMY to the multi-year mean</small></span><input v-model="model.longTermCorrection" type="checkbox" /></label>
        <label class="switch"><span>Cross-check other models<small>NREL PVWatts and EU PVGIS</small></span><input v-model="model.compare" type="checkbox" /></label>
      </div>
    </details>

    <details class="group">
      <summary>
        <span class="ic-chip"><Wallet /></span>
        <span class="sum-text"><strong>Economics</strong><small>≈ {{ money(costTotal) }} before incentives</small></span>
        <ChevronRight class="chev" />
      </summary>
      <div class="grid-2 inner">
        <label class="field">Installed cost<div class="input-unit"><input v-model.number="model.financial.costPerWatt" type="number" min="0" step="0.05" /><span>$/W</span></div></label>
        <label class="field">Incentives<div class="input-unit"><input v-model.number="model.financial.incentivePct" type="number" min="0" max="100" /><span>%</span></div></label>
        <label class="field">Electricity<div class="input-unit"><input v-model.number="model.financial.electricityRate" type="number" min="0" step="0.01" /><span>$/kWh</span></div></label>
        <label class="field">Rate escalation<div class="input-unit"><input v-model.number="model.financial.rateEscalationPct" type="number" step="0.1" /><span>%/yr</span></div></label>
        <label class="field">Degradation<div class="input-unit"><input v-model.number="model.financial.degradationPct" type="number" min="0" max="3" step="0.05" /><span>%/yr</span></div></label>
        <label class="field">O&amp;M<div class="input-unit"><input v-model.number="model.financial.omCostPerKwYear" type="number" min="0" /><span>$/kW·yr</span></div></label>
        <label class="field">Discount rate<div class="input-unit"><input v-model.number="model.financial.discountRatePct" type="number" min="0" step="0.5" /><span>%</span></div></label>
        <label class="field">Lifetime<div class="input-unit"><input v-model.number="model.financial.years" type="number" min="1" max="50" /><span>yrs</span></div></label>
        <label class="field">Grid CO₂<div class="input-unit"><input v-model.number="model.financial.co2KgPerKwh" type="number" min="0" step="0.01" /><span>kg/kWh</span></div></label>
      </div>
    </details>
  </div>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field > span {
  font-size: 0.76rem;
  font-weight: 500;
  color: var(--text-secondary);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Panel count stepper */
.stepper {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 38px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface);
}
.stepper:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.stepper button {
  display: grid;
  place-items: center;
  border: 0;
  background: var(--surface-2);
  color: var(--text-secondary);
  cursor: pointer;
}
.stepper button:hover {
  color: var(--text-primary);
  background: var(--surface-3);
}
.stepper button svg {
  width: 15px;
  height: 15px;
}
.stepper input {
  border: 0;
  border-radius: 0;
  text-align: center;
  font-weight: 600;
  font-size: 0.95rem;
  box-shadow: none !important;
  -moz-appearance: textfield;
}
.stepper input::-webkit-inner-spin-button {
  -webkit-appearance: none;
}

/* Panel specification card */
.spec {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.spec input {
  background: var(--surface);
}
.spec .segmented {
  background: var(--surface-3);
}
.spec-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.spec-head strong {
  display: block;
  font-size: 0.84rem;
}
.spec-head small {
  display: block;
  font-size: 0.72rem;
  color: var(--text-muted);
}
.spec-sum {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--border);
}
.spec-sum > div {
  background: var(--surface);
  padding: 8px 10px;
}
.spec-sum dt {
  font-size: 0.68rem;
  color: var(--text-muted);
  font-weight: 500;
}
.spec-sum dd {
  margin: 1px 0 0;
  font-size: 0.86rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Mounting option cards */
.options {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
.option {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 9px;
  align-items: center;
  text-align: left;
  padding: 10px 11px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}
.option:hover {
  border-color: var(--axis);
  background: var(--surface-2);
}
.option[aria-checked='true'] {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 0 0 1px var(--accent);
}
.opt-ic {
  grid-row: 1 / 3;
  width: 18px;
  height: 18px;
  color: var(--text-muted);
}
.option[aria-checked='true'] .opt-ic {
  color: var(--accent);
}
.opt-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.2;
}
.opt-hint {
  font-size: 0.7rem;
  color: var(--text-muted);
  line-height: 1.3;
}

/* Sliders */
.slider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.slider-head > span {
  font-size: 0.76rem;
  font-weight: 500;
  color: var(--text-secondary);
}
.input-unit.mini {
  width: 76px;
}
.input-unit.mini input {
  height: 30px;
  padding-right: 22px;
  text-align: right;
}
.az-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.dial {
  width: 26px;
  height: 26px;
}
.dial circle {
  fill: var(--surface-2);
  stroke: var(--border-strong);
}
.dial text {
  font-size: 7px;
  font-weight: 700;
  text-anchor: middle;
  fill: var(--text-muted);
}
.dial path {
  fill: var(--accent);
}
.dial g {
  transition: transform 0.2s var(--ease);
}

/* Collapsible groups */
details.group {
  border-top: 1px solid var(--grid);
  padding-top: 10px;
  gap: 0;
}
summary {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  list-style: none;
  padding: 4px 0;
  border-radius: 8px;
}
summary::-webkit-details-marker {
  display: none;
}
.sum-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.sum-text strong {
  font-size: 0.86rem;
  font-weight: 600;
}
.sum-text small {
  font-size: 0.74rem;
  color: var(--text-muted);
}
.chev {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  transition: transform 0.2s var(--ease);
}
details[open] .chev {
  transform: rotate(90deg);
}
.inner {
  margin-top: 12px;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
details p {
  margin: 10px 0 0;
}
</style>
