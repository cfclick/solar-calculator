import { reactive, onMounted, onBeforeUnmount } from 'vue';

// Reads the CSS design tokens so Chart.js follows light/dark mode.
const TOKENS = ['series-1', 'series-2', 'series-3', 'text-primary', 'text-secondary', 'text-muted', 'grid', 'axis', 'surface'];

export function useChartTheme() {
  const theme = reactive({});
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    for (const t of TOKENS) theme[t] = cs.getPropertyValue(`--${t}`).trim();
    theme.dark = cs.getPropertyValue('--scheme').trim() === 'dark';
  };
  read();
  let mq;
  let observer;
  onMounted(() => {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', read);
    // The in-app theme toggle sets data-theme on <html>.
    observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });
  onBeforeUnmount(() => {
    mq?.removeEventListener('change', read);
    observer?.disconnect();
  });
  return theme;
}

/** Shared Chart.js options: recessive grid, muted axes, index-mode tooltip. */
export function baseOptions(theme, { yTitle, xTitle, legend = false } = {}) {
  const axis = (title) => ({
    grid: { color: theme.grid, drawTicks: false },
    border: { color: theme.axis },
    ticks: { color: theme['text-muted'], padding: 6, font: { size: 11 } },
    title: title ? { display: true, text: title, color: theme['text-secondary'], font: { size: 11 } } : undefined,
  });
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: legend,
        position: 'top',
        align: 'start',
        labels: { color: theme['text-secondary'], boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 },
      },
      tooltip: {
        backgroundColor: theme.surface,
        titleColor: theme['text-primary'],
        bodyColor: theme['text-secondary'],
        borderColor: theme.axis,
        borderWidth: 1,
        padding: 12,
        boxPadding: 5,
        cornerRadius: 10,
        titleFont: { weight: 600 },
        usePointStyle: true,
      },
    },
    scales: {
      x: { ...axis(xTitle), grid: { display: false } },
      y: { ...axis(yTitle), beginAtZero: true },
    },
  };
}
