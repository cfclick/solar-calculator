<script setup>
import { computed, ref } from 'vue';
import { Clock } from 'lucide-vue-next';
import { MONTHS, fmt } from '../utils/format.js';
import { useChartTheme } from '../composables/useChartTheme.js';

const props = defineProps({ result: { type: Object, required: true } });
const hover = ref(null);
const theme = useChartTheme();

// Blue sequential ramp; more power = more contrast against the surface.
const LIGHT = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#2a78d6', '#1c5cab', '#104281', '#0d366b'];
const RAMP_DARK = ['#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6'];
const RAMP = computed(() => (theme.dark ? RAMP_DARK : LIGHT));

const max = computed(() => Math.max(...props.result.profile.flat(), 0.001));
const hours = computed(() => {
  // Only show hours that ever produce, plus one hour of margin.
  const any = Array.from({ length: 24 }, (_, h) => props.result.profile.some((m) => m[h] > 0.001));
  let first = any.indexOf(true);
  let last = any.lastIndexOf(true);
  if (first < 0) return [];
  first = Math.max(0, first - 1);
  last = Math.min(23, last + 1);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
});

function color(v) {
  if (v <= 0.001) return 'transparent';
  const t = Math.min(1, v / max.value);
  const r = RAMP.value;
  return r[Math.min(r.length - 1, Math.floor(t * r.length))];
}

const tz = computed(() => {
  const t = props.result.location.tzOffsetHours ?? 0;
  return `UTC${t >= 0 ? '+' : ''}${t}`;
});
</script>

<template>
  <section class="card">
    <div class="card-head">
      <h2><span class="ic-chip sun"><Clock /></span>Average daily profile</h2>
      <span class="sub" aria-live="polite">
        <template v-if="hover">{{ MONTHS[hover.m] }} {{ String(hover.h).padStart(2, '0') }}:00 · {{ fmt(hover.v, 2) }} kW average</template>
        <template v-else>Mean AC power by month and hour ({{ tz }}, standard time)</template>
      </span>
    </div>
    <div class="heat" :style="{ gridTemplateColumns: `36px repeat(${hours.length}, minmax(0, 1fr))` }" @mouseleave="hover = null">
      <span></span>
      <span v-for="h in hours" :key="'h' + h" class="hlabel">{{ h % 3 === 0 ? h : '' }}</span>
      <template v-for="(row, m) in result.profile" :key="m">
        <span class="mlabel">{{ MONTHS[m] }}</span>
        <span
          v-for="h in hours"
          :key="m + '-' + h"
          class="cell"
          :class="{ active: hover && hover.m === m && hover.h === h }"
          :style="{ background: color(row[h]) }"
          :title="`${MONTHS[m]} ${h}:00 — ${fmt(row[h], 2)} kW`"
          @mouseenter="hover = { m, h, v: row[h] }"
        ></span>
      </template>
    </div>
    <div class="legend">
      <span class="muted">0 kW</span>
      <span class="ramp" :style="{ background: `linear-gradient(90deg, ${RAMP.join(',')})` }"></span>
      <span class="muted">{{ fmt(max, 2) }} kW</span>
    </div>
  </section>
</template>

<style scoped>
.heat {
  display: grid;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}
.cell {
  height: 18px;
  border-radius: 3px;
  background-clip: padding-box;
  outline: 1px solid var(--grid);
  outline-offset: -1px;
}
.cell.active {
  outline: 2px solid var(--text-primary);
  outline-offset: 0;
}
.mlabel,
.hlabel {
  font-size: 0.7rem;
  color: var(--text-muted);
}
.mlabel {
  line-height: 18px;
}
.hlabel {
  text-align: center;
}
.legend {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}
.ramp {
  flex: 0 1 180px;
  height: 8px;
  border-radius: 4px;
}
</style>
