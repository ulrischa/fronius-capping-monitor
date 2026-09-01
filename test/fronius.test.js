import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeFroniusResponses } from '../src/fronius.js';
import { makeCommonInverter, makePowerFlow } from './fixtures.js';

test('normalizes Fronius signs into explicit power-flow directions', () => {
  const measurement = normalizeFroniusResponses(
    makePowerFlow(),
    makeCommonInverter(),
    { deviceId: 1, timeZone: 'Europe/Berlin', recordedAtMs: Date.parse('2026-09-01T11:22:17Z') },
  );

  assert.equal(measurement.localDate, '2026-09-01');
  assert.equal(measurement.pvDcW, 8938.05029296875);
  assert.equal(measurement.gridExportW, 8555.9375);
  assert.equal(measurement.gridImportW, 0);
  assert.equal(measurement.loadW, 120.8955078125);
  assert.equal(measurement.batteryChargeW, 6.564971923828125);
  assert.equal(measurement.batteryDischargeW, 0);
  assert.equal(measurement.batterySocPercent, 100);
  assert.equal(measurement.inverterAcW, 8675.4453125);
});

test('calculates both MPPT powers from voltage and current', () => {
  const measurement = normalizeFroniusResponses(
    makePowerFlow(),
    makeCommonInverter(),
    { deviceId: 1, timeZone: 'Europe/Berlin', recordedAtMs: Date.now() },
  );

  assert.ok(Math.abs(measurement.mppt1W - 6451.138) < 0.1);
  assert.ok(Math.abs(measurement.mppt2W - 2486.846) < 0.1);
  assert.ok(Math.abs(measurement.mpptTotalW - measurement.pvDcW) < 1);
});

test('rejects a Fronius response with a non-zero status code', () => {
  const powerFlow = makePowerFlow({ head: { Status: { Code: 255, Reason: 'Solar API disabled' } } });

  assert.throws(
    () => normalizeFroniusResponses(powerFlow, makeCommonInverter(), {
      deviceId: 1,
      timeZone: 'Europe/Berlin',
      recordedAtMs: Date.now(),
    }),
    /Solar API disabled/,
  );
});

test('keeps unavailable optional values as null instead of inventing zero', () => {
  const common = makeCommonInverter({
    data: {
      IDC_2: { Unit: 'A', Value: null },
      UDC_2: { Unit: 'V', Value: null },
    },
  });
  const measurement = normalizeFroniusResponses(makePowerFlow(), common, {
    deviceId: 1,
    timeZone: 'Europe/Berlin',
    recordedAtMs: Date.now(),
  });

  assert.equal(measurement.mppt2VoltageV, null);
  assert.equal(measurement.mppt2CurrentA, null);
  assert.equal(measurement.mppt2W, null);
});
