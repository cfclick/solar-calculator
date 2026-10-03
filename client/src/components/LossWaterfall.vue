<script setup>
import { computed } from 'vue';
import { TrendingDown } from 'lucide-vue-next';
import { Bar } from 'vue-chartjs';
import { useChartTheme, baseOptions } from '../composables/useChartTheme.js';
import { fmt } from '../utils/format.js';

const props = defineProps({ result: { type: Object, required: true } });
const theme = useChartTheme();

// Hide negligible steps (e.g. no clipping, no horizon) to keep the chart readable.
const steps = computed(() => {
  const w = props.result.waterfall;
  const start = w[0].value;
  return w.filter((s) => s.kind !== 'loss' || Math.abs(s.value) >= start * 0.001);
});

const bars = computed(() => {
  const start = steps.value[0].value;
  let level = 0;
  return steps.value.map((s) => {
    if (s.kind === 'start' || s.kind === 'end') {
      level = s.value;
      return { ...s, range: [0, s.value], pct: (s.value / start) * 100 };
    }
    const from = level;
    level += s.value;
    return { ...s, range: [level, from], pct: (s.value / start) * 100 };
  });
});

const data = computed(() => ({
  labels: bars.value.map((b) => b.label),
  datasets: [
    {
      data: bars.value.map((b) => b.range),
      backgroundColor: bars.value.map((b) => (b.kind === 'loss' ? theme['series-2'] : theme['series-1'])),
      borderRadius: 4,
      borderSkipped: false,
      maxBarThickness: 22,
    },
  ],
}));

const options = computed(() => {
  // Axes are swapped below for horizontal bars, so the value title goes on y here.
  const o = baseOptions(theme, { yTitle: 'kWh/yr' });
  o.indexAxis = 'y';
  o.interaction = { mode: 'nearest', axis: 'y', intersect: false };
  o.scales = {
    x: { ...o.scales.y, beginAtZero: true },
    y: { ...o.scales.x, ticks: { ...o.scales.x.ticks, color: theme['text-secondary'] } },
  };
  o.plugins.tooltip.callbacks = {
    title: (c) => bars.value[c[0].dataIndex].label,
    label: (c) => {
      const b = bars.value[c.dataIndex];
      return b.kind === 'loss'
        ? ` ${fmt(b.value)} kWh (${b.pct.toFixed(1)}%)`
        : ` ${fmt(b.value)} kWh`;
    },
  };
  return o;
});
</script>

<template>
  <section class="card">
    <div class="card-head">
      <h2><span class="ic-chip"><TrendingDown /></span>Energy losses</h2>
      <span class="sub">From irradiance on the modules to energy delivered</span>
    </div>
    <div class="chart-box" style="height: 300px">
      <Bar :data="data" :options="options" aria-label="Loss waterfall chart" role="img" />
    </div>
    <div class="table-wrap">
      <table class="loss-table">
        <tbody>
          <tr v-for="b in bars" :key="b.key" :class="{ total: b.kind !== 'loss' }">
            <td>
              <span class="swatch" :style="{ background: b.kind === 'loss' ? theme['series-2'] : theme['series-1'] }"></span>{{ b.label }}
            </td>
            <td>{{ fmt(b.value) }} kWh</td>
            <td>{{ b.kind === 'loss' ? `${b.pct.toFixed(1)}%` : '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.loss-table {
  margin-top: 10px;
}
.total td {
  font-weight: 600;
}
</style>
