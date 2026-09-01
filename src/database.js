import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

function maxNullable(...values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}

function mapMeasurement(row) {
  if (!row) return null;
  return {
    recordedAtMs: row.recorded_at_ms,
    localDate: row.local_date,
    powerFlowTimestampMs: row.power_flow_timestamp_ms,
    inverterTimestampMs: row.inverter_timestamp_ms,
    pvDcW: row.pv_dc_w,
    gridExportW: row.grid_export_w,
    gridImportW: row.grid_import_w,
    loadW: row.load_w,
    batteryChargeW: row.battery_charge_w,
    batteryDischargeW: row.battery_discharge_w,
    batterySocPercent: row.battery_soc_percent,
    batteryMode: row.battery_mode,
    inverterAcW: row.inverter_ac_w,
    inverterReportedW: row.inverter_reported_w,
    totalEnergyWh: row.total_energy_wh,
    mppt1VoltageV: row.mppt1_voltage_v,
    mppt1CurrentA: row.mppt1_current_a,
    mppt1W: row.mppt1_w,
    mppt2VoltageV: row.mppt2_voltage_v,
    mppt2CurrentA: row.mppt2_current_a,
    mppt2W: row.mppt2_w,
    mpptTotalW: row.mppt_total_w,
    inverterState: row.inverter_state,
    inverterErrorCode: row.inverter_error_code,
    durationMs: row.duration_ms,
    analysis: {
      level: row.analysis_level,
      score: row.analysis_score,
      isNearLimit: Boolean(row.is_near_limit),
      hasPlateau: Boolean(row.has_plateau),
      reasons: JSON.parse(row.analysis_reasons_json || '[]'),
    },
  };
}

export class MonitorDatabase {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
    this.prepareStatements();
  }

  initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS measurements (
        recorded_at_ms INTEGER PRIMARY KEY,
        local_date TEXT NOT NULL,
        power_flow_timestamp_ms INTEGER,
        inverter_timestamp_ms INTEGER,
        pv_dc_w REAL NOT NULL,
        grid_export_w REAL NOT NULL,
        grid_import_w REAL NOT NULL,
        load_w REAL NOT NULL,
        battery_charge_w REAL,
        battery_discharge_w REAL,
        battery_soc_percent REAL,
        battery_mode TEXT,
        inverter_ac_w REAL,
        inverter_reported_w REAL,
        total_energy_wh REAL,
        mppt1_voltage_v REAL,
        mppt1_current_a REAL,
        mppt1_w REAL,
        mppt2_voltage_v REAL,
        mppt2_current_a REAL,
        mppt2_w REAL,
        mppt_total_w REAL,
        inverter_state TEXT,
        inverter_error_code INTEGER,
        analysis_level TEXT NOT NULL,
        analysis_score INTEGER NOT NULL,
        is_near_limit INTEGER NOT NULL,
        has_plateau INTEGER NOT NULL,
        analysis_reasons_json TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE INDEX IF NOT EXISTS measurements_local_date_idx
        ON measurements(local_date, recorded_at_ms);

      CREATE TABLE IF NOT EXISTS minute_measurements (
        minute_ms INTEGER PRIMARY KEY,
        local_date TEXT NOT NULL,
        sample_count INTEGER NOT NULL,
        average_pv_dc_w REAL NOT NULL,
        maximum_pv_dc_w REAL NOT NULL,
        average_grid_export_w REAL NOT NULL,
        maximum_grid_export_w REAL NOT NULL,
        average_load_w REAL NOT NULL,
        average_battery_charge_w REAL,
        average_battery_discharge_w REAL,
        average_battery_soc_percent REAL,
        average_mppt1_w REAL,
        average_mppt2_w REAL,
        maximum_mppt1_w REAL,
        maximum_mppt2_w REAL,
        maximum_analysis_score INTEGER NOT NULL,
        near_limit_duration_ms INTEGER NOT NULL,
        likely_duration_ms INTEGER NOT NULL,
        very_likely_duration_ms INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS minute_measurements_local_date_idx
        ON minute_measurements(local_date, minute_ms);

      CREATE TABLE IF NOT EXISTS curtailment_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_date TEXT NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL,
        verified_extra_available_w REAL,
        load_delta_w REAL,
        pv_delta_w REAL,
        export_delta_w REAL,
        claim TEXT NOT NULL,
        explanation TEXT NOT NULL,
        UNIQUE(event_type, occurred_at_ms)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS curtailment_events_local_date_idx
        ON curtailment_events(local_date, occurred_at_ms DESC);
    `);
  }

  prepareStatements() {
    this.latestStatement = this.db.prepare('SELECT * FROM measurements ORDER BY recorded_at_ms DESC LIMIT 1');
    this.previousStatement = this.db.prepare('SELECT recorded_at_ms FROM measurements WHERE recorded_at_ms < ? ORDER BY recorded_at_ms DESC LIMIT 1');
    this.updateDurationStatement = this.db.prepare('UPDATE measurements SET duration_ms = ? WHERE recorded_at_ms = ? AND duration_ms = 0');
    this.insertMeasurementStatement = this.db.prepare(`
      INSERT INTO measurements (
        recorded_at_ms, local_date, power_flow_timestamp_ms, inverter_timestamp_ms,
        pv_dc_w, grid_export_w, grid_import_w, load_w, battery_charge_w, battery_discharge_w,
        battery_soc_percent, battery_mode, inverter_ac_w, inverter_reported_w, total_energy_wh,
        mppt1_voltage_v, mppt1_current_a, mppt1_w, mppt2_voltage_v, mppt2_current_a, mppt2_w,
        mppt_total_w, inverter_state, inverter_error_code, analysis_level, analysis_score,
        is_near_limit, has_plateau, analysis_reasons_json
      ) VALUES (
        @recordedAtMs, @localDate, @powerFlowTimestampMs, @inverterTimestampMs,
        @pvDcW, @gridExportW, @gridImportW, @loadW, @batteryChargeW, @batteryDischargeW,
        @batterySocPercent, @batteryMode, @inverterAcW, @inverterReportedW, @totalEnergyWh,
        @mppt1VoltageV, @mppt1CurrentA, @mppt1W, @mppt2VoltageV, @mppt2CurrentA, @mppt2W,
        @mpptTotalW, @inverterState, @inverterErrorCode, @analysisLevel, @analysisScore,
        @isNearLimit, @hasPlateau, @analysisReasonsJson
      )
    `);
    this.insertEventStatement = this.db.prepare(`
      INSERT OR IGNORE INTO curtailment_events (
        local_date, event_type, occurred_at_ms, verified_extra_available_w,
        load_delta_w, pv_delta_w, export_delta_w, claim, explanation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.insertMeasurementTransaction = this.db.transaction((measurement, analysis) => {
      const previous = this.previousStatement.get(measurement.recordedAtMs);
      if (previous) {
        const elapsedMs = measurement.recordedAtMs - previous.recorded_at_ms;
        // Downtime must not be counted as observed curtailment time.
        this.updateDurationStatement.run(Math.min(elapsedMs, 60000), previous.recorded_at_ms);
      }
      this.insertMeasurementStatement.run({
        recordedAtMs: measurement.recordedAtMs,
        localDate: measurement.localDate,
        powerFlowTimestampMs: measurement.powerFlowTimestampMs ?? null,
        inverterTimestampMs: measurement.inverterTimestampMs ?? null,
        pvDcW: measurement.pvDcW,
        gridExportW: measurement.gridExportW,
        gridImportW: measurement.gridImportW,
        loadW: measurement.loadW,
        batteryChargeW: measurement.batteryChargeW ?? null,
        batteryDischargeW: measurement.batteryDischargeW ?? null,
        batterySocPercent: measurement.batterySocPercent ?? null,
        batteryMode: measurement.batteryMode ?? null,
        inverterAcW: measurement.inverterAcW ?? null,
        inverterReportedW: measurement.inverterReportedW ?? null,
        totalEnergyWh: measurement.totalEnergyWh ?? null,
        mppt1VoltageV: measurement.mppt1VoltageV ?? null,
        mppt1CurrentA: measurement.mppt1CurrentA ?? null,
        mppt1W: measurement.mppt1W ?? null,
        mppt2VoltageV: measurement.mppt2VoltageV ?? null,
        mppt2CurrentA: measurement.mppt2CurrentA ?? null,
        mppt2W: measurement.mppt2W ?? null,
        mpptTotalW: measurement.mpptTotalW ?? null,
        inverterState: measurement.inverterState ?? null,
        inverterErrorCode: measurement.inverterErrorCode ?? null,
        analysisLevel: analysis.level,
        analysisScore: analysis.score,
        isNearLimit: analysis.isNearLimit ? 1 : 0,
        hasPlateau: analysis.hasPlateau ? 1 : 0,
        analysisReasonsJson: JSON.stringify(analysis.reasons || []),
      });
    });
  }

  insertMeasurement(measurement, analysis) {
    this.insertMeasurementTransaction(measurement, analysis);
  }

  insertEvent(event, localDate) {
    return this.insertEventStatement.run(
      localDate,
      event.type,
      event.occurredAtMs,
      event.verifiedExtraAvailableW ?? null,
      event.loadDeltaW ?? null,
      event.pvDeltaW ?? null,
      event.exportDeltaW ?? null,
      event.claim,
      event.explanation,
    ).changes > 0;
  }

  getLatestMeasurement() {
    return mapMeasurement(this.latestStatement.get());
  }

  getRecentSamples(sinceMs) {
    return this.db.prepare(`
      SELECT * FROM measurements
      WHERE recorded_at_ms >= ?
      ORDER BY recorded_at_ms
      LIMIT 10000
    `).all(sinceMs).map(mapMeasurement);
  }

  getDaySummary(localDate) {
    const raw = this.db.prepare(`
      SELECT
        COUNT(*) AS sample_count,
        MAX(pv_dc_w) AS maximum_pv_dc_w,
        MAX(grid_export_w) AS maximum_grid_export_w,
        MAX(mppt1_w) AS maximum_mppt1_w,
        MAX(mppt2_w) AS maximum_mppt2_w,
        SUM(CASE WHEN is_near_limit = 1 THEN duration_ms ELSE 0 END) AS near_limit_duration_ms,
        SUM(CASE WHEN analysis_score >= 60 THEN duration_ms ELSE 0 END) AS likely_duration_ms,
        SUM(CASE WHEN analysis_score >= 80 THEN duration_ms ELSE 0 END) AS very_likely_duration_ms
      FROM measurements WHERE local_date = ?
    `).get(localDate);
    const minute = this.db.prepare(`
      SELECT
        COALESCE(SUM(sample_count), 0) AS sample_count,
        MAX(maximum_pv_dc_w) AS maximum_pv_dc_w,
        MAX(maximum_grid_export_w) AS maximum_grid_export_w,
        MAX(maximum_mppt1_w) AS maximum_mppt1_w,
        MAX(maximum_mppt2_w) AS maximum_mppt2_w,
        COALESCE(SUM(near_limit_duration_ms), 0) AS near_limit_duration_ms,
        COALESCE(SUM(likely_duration_ms), 0) AS likely_duration_ms,
        COALESCE(SUM(very_likely_duration_ms), 0) AS very_likely_duration_ms
      FROM minute_measurements WHERE local_date = ?
    `).get(localDate);
    const event = this.db.prepare(`
      SELECT MAX(verified_extra_available_w) AS verified_extra_available_w
      FROM curtailment_events WHERE local_date = ?
    `).get(localDate);

    return {
      localDate,
      sampleCount: raw.sample_count + minute.sample_count,
      maximumPvDcW: maxNullable(raw.maximum_pv_dc_w, minute.maximum_pv_dc_w),
      maximumGridExportW: maxNullable(raw.maximum_grid_export_w, minute.maximum_grid_export_w),
      maximumMppt1W: maxNullable(raw.maximum_mppt1_w, minute.maximum_mppt1_w),
      maximumMppt2W: maxNullable(raw.maximum_mppt2_w, minute.maximum_mppt2_w),
      nearLimitDurationMs: raw.near_limit_duration_ms + minute.near_limit_duration_ms,
      likelyDurationMs: raw.likely_duration_ms + minute.likely_duration_ms,
      veryLikelyDurationMs: raw.very_likely_duration_ms + minute.very_likely_duration_ms,
      verifiedExtraAvailableW: event.verified_extra_available_w,
    };
  }

  getChartBuckets(localDate, maxPoints = 1200) {
    const safeMaxPoints = Math.max(100, Math.min(2000, Math.trunc(maxPoints)));
    const bucketMs = Math.max(1000, Math.ceil(86400000 / safeMaxPoints));
    const rows = this.db.prepare(`
      WITH points AS (
        SELECT recorded_at_ms AS timestamp_ms, 1 AS weight,
          pv_dc_w AS average_pv_dc_w, pv_dc_w AS maximum_pv_dc_w,
          grid_export_w AS average_grid_export_w, grid_export_w AS maximum_grid_export_w,
          load_w AS average_load_w, battery_charge_w AS average_battery_charge_w,
          battery_discharge_w AS average_battery_discharge_w,
          battery_soc_percent AS average_battery_soc_percent,
          mppt1_w AS average_mppt1_w, mppt2_w AS average_mppt2_w,
          mppt1_w AS maximum_mppt1_w, mppt2_w AS maximum_mppt2_w,
          analysis_score AS maximum_analysis_score
        FROM measurements WHERE local_date = @localDate
        UNION ALL
        SELECT minute_ms, sample_count,
          average_pv_dc_w, maximum_pv_dc_w,
          average_grid_export_w, maximum_grid_export_w,
          average_load_w, average_battery_charge_w,
          average_battery_discharge_w, average_battery_soc_percent,
          average_mppt1_w, average_mppt2_w,
          maximum_mppt1_w, maximum_mppt2_w, maximum_analysis_score
        FROM minute_measurements WHERE local_date = @localDate
      )
      SELECT
        CAST(timestamp_ms / @bucketMs AS INTEGER) * @bucketMs AS bucket_ms,
        SUM(weight) AS sample_count,
        SUM(average_pv_dc_w * weight) / SUM(weight) AS average_pv_dc_w,
        MAX(maximum_pv_dc_w) AS maximum_pv_dc_w,
        SUM(average_grid_export_w * weight) / SUM(weight) AS average_grid_export_w,
        MAX(maximum_grid_export_w) AS maximum_grid_export_w,
        SUM(average_load_w * weight) / SUM(weight) AS average_load_w,
        SUM(CASE WHEN average_battery_charge_w IS NOT NULL THEN average_battery_charge_w * weight END)
          / NULLIF(SUM(CASE WHEN average_battery_charge_w IS NOT NULL THEN weight ELSE 0 END), 0) AS average_battery_charge_w,
        SUM(CASE WHEN average_battery_discharge_w IS NOT NULL THEN average_battery_discharge_w * weight END)
          / NULLIF(SUM(CASE WHEN average_battery_discharge_w IS NOT NULL THEN weight ELSE 0 END), 0) AS average_battery_discharge_w,
        SUM(CASE WHEN average_battery_soc_percent IS NOT NULL THEN average_battery_soc_percent * weight END)
          / NULLIF(SUM(CASE WHEN average_battery_soc_percent IS NOT NULL THEN weight ELSE 0 END), 0) AS average_battery_soc_percent,
        SUM(CASE WHEN average_mppt1_w IS NOT NULL THEN average_mppt1_w * weight END)
          / NULLIF(SUM(CASE WHEN average_mppt1_w IS NOT NULL THEN weight ELSE 0 END), 0) AS average_mppt1_w,
        SUM(CASE WHEN average_mppt2_w IS NOT NULL THEN average_mppt2_w * weight END)
          / NULLIF(SUM(CASE WHEN average_mppt2_w IS NOT NULL THEN weight ELSE 0 END), 0) AS average_mppt2_w,
        MAX(maximum_mppt1_w) AS maximum_mppt1_w,
        MAX(maximum_mppt2_w) AS maximum_mppt2_w,
        MAX(maximum_analysis_score) AS maximum_analysis_score
      FROM points
      GROUP BY bucket_ms
      ORDER BY bucket_ms
    `).all({ localDate, bucketMs });

    return rows.map((row) => ({
      timestampMs: row.bucket_ms,
      sampleCount: row.sample_count,
      averagePvDcW: row.average_pv_dc_w,
      maximumPvDcW: row.maximum_pv_dc_w,
      averageGridExportW: row.average_grid_export_w,
      maximumGridExportW: row.maximum_grid_export_w,
      averageLoadW: row.average_load_w,
      averageBatteryChargeW: row.average_battery_charge_w,
      averageBatteryDischargeW: row.average_battery_discharge_w,
      averageBatterySocPercent: row.average_battery_soc_percent,
      averageMppt1W: row.average_mppt1_w,
      averageMppt2W: row.average_mppt2_w,
      maximumMppt1W: row.maximum_mppt1_w,
      maximumMppt2W: row.maximum_mppt2_w,
      maximumAnalysisScore: row.maximum_analysis_score,
    }));
  }

  getEvents(localDate, limit = 100) {
    return this.db.prepare(`
      SELECT event_type, occurred_at_ms, verified_extra_available_w,
        load_delta_w, pv_delta_w, export_delta_w, claim, explanation
      FROM curtailment_events
      WHERE local_date = ?
      ORDER BY occurred_at_ms DESC
      LIMIT ?
    `).all(localDate, Math.max(1, Math.min(100, limit))).map((row) => ({
      type: row.event_type,
      occurredAtMs: row.occurred_at_ms,
      verifiedExtraAvailableW: row.verified_extra_available_w,
      loadDeltaW: row.load_delta_w,
      pvDeltaW: row.pv_delta_w,
      exportDeltaW: row.export_delta_w,
      claim: row.claim,
      explanation: row.explanation,
    }));
  }

  compactBefore(cutoffMs) {
    const alignedCutoffMs = Math.floor(cutoffMs / 60000) * 60000;
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR IGNORE INTO minute_measurements (
          minute_ms, local_date, sample_count, average_pv_dc_w, maximum_pv_dc_w,
          average_grid_export_w, maximum_grid_export_w, average_load_w,
          average_battery_charge_w, average_battery_discharge_w, average_battery_soc_percent,
          average_mppt1_w, average_mppt2_w,
          maximum_mppt1_w, maximum_mppt2_w, maximum_analysis_score,
          near_limit_duration_ms, likely_duration_ms, very_likely_duration_ms
        )
        SELECT
          CAST(recorded_at_ms / 60000 AS INTEGER) * 60000,
          MIN(local_date), COUNT(*), AVG(pv_dc_w), MAX(pv_dc_w),
          AVG(grid_export_w), MAX(grid_export_w), AVG(load_w),
          AVG(battery_charge_w), AVG(battery_discharge_w), AVG(battery_soc_percent),
          AVG(mppt1_w), AVG(mppt2_w),
          MAX(mppt1_w), MAX(mppt2_w), MAX(analysis_score),
          SUM(CASE WHEN is_near_limit = 1 THEN duration_ms ELSE 0 END),
          SUM(CASE WHEN analysis_score >= 60 THEN duration_ms ELSE 0 END),
          SUM(CASE WHEN analysis_score >= 80 THEN duration_ms ELSE 0 END)
        FROM measurements
        WHERE recorded_at_ms < ?
        GROUP BY CAST(recorded_at_ms / 60000 AS INTEGER)
      `).run(alignedCutoffMs);
      return this.db.prepare('DELETE FROM measurements WHERE recorded_at_ms < ?').run(alignedCutoffMs).changes;
    });

    return { rawRowsDeleted: transaction() };
  }

  close() {
    this.db.close();
  }
}
