<script setup>
import { computed } from 'vue';
import { BarChart3 } from 'lucide-vue-next';
import { Bar } from 'vue-chartjs';
import { useChartTheme, baseOptions } from '../composables/useChartTheme.js';
import { fmt, pct, MONTHS } from '../utils/format.js';

const props = defineProps({ result: { type: Object, required: true } });
const theme = useChartTheme();

const data = computed(() => ({
  labels: MONTHS,
  datasets: [
    {
      label: 'AC energy',
      data: props.result.monthly.map((m) => m.ac),
      backgroundColor: theme['series-1'],
      hoverBackgroundColor: theme['series-1'],
      borderRadius: { topLeft: 4, topRight: 4 },
      borderSkipped: 'bottom',
      maxBarThickness: 36,
    },
  ],
}));

const options = computed(() => {
  const o = baseOptions(theme, { yTitle: 'kWh' });
  o.plugins.tooltip.callbacks = {
    label: (c) => ` ${fmt(c.parsed.y)} kWh`,
    afterLabel: (c) => {
      const m = props.result.monthly[c.dataIndex];
      return [` ${fmt(m.acPerDay, 1)} kWh/day`, ` POA ${fmt(m.poa, 1)} kWh/m²`, ` PR ${pct(m.performanceRatio)}`];
    },
  };
  return o;
});

const best = computed(() => {
  const m = props.result.monthly;
  const hi = m.reduce((a, b) => (b.ac > a.ac ? b : a));
  const lo = m.reduce((a, b) => (b.ac < a.ac ? b : a));
  return { hi, lo };
});
</script>

<template>
  <section class="card fill">
    <div class="card-head">
      <h2><span class="ic-chip blue"><BarChart3 /></span>Monthly production</h2>
      <span class="sub">
        Peak {{ MONTHS[best.hi.month - 1] }} {{ fmt(best.hi.ac) }} kWh · low {{ MONTHS[best.lo.month - 1] }} {{ fmt(best.lo.ac) }} kWh
      </span>
    </div>
    <div class="chart-box">
      <div class="chart-abs">
        <Bar :data="data" :options="options" aria-label="Monthly AC energy bar chart" role="img" />
      </div>
    </div>
  </section>
</template>
