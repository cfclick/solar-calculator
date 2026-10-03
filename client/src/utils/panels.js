// Typical current-generation module datasheets by technology (generic, not
// a specific brand). moduleType selects glass reflection and low-light
// behaviour in the engine: AR-coated n-type cells map to "premium".
export const PANEL_PRESETS = [
  { id: 'perc-410', name: 'Mono PERC 410 W', tech: 'Mono PERC, 108 half-cut cells', powerW: 410, lengthMm: 1722, widthMm: 1134, gammaPct: -0.35, moduleType: 'standard' },
  { id: 'topcon-440', name: 'TOPCon 440 W', tech: 'n-type TOPCon, 108 half-cut cells', powerW: 440, lengthMm: 1722, widthMm: 1134, gammaPct: -0.3, moduleType: 'premium' },
  { id: 'hjt-450', name: 'Heterojunction 450 W', tech: 'n-type HJT, 108 half-cut cells', powerW: 450, lengthMm: 1722, widthMm: 1134, gammaPct: -0.26, moduleType: 'premium' },
  { id: 'ibc-460', name: 'Back-contact 460 W', tech: 'n-type back-contact (IBC)', powerW: 460, lengthMm: 1722, widthMm: 1134, gammaPct: -0.29, moduleType: 'premium' },
  { id: 'topcon-580', name: 'TOPCon 580 W (utility)', tech: 'n-type TOPCon, 144 half-cut cells', powerW: 580, lengthMm: 2278, widthMm: 1134, gammaPct: -0.29, moduleType: 'premium' },
  { id: 'cdte-480', name: 'Thin film CdTe 480 W', tech: 'Cadmium telluride (utility)', powerW: 480, lengthMm: 2009, widthMm: 1232, gammaPct: -0.28, moduleType: 'thinfilm' },
];

export const CUSTOM_ID = 'custom';

export function panelEfficiency(p) {
  if (!p.powerW || !p.lengthMm || !p.widthMm) return null;
  return p.powerW / ((p.lengthMm * p.widthMm) / 1e6) / 1000;
}
