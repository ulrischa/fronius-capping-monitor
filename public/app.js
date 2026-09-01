const elements = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map((element) => [element.id, element]),
);

const levelLabels = {
  NOT_DETECTED: 'Keine Hinweise',
  POSSIBLE: 'Möglich',
  LIKELY: 'Wahrscheinlich',
  VERY_LIKELY: 'Sehr wahrscheinlich',
};

const levelLeads = {
  NOT_DETECTED: 'Die aktuelle Messung zeigt keine auffällige Begrenzung der Netzeinspeisung.',
  POSSIBLE: 'Die Einspeisung liegt am erwarteten Limit. Eine einzelne Übereinstimmung kann aber zufällig sein.',
  LIKELY: 'Mehrere Messmerkmale sprechen gleichzeitig für eine aktive Einspeisebegrenzung.',
  VERY_LIKELY: 'Die Einspeisung bleibt am Limit, während weitere Bedingungen eine Abregelung sehr plausibel machen.',
};

let timeZone = 'Europe/Berlin';
let selectedDate = null;
let liveTimer = null;
let dayTimer = null;
let lastConnectionState = null;
let dayRequestNumber = 0;
let currentExportLimitW = null;

function text(id, value) {
  elements[id].textContent = value;
}

function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return '–';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPower(value) {
  if (!Number.isFinite(value)) return '–';
  if (Math.abs(value) >= 1000) return `${formatNumber(value / 1000, 2)} kW`;
  return `${formatNumber(value, 0)} W`;
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '0 min';
  const minutes = Math.round(durationMs / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatTime(timestampMs) {
  if (!Number.isFinite(timestampMs)) return '–';
  return new Intl.DateTimeFormat('de-DE', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestampMs));
}

function formatDateTime(timestampMs) {
  if (!Number.isFinite(timestampMs)) return '–';
  return new Intl.DateTimeFormat('de-DE', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestampMs));
}

function formatAge(timestampMs) {
  if (!Number.isFinite(timestampMs)) return '–';
  const seconds = Math.max(0, Math.round((Date.now() - timestampMs) / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min`;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`);
  return body;
}

function setConnection(state, label, announcement) {
  elements['connection-status'].dataset.state = state;
  text('connection-label', label);
  if (lastConnectionState !== state && announcement) text('live-announcer', announcement);
  lastConnectionState = state;
}

function updateEvidence(analysis) {
  if (!analysis) {
    elements['evidence-badge'].dataset.level = 'NOT_DETECTED';
    text('evidence-label', 'Noch keine Daten');
    text('evidence-score', '–');
    return;
  }

  elements['evidence-badge'].dataset.level = analysis.level;
  text('evidence-label', levelLabels[analysis.level] || analysis.level);
  text('evidence-score', `${analysis.score}/100`);
  text('evidence-lead', levelLeads[analysis.level] || 'Bewertung liegt vor.');
  text('configured-limit', formatPower(analysis.exportLimitW));
  const distance = analysis.distanceToLimitW;
  text('limit-distance', distance >= 0 ? `${formatPower(distance)} darunter` : `${formatPower(Math.abs(distance))} darüber`);
  text('battery-full', analysis.isBatteryFull ? 'Ja' : 'Nein');
  text('plateau-detected', analysis.hasPlateau ? 'Ja' : 'Nein');
  text('method-note', analysis.disclaimer);

  const reasonItems = analysis.reasons.map((reason) => {
    const item = document.createElement('li');
    const label = document.createElement('strong');
    const detail = document.createElement('small');
    label.textContent = reason.label;
    detail.textContent = reason.detail;
    item.append(label, detail);
    return item;
  });
  elements['reason-list'].replaceChildren(...reasonItems);
}

function updateLive(status) {
  timeZone = status.timeZone || timeZone;
  elements['demo-notice'].hidden = !status.demoMode;
  const measurement = status.measurement;

  if (!measurement) {
    elements['error-notice'].hidden = false;
    text('error-notice', 'Noch keine gültige Fronius-Messung vorhanden. Prüfe Konfiguration und Solar API.');
    setConnection('error', 'Keine Messdaten', 'Noch keine Messdaten verfügbar.');
    return;
  }

  elements['error-notice'].hidden = !status.collector.lastError;
  if (status.collector.lastError) {
    text('error-notice', `Letzte Abfrage fehlgeschlagen: ${status.collector.lastError.message}. Der letzte gültige Messwert bleibt sichtbar.`);
    setConnection('error', `Gestört · ${formatAge(measurement.recordedAtMs)}`, 'Verbindung zum Wechselrichter gestört.');
  } else {
    setConnection('online', status.demoMode ? 'Demo aktiv' : 'Lokal verbunden', 'Verbindung zum Wechselrichter hergestellt.');
  }

  text('live-time', formatDateTime(measurement.recordedAtMs));
  elements['live-time'].dateTime = new Date(measurement.recordedAtMs).toISOString();
  text('pv-value', formatPower(measurement.pvDcW));
  text('export-value', formatPower(measurement.gridExportW));
  text('load-value', formatPower(measurement.loadW));
  text('inverter-value', formatPower(measurement.inverterAcW));

  const limitW = status.configuredLimits.exportLimitW;
  currentExportLimitW = limitW;
  const limitPercent = limitW > 0 ? Math.min(100, measurement.gridExportW / limitW * 100) : 0;
  text('export-detail', `${formatNumber(limitPercent, 1)} % von ${formatPower(limitW)}`);
  elements['limit-progress'].style.width = `${limitPercent}%`;

  if (measurement.batteryChargeW > 10) {
    text('battery-value', `${formatPower(measurement.batteryChargeW)} lädt`);
  } else if (measurement.batteryDischargeW > 10) {
    text('battery-value', `${formatPower(measurement.batteryDischargeW)} entlädt`);
  } else {
    text('battery-value', '0 W');
  }
  text('battery-detail', `SOC ${formatNumber(measurement.batterySocPercent, 1)} % · ${measurement.batteryMode || 'Modus unbekannt'}`);

  text('mppt1-power', formatPower(measurement.mppt1W));
  text('mppt1-detail', `${formatNumber(measurement.mppt1VoltageV, 1)} V × ${formatNumber(measurement.mppt1CurrentA, 2)} A`);
  text('mppt2-power', formatPower(measurement.mppt2W));
  text('mppt2-detail', `${formatNumber(measurement.mppt2VoltageV, 1)} V × ${formatNumber(measurement.mppt2CurrentA, 2)} A`);
  text('mppt-total', formatPower(measurement.mpptTotalW));
  text('data-age', formatAge(measurement.recordedAtMs));
  text('poll-interval', status.collector.currentPollIntervalMs
    ? `Abfrageintervall ${formatNumber(status.collector.currentPollIntervalMs / 1000, 0)} s`
    : 'Statische Demodaten');
  updateEvidence(status.analysis);

  if (!selectedDate) {
    selectedDate = measurement.localDate;
    elements['selected-date'].value = selectedDate;
    void loadDay(selectedDate);
  }
}

async function refreshStatus() {
  clearTimeout(liveTimer);
  try {
    updateLive(await fetchJson('/api/v1/status'));
  } catch (error) {
    elements['error-notice'].hidden = false;
    text('error-notice', `Monitor nicht erreichbar: ${error.message}`);
    setConnection('error', 'Monitor nicht erreichbar', 'Der Monitor ist nicht erreichbar.');
  } finally {
    const delay = document.visibilityState === 'visible' ? 3000 : 30000;
    liveTimer = setTimeout(refreshStatus, delay);
  }
}

function updateDaySummary(summary) {
  text('day-pv-max', formatPower(summary.maximumPvDcW));
  text('day-export-max', formatPower(summary.maximumGridExportW));
  text('day-near-limit', formatDuration(summary.nearLimitDurationMs));
  text('day-likely', formatDuration(summary.likelyDurationMs));
  text('day-extra', Number.isFinite(summary.verifiedExtraAvailableW)
    ? `≥ ${formatPower(summary.verifiedExtraAvailableW)}`
    : 'Nicht getestet');
}

const svgNamespace = 'http://www.w3.org/2000/svg';

function svgElement(name, attributes = {}, content = null) {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (content !== null) element.textContent = content;
  return element;
}

function linePath(data, x, y, field) {
  let path = '';
  let started = false;
  for (const point of data) {
    const value = point[field];
    if (!Number.isFinite(value)) {
      started = false;
      continue;
    }
    path += `${started ? 'L' : 'M'}${x(point.timestampMs).toFixed(1)},${y(value).toFixed(1)} `;
    started = true;
  }
  return path.trim();
}

function renderChart(data, exportLimitW) {
  const svg = elements['power-chart'];
  svg.replaceChildren();
  elements['chart-empty'].hidden = data.length > 0;
  svg.hidden = data.length === 0;
  if (!data.length) return;

  const width = 1000;
  const height = 390;
  const margin = { top: 18, right: 20, bottom: 42, left: 68 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const firstMs = data[0].timestampMs;
  const lastMs = Math.max(data.at(-1).timestampMs, firstMs + 60000);
  const maximumW = Math.max(
    exportLimitW || 0,
    ...data.map((point) => Math.max(point.maximumPvDcW || 0, point.maximumGridExportW || 0, point.averageLoadW || 0)),
  );
  const yMaximumW = Math.max(1000, Math.ceil(maximumW * 1.08 / 1000) * 1000);
  const x = (timestampMs) => margin.left + (timestampMs - firstMs) / (lastMs - firstMs) * plotWidth;
  const y = (valueW) => margin.top + plotHeight - valueW / yMaximumW * plotHeight;
  const ySoc = (percent) => margin.top + plotHeight - percent / 100 * plotHeight;

  const evidenceGroup = svgElement('g', { 'aria-hidden': 'true' });
  data.forEach((point, index) => {
    if (point.maximumAnalysisScore < 60) return;
    const nextMs = data[index + 1]?.timestampMs ?? lastMs;
    evidenceGroup.append(svgElement('rect', {
      x: x(point.timestampMs).toFixed(1),
      y: margin.top,
      width: Math.max(1, x(nextMs) - x(point.timestampMs)).toFixed(1),
      height: plotHeight,
      fill: 'var(--solar)',
      opacity: '0.11',
    }));
  });
  svg.append(evidenceGroup);

  const gridGroup = svgElement('g', { 'aria-hidden': 'true' });
  for (let index = 0; index <= 4; index += 1) {
    const valueW = yMaximumW * index / 4;
    const yPosition = y(valueW);
    gridGroup.append(svgElement('line', {
      x1: margin.left, y1: yPosition, x2: width - margin.right, y2: yPosition,
      stroke: 'var(--line)', 'stroke-width': '1',
    }));
    gridGroup.append(svgElement('text', {
      x: margin.left - 10, y: yPosition + 4, 'text-anchor': 'end',
      fill: 'var(--ink-muted)', 'font-size': '12',
    }, `${formatNumber(valueW / 1000, 1)} kW`));
  }
  for (let index = 0; index <= 4; index += 1) {
    const timestampMs = firstMs + (lastMs - firstMs) * index / 4;
    const xPosition = x(timestampMs);
    gridGroup.append(svgElement('line', {
      x1: xPosition, y1: margin.top, x2: xPosition, y2: height - margin.bottom,
      stroke: 'var(--line)', 'stroke-width': '1', 'stroke-dasharray': '3 5',
    }));
    gridGroup.append(svgElement('text', {
      x: xPosition, y: height - 15, 'text-anchor': index === 0 ? 'start' : index === 4 ? 'end' : 'middle',
      fill: 'var(--ink-muted)', 'font-size': '12',
    }, formatTime(timestampMs).slice(0, 5)));
  }
  gridGroup.append(svgElement('text', {
    x: width - margin.right,
    y: margin.top + 11,
    'text-anchor': 'end',
    fill: 'var(--soc)',
    'font-size': '12',
  }, '100 % SOC'));
  gridGroup.append(svgElement('text', {
    x: width - margin.right,
    y: height - margin.bottom - 6,
    'text-anchor': 'end',
    fill: 'var(--soc)',
    'font-size': '12',
  }, '0 % SOC'));
  svg.append(gridGroup);

  const series = [
    ['averagePvDcW', 'var(--solar)', '3', null],
    ['maximumPvDcW', 'var(--solar-dark)', '1.5', '6 5'],
    ['averageMppt1W', 'var(--mppt1)', '1.3', null],
    ['averageMppt2W', 'var(--mppt2)', '1.3', null],
    ['averageGridExportW', 'var(--export)', '2.5', null],
    ['averageLoadW', 'var(--load)', '1.8', null],
  ];
  for (const [field, stroke, strokeWidth, dash] of series) {
    const attributes = {
      d: linePath(data, x, y, field),
      fill: 'none',
      stroke,
      'stroke-width': strokeWidth,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke',
    };
    if (dash) attributes['stroke-dasharray'] = dash;
    svg.append(svgElement('path', attributes));
  }

  svg.append(svgElement('path', {
    d: linePath(data, x, ySoc, 'averageBatterySocPercent'),
    fill: 'none',
    stroke: 'var(--soc)',
    'stroke-width': '1.5',
    'stroke-dasharray': '2 5',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
    'vector-effect': 'non-scaling-stroke',
  }));

  if (Number.isFinite(exportLimitW)) {
    svg.append(svgElement('line', {
      x1: margin.left,
      y1: y(exportLimitW),
      x2: width - margin.right,
      y2: y(exportLimitW),
      stroke: 'var(--danger)',
      'stroke-width': '2',
      'stroke-dasharray': '8 6',
      'vector-effect': 'non-scaling-stroke',
    }));
  }

  svg.setAttribute('aria-label', `Leistungsverlauf am ${selectedDate}. PV-Maximum ${formatPower(Math.max(...data.map((point) => point.maximumPvDcW || 0)))}.`);
}

function renderTable(data) {
  const step = Math.max(1, Math.ceil(data.length / 500));
  const rows = data.filter((_point, index) => index % step === 0).map((point) => {
    const row = document.createElement('tr');
    const values = [
      formatTime(point.timestampMs).slice(0, 5),
      formatPower(point.averagePvDcW),
      formatPower(point.maximumPvDcW),
      formatPower(point.averageGridExportW),
      formatPower(point.averageLoadW),
      formatPower(point.averageMppt1W),
      formatPower(point.averageMppt2W),
      Number.isFinite(point.averageBatterySocPercent) ? `${formatNumber(point.averageBatterySocPercent, 1)} %` : '–',
      point.maximumAnalysisScore >= 80 ? 'Sehr wahrscheinlich'
        : point.maximumAnalysisScore >= 60 ? 'Wahrscheinlich'
          : point.maximumAnalysisScore >= 40 ? 'Möglich' : 'Keine Hinweise',
    ];
    values.forEach((value, index) => {
      const cell = document.createElement(index === 0 ? 'th' : 'td');
      if (index === 0) cell.scope = 'row';
      cell.textContent = value;
      row.append(cell);
    });
    return row;
  });
  elements['measurement-table'].replaceChildren(...rows);
}

async function loadDay(localDate) {
  clearTimeout(dayTimer);
  const requestNumber = ++dayRequestNumber;
  try {
    const [summaryResponse, chartResponse] = await Promise.all([
      fetchJson(`/api/v1/days/${encodeURIComponent(localDate)}`),
      fetchJson(`/api/v1/measurements?date=${encodeURIComponent(localDate)}&maxPoints=1200`),
    ]);
    if (requestNumber !== dayRequestNumber) return;
    updateDaySummary(summaryResponse.data);
    renderChart(chartResponse.data, currentExportLimitW);
    renderTable(chartResponse.data);
  } catch (error) {
    if (requestNumber !== dayRequestNumber) return;
    elements['chart-empty'].hidden = false;
    text('chart-empty', `Tagesdaten konnten nicht geladen werden: ${error.message}`);
  } finally {
    if (requestNumber === dayRequestNumber) {
      dayTimer = setTimeout(() => loadDay(selectedDate), document.visibilityState === 'visible' ? 30000 : 120000);
    }
  }
}

function shiftDate(localDate, days) {
  const date = new Date(`${localDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function selectDate(localDate) {
  selectedDate = localDate;
  elements['selected-date'].value = localDate;
  void loadDay(localDate);
}

elements['selected-date'].addEventListener('change', (event) => {
  if (event.target.value) selectDate(event.target.value);
});
elements['previous-day'].addEventListener('click', () => {
  if (selectedDate) selectDate(shiftDate(selectedDate, -1));
});
elements['next-day'].addEventListener('click', () => {
  if (selectedDate) selectDate(shiftDate(selectedDate, 1));
});
elements['today-button'].addEventListener('click', () => {
  const formatter = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  selectDate(`${parts.year}-${parts.month}-${parts.day}`);
});

document.addEventListener('visibilitychange', () => {
  clearTimeout(liveTimer);
  clearTimeout(dayTimer);
  void refreshStatus();
  if (selectedDate) void loadDay(selectedDate);
});

void refreshStatus();
