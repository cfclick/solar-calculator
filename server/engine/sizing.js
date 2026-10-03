// Sizes an array to cover a household's electricity use.

/**
 * Fills a 12-month usage array. Missing months take the mean of the known
 * ones, so a partial history still gives a full year.
 * @param {Array<number|null>} monthlyKwh index 0 = January
 * @returns {{ months: number[], knownMonths: number }}
 */
export function completeUsage(monthlyKwh) {
  const vals = Array.from({ length: 12 }, (_, m) => {
    const v = Number(monthlyKwh?.[m]);
    return monthlyKwh?.[m] !== null && monthlyKwh?.[m] !== '' && Number.isFinite(v) && v >= 0 ? v : null;
  });
  const known = vals.filter((v) => v !== null);
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  return { months: vals.map((v) => (v === null ? mean : v)), knownMonths: known.length };
}

/**
 * @param {object} o {
 *   monthlyKwh: 12 values (null = unknown), yieldMonthly: 12 × kWh per kWp,
 *   offsetPct: share of annual use to cover, panelW: module rating }
 */
export function recommendSize({ monthlyKwh, yieldMonthly, offsetPct = 100, panelW = 440 }) {
  const { months: usage, knownMonths } = completeUsage(monthlyKwh);
  const annualUsage = usage.reduce((a, b) => a + b, 0);
  const specificYield = yieldMonthly.reduce((a, b) => a + b, 0);
  if (!(annualUsage > 0)) throw badRequest('Enter your electricity use (kWh) for at least one month.');
  if (!(specificYield > 0)) throw badRequest('The site produces no energy with this orientation.');

  const offset = Math.min(200, Math.max(10, Number(offsetPct) || 100)) / 100;
  const watts = Math.min(1500, Math.max(10, Number(panelW) || 440));

  const exactKw = (annualUsage * offset) / specificYield;
  const panels = Math.max(1, Math.ceil((exactKw * 1000) / watts));
  const capacityKw = (panels * watts) / 1000;
  const production = yieldMonthly.map((y) => y * capacityKw);
  const annualProduction = production.reduce((a, b) => a + b, 0);

  return {
    annualUsageKwh: Math.round(annualUsage),
    knownMonths,
    targetOffsetPct: Math.round(offset * 100),
    specificYield: round(specificYield, 1),
    exactKw: round(exactKw, 2),
    panels,
    panelW: watts,
    capacityKw: round(capacityKw, 2),
    annualProductionKwh: Math.round(annualProduction),
    offsetPct: round((annualProduction / annualUsage) * 100, 1),
    monthly: usage.map((u, m) => ({
      month: m + 1,
      usageKwh: Math.round(u),
      productionKwh: Math.round(production[m]),
    })),
  };
}

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
