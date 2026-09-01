import fs from 'node:fs';
import path from 'node:path';

const defaultConfig = {
  deviceId: 1,
  exportLimitW: null,
  port: 3200,
  bindAddress: '0.0.0.0',
  timeZone: 'Europe/Berlin',
  databasePath: 'data/fronius-monitor.sqlite',
  polling: {
    fastMs: 2000,
    normalMs: 10000,
    nightMs: 60000,
    requestTimeoutMs: 5000,
  },
  analysis: {
    limitToleranceW: 60,
    nightThresholdW: 50,
    fullSocPercent: 99.5,
    plateauWindowSeconds: 90,
    minimumPlateauSamples: 12,
    loadStepMinimumW: 500,
  },
  retention: {
    rawDays: 14,
    maintenanceIntervalMinutes: 60,
  },
};

function mergeConfig(base, supplied) {
  return {
    ...base,
    ...supplied,
    polling: { ...base.polling, ...supplied.polling },
    analysis: { ...base.analysis, ...supplied.analysis },
    retention: { ...base.retention, ...supplied.retention },
  };
}

function requireNumber(value, name, { min, max } = {}) {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`${name} must be at least ${min}`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`${name} must be at most ${max}`);
  }
}

export function validateConfig(config, { allowDemo = false } = {}) {
  if (!allowDemo && (typeof config.froniusHost !== 'string' || !config.froniusHost.trim())) {
    throw new Error('froniusHost is required');
  }
  if (config.froniusHost && (!/^[a-zA-Z0-9.[\]:_-]+$/.test(config.froniusHost) || config.froniusHost.includes('..'))) {
    throw new Error('froniusHost must be a hostname or IP address without scheme or path');
  }

  requireNumber(config.deviceId, 'deviceId', { min: 0, max: 255 });
  requireNumber(config.dcPeakW, 'dcPeakW', { min: 100, max: 10000000 });
  if (config.exportLimitW !== null) {
    requireNumber(config.exportLimitW, 'exportLimitW', { min: 0, max: config.dcPeakW });
  } else {
    requireNumber(config.exportLimitPercent, 'exportLimitPercent', { min: 0, max: 100 });
  }
  requireNumber(config.port, 'port', { min: 1, max: 65535 });
  requireNumber(config.polling.fastMs, 'polling.fastMs', { min: 1000, max: 60000 });
  requireNumber(config.polling.normalMs, 'polling.normalMs', { min: config.polling.fastMs, max: 300000 });
  requireNumber(config.polling.nightMs, 'polling.nightMs', { min: config.polling.normalMs, max: 3600000 });
  requireNumber(config.polling.requestTimeoutMs, 'polling.requestTimeoutMs', { min: 500, max: 60000 });
  requireNumber(config.analysis.limitToleranceW, 'analysis.limitToleranceW', { min: 1, max: 2000 });
  requireNumber(config.retention.rawDays, 'retention.rawDays', { min: 1, max: 365 });

  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: config.timeZone }).format();
  } catch {
    throw new Error(`timeZone is invalid: ${config.timeZone}`);
  }

  return config;
}

export function loadConfig({ configPath, allowDemo = false } = {}) {
  const resolvedPath = path.resolve(configPath || process.env.FRONIUS_MONITOR_CONFIG || 'config/config.json');
  let supplied = {};

  if (fs.existsSync(resolvedPath)) {
    supplied = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } else if (!allowDemo) {
    throw new Error(`Configuration not found: ${resolvedPath}. Copy config/config.example.json to config/config.json.`);
  } else {
    supplied = {
      froniusHost: 'demo',
      dcPeakW: 14260,
      exportLimitPercent: 60,
    };
  }

  const config = mergeConfig(defaultConfig, supplied);
  if (process.env.PORT) config.port = Number(process.env.PORT);
  if (process.env.FRONIUS_HOST) config.froniusHost = process.env.FRONIUS_HOST;
  if (process.env.FRONIUS_DATABASE_PATH) config.databasePath = process.env.FRONIUS_DATABASE_PATH;

  config.databasePath = path.resolve(config.databasePath);
  return validateConfig(config, { allowDemo });
}
