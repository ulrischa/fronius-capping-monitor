export function makePowerFlow(overrides = {}) {
  const site = {
    P_Akku: -6.564971923828125,
    P_Grid: -8555.9375,
    P_Load: -120.8955078125,
    P_PV: 8938.05029296875,
    Meter_Location: 'grid',
    Mode: 'bidirectional',
    ...overrides.site,
  };

  const inverter = {
    Battery_Mode: 'battery full',
    DT: 1,
    P: 8677.703125,
    SOC: 100,
    ...overrides.inverter,
  };

  return {
    Body: { Data: { Inverters: { 1: inverter }, Site: site, Version: '13' } },
    Head: {
      Status: { Code: 0, Reason: '', UserMessage: '' },
      Timestamp: '2026-09-01T11:22:13+00:00',
      ...overrides.head,
    },
  };
}

export function makeCommonInverter(overrides = {}) {
  const value = (number, unit) => ({ Unit: unit, Value: number });
  const data = {
    DeviceStatus: { ErrorCode: 0, InverterState: 'Running', StatusCode: 7 },
    FAC: value(50.00394058227539, 'Hz'),
    IAC: value(37.954673767089844, 'A'),
    IDC: value(11.036062240600586, 'A'),
    IDC_2: value(7.079251766204834, 'A'),
    PAC: value(8675.4453125, 'W'),
    SAC: value(8676.6337890625, 'VA'),
    UAC: value(228.91981506347656, 'V'),
    UDC: value(584.5507202148438, 'V'),
    UDC_2: value(351.28656005859375, 'V'),
    TOTAL_ENERGY: value(377103.4036111111, 'Wh'),
    ...overrides.data,
  };

  return {
    Body: { Data: data },
    Head: {
      Status: { Code: 0, Reason: '', UserMessage: '' },
      Timestamp: '2026-09-01T11:22:16+00:00',
      ...overrides.head,
    },
  };
}

export function makeNormalizedSample(overrides = {}) {
  return {
    recordedAtMs: Date.parse('2026-09-01T11:22:16Z'),
    localDate: '2026-09-01',
    pvDcW: 8938,
    gridExportW: 8556,
    gridImportW: 0,
    loadW: 121,
    batteryChargeW: 7,
    batteryDischargeW: 0,
    batterySocPercent: 100,
    batteryMode: 'battery full',
    inverterAcW: 8675,
    mppt1W: 6451,
    mppt2W: 2487,
    ...overrides,
  };
}
