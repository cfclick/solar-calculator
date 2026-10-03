import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendSize, completeUsage } from '../server/engine/sizing.js';
import { deriveUsage } from '../server/services/billReader.js';

const flatYield = new Array(12).fill(1500 / 12); // 1500 kWh/kWp/yr

test('sizes to cover annual use and rounds up to whole panels', () => {
  const r = recommendSize({ monthlyKwh: new Array(12).fill(750), yieldMonthly: flatYield, offsetPct: 100, panelW: 400 });
  assert.equal(r.annualUsageKwh, 9000);
  assert.equal(r.exactKw, 6); // 9000 / 1500
  assert.equal(r.panels, 15); // 6000 W / 400 W
  assert.equal(r.capacityKw, 6);
  assert.equal(r.offsetPct, 100);
});

test('a partial panel rounds up, so the offset lands at or above target', () => {
  const r = recommendSize({ monthlyKwh: new Array(12).fill(700), yieldMonthly: flatYield, offsetPct: 100, panelW: 440 });
  assert.equal(r.panels, Math.ceil((8400 / 1500) * 1000 / 440));
  assert.ok(r.offsetPct >= 100 && r.offsetPct < 100 + (440 / 1000) * 1500 / 8400 * 100);
});

test('offset target scales the system', () => {
  const full = recommendSize({ monthlyKwh: new Array(12).fill(1000), yieldMonthly: flatYield, offsetPct: 100, panelW: 100 });
  const half = recommendSize({ monthlyKwh: new Array(12).fill(1000), yieldMonthly: flatYield, offsetPct: 50, panelW: 100 });
  assert.equal(half.panels * 2, full.panels);
});

test('missing months take the mean of the known ones', () => {
  const { months, knownMonths } = completeUsage([100, 300, null, '', undefined]);
  assert.equal(knownMonths, 2);
  assert.deepEqual(months.slice(0, 4), [100, 300, 200, 200]);
  assert.equal(months.length, 12);
});

test('no usage is rejected', () => {
  assert.throws(() => recommendSize({ monthlyKwh: [], yieldMonthly: flatYield }), /electricity use/);
});

test('bill history maps to calendar months, latest reading wins', () => {
  const { monthlyKwh, effectiveRate } = deriveUsage({
    periodKwh: 500,
    totalAmount: 125,
    history: [
      { month: '2025-09', kwh: 410 },
      { month: '2024-09', kwh: 380 },
      { month: '2025-01', kwh: 620.4 },
      { month: 'bogus', kwh: 1 },
    ],
  });
  assert.equal(monthlyKwh[8], 410);
  assert.equal(monthlyKwh[0], 620);
  assert.equal(monthlyKwh.filter((v) => v !== null).length, 2);
  assert.equal(effectiveRate, 0.25);
});

test('a bill without history spreads the period over its end month', () => {
  const { monthlyKwh } = deriveUsage({ periodKwh: 600, billingDays: 30, billingPeriodEnd: '2026-03-15', history: [] });
  assert.equal(monthlyKwh[2], 620); // 20 kWh/day × 31 days
  assert.equal(monthlyKwh.filter((v) => v !== null).length, 1);
});
