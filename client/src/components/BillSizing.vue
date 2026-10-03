<script setup>
import { ref, computed } from 'vue';
import { FileUp, Loader2, Calculator, CheckCircle2, AlertTriangle, X } from 'lucide-vue-next';
import { Bar } from 'vue-chartjs';
import { api } from '../api.js';
import { useChartTheme, baseOptions } from '../composables/useChartTheme.js';
import { fmt, money, MONTHS } from '../utils/format.js';

const model = defineModel({ type: Object, required: true });
const emit = defineEmits(['apply']);
const theme = useChartTheme();

const u = computed(() => model.value.usage);

const MODES = [
  { value: 'monthly', label: 'Month by month' },
  { value: 'average', label: 'Average month' },
  { value: 'amount', label: 'Bill amount' },
];

// --- usage as 12 calendar months ----------------------------------------------
const monthlyKwh = computed(() => {
  if (u.value.mode === 'average') return new Array(12).fill(num(u.value.averageKwh));
  if (u.value.mode === 'amount') {
    const rate = Number(model.value.financial.electricityRate);
    const amt = num(u.value.billAmount);
    return new Array(12).fill(amt !== null && rate > 0 ? Math.round(amt / rate) : null);
  }
  return u.value.monthly.map(num);
});
const knownMonths = computed(() => monthlyKwh.value.filter((v) => v !== null).length);
const annualGuess = computed(() => {
  const known = monthlyKwh.value.filter((v) => v !== null);
  return known.length ? (known.reduce((a, b) => a + b, 0) / known.length) * 12 : 0;
});

function billMoney(v, currency) {
  try {
    return money(v, currency || 'USD');
  } catch {
    return money(v); // unrecognised currency code
  }
}

function num(v) {
  const x = Number(v);
  return v === null || v === '' || !Number.isFinite(x) || x < 0 ? null : x;
}

// --- read a bill with the server -----------------------------------------------
const fileInput = ref(null);
const reading = ref(false);
const readError = ref('');

async function onFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  readError.value = '';
  reading.value = true;
  try {
    const payload = await encodeFile(file);
    const bill = await api.readBill(payload);
    u.value.mode = 'monthly';
    u.value.monthly = bill.monthlyKwh;
    u.value.bill = {
      fileName: file.name,
      utility: bill.utility,
      currency: bill.currency,
      periodStart: bill.billingPeriodStart,
      periodEnd: bill.billingPeriodEnd,
      periodKwh: bill.periodKwh,
      totalAmount: bill.totalAmount,
      effectiveRate: bill.effectiveRate,
      notes: bill.notes,
      historyMonths: bill.monthlyKwh.filter((v) => v !== null).length,
    };
    u.value.useBillRate = bill.effectiveRate !== null;
    if (knownMonths.value) recommend();
  } catch (err) {
    readError.value = err.message;
  } finally {
    reading.value = false;
  }
}

/** PDFs go as-is; photos are re-encoded to a JPEG no larger than 2000 px. */
async function encodeFile(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 10 * 1024 * 1024) throw new Error('The PDF is larger than 10 MB.');
    return { mediaType: file.type, data: await toBase64(file) };
  }
  if (!file.type.startsWith('image/')) throw new Error('Upload a PDF or a photo of the bill.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image format cannot be read here. Use JPEG, PNG or PDF.');
  }
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
  return { mediaType: 'image/jpeg', data: await toBase64(blob) };
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(blob);
  });
}

function clearBill() {
  u.value.bill = null;
  u.value.useBillRate = false;
}

// --- recommendation ------------------------------------------------------------
const sizing = ref(null);
const sizingKey = ref('');
const sizingLoading = ref(false);
const sizingError = ref('');
let abort;

const requestBody = computed(() => {
  const f = model.value;
  return {
    lat: f.lat,
    lon: f.lon,
    weatherSource: f.weatherSource,
    useHorizon: f.useHorizon,
    longTermCorrection: f.longTermCorrection,
    sunHours: f.sunHoursOverride,
    monthlyKwh: monthlyKwh.value,
    offsetPct: u.value.offsetPct,
    system: { ...f.system, panel: f.panel },
  };
});
const stale = computed(() => sizing.value && JSON.stringify(requestBody.value) !== sizingKey.value);

async function recommend() {
  if (!knownMonths.value) {
    sizingError.value =
      u.value.mode === 'amount' && !(model.value.financial.electricityRate > 0)
        ? 'Set an electricity rate under Economics to convert the bill amount to kWh.'
        : 'Enter your electricity use first.';
    return;
  }
  abort?.abort();
  abort = new AbortController();
  sizingLoading.value = true;
  sizingError.value = '';
  const body = requestBody.value;
  try {
    sizing.value = await api.size(body, abort.signal);
    sizingKey.value = JSON.stringify(body);
  } catch (err) {
    if (err.name === 'AbortError') return;
    sizingError.value = err.message;
  } finally {
    sizingLoading.value = false;
  }
}

function apply() {
  model.value.sizing = 'panels';
  model.value.panel.count = sizing.value.panels;
  if (u.value.useBillRate && u.value.bill?.effectiveRate) model.value.financial.electricityRate = u.value.bill.effectiveRate;
  emit('apply');
}

const chartData = computed(() => ({
  labels: MONTHS.map((m) => m[0]),
  datasets: [
    {
      label: 'Usage',
      data: sizing.value.monthly.map((m) => m.usageKwh),
      backgroundColor: theme['series-2'],
      borderRadius: { topLeft: 3, topRight: 3 },
      borderSkipped: 'bottom',
      maxBarThickness: 12,
    },
    {
      label: 'Solar',
      data: sizing.value.monthly.map((m) => m.productionKwh),
      backgroundColor: theme['series-1'],
      borderRadius: { topLeft: 3, topRight: 3 },
      borderSkipped: 'bottom',
      maxBarThickness: 12,
    },
  ],
}));
const chartOptions = computed(() => {
  const o = baseOptions(theme, { legend: true });
  o.scales.y.ticks.maxTicksLimit = 4;
  o.plugins.tooltip.callbacks = {
    title: (c) => MONTHS[c[0].dataIndex],
    label: (c) => ` ${c.dataset.label} ${fmt(c.parsed.y)} kWh`,
  };
  return o;
});
</script>

<template>
  <div class="bill">
    <div class="drop" :class="{ busy: reading }">
      <input ref="fileInput" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden @change="onFile" />
      <button class="btn upload" type="button" :disabled="reading" @click="fileInput.click()">
        <Loader2 v-if="reading" class="spin" />
        <FileUp v-else />
        {{ reading ? 'Reading your bill…' : 'Upload a bill (PDF or photo)' }}
      </button>
      <small>Reads the kWh, charges and usage history. Use a bill that shows the 12-month usage chart for the best result.</small>
    </div>
    <p v-if="readError" class="error" role="alert">{{ readError }}</p>

    <div v-if="u.bill" class="bill-card">
      <div class="bill-head">
        <CheckCircle2 class="ok" />
        <div>
          <strong>{{ u.bill.utility || 'Electricity bill' }}</strong>
          <small v-if="u.bill.periodStart && u.bill.periodEnd">{{ u.bill.periodStart }} → {{ u.bill.periodEnd }}</small>
        </div>
        <button type="button" class="icon-btn" aria-label="Forget this bill" @click="clearBill"><X /></button>
      </div>
      <dl>
        <div><dt>This period</dt><dd>{{ u.bill.periodKwh !== null ? fmt(u.bill.periodKwh) + ' kWh' : '—' }}</dd></div>
        <div><dt>Amount</dt><dd>{{ u.bill.totalAmount !== null ? billMoney(u.bill.totalAmount, u.bill.currency) : '—' }}</dd></div>
        <div><dt>Effective rate</dt><dd>{{ u.bill.effectiveRate !== null ? u.bill.effectiveRate.toFixed(3) + '/kWh' : '—' }}</dd></div>
      </dl>
      <p class="muted small">
        {{ u.bill.historyMonths }} month{{ u.bill.historyMonths === 1 ? '' : 's' }} of usage read. Check the values below.
        <template v-if="u.bill.notes"> {{ u.bill.notes }}</template>
      </p>
      <label v-if="u.bill.effectiveRate !== null" class="check">
        <input v-model="u.useBillRate" type="checkbox" />
        Use this rate for the economics (includes fixed charges and taxes)
      </label>
    </div>

    <div class="field">
      <span>Electricity use</span>
      <div class="segmented" role="group" aria-label="Usage entry">
        <button v-for="m in MODES" :key="m.value" type="button" :aria-pressed="u.mode === m.value" @click="u.mode = m.value">
          {{ m.label }}
        </button>
      </div>
    </div>

    <div v-if="u.mode === 'monthly'" class="months">
      <label v-for="(name, i) in MONTHS" :key="name" class="month">
        <span>{{ name }}</span>
        <input v-model.number="u.monthly[i]" type="number" min="0" step="1" placeholder="kWh" :aria-label="`${name} kWh`" />
      </label>
    </div>
    <label v-else-if="u.mode === 'average'" class="field">
      Typical monthly use
      <div class="input-unit"><input v-model.number="u.averageKwh" type="number" min="0" step="10" /><span>kWh/mo</span></div>
    </label>
    <template v-else>
      <label class="field">
        Typical monthly bill
        <div class="input-unit"><input v-model.number="u.billAmount" type="number" min="0" step="5" /><span>$/mo</span></div>
      </label>
      <p class="muted small">
        Converted at {{ model.financial.electricityRate }} $/kWh (Economics). Fixed charges make this an overestimate; kWh from the bill is more accurate.
      </p>
    </template>

    <div class="field slider">
      <div class="slider-head">
        <span>Cover this share of annual use</span>
        <div class="input-unit mini"><input v-model.number="u.offsetPct" type="number" min="10" max="200" aria-label="Target offset percent" /><span>%</span></div>
      </div>
      <input v-model.number="u.offsetPct" type="range" min="50" max="150" step="5" aria-label="Target offset" />
    </div>

    <button class="btn recommend" type="button" :disabled="sizingLoading" @click="recommend">
      <Loader2 v-if="sizingLoading" class="spin" />
      <Calculator v-else />
      {{ sizingLoading ? 'Sizing…' : `Recommend system size${annualGuess ? ` · ${fmt(annualGuess)} kWh/yr` : ''}` }}
    </button>
    <p v-if="sizingError" class="error" role="alert">{{ sizingError }}</p>

    <div v-if="sizing" class="result" :class="{ stale }">
      <div class="headline">
        <div>
          <strong>{{ sizing.panels }} panels</strong>
          <small>× {{ sizing.panelW }} W ({{ model.panel.name }})</small>
        </div>
        <div class="kw">
          <strong>{{ sizing.capacityKw.toFixed(2) }} kWp</strong>
          <small>exact need {{ sizing.exactKw.toFixed(2) }} kWp</small>
        </div>
      </div>
      <dl>
        <div><dt>Annual use</dt><dd>{{ fmt(sizing.annualUsageKwh) }} kWh</dd></div>
        <div><dt>Solar production</dt><dd>{{ fmt(sizing.annualProductionKwh) }} kWh</dd></div>
        <div><dt>Offset</dt><dd>{{ fmt(sizing.offsetPct, 0) }}%</dd></div>
        <div><dt>Yield</dt><dd>{{ fmt(sizing.specificYield) }} kWh/kWp</dd></div>
        <div v-if="sizing.arrayAreaM2"><dt>Panel area</dt><dd>{{ fmt(sizing.arrayAreaM2, 1) }} m²</dd></div>
      </dl>
      <div class="chart" style="height: 150px">
        <Bar :data="chartData" :options="chartOptions" aria-label="Monthly usage versus solar production" role="img" />
      </div>
      <div v-for="w in sizing.warnings" :key="w" class="note"><AlertTriangle /><span>{{ w }}</span></div>
      <p v-if="stale" class="muted small">Inputs changed since this recommendation. Recommend again to update it.</p>
      <button class="btn-primary btn" type="button" :disabled="stale" @click="apply">
        Use {{ sizing.panels }} panels &amp; calculate
      </button>
    </div>
  </div>
</template>

<style scoped>
.bill {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field > span,
.slider-head > span {
  font-size: 0.76rem;
  font-weight: 500;
  color: var(--text-secondary);
}
.drop {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
}
.drop small {
  font-size: 0.72rem;
  color: var(--text-muted);
  line-height: 1.4;
}
.upload,
.recommend {
  width: 100%;
  justify-content: center;
}
.bill-card,
.result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.bill-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.bill-head > div {
  flex: 1;
  min-width: 0;
}
.bill-head strong,
.headline strong {
  display: block;
  font-size: 0.86rem;
}
.bill-head small,
.headline small {
  display: block;
  font-size: 0.72rem;
  color: var(--text-muted);
}
.ok {
  width: 18px;
  height: 18px;
  color: var(--good);
  flex: none;
}
.icon-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}
.icon-btn svg {
  width: 15px;
  height: 15px;
}
dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 1px;
  margin: 0;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--border);
}
dl > div {
  background: var(--surface);
  padding: 7px 9px;
}
dt {
  font-size: 0.68rem;
  color: var(--text-muted);
  font-weight: 500;
}
dd {
  margin: 1px 0 0;
  font-size: 0.84rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.small {
  font-size: 0.74rem;
  margin: 0;
  line-height: 1.45;
}
.check {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 0.76rem;
  color: var(--text-secondary);
}
.check input {
  margin-top: 2px;
}
.months {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.month {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.month span {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-weight: 500;
}
.month input {
  height: 32px;
  padding: 0 8px;
  font-variant-numeric: tabular-nums;
}
.slider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.input-unit.mini {
  width: 76px;
}
.input-unit.mini input {
  height: 30px;
  padding-right: 22px;
  text-align: right;
}
.headline {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 10px;
}
.headline strong {
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.kw {
  text-align: right;
}
.chart {
  position: relative;
}
.note {
  display: flex;
  gap: 8px;
  font-size: 0.72rem;
  line-height: 1.4;
  color: var(--warning-ink);
  background: var(--warning-bg);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-sm);
  padding: 7px 9px;
}
.note svg {
  width: 14px;
  height: 14px;
  flex: none;
  margin-top: 1px;
}
.stale dl,
.stale .chart,
.stale .headline {
  opacity: 0.5;
}
</style>
