import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Collector } from '../src/collector.js';
import { MonitorDatabase } from '../src/database.js';
import { FroniusClient } from '../src/fronius.js';
import { createMonitorServer } from '../src/server.js';
import { makeCommonInverter, makePowerFlow } from './fixtures.js';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('collects from both Fronius endpoints and exposes bounded read-only API data', async (context) => {
  let froniusRequestCount = 0;
  const fakeFronius = http.createServer((request, response) => {
    froniusRequestCount += 1;
    response.setHeader('Content-Type', 'application/json');
    if (request.url.startsWith('/solar_api/v1/GetPowerFlowRealtimeData.fcgi')) {
      response.end(JSON.stringify(makePowerFlow()));
      return;
    }
    if (request.url.startsWith('/solar_api/v1/GetInverterRealtimeData.cgi')) {
      response.end(JSON.stringify(makeCommonInverter()));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await listen(fakeFronius);
  context.after(() => close(fakeFronius));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fronius-integration-'));
  const database = new MonitorDatabase(path.join(directory, 'monitor.sqlite'));
  context.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const froniusPort = fakeFronius.address().port;
  const config = {
    froniusHost: `127.0.0.1:${froniusPort}`,
    deviceId: 1,
    dcPeakW: 14260,
    exportLimitPercent: 60,
    exportLimitW: null,
    port: 3200,
    bindAddress: '127.0.0.1',
    timeZone: 'Europe/Berlin',
    polling: { fastMs: 2000, normalMs: 10000, nightMs: 60000, requestTimeoutMs: 2000 },
    analysis: {
      limitToleranceW: 60,
      nightThresholdW: 50,
      fullSocPercent: 99.5,
      plateauWindowSeconds: 90,
      minimumPlateauSamples: 12,
      loadStepMinimumW: 500,
    },
    retention: { rawDays: 14, maintenanceIntervalMinutes: 60 },
  };
  const collector = new Collector({ config, database, froniusClient: new FroniusClient(config) });

  const result = await collector.sampleOnce(Date.parse('2026-09-01T11:22:17Z'));
  assert.equal(froniusRequestCount, 2);
  assert.equal(result.measurement.gridExportW, 8555.9375);
  assert.equal(result.analysis.level, 'LIKELY');

  const monitorServer = createMonitorServer({ config, database, collector });
  await listen(monitorServer);
  context.after(() => close(monitorServer));
  const baseUrl = `http://127.0.0.1:${monitorServer.address().port}`;

  const statusResponse = await fetch(`${baseUrl}/api/v1/status`);
  const status = await statusResponse.json();
  assert.equal(statusResponse.status, 200);
  assert.equal(status.measurement.pvDcW, 8938.05029296875);
  assert.equal(status.analysis.exportLimitW, 8556);
  assert.equal(status.configuredLimits.dcPeakW, 14260);
  assert.equal('froniusHost' in status, false);
  assert.match(statusResponse.headers.get('content-security-policy'), /default-src 'self'/);

  const pageResponse = await fetch(`${baseUrl}/`);
  const page = await pageResponse.text();
  assert.equal(pageResponse.status, 200);
  assert.match(page, /<h1>Fronius Curtailment Monitor<\/h1>/);
  assert.equal(pageResponse.headers.get('x-frame-options'), 'DENY');

  const chartResponse = await fetch(`${baseUrl}/api/v1/measurements?date=2026-09-01&maxPoints=500`);
  const chart = await chartResponse.json();
  assert.equal(chart.data.length, 1);
  assert.equal(chart.data[0].maximumPvDcW, 8938.05029296875);

  const invalidResponse = await fetch(`${baseUrl}/api/v1/measurements?date=not-a-date`);
  const invalid = await invalidResponse.json();
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalid.error.code, 'INVALID_QUERY');

  const postResponse = await fetch(`${baseUrl}/api/v1/status`, { method: 'POST' });
  assert.equal(postResponse.status, 405);
});

test('records collector failures without deleting the last valid measurement', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fronius-errors-'));
  const database = new MonitorDatabase(path.join(directory, 'monitor.sqlite'));
  context.after(() => {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  let shouldFail = false;
  const client = {};
  const config = {
    dcPeakW: 14260,
    exportLimitPercent: 60,
    exportLimitW: null,
    polling: { fastMs: 2000, normalMs: 10000, nightMs: 60000 },
    analysis: {
      limitToleranceW: 60, nightThresholdW: 50, fullSocPercent: 99.5,
      plateauWindowSeconds: 90, minimumPlateauSamples: 12, loadStepMinimumW: 500,
    },
    retention: { rawDays: 14, maintenanceIntervalMinutes: 60 },
  };
  const validSample = {
    recordedAtMs: 1000, localDate: '2026-09-01', pvDcW: 1000, gridExportW: 500,
    gridImportW: 0, loadW: 200, batteryChargeW: 300, batteryDischargeW: 0,
    batterySocPercent: 50, batteryMode: 'normal', inverterAcW: 800,
    mppt1W: 700, mppt2W: 300,
  };
  client.collect = async () => {
    if (shouldFail) throw new Error('Inverter unavailable');
    return validSample;
  };
  const collector = new Collector({ config, database, froniusClient: client });

  await collector.sampleOnce(1000);
  shouldFail = true;
  await assert.rejects(() => collector.sampleOnce(2000), /Inverter unavailable/);

  assert.equal(database.getLatestMeasurement().recordedAtMs, 1000);
  assert.equal(collector.getState().consecutiveErrors, 1);
  assert.match(collector.getState().lastError.message, /Inverter unavailable/);
});
