<script setup>
import { computed } from 'vue';
import { Table2 } from 'lucide-vue-next';
import { MONTHS, fmt, pct } from '../utils/format.js';

const props = defineProps({ result: { type: Object, required: true } });
const a = computed(() => props.result.annual);
</script>

<template>
  <section class="card">
    <div class="card-head">
      <h2><span class="ic-chip"><Table2 /></span>Monthly detail</h2>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Month</th>
            <th>GHI kWh/m²</th>
            <th>POA kWh/m²</th>
            <th>DC kWh</th>
            <th>AC kWh</th>
            <th>kWh/day</th>
            <th>PR</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in result.monthly" :key="m.month">
            <td>{{ MONTHS[m.month - 1] }}</td>
            <td>{{ fmt(m.ghi, 1) }}</td>
            <td>{{ fmt(m.poa, 1) }}</td>
            <td>{{ fmt(m.dc) }}</td>
            <td>{{ fmt(m.ac) }}</td>
            <td>{{ fmt(m.acPerDay, 1) }}</td>
            <td>{{ pct(m.performanceRatio) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th>Year</th>
            <th>{{ fmt(a.ghiKwhM2) }}</th>
            <th>{{ fmt(a.poaKwhM2) }}</th>
            <th>{{ fmt(a.dcKwh) }}</th>
            <th>{{ fmt(a.acKwh) }}</th>
            <th>{{ fmt(a.acKwh / 365, 1) }}</th>
            <th>{{ pct(a.performanceRatio) }}</th>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
</template>
