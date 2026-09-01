import { analyzeCurtailment } from './analysis.js';
import { localDateFromMs } from './fronius.js';

function getLocalHour(timestampMs, timeZone) {
  return Number(new Intl.DateTimeFormat('en', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestampMs)));
}

export function seedDemoData(database, config, nowMs = Date.now()) {
  const localDate = localDateFromMs(nowMs, config.timeZone);
  const startMs = nowMs - 12 * 3600000;
  const samples = [];

  for (let timestampMs = startMs; timestampMs <= nowMs; timestampMs += 60000) {
    const hour = getLocalHour(timestampMs, config.timeZone);
    const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
    const cloudFactor = 0.88 + 0.1 * Math.sin(timestampMs / 900000);
    const availablePvW = config.dcPeakW * daylight * cloudFactor;
    const loadW = 420 + 180 * (1 + Math.sin(timestampMs / 1200000));
    const soc = Math.min(100, 45 + Math.max(0, hour - 7) * 8.5);
    const batteryChargeW = soc < 99.5 ? Math.min(2400, availablePvW * 0.24) : 0;
    const exportLimitW = config.exportLimitW ?? config.dcPeakW * config.exportLimitPercent / 100;
    const gridExportW = Math.max(0, Math.min(exportLimitW, availablePvW - loadW - batteryChargeW));
    const pvDcW = Math.max(0, gridExportW + loadW + batteryChargeW + availablePvW * 0.03);
    const mppt1W = pvDcW * 0.72;
    const mppt2W = pvDcW * 0.28;
    const sample = {
      recordedAtMs: timestampMs,
      localDate: localDateFromMs(timestampMs, config.timeZone),
      powerFlowTimestampMs: timestampMs,
      inverterTimestampMs: timestampMs,
      pvDcW,
      gridExportW,
      gridImportW: availablePvW < loadW ? loadW - availablePvW : 0,
      loadW,
      batteryChargeW,
      batteryDischargeW: 0,
      batterySocPercent: soc,
      batteryMode: soc >= 99.5 ? 'battery full' : 'normal',
      inverterAcW: Math.max(0, pvDcW - batteryChargeW - pvDcW * 0.025),
      inverterReportedW: Math.max(0, pvDcW - batteryChargeW - pvDcW * 0.025),
      totalEnergyWh: 377103 + (timestampMs - startMs) / 3600000 * pvDcW / 1000,
      mppt1VoltageV: daylight ? 540 : null,
      mppt1CurrentA: daylight ? mppt1W / 540 : null,
      mppt1W: daylight ? mppt1W : null,
      mppt2VoltageV: daylight ? 350 : null,
      mppt2CurrentA: daylight ? mppt2W / 350 : null,
      mppt2W: daylight ? mppt2W : null,
      mpptTotalW: daylight ? pvDcW : null,
      inverterState: daylight ? 'Running' : 'Sleeping',
      inverterErrorCode: 0,
    };
    samples.push(sample);
    const recent = samples.slice(-config.analysis.minimumPlateauSamples - 2);
    database.insertMeasurement(sample, analyzeCurtailment(sample, recent, config));
  }

  return { localDate, sampleCount: samples.length };
}
