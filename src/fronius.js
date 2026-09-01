function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Fronius response: ${label} is missing`);
  }
  return value;
}

function readNumber(value, label, { required = false } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new Error(`Invalid Fronius response: ${label} is missing`);
    return null;
  }
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid Fronius response: ${label} is not numeric`);
  }
  return value;
}

function readApiValue(data, key, options) {
  return readNumber(data[key]?.Value, key, options);
}

function verifyStatus(response, label) {
  const status = requireObject(response?.Head?.Status, `${label}.Head.Status`);
  if (status.Code !== 0) {
    const detail = status.Reason || status.UserMessage || `status code ${status.Code}`;
    throw new Error(`Fronius ${label} failed: ${detail}`);
  }
}

function multiplyNullable(left, right) {
  return left === null || right === null ? null : left * right;
}

export function localDateFromMs(timestampMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestampMs));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function normalizeFroniusResponses(powerFlow, commonInverter, options) {
  verifyStatus(powerFlow, 'PowerFlow');
  verifyStatus(commonInverter, 'CommonInverterData');

  const powerData = requireObject(powerFlow.Body?.Data, 'PowerFlow.Body.Data');
  const site = requireObject(powerData.Site, 'PowerFlow.Body.Data.Site');
  const inverter = requireObject(powerData.Inverters?.[String(options.deviceId)], `Inverters.${options.deviceId}`);
  const common = requireObject(commonInverter.Body?.Data, 'CommonInverterData.Body.Data');

  const pGridW = readNumber(site.P_Grid, 'P_Grid', { required: true });
  const pLoadW = readNumber(site.P_Load, 'P_Load', { required: true });
  const pBatteryW = readNumber(site.P_Akku, 'P_Akku');
  const mppt1VoltageV = readApiValue(common, 'UDC');
  const mppt1CurrentA = readApiValue(common, 'IDC');
  const mppt2VoltageV = readApiValue(common, 'UDC_2');
  const mppt2CurrentA = readApiValue(common, 'IDC_2');
  const mppt1W = multiplyNullable(mppt1VoltageV, mppt1CurrentA);
  const mppt2W = multiplyNullable(mppt2VoltageV, mppt2CurrentA);

  return {
    recordedAtMs: options.recordedAtMs,
    localDate: localDateFromMs(options.recordedAtMs, options.timeZone),
    powerFlowTimestampMs: Date.parse(powerFlow.Head.Timestamp),
    inverterTimestampMs: Date.parse(commonInverter.Head.Timestamp),
    pvDcW: readNumber(site.P_PV, 'P_PV', { required: true }),
    gridExportW: Math.max(0, -pGridW),
    gridImportW: Math.max(0, pGridW),
    loadW: Math.max(0, -pLoadW),
    batteryChargeW: pBatteryW === null ? null : Math.max(0, -pBatteryW),
    batteryDischargeW: pBatteryW === null ? null : Math.max(0, pBatteryW),
    batterySocPercent: readNumber(inverter.SOC, 'SOC'),
    batteryMode: typeof inverter.Battery_Mode === 'string' ? inverter.Battery_Mode : null,
    inverterAcW: readApiValue(common, 'PAC'),
    inverterReportedW: readNumber(inverter.P, 'Inverter.P'),
    totalEnergyWh: readApiValue(common, 'TOTAL_ENERGY'),
    mppt1VoltageV,
    mppt1CurrentA,
    mppt1W,
    mppt2VoltageV,
    mppt2CurrentA,
    mppt2W,
    mpptTotalW: mppt1W === null && mppt2W === null ? null : (mppt1W || 0) + (mppt2W || 0),
    inverterState: typeof common.DeviceStatus?.InverterState === 'string' ? common.DeviceStatus.InverterState : null,
    inverterErrorCode: readNumber(common.DeviceStatus?.ErrorCode, 'DeviceStatus.ErrorCode'),
  };
}

export class FroniusClient {
  constructor(config, fetchImplementation = fetch) {
    this.config = config;
    this.fetch = fetchImplementation;
  }

  async fetchJson(pathname) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.polling.requestTimeoutMs);
    const host = this.config.froniusHost;
    const url = `http://${host}${pathname}`;

    try {
      const response = await this.fetch(url, {
        signal: controller.signal,
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Fronius returned HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Fronius request timed out after ${this.config.polling.requestTimeoutMs} ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async collect(recordedAtMs = Date.now()) {
    const deviceId = encodeURIComponent(String(this.config.deviceId));
    const [powerFlow, common] = await Promise.all([
      this.fetchJson('/solar_api/v1/GetPowerFlowRealtimeData.fcgi'),
      this.fetchJson(`/solar_api/v1/GetInverterRealtimeData.cgi?Scope=Device&DeviceId=${deviceId}&DataCollection=CommonInverterData`),
    ]);

    return normalizeFroniusResponses(powerFlow, common, {
      deviceId: this.config.deviceId,
      timeZone: this.config.timeZone,
      recordedAtMs,
    });
  }
}
