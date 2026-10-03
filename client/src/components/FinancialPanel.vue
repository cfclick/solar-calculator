<script setup>
import { computed } from 'vue';
import { Wallet } from 'lucide-vue-next';
import { Bar } from 'vue-chartjs';
import { useChartTheme, baseOptions } from '../composables/useChartTheme.js';
import { fmt, money } from '../utils/format.js';

const props = defineProps({ result: { type: Object, required: true } });
const theme = useChartTheme();
const f = computed(() => props.result.financial);

// Diverging: cumulative cash position below zero (red) vs above (blue).
const NEG = { light: '#e34948', dark: '#e66767' };
const negColor = computed(() => (theme.dark ? NEG.dark : NEG.light));

const data = computed(() => ({
  labels: f.value.rows.map((r) => r.year),
  datasets: [
    {
      label: 'Cumulative net savings',
      data: f.value.rows.map((r) => r.cumulative),
      backgroundColor: f.value.rows.map((r) => (r.cumulative < 0 ? negColor.value : theme['series-1'])),
      borderRadius: 3,
      borderSkipped: false,
      maxBarThickness: 18,
    },
  ],
}));

const options = computed(() => {
  const o = baseOptions(theme, { xTitle: 'Year' });
  o.scales.y.beginAtZero = false;
  o.scales.y.ticks.callback = (v) => money(v);
  o.plugins.tooltip.callbacks = {
    title: (c) => `Year ${c[0].label}`,
    label: (c) => {
      const r = f.value.rows[c.dataIndex];
      return [` Cumulative ${money(r.cumulative)}`, ` Production ${fmt(r.kwh)} kWh`, ` Savings ${money(r.savings)}`];
    },
  };
  return o;
});

const tiles = computed(() => [
  { label: 'Net system cost', value: money(f.value.netCost) },
  { label: 'Simple payback', value: f.value.paybackYears ? `${f.value.paybackYears} yrs` : 'Not within lifetime' },
  { label: `${f.value.years}-yr net savings`, value: money(f.value.totalSavings - f.value.netCost) },
  { label: 'NPV', value: money(f.value.npv) },
  { label: 'LCOE', value: f.value.lcoe ? `$${f.value.lcoe.toFixed(3)}/kWh` : '—' },
  { label: 'CO₂ avoided', value: `${fmt(f.value.co2AvoidedTonnes, 1)} t` },
]);
</script>

<template>
  <section class="card">
    <div class="card-head">
      <h2><span class="ic-chip"><Wallet /></span>Lifetime economics</h2>
      <span class="sub">{{ fmt(f.totalKwh) }} kWh over {{ f.years }} years with degradation</span>
    </div>
    <dl class="tiles">
      <div v-for="t in tiles" :key="t.label" class="tile">
        <dt>{{ t.label }}</dt>
        <dd>{{ t.value }}</dd>
      </div>
    </dl>
    <div class="chart-box" style="height: 240px">
      <Bar :data="data" :options="options" aria-label="Cumulative net savings by year" role="img" />
    </div>
    <p class="muted legend">
      <span class="swatch" :style="{ background: negColor }"></span>Not yet paid back
      <span class="swatch" :style="{ background: theme['series-1'], marginLeft: '12px' }"></span>Net positive
    </p>
  </section>
</template>

<style scoped>
.tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin: 0 0 14px;
}
.tile {
  background: var(--surface-2);
  border-radius: 8px;
  padding: 10px 12px;
}
dt {
  font-size: 0.75rem;
  color: var(--text-secondary);
}
dd {
  margin: 2px 0 0;
  font-size: 1.05rem;
  font-weight: 600;
}
.legend {
  margin: 8px 0 0;
}
@media (max-width: 560px) {
  .tiles {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
