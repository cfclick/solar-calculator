<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import L from 'leaflet';
import { Search, ArrowRight, Loader2, MapPin } from 'lucide-vue-next';
import { api } from '../api.js';

const lat = defineModel('lat', { type: Number, required: true });
const lon = defineModel('lon', { type: Number, required: true });
const label = defineModel('label', { type: String, default: '' });

const mapEl = ref(null);
const query = ref('');
const results = ref([]);
const searching = ref(false);
const searchError = ref('');
let map;
let marker;

onMounted(() => {
  map = L.map(mapEl.value, { zoomControl: true, attributionControl: true }).setView([lat.value, lon.value], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  marker = L.circleMarker([lat.value, lon.value], {
    radius: 8,
    color: '#ffffff',
    weight: 2,
    fillColor: '#eb6834',
    fillOpacity: 1,
  }).addTo(map);
  map.on('click', (e) => {
    lat.value = round(e.latlng.lat);
    lon.value = round(wrapLon(e.latlng.lng));
    label.value = '';
  });
});

onBeforeUnmount(() => map?.remove());

watch([lat, lon], ([a, b]) => {
  if (!map || !Number.isFinite(a) || !Number.isFinite(b)) return;
  marker.setLatLng([a, b]);
  if (!map.getBounds().contains([a, b])) map.panTo([a, b]);
});

async function search() {
  if (query.value.trim().length < 2) return;
  searching.value = true;
  searchError.value = '';
  try {
    results.value = await api.geocode(query.value);
    if (!results.value.length) searchError.value = 'No matches found.';
  } catch (e) {
    searchError.value = e.message;
  } finally {
    searching.value = false;
  }
}

function pick(r) {
  lat.value = round(r.lat);
  lon.value = round(r.lon);
  label.value = r.name;
  results.value = [];
  map.setView([r.lat, r.lon], 15);
}

const round = (v) => Math.round(v * 10000) / 10000;
const wrapLon = (v) => ((((v + 180) % 360) + 360) % 360) - 180;
</script>

<template>
  <div class="loc">
    <form class="search" @submit.prevent="search" role="search">
      <div class="search-box">
        <Search class="search-ic" />
        <input v-model="query" type="search" placeholder="Search address or place" aria-label="Search address" />
        <button class="go" type="submit" :disabled="searching" aria-label="Search">
          <Loader2 v-if="searching" class="spin" />
          <ArrowRight v-else />
        </button>
      </div>
      <ul v-if="results.length" class="results">
        <li v-for="r in results" :key="r.name + r.lat">
          <button type="button" @click="pick(r)"><MapPin class="pin" />{{ r.name }}</button>
        </li>
      </ul>
    </form>
    <p v-if="searchError" class="muted">{{ searchError }}</p>
    <div class="map-wrap">
      <div ref="mapEl" class="map" aria-label="Map: click to set the site location"></div>
      <div class="coords">
        <MapPin />
        <span>{{ Number(lat || 0).toFixed(4) }}, {{ Number(lon || 0).toFixed(4) }}</span>
      </div>
    </div>
    <p class="place" :title="label">{{ label || 'Click the map to place the array' }}</p>
    <details class="manual">
      <summary>Enter coordinates</summary>
      <div class="grid-2">
        <label class="field">Latitude<input v-model.number="lat" type="number" step="0.0001" min="-90" max="90" /></label>
        <label class="field">Longitude<input v-model.number="lon" type="number" step="0.0001" min="-180" max="180" /></label>
      </div>
    </details>
  </div>
</template>

<style scoped>
.loc {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.search {
  position: relative;
}
.search-box {
  position: relative;
}
.search-box input {
  padding-left: 36px;
  padding-right: 44px;
  height: 42px;
  border-radius: var(--radius);
}
.search-ic {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  pointer-events: none;
}
.go {
  position: absolute;
  right: 5px;
  top: 5px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: var(--ink-btn);
  color: var(--ink-btn-text);
  cursor: pointer;
}
.go svg {
  width: 15px;
  height: 15px;
}
.results {
  position: absolute;
  z-index: 1000;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  list-style: none;
  margin: 0;
  padding: 4px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  max-height: 240px;
  overflow: auto;
}
.results button {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font-size: 0.8rem;
  line-height: 1.35;
}
.results button:hover {
  background: var(--surface-2);
}
.pin {
  flex: none;
  width: 14px;
  height: 14px;
  margin-top: 2px;
  color: var(--text-muted);
}
.map-wrap {
  position: relative;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--border);
}
.map {
  height: 210px;
  z-index: 0;
}
.coords {
  position: absolute;
  left: 8px;
  bottom: 8px;
  z-index: 500;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--surface-glass);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  font-size: 0.72rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.coords svg {
  width: 12px;
  height: 12px;
  color: var(--series-2);
}
.place {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
p {
  margin: 0;
}
.manual summary {
  cursor: pointer;
  font-size: 0.76rem;
  color: var(--text-muted);
  font-weight: 500;
  margin-bottom: 8px;
}
.manual summary:hover {
  color: var(--text-primary);
}
:deep(.leaflet-control-attribution) {
  font-size: 9px;
  background: var(--surface-glass) !important;
  color: var(--text-muted);
}
:deep(.leaflet-bar a) {
  background: var(--surface);
  color: var(--text-primary);
  border-color: var(--border);
}
</style>
