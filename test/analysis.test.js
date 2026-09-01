import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeCurtailment,
  calculateExportLimitW,
  choosePollIntervalMs,
  detectLoadStepEvidence,
} from '../src/analysis.js';
import { makeNormalizedSample } from './fixtures.js';

const config = {
  dcPeakW: 14260,
  exportLimitPercent: 60,
  exportLimitW: null,
  polling: { fastMs: 2000, normalMs: 10000, nightMs: 60000 },
  analysis: {
    limitToleranceW: 60,
    nightThresholdW: 50,
    fullSocPercent: 99.5,
    plateauWindowSeconds: 90,
    minimumPlateauSamples: 12,
    loadStepMinimumW: 500,
  },
};

test('calculates the configured 60 percent export limit', () => {
  assert.equal(calculateExportLimitW(config), 8556);
});

test('classifies a single near-limit sample with a full battery as likely evidence', () => {
  const result = analyzeCurtailment(makeNormalizedSample(), [], config);

  assert.equal(result.level, 'LIKELY');
  assert.equal(result.isNearLimit, true);
  assert.equal(result.isBatteryFull, true);
  assert.ok(result.score >= 60 && result.score < 80);
  assert.ok(result.reasons.some((reason) => reason.code === 'EXPORT_AT_LIMIT'));
  assert.ok(result.reasons.some((reason) => reason.code === 'BATTERY_FULL'));
});

test('requires more than an accidental near-limit reading for very likely evidence', () => {
  const recent = Array.from({ length: 12 }, (_, index) => makeNormalizedSample({
    recordedAtMs: Date.parse('2026-09-01T11:20:30Z') + index * 8000,
    gridExportW: 8540 + (index % 3) * 8,
  }));
  const result = analyzeCurtailment(recent.at(-1), recent, config);

  assert.equal(result.level, 'VERY_LIKELY');
  assert.equal(result.hasPlateau, true);
  assert.ok(result.reasons.some((reason) => reason.code === 'EXPORT_PLATEAU'));
});

test('does not report curtailment while well below the limit', () => {
  const result = analyzeCurtailment(makeNormalizedSample({ gridExportW: 6200 }), [], config);

  assert.equal(result.level, 'NOT_DETECTED');
  assert.equal(result.isNearLimit, false);
});

test('recognizes a load step as a verified lower bound for available extra PV power', () => {
  const before = makeNormalizedSample({ pvDcW: 8938, gridExportW: 8556, loadW: 121 });
  const after = makeNormalizedSample({
    recordedAtMs: before.recordedAtMs + 5000,
    pvDcW: 10820,
    gridExportW: 8548,
    loadW: 2120,
  });

  const evidence = detectLoadStepEvidence(before, after, config);

  assert.ok(evidence);
  assert.equal(evidence.type, 'LOAD_STEP');
  assert.equal(evidence.verifiedExtraAvailableW, 1882);
  assert.equal(evidence.claim, 'LOWER_BOUND');
});

test('rejects a load step when export is not held at the configured limit', () => {
  const before = makeNormalizedSample({ gridExportW: 7000, loadW: 100 });
  const after = makeNormalizedSample({ gridExportW: 6900, loadW: 2100, pvDcW: 10800 });

  assert.equal(detectLoadStepEvidence(before, after, config), null);
});

test('uses fast, normal, and night polling intervals adaptively', () => {
  assert.equal(choosePollIntervalMs(makeNormalizedSample({ pvDcW: 10 }), null, config), 60000);
  assert.equal(choosePollIntervalMs(
    makeNormalizedSample({ gridExportW: 5000, batterySocPercent: 50, batteryMode: 'normal' }),
    { isNearLimit: false },
    config,
  ), 10000);
  assert.equal(choosePollIntervalMs(makeNormalizedSample(), { isNearLimit: true }, config), 2000);
});
