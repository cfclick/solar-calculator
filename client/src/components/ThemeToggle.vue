<script setup>
import { ref, watchEffect } from 'vue';
import { Sun, Moon, Monitor } from 'lucide-vue-next';

const KEY = 'solar-calculator:theme';
const OPTIONS = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'system', label: 'System theme', icon: Monitor },
  { value: 'dark', label: 'Dark theme', icon: Moon },
];

let saved = 'system';
try {
  saved = localStorage.getItem(KEY) || 'system';
} catch {
  /* storage unavailable */
}
const mode = ref(saved);

watchEffect(() => {
  const root = document.documentElement;
  if (mode.value === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode.value);
  try {
    localStorage.setItem(KEY, mode.value);
  } catch {
    /* ignore */
  }
});
</script>

<template>
  <div class="toggle" role="group" aria-label="Color theme">
    <button
      v-for="o in OPTIONS"
      :key="o.value"
      type="button"
      :aria-pressed="mode === o.value"
      :aria-label="o.label"
      :title="o.label"
      @click="mode = o.value"
    >
      <component :is="o.icon" />
    </button>
  </div>
</template>

<style scoped>
.toggle {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
button svg {
  width: 15px;
  height: 15px;
}
button:hover {
  color: var(--text-primary);
}
button[aria-pressed='true'] {
  background: var(--surface);
  color: var(--text-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1), 0 0 0 1px var(--border);
}
</style>
