# ADR-001: Use Node.js with plain JavaScript and SQLite

## Status

Accepted

## Date

2026-09-01

## Context

The monitor must continuously collect local Fronius data and also serve a responsive website on a Raspberry Pi. It should remain easy to install, inspect, and update, with no frontend build pipeline.

## Decision

Use Node.js 24.15 or newer from the Node 24 LTS line, ECMAScript modules, plain browser JavaScript, a native HTTP server, and the built-in `node:sqlite` module. Run collector and web server in one systemd service. Use no cron, TypeScript, React, Express, external npm packages, or CDN assets.

## Alternatives Considered

### Express and Chart.js

Both are capable, but unnecessary here. Native Node HTTP and a focused SVG chart keep dependencies and the browser payload small.

### Cron

Cron is unsuitable for adaptive 2–60 second polling, stateful plateau detection, and immediate error recovery.

## Consequences

- One long-running process owns collection, analysis, database access, and the website.
- Installation requires only a system-wide Node.js runtime and Git.
- SQLite is provided by Node itself, so there is no native add-on or package installation step.
- The frontend has no build step and remains usable without internet access.
- The REST API is read-only and versioned from the first release.
