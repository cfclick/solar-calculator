<script setup>
import { computed } from 'vue';
import { SunMedium, RotateCcw, Loader2 } from 'lucide-vue-next';

const props = defineProps({
  site: { type: Object, default: null }, // { daily, monthly[], dataset }
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
});
// null = use the site's own value
const override = defineModel({ type: Number, default: null });

const LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isCustom = computed(() => override.value !== null && override.value !== undefined && override.value !== '');
const value = computed({
  get: () => (isCustom.value ? override.value : props.site?.daily ?? ''),
  set: (v) => {
    const n = v === '' || v === null ? null : Number(v);
    override.value = n === null || !Number.isFinite(n) || (props.site && Math.abs(n - props.site.daily) < 0.005) ? null : n;
  },
});
const factor = computed(() => (isCustom.value && props.site?.daily ? override.value / props.site.daily : 1));
const bars = computed(() => {
  const m = props.site?.monthly || [];
  const max = Math.max(...m, 0.01);
  return m.map((v, i) => ({ v: v * factor.value, h: (v / max) * 100, name: NAMES[i], letter: LETTERS[i] }));
});
</script>

<template>
  <div class="sun" :class="{ custom: isCustom }">
    <div class="row">
      <span class="ic-chip sun"><SunMedium /></span>
      <div class="title">
        <strong>Peak sun hours</strong>
        <small v-if="loading"><Loader2 class="spin" /> Looking up this site…</small>
        <small v-else-if="error" class="err">{{ error }}</small>
        <small v-else-if="site && !isCustom">Site average · {{ site.dataset }}</small>
        <small v-else-if="site">Custom · site data says {{ site.daily.toFixed(2) }} h</small>
        <small v-else>Pick a location</small>
      </div>
      <div class="input-unit val">
        <input v-model.lazy.number="value" type="number" min="0.5" max="12" step="any" aria-label="Peak sun hours per day" :disabled="loading && !site" />
        <span>h/day</span>
      </div>
    </div>

    <div v-if="bars.length" class="bars" role="img" :aria-label="`Monthly sun hours: ${bars.map((b) => `${b.name} ${b.v.toFixed(1)}`).join(', ')}`">
      <div v-for="b in bars" :key="b.name" class="bar" :title="`${b.name}: ${b.v.toFixed(2)} h/day`">
        <span class="fill" :style="{ height: `${Math.max(4, b.h)}%` }"></span>
        <span class="lbl">{{ b.letter }}</span>
      </div>
    </div>

    <div class="foot">
      <span class="muted">Daily solar energy on flat ground, in hours of full 1,000 W/m² sun.</span>
      <button v-if="isCustom" type="button" class="reset" @click="override = null"><RotateCcw />Use site value</button>
    </div>
  </div>
</template>

<style scoped>
.sun {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius);
  background: var(--surface-2);
  border: 1px solid var(--border);
  transition: border-color 0.2s, background 0.2s;
}
.sun.custom {
  border-color: var(--sun-2);
  background: var(--sun-soft);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.title strong {
  font-size: 0.84rem;
}
.title small {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.title small svg {
  width: 12px;
  height: 12px;
}
.title .err {
  color: var(--critical);
  white-space: normal;
}
.val {
  width: 108px;
  flex: none;
}
.val input {
  height: 36px;
  font-weight: 650;
  text-align: right;
  padding-right: 48px;
  background: var(--surface);
}
.bars {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 3px;
  height: 52px;
}
.bar {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 3px;
  min-width: 0;
}
.fill {
  width: 100%;
  border-radius: 3px 3px 1px 1px;
  background: linear-gradient(to top, var(--sun-2), var(--sun-1));
  opacity: 0.85;
  transition: height 0.3s var(--ease);
}
.bar:hover .fill {
  opacity: 1;
}
.lbl {
  font-size: 0.62rem;
  color: var(--text-muted);
  line-height: 1;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.foot .muted {
  font-size: 0.7rem;
  line-height: 1.35;
}
.reset {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  color: var(--sun-ink);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 6px;
}
.reset:hover {
  background: var(--surface);
}
.reset svg {
  width: 12px;
  height: 12px;
}
</style>
