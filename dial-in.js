(function (root, factory) {
  const dialIn = factory();
  if (typeof module === 'object' && module.exports) module.exports = dialIn;
  if (root) root.DialIn = dialIn;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Model: ln(time) = c - k * setting + betaD * ln(dose) + drift, where k = +betaS when a
  // higher click number is coarser (faster) and -betaS when it is finer.
  const DEFAULT_CONSTANTS = Object.freeze({ betaS: 0.18, betaD: 2.0, higherIsCoarser: true, toleranceS: 2 });
  const DEFAULT_RECIPE = Object.freeze({ doseG: 18, yieldG: 36, timeS: 28 });
  const DEFAULT_PRESSURE_BAR = 9;
  const MAX_DOSE_TRIM_G = 0.5;
  const MAX_SHOTS = 8;
  const MIN_FIT_ROWS = 6;
  const DEFAULT_RIDGE_LAMBDA = 1e-3;
  const FEATURES = Object.freeze([
    Object.freeze({ key: 'bean_age_days', label: 'Bean age', unit: 'days' }),
    Object.freeze({ key: 'outdoor_humidity_pct', label: 'Humidity', unit: '%' }),
    Object.freeze({ key: 'outdoor_temp_f', label: 'Outdoor temp', unit: '°F' }),
    Object.freeze({ key: 'pressure_bar', label: 'Water pressure', unit: 'bar' })
  ]);

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundTo(value, decimals) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  function withDefaults(constants) {
    return { ...DEFAULT_CONSTANTS, ...(constants || {}) };
  }

  function clickSlope(constants) {
    const { betaS, higherIsCoarser } = withDefaults(constants);
    return higherIsCoarser === false ? -betaS : betaS;
  }

  function roundDose(dose, min, max) {
    let rounded = roundTo(dose, 1);
    if (rounded > max) rounded = Math.floor(max * 10 + 1e-9) / 10;
    if (rounded < min) rounded = Math.ceil(min * 10 - 1e-9) / 10;
    return rounded;
  }

  // Turn a continuous setting into a whole click plus a small dose trim that absorbs the remainder.
  function splitSetting(setting, recipeDoseG, constants) {
    const { betaD } = withDefaults(constants);
    const k = clickSlope(constants);
    const click = Math.round(setting);
    const remainder = setting - click;
    const idealDoseG = recipeDoseG * Math.exp(-(k / betaD) * remainder);
    const min = recipeDoseG - MAX_DOSE_TRIM_G;
    const max = recipeDoseG + MAX_DOSE_TRIM_G;
    const doseG = roundDose(clamp(idealDoseG, min, max), min, max);
    return {
      click: click === 0 ? 0 : click,
      doseG,
      remainder,
      idealDoseG,
      clamped: idealDoseG < min - 1e-9 || idealDoseG > max + 1e-9
    };
  }

  function maxTrimNeeded(recipeDoseG, constants) {
    const { betaS, betaD } = withDefaults(constants);
    return recipeDoseG * Math.abs(betaS) / (2 * betaD);
  }

  // Worst-case shot-time miss when half a click cannot be fully absorbed by the capped dose trim.
  function trimInfo(recipe, constants) {
    const { betaS, betaD } = withDefaults(constants);
    const needed = maxTrimNeeded(recipe.doseG, constants);
    const absorbedClicks = Math.min(0.5, (betaD / Math.abs(betaS)) * Math.log((recipe.doseG + MAX_DOSE_TRIM_G) / recipe.doseG));
    const residualClicks = Math.max(0, 0.5 - absorbedClicks);
    return {
      maxTrimNeededG: needed,
      limitG: MAX_DOSE_TRIM_G,
      exceedsLimit: needed > MAX_DOSE_TRIM_G + 1e-9,
      worstCaseTimeErrorS: recipe.timeS * (Math.exp(Math.abs(betaS) * residualClicks) - 1)
    };
  }

  // Setting that would give the same shot time at the recipe dose.
  function effectiveSetting(shot, recipeDoseG, constants) {
    const { betaD } = withDefaults(constants);
    return shot.click - (betaD / clickSlope(constants)) * Math.log(shot.doseG / recipeDoseG);
  }

  // Setting (at the recipe dose) that would have hit the target time under today's conditions.
  function virtualSetting(shot, recipe, constants) {
    return effectiveSetting(shot, recipe.doseG, constants) +
      Math.log(shot.timeS / recipe.timeS) / clickSlope(constants);
  }

  function isInTolerance(timeS, targetTimeS, toleranceS) {
    return Math.abs(timeS - targetTimeS) <= toleranceS + 1e-9;
  }

  function evaluateShot(shot, recipe, constants) {
    const c = withDefaults(constants);
    const sEff = effectiveSetting(shot, recipe.doseG, c);
    const sVirtual = virtualSetting(shot, recipe, c);
    const deltaS = shot.timeS - recipe.timeS;
    const inTolerance = isInTolerance(shot.timeS, recipe.timeS, c.toleranceS);
    let next = null;
    if (!inTolerance) {
      next = splitSetting(sVirtual, recipe.doseG, c);
      // Never suggest repeating the exact same out-of-tolerance shot (possible when the trim is capped).
      if (next.click === shot.click && Math.abs(next.doseG - shot.doseG) < 0.05) {
        next = { ...next, click: shot.click + Math.sign(sVirtual - sEff), doseG: recipe.doseG, nudged: true };
      }
    }
    return {
      effectiveSetting: sEff,
      virtualSetting: sVirtual,
      deltaS,
      inTolerance,
      direction: inTolerance ? 'ok' : (deltaS > 0 ? 'slow' : 'fast'),
      next
    };
  }

  function featureVector(source) {
    return FEATURES.map(({ key }) => {
      const value = toNumber(source ? source[key] : null);
      if (value === null) return null;
      if (key === 'pressure_bar') return value > 0 ? Math.log(value) : null;
      return value;
    });
  }

  function localDayKey(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  // One row per calendar day (the latest log that day), oldest first.
  function dailyHistory(rows, dayKey = localDayKey) {
    const usable = (rows || [])
      .filter((row) => row && toNumber(row.virtual_setting) !== null && !Number.isNaN(new Date(row.created_at).getTime()))
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const byDay = new Map();
    usable.forEach((row) => {
      const key = dayKey(row.created_at);
      byDay.delete(key);
      byDay.set(key, row);
    });
    return Array.from(byDay.values());
  }

  function sameBean(a, b) {
    const nameA = (a.bean_name || '').trim().toLowerCase();
    const nameB = (b.bean_name || '').trim().toLowerCase();
    return !nameA || !nameB || nameA === nameB;
  }

  // Day-to-day changes in the selected features and in the virtual setting.
  function buildDeltas(days, featureIndexes) {
    const deltas = [];
    for (let i = 1; i < days.length; i += 1) {
      const previous = days[i - 1];
      const current = days[i];
      if (!sameBean(previous, current)) continue;
      const xPrevious = featureVector(previous);
      const xCurrent = featureVector(current);
      if (featureIndexes.some((j) => xPrevious[j] === null || xCurrent[j] === null)) continue;
      deltas.push({
        dx: featureIndexes.map((j) => xCurrent[j] - xPrevious[j]),
        ds: toNumber(current.virtual_setting) - toNumber(previous.virtual_setting)
      });
    }
    return deltas;
  }

  function solveLinearSystem(matrix, vector) {
    const n = vector.length;
    const a = matrix.map((row, i) => [...row, vector[i]]);
    for (let col = 0; col < n; col += 1) {
      let pivot = col;
      for (let row = col + 1; row < n; row += 1) {
        if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
      }
      if (Math.abs(a[pivot][col]) < 1e-12) return null;
      [a[col], a[pivot]] = [a[pivot], a[col]];
      for (let row = 0; row < n; row += 1) {
        if (row === col) continue;
        const factor = a[row][col] / a[col][col];
        for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
      }
    }
    return a.map((row, i) => row[n] / row[i]);
  }

  // Ridge least squares without intercept: w = (XᵀX + λI)⁻¹Xᵀy on RMS-scaled columns.
  // Columns that never change (e.g. constant pressure) get weight 0.
  function ridgeFit(rows, targets, lambda = DEFAULT_RIDGE_LAMBDA) {
    const n = rows.length;
    const p = n > 0 ? rows[0].length : 0;
    const weights = new Array(p).fill(0);
    if (n === 0 || p === 0) return weights;
    const scales = [];
    for (let j = 0; j < p; j += 1) {
      const rms = Math.sqrt(rows.reduce((sum, row) => sum + row[j] * row[j], 0) / n);
      if (rms > 1e-9) scales.push({ j, rms });
    }
    if (scales.length === 0) return weights;
    const m = scales.length;
    const xtx = Array.from({ length: m }, () => new Array(m).fill(0));
    const xty = new Array(m).fill(0);
    rows.forEach((row, i) => {
      const z = scales.map(({ j, rms }) => row[j] / rms);
      for (let a = 0; a < m; a += 1) {
        xty[a] += z[a] * targets[i];
        for (let b = 0; b < m; b += 1) xtx[a][b] += z[a] * z[b];
      }
    });
    for (let a = 0; a < m; a += 1) xtx[a][a] += lambda * n;
    const solution = solveLinearSystem(xtx, xty);
    if (!solution) return weights;
    scales.forEach(({ j, rms }, a) => { weights[j] = solution[a] / rms; });
    return weights;
  }

  function featureDisplayValue(source, key) {
    return toNumber(source ? source[key] : null);
  }

  // Morning prediction: yesterday's virtual setting plus learned drift from today's conditions.
  function predictSetting({ rows, today, recipe, constants, dayKey, lambda } = {}) {
    const days = dailyHistory(rows, dayKey);
    if (days.length === 0) return { hasHistory: false, daysUsed: 0, deltaRows: 0, fitted: false };

    const reference = days[days.length - 1];
    const referenceSetting = toNumber(reference.virtual_setting);
    const xReference = featureVector(reference);
    const xToday = featureVector(today);
    const active = FEATURES.map((_, j) => j).filter((j) => xReference[j] !== null && xToday[j] !== null);
    const deltas = active.length > 0 ? buildDeltas(days, active) : [];
    const fitted = deltas.length >= MIN_FIT_ROWS;
    const activeWeights = fitted
      ? ridgeFit(deltas.map((d) => d.dx), deltas.map((d) => d.ds), lambda)
      : active.map(() => 0);

    const weights = FEATURES.map(() => null);
    const contributions = [];
    let setting = referenceSetting;
    active.forEach((j, a) => {
      const feature = FEATURES[j];
      const clicks = activeWeights[a] * (xToday[j] - xReference[j]);
      weights[j] = activeWeights[a];
      setting += clicks;
      contributions.push({
        key: feature.key,
        label: feature.label,
        unit: feature.unit,
        from: featureDisplayValue(reference, feature.key),
        to: featureDisplayValue(today, feature.key),
        weight: activeWeights[a],
        clicks
      });
    });

    return {
      hasHistory: true,
      reference,
      referenceSetting,
      setting,
      daysUsed: days.length,
      deltaRows: deltas.length,
      fitted,
      minFitRows: MIN_FIT_ROWS,
      weights,
      contributions,
      recommendation: splitSetting(setting, recipe.doseG, constants)
    };
  }

  // Shots that have a time are "pulled"; the last one is the final shot.
  function summarizeShots(shots, recipe, constants) {
    const pulled = (shots || []).filter((shot) => toNumber(shot.timeS) !== null);
    if (pulled.length === 0) return null;
    const last = pulled[pulled.length - 1];
    const evaluation = evaluateShot(last, recipe, constants);
    return {
      shots: pulled.map((shot) => ({ click: shot.click, dose_g: shot.doseG, time_s: shot.timeS })),
      count: pulled.length,
      final: last,
      virtualSetting: evaluation.virtualSetting,
      inTolerance: evaluation.inTolerance
    };
  }

  function beanAgeDays(roastDate, today = new Date()) {
    if (!roastDate) return null;
    const roast = new Date(`${roastDate}T00:00:00`);
    if (Number.isNaN(roast.getTime())) return null;
    const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((current - roast) / 86400000);
  }

  // betaS from two shots one click apart (same dose).
  function measureBetaS(timeA, timeB) {
    const a = toNumber(timeA);
    const b = toNumber(timeB);
    if (!(a > 0) || !(b > 0)) return null;
    return Math.abs(Math.log(a / b));
  }

  // betaD from two shots at the same click with different doses.
  function measureBetaD(time1, dose1, time2, dose2) {
    const t1 = toNumber(time1);
    const t2 = toNumber(time2);
    const d1 = toNumber(dose1);
    const d2 = toNumber(dose2);
    if (!(t1 > 0) || !(t2 > 0) || !(d1 > 0) || !(d2 > 0) || d1 === d2) return null;
    return Math.log(t2 / t1) / Math.log(d2 / d1);
  }

  function parseOpenMeteoCurrent(payload) {
    const current = payload && payload.current;
    if (!current) return null;
    const tempF = toNumber(current.temperature_2m);
    const humidityPct = toNumber(current.relative_humidity_2m);
    if (tempF === null || humidityPct === null) return null;
    return { tempF: roundTo(tempF, 1), humidityPct: Math.round(humidityPct), time: current.time || null };
  }

  return {
    DEFAULT_CONSTANTS,
    DEFAULT_RECIPE,
    DEFAULT_PRESSURE_BAR,
    MAX_DOSE_TRIM_G,
    MAX_SHOTS,
    MIN_FIT_ROWS,
    FEATURES,
    toNumber,
    clickSlope,
    splitSetting,
    maxTrimNeeded,
    trimInfo,
    effectiveSetting,
    virtualSetting,
    isInTolerance,
    evaluateShot,
    featureVector,
    dailyHistory,
    buildDeltas,
    ridgeFit,
    predictSetting,
    summarizeShots,
    beanAgeDays,
    measureBetaS,
    measureBetaD,
    parseOpenMeteoCurrent
  };
});
