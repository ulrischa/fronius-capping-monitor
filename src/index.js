// Created for Uli's local Fronius monitoring setup.
import { Collector } from './collector.js';
import { loadConfig } from './config.js';
import { MonitorDatabase } from './database.js';
import { seedDemoData } from './demo.js';
import { FroniusClient } from './fronius.js';
import { createMonitorServer } from './server.js';

function argumentValue(prefix) {
  const argument = process.argv.find((value) => value.startsWith(`${prefix}=`));
  return argument ? argument.slice(prefix.length + 1) : undefined;
}

const isDemo = process.argv.includes('--demo');
const isSample = process.argv.includes('--sample');
const config = loadConfig({ configPath: argumentValue('--config'), allowDemo: isDemo });
if (isDemo) {
  config.databasePath = ':memory:';
  config.demoMode = true;
}

const database = new MonitorDatabase(config.databasePath);
const froniusClient = isDemo ? null : new FroniusClient(config);
const collector = isDemo
  ? {
      getState: () => ({
        isRunning: false,
        lastSuccessAtMs: database.getLatestMeasurement()?.recordedAtMs ?? null,
        lastAttemptAtMs: null,
        lastError: null,
        consecutiveErrors: 0,
        currentPollIntervalMs: null,
        lastAnalysis: null,
      }),
      start() {},
      stop() {},
    }
  : new Collector({ config, database, froniusClient });

if (isDemo) seedDemoData(database, config);

if (isSample) {
  try {
    const result = await collector.sampleOnce();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    database.close();
  }
  process.exit(0);
}

const server = createMonitorServer({ config, database, collector });
server.listen(config.port, config.bindAddress, () => {
  console.log(`Fronius Curtailment Monitor: http://${config.bindAddress}:${config.port}`);
});
collector.start();

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down`);
  collector.stop();
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
