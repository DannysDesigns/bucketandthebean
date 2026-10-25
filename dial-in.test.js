const assert = require('node:assert/strict');
const test = require('node:test');
const DialIn = require('./dial-in.js');

const recipe = { doseG: 18, yieldG: 36, timeS: 28 };
const constants = { betaS: 0.18, betaD: 2, higherIsCoarser: true, toleranceS: 2 };

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

// Shot time implied by the model for a shot pulled when the true virtual setting is `trueSetting`.
function modelTime(shot, trueSetting, c = constants) {
  const k = DialIn.clickSlope(c);
  return recipe.timeS * Math.exp(-k * (DialIn.effectiveSetting(shot, recipe.doseG, c) - trueSetting));
}

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

test('split rounds to the nearest click and trims dose to absorb the remainder', () => {
  const finerRounded = DialIn.splitSetting(14.3, 18, constants);
  assert.equal(finerRounded.click, 14);
  close(finerRounded.remainder, 0.3, 1e-12);
  assert.equal(finerRounded.doseG, 17.5);

  const coarserRounded = DialIn.splitSetting(13.8, 18, constants);
  assert.equal(coarserRounded.click, 14);
  assert.equal(coarserRounded.doseG, 18.3, 'rounding coarser should add dose to slow the shot');
  assert.equal(coarserRounded.clamped, false);

  const exact = DialIn.splitSetting(15, 18, constants);
  assert.deepEqual([exact.click, exact.doseG], [15, 18]);
});

test('split clamps the dose trim to ±0.5 g', () => {
  const steep = { ...constants, betaS: 0.4, betaD: 1 };
  const coarser = DialIn.splitSetting(13.5, 18, steep);
  assert.equal(coarser.click, 14);
  assert.equal(coarser.doseG, 18.5);
  assert.equal(coarser.clamped, true);

  const finer = DialIn.splitSetting(14.45, 18, steep);
  assert.equal(finer.click, 14);
  assert.equal(finer.doseG, 17.5);
  assert.equal(finer.clamped, true);
});

test('split flips the trim direction when a higher click number is finer', () => {
  const flipped = { ...constants, higherIsCoarser: false };
  const split = DialIn.splitSetting(13.8, 18, flipped);
  assert.equal(split.click, 14);
  assert.equal(split.doseG, 17.7, 'rounding finer (higher number) should remove dose');
});

test('reports the dose trim a half click would need', () => {
  close(DialIn.maxTrimNeeded(18, constants), 0.81);
  const info = DialIn.trimInfo(recipe, constants);
  assert.equal(info.exceedsLimit, true);
  assert.ok(info.worstCaseTimeErrorS > 0.9 && info.worstCaseTimeErrorS < 1.1);
  assert.equal(DialIn.trimInfo(recipe, { ...constants, betaS: 0.1 }).exceedsLimit, false);
});

test('computes effective and virtual settings', () => {
  const onTarget = { click: 14, doseG: 18, timeS: 28 };
  close(DialIn.effectiveSetting(onTarget, 18, constants), 14);
  close(DialIn.virtualSetting(onTarget, recipe, constants), 14);

  const heavySlow = { click: 14, doseG: 18.5, timeS: 33 };
  const sEff = 14 - (2 / 0.18) * Math.log(18.5 / 18);
  close(DialIn.effectiveSetting(heavySlow, 18, constants), sEff);
  close(DialIn.virtualSetting(heavySlow, recipe, constants), sEff + Math.log(33 / 28) / 0.18);
  assert.ok(DialIn.virtualSetting(heavySlow, recipe, constants) > 14, 'slow shot should point coarser');

  const flipped = { ...constants, higherIsCoarser: false };
  assert.ok(DialIn.virtualSetting({ click: 14, doseG: 18, timeS: 33 }, recipe, flipped) < 14,
    'slow shot should point to a lower (coarser) number when higher is finer');
});

test('checks the time tolerance inclusively', () => {
  assert.equal(DialIn.evaluateShot({ click: 14, doseG: 18, timeS: 30 }, recipe, constants).inTolerance, true);
  assert.equal(DialIn.evaluateShot({ click: 14, doseG: 18, timeS: 26 }, recipe, constants).inTolerance, true);
  const slow = DialIn.evaluateShot({ click: 14, doseG: 18, timeS: 30.5 }, recipe, constants);
  assert.equal(slow.inTolerance, false);
  assert.equal(slow.direction, 'slow');
  assert.equal(DialIn.evaluateShot({ click: 14, doseG: 18, timeS: 22 }, recipe, constants).direction, 'fast');
  assert.equal(DialIn.evaluateShot({ click: 14, doseG: 18, timeS: 29 }, recipe, constants).next, null);
});

test('the recommended next shot lands within tolerance under the model', () => {
  [true, false].forEach((higherIsCoarser) => {
    const c = { ...constants, higherIsCoarser };
    [11.2, 13.49, 14.5, 16.77].forEach((trueSetting) => {
      const first = { click: 14, doseG: 18 };
      const pulled = { ...first, timeS: modelTime(first, trueSetting, c) };
      const evaluation = DialIn.evaluateShot(pulled, recipe, c);
      close(evaluation.virtualSetting, trueSetting, 1e-9);
      if (evaluation.inTolerance) return;
      const next = { click: evaluation.next.click, doseG: evaluation.next.doseG };
      const nextTime = modelTime(next, trueSetting, c);
      assert.ok(Math.abs(nextTime - recipe.timeS) <= c.toleranceS, `${trueSetting}: ${nextTime}s`);
    });
  });
});

test('never recommends repeating the same out-of-tolerance shot', () => {
  const steep = { ...constants, betaS: 0.4, betaD: 1, toleranceS: 0.1 };
  const shot = { click: 14, doseG: 18.5, timeS: 27 };
  assert.deepEqual(
    [DialIn.splitSetting(DialIn.virtualSetting(shot, recipe, steep), 18, steep).click,
      DialIn.splitSetting(DialIn.virtualSetting(shot, recipe, steep), 18, steep).doseG],
    [14, 18.5],
    'the capped trim alone would repeat the same shot'
  );
  const evaluation = DialIn.evaluateShot(shot, recipe, steep);
  assert.equal(evaluation.direction, 'fast');
  assert.equal(evaluation.next.nudged, true);
  assert.deepEqual([evaluation.next.click, evaluation.next.doseG], [13, 18]);

  const flipped = DialIn.evaluateShot(shot, recipe, { ...steep, higherIsCoarser: false });
  assert.notDeepEqual([flipped.next.click, flipped.next.doseG], [shot.click, shot.doseG]);
});

test('ridge fit recovers known weights from synthetic data', () => {
  const random = seededRandom(42);
  const trueWeights = [-0.05, 0.02, -0.03, 1.5];
  const rows = [];
  const targets = [];
  for (let i = 0; i < 30; i += 1) {
    const dx = [1 + Math.floor(random() * 3), (random() - 0.5) * 30, (random() - 0.5) * 20, (random() - 0.5) * 0.2];
    rows.push(dx);
    targets.push(dx.reduce((sum, value, j) => sum + value * trueWeights[j], 0));
  }
  const weights = DialIn.ridgeFit(rows, targets);
  weights.forEach((weight, j) => close(weight, trueWeights[j], Math.abs(trueWeights[j]) * 0.02));
});

test('ridge fit gives zero weight to features that never change', () => {
  const rows = [[1, 0], [2, 0], [1, 0], [3, 0], [1, 0], [2, 0]];
  const targets = rows.map(([a]) => -0.1 * a);
  const weights = DialIn.ridgeFit(rows, targets);
  close(weights[0], -0.1, 1e-3);
  assert.equal(weights[1], 0);
});

function syntheticHistory(days, trueWeights, base = 14) {
  const random = seededRandom(7);
  const rows = [];
  for (let i = 0; i < days; i += 1) {
    const features = {
      bean_age_days: 5 + i,
      outdoor_humidity_pct: Math.round(40 + random() * 50),
      outdoor_temp_f: Math.round((40 + random() * 40) * 10) / 10,
      pressure_bar: 9
    };
    const x = DialIn.featureVector(features);
    const setting = base + x.reduce((sum, value, j) => sum + value * trueWeights[j], 0);
    rows.push({
      created_at: new Date(Date.UTC(2026, 9, 1 + i, 12)).toISOString(),
      bean_name: 'House',
      ...features,
      virtual_setting: setting
    });
  }
  return rows;
}

test('morning prediction uses the fitted drift weights and splits the result', () => {
  const trueWeights = [-0.04, 0.03, -0.02, 0];
  const rows = syntheticHistory(14, trueWeights);
  const reference = rows[rows.length - 1];
  const today = { bean_age_days: reference.bean_age_days + 1, outdoor_humidity_pct: 95, outdoor_temp_f: 30, pressure_bar: 9 };
  const prediction = DialIn.predictSetting({ rows: rows.slice().reverse(), today, recipe, constants });
  const expected = reference.virtual_setting +
    trueWeights[0] * 1 +
    trueWeights[1] * (95 - reference.outdoor_humidity_pct) +
    trueWeights[2] * (30 - reference.outdoor_temp_f);

  assert.equal(prediction.hasHistory, true);
  assert.equal(prediction.fitted, true);
  assert.equal(prediction.daysUsed, 14);
  assert.equal(prediction.deltaRows, 13);
  close(prediction.setting, expected, 0.02);
  assert.equal(prediction.weights[3], 0);
  const humidity = prediction.contributions.find((item) => item.key === 'outdoor_humidity_pct');
  close(humidity.clicks, trueWeights[1] * (95 - reference.outdoor_humidity_pct), 0.02);
  assert.deepEqual(prediction.recommendation, DialIn.splitSetting(prediction.setting, recipe.doseG, constants));
});

test('morning prediction falls back to the latest setting without enough history', () => {
  const none = DialIn.predictSetting({ rows: [], today: {}, recipe, constants });
  assert.equal(none.hasHistory, false);

  const rows = syntheticHistory(5, [-0.04, 0.03, -0.02, 0]);
  const today = { bean_age_days: 40, outdoor_humidity_pct: 99, outdoor_temp_f: 10, pressure_bar: 9 };
  const prediction = DialIn.predictSetting({ rows, today, recipe, constants });
  assert.equal(prediction.fitted, false);
  assert.equal(prediction.deltaRows, 4);
  close(prediction.setting, rows[rows.length - 1].virtual_setting);
  assert.ok(prediction.contributions.every((item) => item.clicks === 0));
});

test('history keeps the latest log per day and skips bean changes', () => {
  const rows = [
    { created_at: '2026-10-01T12:00:00Z', virtual_setting: 10, bean_name: 'House' },
    { created_at: '2026-10-01T15:00:00Z', virtual_setting: 11, bean_name: 'House' },
    { created_at: '2026-10-02T12:00:00Z', virtual_setting: 12, bean_name: 'Guest' },
    { created_at: '2026-10-03T12:00:00Z', virtual_setting: 13, bean_name: 'guest ' }
  ].map((row) => ({ ...row, bean_age_days: 3, outdoor_humidity_pct: 50, outdoor_temp_f: 60, pressure_bar: 9 }));
  const days = DialIn.dailyHistory(rows);
  assert.deepEqual(days.map((row) => row.virtual_setting), [11, 12, 13]);
  const deltas = DialIn.buildDeltas(days, [0, 1, 2, 3]);
  assert.deepEqual(deltas.map((delta) => delta.ds), [1]);
});

test('only uses features known for both today and the reference day', () => {
  const rows = syntheticHistory(10, [0, 0.03, 0, 0]).map((row) => ({ ...row, bean_age_days: null }));
  const today = { bean_age_days: 12, outdoor_humidity_pct: 80, outdoor_temp_f: 50, pressure_bar: 9 };
  const prediction = DialIn.predictSetting({ rows, today, recipe, constants });
  assert.equal(prediction.fitted, true);
  assert.equal(prediction.weights[0], null);
  assert.ok(!prediction.contributions.some((item) => item.key === 'bean_age_days'));
});

test('summarizes pulled shots and uses the last one as final', () => {
  const summary = DialIn.summarizeShots([
    { click: 14, doseG: 18, timeS: 24 },
    { click: 13, doseG: 18.2, timeS: 28.5 },
    { click: 13, doseG: 18.2, timeS: null }
  ], recipe, constants);
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.final, { click: 13, doseG: 18.2, timeS: 28.5 });
  assert.deepEqual(summary.shots[0], { click: 14, dose_g: 18, time_s: 24 });
  assert.equal(summary.inTolerance, true);
  assert.equal(DialIn.summarizeShots([{ click: 14, doseG: 18, timeS: '' }], recipe, constants), null);
});

test('helpers compute bean age, measured betas, and weather', () => {
  assert.equal(DialIn.beanAgeDays('2026-10-15', new Date(2026, 9, 25, 7, 30)), 10);
  assert.equal(DialIn.beanAgeDays('', new Date()), null);
  close(DialIn.measureBetaS(25, 30), Math.log(30 / 25));
  close(DialIn.measureBetaD(26, 17.5, 30, 18.5), Math.log(30 / 26) / Math.log(18.5 / 17.5));
  assert.equal(DialIn.measureBetaD(26, 18, 30, 18), null);
  assert.deepEqual(
    DialIn.parseOpenMeteoCurrent({ current: { time: '2026-10-25T07:45', temperature_2m: 51.26, relative_humidity_2m: 81.4 } }),
    { tempF: 51.3, humidityPct: 81, time: '2026-10-25T07:45' }
  );
  assert.equal(DialIn.parseOpenMeteoCurrent({}), null);
});
