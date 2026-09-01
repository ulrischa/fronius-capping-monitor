# Implementation Plan: Fronius Curtailment Monitor

## Overview

Implement one low-dependency Node.js service that polls the local Fronius Solar API, records measurements, evaluates curtailment evidence, and serves a responsive dashboard from a configurable port.

## Architecture Decisions

- Plain JavaScript and native HTTP/fetch instead of TypeScript, Express, or a frontend framework to eliminate the build step.
- Built-in `node:sqlite` instead of an external native package.
- Browser polling of the local REST API instead of WebSockets; the Fronius poller remains independent and adaptive.
- Evidence levels and load-step lower bounds instead of invented lost-energy estimates.

## Task List

### Phase 1: Foundations

- [x] Specify configuration, normalized measurement model, and API contract.
- [x] Implement and test Fronius validation and normalization.
- [x] Implement and test curtailment evidence analysis.

### Checkpoint: Foundations

- [x] Pure logic tests pass and measured/inferred values remain clearly separated.

### Phase 2: Persistence and service

- [x] Add SQLite schema, prepared queries, retention, and aggregation.
- [x] Add adaptive collector, failure recovery, and load-step event detection.
- [x] Add read-only versioned REST API and health endpoint.

### Checkpoint: Service

- [x] Fake-Fronius integration test records and returns a complete measurement.

### Phase 3: Dashboard and operation

- [x] Add responsive live dashboard, daily SVG chart, evidence explanation, and table alternative.
- [x] Add demo mode and runtime smoke verification.
- [x] Add Raspberry Pi install script, systemd unit, README, and ADR.

### Checkpoint: Complete

- [x] Tests, syntax checks, dependency audit, HTTP/UI smoke checks, and code review pass.
- [x] ZIP artifact contains no runtime database, secrets, or `node_modules`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| API fields differ by firmware | Medium | Validate defensively, retain null for absent optional fields, surface clear error state |
| Weather resembles curtailment | High | Use evidence levels and reasons; require plateau/full battery or load-step evidence for stronger claims |
| Short peaks disappear in charts | Medium | Store raw samples and return average plus min/max per chart bucket |
| Database grows indefinitely | Medium | Compact older raw data into minute aggregates and retain daily summaries/events |
| Unsupported Node version | Medium | Require and validate Node 24.15 or newer from the Node 24 LTS line |

## Open Questions

- Exact DC peak power and Fronius host are supplied in `config/config.json` during installation.
