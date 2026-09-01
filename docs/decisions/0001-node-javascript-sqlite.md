# ADR-001: Use Node.js with plain JavaScript and SQLite

## Status

Accepted

## Date

2026-09-01

## Context

The monitor must continuously collect local Fronius data and also serve a responsive website on a Raspberry Pi. It should remain easy to install, inspect, and update, with no frontend build pipeline.

## Decision

Use Node.js 24 LTS, ECMAScript modules, plain browser JavaScript, a native HTTP server, and SQLite through `better-sqlite3`. Run collector and web server in one systemd service. Use no cron, TypeScript, React, Express, or CDN assets.

## Alternatives Considered

### Python

Python is an excellent fit for the collector alone. With a website, however, it introduces the same application layers while splitting the user's preferred JavaScript workflow across two languages.

### Node's built-in `node:sqlite`

It removes the only native dependency, but the official Node.js documentation still marks it as a release candidate rather than stable. The monitor favors the mature `better-sqlite3` API.

### Express and Chart.js

Both are capable, but unnecessary here. Native Node HTTP and a focused SVG chart keep dependencies and the browser payload small.

### Cron

Cron is unsuitable for adaptive 2–60 second polling, stateful plateau detection, and immediate error recovery.

## Consequences

- One long-running process owns collection, analysis, database access, and the website.
- Installation requires one native SQLite package; current supported Node releases normally receive prebuilt binaries.
- The frontend has no build step and remains usable without internet access.
- The REST API is read-only and versioned from the first release.
