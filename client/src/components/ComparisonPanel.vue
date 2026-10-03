<script setup>
import { computed } from 'vue';
import { ShieldCheck } from 'lucide-vue-next';
import { Line } from 'vue-chartjs';
import { useChartTheme, baseOptions } from '../composables/useChartTheme.js';
import { fmt, signedPct, MONTHS } from '../utils/format.js';

const props = defineProps({ result: { type: Object, required: true } });
const theme = useChartTheme();

const rows = computed(() => {
  const r = props.result;
  const engine = {
    source: 'This calculator',
    model: 'Hourly Perez / SAPM / PVWatts inverter',
    dataset: r.weather.dataset,
    acKwh: r.annual.acKwh,
    monthly: r.monthly.map((m) => m.ac),
    color: 'series-1',
  };
  const refs = r.references.map((x, i) => ({ ...x, color: `series-${i + 2}` }));
  return [engine, ...refs];
});

const valid = computed(() => rows.value.filter((r) => Number.isFinite(r.acKwh)));
const spread = computed(() => {
  const v = valid.value.map((r) => r.acKwh);
  if (v.length < 2) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { min: Math.min(...v), max: Math.max(...v), mean, rangePct: ((Math.max(...v) - Math.min(...v)) / mean) * 100 };
});

const chartData = computed(() => ({
  labels: MONTHS,
  datasets: valid.value
    .filter((r) => r.monthly?.length === 12)
    .map((r) => ({
      label: r.source,
      data: r.monthly.map((v) => Math.round(v)),
      borderColor: theme[r.color],
      backgroundColor: theme[r.color],
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      pointBorderColor: theme.surface,
      pointBorderWidth: 1.5,
      tension: 0.25,
    })),
}));

const options = computed(() => {
  const o = baseOptions(theme, { yTitle: 'kWh', legend: true });
  o.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)} kWh` };
  return o;
});
</script>

<template>
  <section class="card">
    <div class="card-head">
      <h2><span class="ic-chip blue"><ShieldCheck /></span>Model cross-check</h2>
      <span v-if="spread" class="sub">
        Models agree within {{ spread.rangePct.toFixed(1) }}% · mean {{ fmt(spread.mean) }} kWh
      </span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Annual kWh</th>
            <th>vs this calculator</th>
            <th style="text-align: left">Weather data</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.source">
            <td>
              <span class="swatch" :style="{ background: theme[r.color] }"></span>{{ r.source }}
              <div class="muted note" v-if="r.note">{{ r.note }}</div>
            </td>
            <template v-if="r.error">
              <td colspan="3" class="err">Unavailable: {{ r.error }}</td>
            </template>
            <template v-else>
              <td>{{ fmt(r.acKwh) }}</td>
              <td>{{ r === rows[0] ? '—' : signedPct(r.acKwh, rows[0].acKwh) }}</td>
              <td style="text-align: left; white-space: normal">{{ r.dataset || '—' }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="chartData.datasets.length > 1" class="chart-box" style="margin-top: 14px">
      <Line :data="chartData" :options="options" aria-label="Monthly production by model" role="img" />
    </div>
    <p class="muted explain">
      Differences come mainly from weather data (satellite NSRDB vs ERA5/SARAH, typical year vs multi-year average) and
      from model choices: PVGIS has no inverter clipping or backtracking, and PVWatts ignores terrain and low-light losses.
      A spread under ~5% is normal. The mean is a sound planning figure.
    </p>
  </section>
</template>

<style scoped>
.note {
  white-space: normal;
  font-size: 0.72rem;
  margin-left: 16px;
}
.err {
  text-align: left;
  color: var(--text-muted);
  white-space: normal;
}
.explain {
  margin: 12px 0 0;
}
</style>
