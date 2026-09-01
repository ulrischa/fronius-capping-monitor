import {
  analyzeCurtailment,
  choosePollIntervalMs,
  detectLoadStepEvidence,
} from './analysis.js';

export class Collector {
  constructor({ config, database, froniusClient, logger = console }) {
    this.config = config;
    this.database = database;
    this.froniusClient = froniusClient;
    this.logger = logger;
    this.running = false;
    this.timer = null;
    this.lastMaintenanceAtMs = 0;
    this.state = {
      isRunning: false,
      lastSuccessAtMs: null,
      lastAttemptAtMs: null,
      lastError: null,
      consecutiveErrors: 0,
      currentPollIntervalMs: config.polling.normalMs,
      lastAnalysis: null,
    };
  }

  async sampleOnce(recordedAtMs = Date.now()) {
    this.state.lastAttemptAtMs = recordedAtMs;

    try {
      const measurement = await this.froniusClient.collect(recordedAtMs);
      const windowStartMs = recordedAtMs - this.config.analysis.plateauWindowSeconds * 1000;
      const recentSamples = this.database.getRecentSamples(windowStartMs);
      const analysis = analyzeCurtailment(measurement, [...recentSamples, measurement], this.config);
      const previous = this.database.getLatestMeasurement();
      const event = detectLoadStepEvidence(previous, measurement, this.config);

      this.database.insertMeasurement(measurement, analysis);
      if (event) this.database.insertEvent(event, measurement.localDate);

      this.state.lastSuccessAtMs = recordedAtMs;
      this.state.lastError = null;
      this.state.consecutiveErrors = 0;
      this.state.lastAnalysis = analysis;
      this.state.currentPollIntervalMs = choosePollIntervalMs(measurement, analysis, this.config);
      this.runMaintenanceIfDue(recordedAtMs);

      return { measurement, analysis, event };
    } catch (error) {
      this.state.consecutiveErrors += 1;
      this.state.lastError = {
        occurredAtMs: recordedAtMs,
        message: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  runMaintenanceIfDue(nowMs) {
    const intervalMs = this.config.retention.maintenanceIntervalMinutes * 60000;
    if (nowMs - this.lastMaintenanceAtMs < intervalMs) return;

    const cutoffMs = nowMs - this.config.retention.rawDays * 86400000;
    this.database.compactBefore(cutoffMs);
    this.lastMaintenanceAtMs = nowMs;
  }

  async runCycle() {
    if (!this.running) return;
    let delayMs = this.state.currentPollIntervalMs;

    try {
      await this.sampleOnce();
      delayMs = this.state.currentPollIntervalMs;
    } catch (error) {
      const exponent = Math.min(this.state.consecutiveErrors - 1, 4);
      delayMs = Math.min(this.config.polling.normalMs * (2 ** exponent), this.config.polling.nightMs);
      this.logger.warn(`[collector] ${error.message}; retrying in ${delayMs} ms`);
    }

    if (this.running) {
      this.timer = setTimeout(() => this.runCycle(), delayMs);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.state.isRunning = true;
    void this.runCycle();
  }

  stop() {
    this.running = false;
    this.state.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getState() {
    return {
      ...this.state,
      lastError: this.state.lastError ? { ...this.state.lastError } : null,
      lastAnalysis: this.state.lastAnalysis ? { ...this.state.lastAnalysis } : null,
    };
  }
}
