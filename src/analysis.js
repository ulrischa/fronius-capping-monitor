export function calculateExportLimitW(config) {
  if (Number.isFinite(config.exportLimitW)) return config.exportLimitW;
  return config.dcPeakW * config.exportLimitPercent / 100;
}

function isBatteryFull(sample, config) {
  const modeSaysFull = sample.batteryMode?.toLowerCase().includes('full') || false;
  const socSaysFull = Number.isFinite(sample.batterySocPercent)
    && sample.batterySocPercent >= config.analysis.fullSocPercent;
  return modeSaysFull || socSaysFull;
}

function isNearLimit(sample, limitW, toleranceW) {
  return Number.isFinite(sample.gridExportW)
    && Math.abs(sample.gridExportW - limitW) <= toleranceW;
}

function detectPlateau(current, recentSamples, limitW, config) {
  const windowMs = config.analysis.plateauWindowSeconds * 1000;
  const samples = recentSamples.filter((sample) => (
    sample.recordedAtMs >= current.recordedAtMs - windowMs
    && sample.recordedAtMs <= current.recordedAtMs
    && Number.isFinite(sample.gridExportW)
  ));

  if (samples.length < config.analysis.minimumPlateauSamples) return false;
  const spanMs = samples.at(-1).recordedAtMs - samples[0].recordedAtMs;
  if (spanMs < windowMs * 0.75) return false;

  const toleranceW = config.analysis.limitToleranceW;
  const nearLimitCount = samples.filter((sample) => isNearLimit(sample, limitW, toleranceW)).length;
  if (nearLimitCount / samples.length < 0.8) return false;

  const exports = samples.map((sample) => sample.gridExportW);
  return Math.max(...exports) - Math.min(...exports) <= toleranceW;
}

function levelForScore(score) {
  if (score >= 80) return 'VERY_LIKELY';
  if (score >= 60) return 'LIKELY';
  if (score >= 40) return 'POSSIBLE';
  return 'NOT_DETECTED';
}

export function analyzeCurtailment(sample, recentSamples, config) {
  const exportLimitW = calculateExportLimitW(config);
  const toleranceW = config.analysis.limitToleranceW;
  const nearLimit = isNearLimit(sample, exportLimitW, toleranceW);
  const batteryFull = isBatteryFull(sample, config);
  const plateau = nearLimit && detectPlateau(sample, recentSamples, exportLimitW, config);
  const reasons = [];
  let score = 0;

  if (nearLimit) {
    score += 45;
    reasons.push({
      code: 'EXPORT_AT_LIMIT',
      label: 'Einspeisung am konfigurierten Limit',
      detail: `Abstand ${Math.round(Math.abs(sample.gridExportW - exportLimitW))} W`,
    });
  }
  if (nearLimit && batteryFull) {
    score += 20;
    reasons.push({
      code: 'BATTERY_FULL',
      label: 'Batterie kann kaum zusätzliche Leistung aufnehmen',
      detail: Number.isFinite(sample.batterySocPercent) ? `${sample.batterySocPercent.toFixed(1)} % SOC` : sample.batteryMode,
    });
  }
  if (plateau) {
    score += 25;
    reasons.push({
      code: 'EXPORT_PLATEAU',
      label: 'Einspeisung bleibt über längere Zeit am Limit',
      detail: `mindestens ${config.analysis.plateauWindowSeconds} s beobachtet`,
    });
  }

  return {
    level: levelForScore(score),
    score,
    exportLimitW,
    distanceToLimitW: exportLimitW - sample.gridExportW,
    isNearLimit: nearLimit,
    isBatteryFull: batteryFull,
    hasPlateau: plateau,
    reasons,
    disclaimer: 'Die Solar API misst keine ungedrosselte Leistung. Die Einstufung ist eine Evidenzbewertung, keine direkte Messung verlorener Energie.',
  };
}

export function detectLoadStepEvidence(before, after, config) {
  if (!before || !after) return null;
  if (after.recordedAtMs <= before.recordedAtMs || after.recordedAtMs - before.recordedAtMs > 30000) return null;

  const limitW = calculateExportLimitW(config);
  const toleranceW = config.analysis.limitToleranceW;
  if (!isNearLimit(before, limitW, toleranceW) || !isNearLimit(after, limitW, toleranceW)) return null;
  if (!isBatteryFull(before, config) || !isBatteryFull(after, config)) return null;

  const loadDeltaW = after.loadW - before.loadW;
  const pvDeltaW = after.pvDcW - before.pvDcW;
  if (loadDeltaW < config.analysis.loadStepMinimumW) return null;
  if (pvDeltaW < loadDeltaW * 0.6) return null;
  if (Math.abs(after.gridExportW - before.gridExportW) > toleranceW) return null;

  return {
    type: 'LOAD_STEP',
    occurredAtMs: after.recordedAtMs,
    verifiedExtraAvailableW: Math.round(Math.min(loadDeltaW, pvDeltaW)),
    loadDeltaW: Math.round(loadDeltaW),
    pvDeltaW: Math.round(pvDeltaW),
    exportDeltaW: Math.round(after.gridExportW - before.gridExportW),
    claim: 'LOWER_BOUND',
    explanation: 'Der zusätzliche Eigenverbrauch wurde bei nahezu gleicher Netzeinspeisung durch zusätzliche PV-Leistung gedeckt.',
  };
}

export function choosePollIntervalMs(sample, analysis, config) {
  if (!Number.isFinite(sample?.pvDcW) || sample.pvDcW < config.analysis.nightThresholdW) {
    return config.polling.nightMs;
  }
  if (analysis?.isNearLimit || sample.batterySocPercent >= config.analysis.fullSocPercent - 1) {
    return config.polling.fastMs;
  }
  return config.polling.normalMs;
}
