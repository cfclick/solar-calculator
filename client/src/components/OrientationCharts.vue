<script setup>
import { computed } from 'vue';
import { Compass } from 'lucide-vue-next';
import { Line } from 'vue-chartjs';
import { useChartTheme, baseOptions } from '../composables/useChartTheme.js';
import { fmt, compass } from '../utils/format.js';

const props = defineProps({ result: { type: Object, required: true } });
const emit = defineEmits(['apply']);
const theme = useChartTheme();

const s = computed(() => props.result.sweeps);
const sys = computed(() => props.result.system);

function lineData(points, xKey, current, optimum) {
  return {
    labels: points.map((p) => p[xKey]),
    datasets: [
      {
        label: 'Annual AC',
        data: points.map((p) => p.acKwh),
        borderColor: theme['series-1'],
        backgroundColor: theme['series-1'],
        borderWidth: 2,
        tension: 0.3,
        pointRadius: points.map((p) => (p[xKey] === nearest(points, xKey, optimum) ? 5 : 0)),
        pointBackgroundColor: theme['series-2'],
        pointBorderColor: theme.surface,
        pointBorderWidth: 2,
        pointHoverRadius: 5,
      },
    ],
    current,
  };
}

function nearest(points, key, v) {
  return points.reduce((a, b) => (Math.abs(b[key] - v) < Math.abs(a[key] - v) ? b : a))[key];
}

const tiltData = computed(() => lineData(s.value.tilt, 'tilt', sys.value.tilt, s.value.optimalTilt.tilt));
const azData = computed(() => lineData(s.value.azimuth, 'azimuth', sys.value.azimuth, s.value.optimalAzimuth.azimuth));

function opts(xTitle, unitFn) {
  const o = baseOptions(theme, { yTitle: 'kWh/yr', xTitle });
  o.scales.y.beginAtZero = false;
  o.plugins.tooltip.callbacks = {
    title: (c) => unitFn(c[0].label),
    label: (c) => ` ${fmt(c.parsed.y)} kWh/yr`,
  };
  return o;
}
const tiltOpts = computed(() => opts('Tilt (°)', (v) => `Tilt ${v}°`));
const azOpts = computed(() => opts('Azimuth (° from N)', (v) => `Azimuth ${v}° (${compass(+v)})`));

const gainTilt = computed(() => (s.value.optimalTilt.acKwh / props.result.annual.acKwh - 1) * 100);
</script>

<template>
  <section class="card">
    <div class="card-head">
      <h2><span class="ic-chip sun"><Compass /></span>Orientation</h2>
      <button class="btn" type="button" @click="emit('apply', { tilt: s.optimalTilt.tilt, azimuth: s.optimalAzimuth.azimuth })">
        Use optimum ({{ s.optimalTilt.tilt }}°, {{ s.optimalAzimuth.azimuth }}°)
      </button>
    </div>
    <p class="sub summary">
      Optimal tilt at {{ sys.azimuth }}° azimuth is <strong>{{ s.optimalTilt.tilt }}°</strong>
      ({{ fmt(s.optimalTilt.acKwh) }} kWh,
      {{ gainTilt >= 0.05 ? `+${gainTilt.toFixed(1)}%` : 'current tilt is optimal' }}). Best azimuth at {{ sys.tilt }}° tilt is
      <strong>{{ s.optimalAzimuth.azimuth }}° ({{ compass(s.optimalAzimuth.azimuth) }})</strong>.
    </p>
    <div class="two">
      <div>
        <h3>Production vs tilt</h3>
        <div class="chart-box" style="height: 220px">
          <Line :data="tiltData" :options="tiltOpts" aria-label="Annual production by tilt" role="img" />
        </div>
      </div>
      <div>
        <h3>Production vs azimuth</h3>
        <div class="chart-box" style="height: 220px">
          <Line :data="azData" :options="azOpts" aria-label="Annual production by azimuth" role="img" />
        </div>
      </div>
    </div>
    <p class="muted"><span class="swatch" :style="{ background: theme['series-2'], borderRadius: '50%' }"></span>Optimum</p>
  </section>
</template>

<style scoped>
.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
h3 {
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-weight: 500;
}
.summary {
  margin: 0 0 12px;
}
p.muted {
  margin: 8px 0 0;
}
@media (max-width: 760px) {
  .two {
    grid-template-columns: 1fr;
  }
}
</style>
