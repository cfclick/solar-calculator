import { ref, watch } from 'vue';

/** Animates a number toward its target (eased), respecting reduced-motion. */
export function useCountUp(source, duration = 700) {
  const value = ref(0);
  let raf;
  watch(
    source,
    (to) => {
      cancelAnimationFrame(raf);
      const from = value.value;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(to)) {
        value.value = to;
        return;
      }
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / duration);
        const e = 1 - (1 - t) ** 3;
        value.value = from + (to - from) * e;
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
    { immediate: true }
  );
  return value;
}
