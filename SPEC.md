# Spec: Fronius Curtailment Monitor

## Objective

Build a small, local monitoring service for a Fronius GEN24 system. It records high-resolution Solar API values, explains the power flow with correct Fronius sign conventions, detects evidence of export curtailment, and presents live and historical data in a responsive German dashboard.

The application must not present estimated uncurtailed output or lost energy as measured facts. It may report evidence levels and verified lower bounds from load-step events.

## Tech Stack

- Node.js 24 LTS, ECMAScript modules, plain JavaScript
- Native Node.js HTTP server and `fetch`
- SQLite through `better-sqlite3`
- Plain HTML, CSS, SVG, and browser JavaScript
- Native `node:test` test runner
- One long-running systemd service; no cron and no build step

## Commands

- Install: `npm ci --ignore-scripts`, inspect the dependency, then `npm rebuild better-sqlite3`
- Development: `npm run dev`
- One API sample: `npm run sample`
- Test: `npm test`
- Lint/syntax check: `npm run check`
- Production: `npm start`

## Project Structure

- `src/` — collector, validation, analysis, database, API, and server
- `public/` — responsive dashboard, styles, and chart code
- `test/` — unit and integration tests
- `config/` — example runtime configuration
- `scripts/` — Raspberry Pi installation helpers and systemd unit
- `docs/decisions/` — architectural decisions
- `tasks/` — implementation plan and checklist
- `data/` — runtime database, excluded from Git

## Code Style

Use descriptive camelCase names, small modules, early validation, and English code comments only when they explain non-obvious intent.

```js
export function toGridExportW(pGridW) {
  return Number.isFinite(pGridW) ? Math.max(0, -pGridW) : null;
}
```

## Testing Strategy

- Pure unit tests for sign normalization, Fronius response parsing, adaptive intervals, evidence scoring, time-zone handling, and load-step evidence.
- Database integration tests against temporary SQLite files.
- HTTP integration tests with a fake Fronius server.
- Browser smoke and responsive visual checks against deterministic demo data.

## Boundaries

- Always: validate configuration and Fronius responses, use prepared SQL, cap query ranges and response sizes, retain raw readings before compacting, distinguish measured values from inferences.
- Ask first: add write-capable Fronius API calls, expose the service outside the trusted LAN, add authentication, or change the stored data model incompatibly.
- Never: change inverter settings, claim an exact uncurtailed power value, claim exact curtailed energy without an external reference, accept arbitrary fetch URLs through the web API, or commit live IP addresses and credentials.

## Success Criteria

- Runs on Raspberry Pi OS 64-bit on configurable port `3200` alongside other services.
- Polls both Fronius endpoints adaptively and independently from dashboard clients.
- Stores DC PV, AC inverter, grid, load, battery, SOC, and MPPT 1/2 values in SQLite.
- Correctly displays negative `P_Grid` as export, negative `P_Load` as consumption, and negative `P_Akku` as charging.
- Shows live status, daily maximums, export-limit distance, evidence reasons, time near the limit, and load-step evidence.
- Shows a responsive daily chart with averages and preserved short peaks, plus an accessible data table.
- Continues after temporary Fronius/network failures and surfaces data age and errors.
- Includes systemd setup, backup/update guidance, health endpoint, tests, and no frontend build step.

## Open Questions

None block implementation. The exact Fronius IP and exact installed DC peak power remain runtime configuration.
