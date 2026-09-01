import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MonitorDatabase } from '../src/database.js';
import { makeNormalizedSample } from './fixtures.js';

test('stores measurements, durations, summaries, chart peaks, and evidence events', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fronius-db-'));
  const databasePath = path.join(directory, 'monitor.sqlite');
  const database = new MonitorDatabase(databasePath);
  context.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const first = makeNormalizedSample({
    recordedAtMs: Date.parse('2026-09-01T11:22:00Z'),
    pvDcW: 9000,
    gridExportW: 8550,
  });
  const second = makeNormalizedSample({
    recordedAtMs: first.recordedAtMs + 5000,
    pvDcW: 10442,
    gridExportW: 8558,
    mppt1W: 7960,
    mppt2W: 2470,
  });

  database.insertMeasurement(first, {
    level: 'LIKELY', score: 65, isNearLimit: true, hasPlateau: false, reasons: [],
  });
  database.insertMeasurement(second, {
    level: 'VERY_LIKELY', score: 90, isNearLimit: true, hasPlateau: true, reasons: [],
  });
  database.insertEvent({
    type: 'LOAD_STEP',
    occurredAtMs: second.recordedAtMs,
    verifiedExtraAvailableW: 1882,
    loadDeltaW: 1999,
    pvDeltaW: 1882,
    exportDeltaW: -8,
    claim: 'LOWER_BOUND',
    explanation: 'Verified response',
  }, second.localDate);

  assert.equal(database.getLatestMeasurement().pvDcW, 10442);
  assert.equal(database.getRecentSamples(first.recordedAtMs).length, 2);

  const summary = database.getDaySummary('2026-09-01');
  assert.equal(summary.maximumPvDcW, 10442);
  assert.equal(summary.maximumGridExportW, 8558);
  assert.equal(summary.maximumMppt1W, 7960);
  assert.equal(summary.nearLimitDurationMs, 5000);
  assert.equal(summary.verifiedExtraAvailableW, 1882);

  const chart = database.getChartBuckets('2026-09-01', 100);
  assert.equal(chart.length, 1);
  assert.equal(chart[0].maximumPvDcW, 10442);
  assert.equal(chart[0].averagePvDcW, 9721);
  assert.equal(chart[0].averageMppt1W, 7205.5);
  assert.equal(chart[0].maximumMppt1W, 7960);

  const events = database.getEvents('2026-09-01');
  assert.equal(events.length, 1);
  assert.equal(events[0].verifiedExtraAvailableW, 1882);
});

test('compacts old raw measurements into minute aggregates without changing the summary', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fronius-compact-'));
  const database = new MonitorDatabase(path.join(directory, 'monitor.sqlite'));
  context.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const start = Date.parse('2026-08-15T10:00:00Z');
  for (let index = 0; index < 3; index += 1) {
    database.insertMeasurement(makeNormalizedSample({
      recordedAtMs: start + index * 10000,
      localDate: '2026-08-15',
      pvDcW: 8000 + index * 1000,
      gridExportW: 7000 + index * 500,
    }), {
      level: index === 2 ? 'LIKELY' : 'NOT_DETECTED',
      score: index === 2 ? 65 : 0,
      isNearLimit: index === 2,
      hasPlateau: false,
      reasons: [],
    });
  }

  const before = database.getDaySummary('2026-08-15');
  const result = database.compactBefore(start + 60000);
  const after = database.getDaySummary('2026-08-15');

  assert.equal(result.rawRowsDeleted, 3);
  assert.equal(database.getRecentSamples(start).length, 0);
  assert.equal(after.maximumPvDcW, before.maximumPvDcW);
  assert.equal(after.maximumGridExportW, before.maximumGridExportW);
  assert.equal(after.likelyDurationMs, before.likelyDurationMs);
  const chart = database.getChartBuckets('2026-08-15', 100);
  assert.equal(chart[0].maximumPvDcW, 10000);
  assert.equal(chart[0].averageMppt1W, 6451);
});

test('rolls back duration updates when a measurement insert fails', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fronius-rollback-'));
  const database = new MonitorDatabase(path.join(directory, 'monitor.sqlite'));
  context.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const first = makeNormalizedSample({
    recordedAtMs: Date.parse('2026-09-01T11:22:00Z'),
  });
  database.insertMeasurement(first, {
    level: 'LIKELY', score: 65, isNearLimit: true, hasPlateau: false, reasons: [],
  });

  const invalidAnalysis = {
    level: null, score: 65, isNearLimit: true, hasPlateau: false, reasons: [],
  };
  assert.throws(
    () => database.insertMeasurement(makeNormalizedSample({
      recordedAtMs: first.recordedAtMs + 5000,
    }), invalidAnalysis),
    /NOT NULL constraint failed/,
  );

  const summary = database.getDaySummary(first.localDate);
  assert.equal(summary.sampleCount, 1);
  assert.equal(summary.nearLimitDurationMs, 0);
});
