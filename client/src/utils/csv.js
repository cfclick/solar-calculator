// Builds an hourly CSV (local standard time) from the API response and downloads it.
export function downloadHourlyCsv(result) {
  const h = result.hourly;
  const tz = result.location.tzOffsetHours ?? 0;
  const tzLabel = `UTC${tz >= 0 ? '+' : ''}${tz}`;
  const lines = [
    `timestamp_local (${tzLabel}),ghi_w_m2,dni_w_m2,dhi_w_m2,temp_air_c,wind_m_s,poa_w_m2,temp_cell_c,ac_w`,
  ];
  for (let i = 0; i < h.ac.length; i++) {
    const t = new Date(h.start + i * h.stepMs + tz * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    lines.push([t, h.ghi[i], h.dni[i], h.dhi[i], h.tAmb[i], h.wind[i], h.poa[i], h.tCell[i], h.ac[i]].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `solar-hourly-${result.location.lat.toFixed(3)}_${result.location.lon.toFixed(3)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
