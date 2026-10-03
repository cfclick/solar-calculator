<script setup>
import { computed } from 'vue';
import { Target, Activity, Gauge, SunMedium, CalendarDays, Zap, CloudSun, MapPin, PanelTop } from 'lucide-vue-next';
import { fmt, pct } from '../utils/format.js';
import { useCountUp } from '../composables/useCountUp.js';

const props = defineProps({
  result: { type: Object, required: true },
  place: { type: String, default: '' },
});
const lt = computed(() => props.result.weather.longTermCorrection);
const panel = computed(() => props.result.system.panel);
const systemLabel = computed(() => {
  const kw = `${fmt(props.result.system.capacityKw, 2)} kWp`;
  const p = panel.value;
  return p ? `${p.count} × ${p.name} · ${kw}` : kw;
});
const animated = useCountUp(computed(() => props.result.annual.acKwh));

const tiles = computed(() => {
  const a = props.result.annual;
  return [
    { label: 'Specific yield', value: fmt(a.specificYield), unit: 'kWh/kWp', icon: Target },
    { label: 'Performance ratio', value: pct(a.performanceRatio), unit: '', icon: Activity },
    { label: 'Capacity factor', value: pct(a.capacityFactor), unit: '', icon: Gauge },
    {
      label: props.result.sunHours.factor !== 1 ? 'Peak sun hours (custom)' : 'Peak sun hours',
      value: fmt(props.result.sunHours.used, 2),
      unit: `h/day · ${fmt(props.result.sunHours.panelPlane, 2)} on panels`,
      icon: SunMedium,
    },
    { label: 'Average per day', value: fmt(a.acKwh / 365, 1), unit: 'kWh', icon: CalendarDays },
    { label: 'Peak AC output', value: fmt(a.peakAcKw, 2), unit: `of ${fmt(a.inverterAcKw, 1)} kW`, icon: Zap },
  ];
});
</script>

<template>
  <div class="kpis">
    <div class="hero card">
      <div class="glow" aria-hidden="true"></div>
      <span class="eyebrow">Estimated annual production</span>
      <div class="hero-value">
        {{ fmt(animated) }}<span class="unit">kWh/yr</span>
      </div>
      <div class="chips">
        <span v-if="place" class="pill" :title="place"><MapPin />{{ place.split(',').slice(0, 2).join(',') }}</span>
        <span class="pill"><PanelTop />{{ systemLabel }}</span>
        <span class="pill"><CloudSun />{{ result.weather.dataset }}<template v-if="result.weather.period"> · {{ result.weather.period }}</template></span>
      </div>
      <div v-if="panel" class="per-panel">
        <div><strong>{{ fmt(result.annual.kwhPerPanel) }}</strong> kWh per panel/yr</div>
        <div v-if="result.annual.kwhPerM2"><strong>{{ fmt(result.annual.kwhPerM2) }}</strong> kWh per m²/yr</div>
      </div>
      <p v-if="lt" class="muted note">
        Irradiance scaled to the {{ lt.period }} mean ({{ lt.changePct >= 0 ? '+' : '−' }}{{ Math.abs(lt.changePct) }}% vs raw TMY)
      </p>
    </div>
    <dl class="tiles">
      <div v-for="t in tiles" :key="t.label" class="kpi card">
        <dt><span class="ic-chip"><component :is="t.icon" /></span>{{ t.label }}</dt>
        <dd>
          {{ t.value }} <span class="kunit">{{ t.unit }}</span>
        </dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.kpis {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 2fr);
  gap: 16px;
}
.hero {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  padding: 24px;
}
.glow {
  position: absolute;
  top: -140px;
  right: -110px;
  width: 300px;
  height: 300px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--sun-1) 0%, var(--sun-2) 35%, transparent 68%);
  opacity: 0.16;
  filter: blur(28px);
  pointer-events: none;
}
.eyebrow {
  font-size: 0.74rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--sun-ink);
}
.hero-value {
  font-size: clamp(2.3rem, 4vw, 3.2rem);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.05;
  font-variant-numeric: tabular-nums;
}
.unit {
  font-size: 1rem;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--text-secondary);
  margin-left: 8px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.chips .pill {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note {
  margin: 2px 0 0;
}
.per-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 0.8rem;
  color: var(--text-secondary);
}
.per-panel strong {
  color: var(--text-primary);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin: 0;
}
.kpi {
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
}
dt {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-weight: 500;
}
dt .ic-chip {
  width: 26px;
  height: 26px;
  border-radius: 8px;
}
dt .ic-chip svg {
  width: 14px;
  height: 14px;
}
dd {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.kunit {
  font-size: 0.76rem;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0;
}
@media (max-width: 1100px) {
  .kpis {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 560px) {
  .tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
}
</style>
