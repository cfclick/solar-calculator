// Lifetime energy and simple economics.

/**
 * @param {number} year1Kwh first-year AC production
 * @param {object} f {
 *   years, degradationPct, systemCost, incentivePct, electricityRate, rateEscalationPct,
 *   omCostPerKwYear, discountRatePct, co2KgPerKwh, capacityKw }
 */
export function lifetimeAnalysis(year1Kwh, f) {
  const years = int(f.years, 1, 50, 25);
  const deg = num(f.degradationPct, 0, 5, 0.5) / 100;
  const cost = num(f.systemCost, 0, 1e9, 0);
  const incentive = num(f.incentivePct, 0, 100, 30) / 100;
  const rate = num(f.electricityRate, 0, 10, 0.17);
  const esc = num(f.rateEscalationPct, -10, 20, 2.5) / 100;
  const om = num(f.omCostPerKwYear, 0, 1000, 15) * num(f.capacityKw, 0, 1e7, 0);
  const disc = num(f.discountRatePct, 0, 30, 5) / 100;
  const co2 = num(f.co2KgPerKwh, 0, 2, 0.37);

  const netCost = cost * (1 - incentive);
  const rows = [];
  let cumulative = -netCost;
  let paybackYears = null;
  let totalKwh = 0;
  let npv = -netCost;
  let discountedKwh = 0;
  let discountedCost = netCost;

  for (let y = 1; y <= years; y++) {
    // Linear degradation from year 1, as warranties are written.
    const kwh = year1Kwh * (1 - deg * (y - 1));
    const price = rate * (1 + esc) ** (y - 1);
    const savings = kwh * price - om;
    const prev = cumulative;
    cumulative += savings;
    if (paybackYears === null && cumulative >= 0 && netCost > 0) {
      paybackYears = y - 1 + (savings > 0 ? -prev / savings : 0);
    }
    const df = (1 + disc) ** y;
    npv += savings / df;
    discountedKwh += kwh / df;
    discountedCost += om / df;
    totalKwh += kwh;
    rows.push({
      year: y,
      kwh: Math.round(kwh),
      price: round(price, 4),
      savings: Math.round(savings),
      cumulative: Math.round(cumulative),
    });
  }

  return {
    years,
    netCost: Math.round(netCost),
    totalKwh: Math.round(totalKwh),
    totalSavings: Math.round(cumulative + netCost),
    paybackYears: paybackYears === null ? null : round(paybackYears, 1),
    npv: Math.round(npv),
    lcoe: discountedKwh > 0 ? round(discountedCost / discountedKwh, 4) : null,
    co2AvoidedTonnes: round((totalKwh * co2) / 1000, 1),
    rows,
  };
}

function num(v, lo, hi, d) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
}
function int(v, lo, hi, d) {
  return Math.round(num(v, lo, hi, d));
}
function round(v, d) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
