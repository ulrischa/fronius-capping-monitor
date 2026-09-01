import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeCurtailment, calculateExportLimitW } from './analysis.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultPublicDirectory = path.resolve(moduleDirectory, '../public');

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
]);

function applySecurityHeaders(response) {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function send(response, statusCode, body, contentType, isHead = false) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', payload.length);
  applySecurityHeaders(response);
  response.end(isHead ? undefined : payload);
}

function sendJson(response, statusCode, value, isHead = false) {
  send(response, statusCode, JSON.stringify(value), 'application/json; charset=utf-8', isHead);
}

function sendError(response, statusCode, code, message, isHead = false) {
  sendJson(response, statusCode, { error: { code, message } }, isHead);
}

function isValidLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function publicMeasurement(measurement) {
  if (!measurement) return null;
  const { analysis, ...values } = measurement;
  return values;
}

function getCurrentAnalysis(database, collector, config, latest) {
  const stateAnalysis = collector.getState().lastAnalysis;
  if (stateAnalysis && collector.getState().lastSuccessAtMs === latest?.recordedAtMs) return stateAnalysis;
  if (!latest) return null;
  const windowStart = latest.recordedAtMs - config.analysis.plateauWindowSeconds * 1000;
  return analyzeCurtailment(latest, database.getRecentSamples(windowStart), config);
}

function handleApi({ request, response, url, config, database, collector, isHead }) {
  if (url.pathname === '/api/v1/health') {
    const latest = database.getLatestMeasurement();
    const state = collector.getState();
    const dataAgeMs = latest ? Math.max(0, Date.now() - latest.recordedAtMs) : null;
    const unavailable = !latest;
    const degraded = !unavailable && (state.lastError || dataAgeMs > config.polling.nightMs * 3);
    sendJson(response, unavailable ? 503 : 200, {
      status: unavailable ? 'unavailable' : degraded ? 'degraded' : 'ok',
      collectorRunning: state.isRunning,
      databaseAvailable: true,
      latestMeasurementAtMs: latest?.recordedAtMs ?? null,
      dataAgeMs,
      consecutiveErrors: state.consecutiveErrors,
    }, isHead);
    return true;
  }

  if (url.pathname === '/api/v1/status') {
    const latest = database.getLatestMeasurement();
    const state = collector.getState();
    sendJson(response, 200, {
      measurement: publicMeasurement(latest),
      analysis: getCurrentAnalysis(database, collector, config, latest),
      collector: {
        isRunning: state.isRunning,
        lastSuccessAtMs: state.lastSuccessAtMs,
        lastAttemptAtMs: state.lastAttemptAtMs,
        currentPollIntervalMs: state.currentPollIntervalMs,
        consecutiveErrors: state.consecutiveErrors,
        lastError: state.lastError,
      },
      configuredLimits: {
        dcPeakW: config.dcPeakW,
        exportLimitPercent: config.exportLimitPercent,
        exportLimitW: calculateExportLimitW(config),
      },
      timeZone: config.timeZone,
      demoMode: Boolean(config.demoMode),
    }, isHead);
    return true;
  }

  const dayMatch = url.pathname.match(/^\/api\/v1\/days\/([^/]+)$/);
  if (dayMatch) {
    const localDate = decodeURIComponent(dayMatch[1]);
    if (!isValidLocalDate(localDate)) {
      sendError(response, 400, 'INVALID_QUERY', 'date must use a valid YYYY-MM-DD value', isHead);
      return true;
    }
    sendJson(response, 200, { data: database.getDaySummary(localDate) }, isHead);
    return true;
  }

  if (url.pathname === '/api/v1/measurements' || url.pathname === '/api/v1/events') {
    const localDate = url.searchParams.get('date');
    if (!isValidLocalDate(localDate)) {
      sendError(response, 400, 'INVALID_QUERY', 'date must use a valid YYYY-MM-DD value', isHead);
      return true;
    }

    if (url.pathname.endsWith('/events')) {
      sendJson(response, 200, { date: localDate, data: database.getEvents(localDate) }, isHead);
      return true;
    }

    const maxPointsValue = url.searchParams.get('maxPoints') ?? '1200';
    const maxPoints = Number(maxPointsValue);
    if (!Number.isInteger(maxPoints) || maxPoints < 100 || maxPoints > 2000) {
      sendError(response, 400, 'INVALID_QUERY', 'maxPoints must be an integer from 100 through 2000', isHead);
      return true;
    }
    sendJson(response, 200, {
      date: localDate,
      maxPoints,
      data: database.getChartBuckets(localDate, maxPoints),
    }, isHead);
    return true;
  }

  return false;
}

function serveStatic(response, pathname, publicDirectory, isHead) {
  const entry = staticFiles.get(pathname);
  if (!entry) return false;
  const [filename, contentType] = entry;
  const filePath = path.join(publicDirectory, filename);
  if (!fs.existsSync(filePath)) return false;
  const body = fs.readFileSync(filePath);
  response.setHeader('Cache-Control', pathname === '/' || pathname.endsWith('.html') ? 'no-cache' : 'public, max-age=3600');
  send(response, 200, body, contentType, isHead);
  return true;
}

export function createMonitorServer({ config, database, collector, publicDirectory = defaultPublicDirectory }) {
  const server = http.createServer((request, response) => {
    const isHead = request.method === 'HEAD';
    if (request.method !== 'GET' && !isHead) {
      response.setHeader('Allow', 'GET, HEAD');
      sendError(response, 405, 'METHOD_NOT_ALLOWED', 'Only GET and HEAD are supported');
      return;
    }
    if ((request.url?.length || 0) > 2048) {
      sendError(response, 414, 'URI_TOO_LONG', 'Request URL is too long', isHead);
      return;
    }

    try {
      const url = new URL(request.url, 'http://localhost');
      if (handleApi({ request, response, url, config, database, collector, isHead })) return;
      if (serveStatic(response, url.pathname, publicDirectory, isHead)) return;
      sendError(response, 404, 'NOT_FOUND', 'Resource not found', isHead);
    } catch {
      sendError(response, 500, 'INTERNAL_ERROR', 'The request could not be completed', isHead);
    }
  });

  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}
