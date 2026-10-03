import { createApp } from 'vue';
import { Chart } from 'chart.js/auto';
import '@fontsource-variable/inter';
import 'leaflet/dist/leaflet.css';
import './style.css';
import App from './App.vue';

Chart.defaults.font.family = "'Inter Variable', system-ui, sans-serif";

createApp(App).mount('#app');
