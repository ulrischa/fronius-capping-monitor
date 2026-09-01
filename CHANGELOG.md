# Changelog

## Unreleased

### Changed

- Replaced the external `better-sqlite3` package with Node's built-in SQLite module
- Removed npm, Python, and compiler requirements from Raspberry Pi installation
- Rewrote the README in English with dependency-free operating instructions

## 1.0.0 - 2026-09-01

### Added

- Adaptive local Fronius GEN24 polling with explicit power-flow normalization
- SQLite raw-data retention and long-term minute aggregation
- Evidence-based export-curtailment classification and load-step lower bounds
- Responsive German dashboard with preserved short PV peaks
- Read-only REST API, health endpoint, demo mode, tests, and Raspberry Pi systemd setup
