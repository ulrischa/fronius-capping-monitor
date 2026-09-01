# Fronius Curtailment Monitor

A lightweight local monitor for Fronius GEN24 systems. It records high-resolution Solar API data, displays it in a responsive dashboard, and provides transparent evidence of whether dynamic export curtailment is probably active.

The application runs continuously on a Raspberry Pi, listens on its own configurable port, and does not depend on Fronius Solar.web or another cloud service.

**German documentation:** [Benutzerhandbuch und Interpretation der Ergebnisse](docs/handbuch-de.md)

## Features

- Polls two local Fronius Solar API endpoints per measurement cycle
- Adaptive polling: every 2 seconds near the export limit, every 10 seconds during normal production, and every 60 seconds at night
- Built-in SQLite storage with 14 days of raw data and long-term minute aggregates
- No external npm packages, native add-ons, Python, compiler, or build step
- Explicit signs for grid export, grid import, household load, and battery power
- PV DC power, inverter AC power, and separate values for both MPPTs
- Configured export limit, distance from the limit, battery state, and plateau detection
- Evidence levels instead of unsupported certainty
- Load-step detection as an observed lower bound for additional available PV power under controlled conditions
- Daily maxima and durations near or probably at the export limit
- Daily chart with averages while preserving short PV and export peaks
- Responsive, accessible frontend without external CDN assets
- Read-only REST API and health endpoint
- Demo mode that works without an inverter

Cron is not suitable for this application. Polling intervals of 2 to 60 seconds, stateful plateau detection, and immediate error recovery require a continuously running process. The supplied systemd service starts the monitor after boot and restarts it after failures.

## Requirements

- Raspberry Pi 3, 4, or 5 with 64-bit Raspberry Pi OS
- Node.js **24.15 or newer from the Node 24 LTS line**, installed system-wide
- Git
- Raspberry Pi and Fronius GEN24 on the same local network
- Solar API enabled on the GEN24
- A fixed or DHCP-reserved IP address for the inverter

Check the installed runtime:

```bash
node --version
```

The version must be at least `v24.15.0` and lower than `v25.0.0`. Use the [official Node.js download page](https://nodejs.org/en/download) and install Node system-wide so that it is available as `/usr/bin/node` or `/usr/local/bin/node`.

The monitor uses Node's built-in `node:sqlite` module. It has no runtime dependencies, and npm is not required for installation or operation.

## Quick start

```bash
git clone https://github.com/ulrischa/fronius-capping-monitor.git
cd fronius-capping-monitor
cp config/config.example.json config/config.json
nano config/config.json
node --test
node src/index.js
```

Open the dashboard at:

```text
http://RASPBERRY-PI-IP:3200
```

Run the dashboard with simulated data:

```bash
node src/index.js --demo
```

Collect one real sample without starting the permanent server:

```bash
node src/index.js --sample
```

## Configuration

For manual operation, use `config/config.json`. The systemd installation uses `/etc/fronius-monitor/config.json`.

```json
{
  "froniusHost": "192.168.178.50",
  "deviceId": 1,
  "dcPeakW": 14260,
  "exportLimitPercent": 60,
  "exportLimitW": null,
  "port": 3200,
  "bindAddress": "0.0.0.0",
  "timeZone": "Europe/Berlin",
  "databasePath": "data/fronius-monitor.sqlite"
}
```

- `froniusHost`: Inverter IP address or local hostname without `http://` and without a path.
- `deviceId`: Inverter device ID. The example responses for this installation use `1`.
- `dcPeakW`: Exact installed module capacity in watts peak. Use `14260` for 14.26 kWp instead of rounding to 14.3 kWp.
- `exportLimitPercent`: Percentage-based export limit, expected to be `60` for this installation.
- `exportLimitW`: Optional absolute limit in watts. When set, it takes precedence over the percentage.
- `port`: Dedicated dashboard port. Use another value such as `3210` if `3200` is already occupied.
- `bindAddress`: `0.0.0.0` exposes the dashboard on the local network. `127.0.0.1` restricts it to the Raspberry Pi itself.
- `timeZone`: IANA timezone used for daily grouping, normally `Europe/Berlin` in Germany.
- `databasePath`: SQLite database location for manual operation.

Other applications on the Raspberry Pi remain unaffected as long as each service uses a different port.

## Install as a Raspberry Pi service

Install Git and clone the repository after Node.js 24.15 or newer has been installed system-wide:

```bash
sudo apt update
sudo apt install -y git
git clone https://github.com/ulrischa/fronius-capping-monitor.git
cd fronius-capping-monitor
```

Install the service:

```bash
sudo bash scripts/install-service.sh
```

On the first run, the installer creates the configuration but deliberately does not start the service. Edit the required values and then enable it:

```bash
sudo nano /etc/fronius-monitor/config.json
sudo systemctl enable --now fronius-monitor
```

Check service status and live logs:

```bash
sudo systemctl status fronius-monitor
sudo journalctl -u fronius-monitor -f
```

Check the health endpoint:

```bash
curl http://127.0.0.1:3200/api/v1/health
```

Restart after a configuration change:

```bash
sudo systemctl restart fronius-monitor
```

The service runs as a dedicated unprivileged user, can write only to `/var/lib/fronius-monitor`, and is restarted automatically after a failure.

## Value definitions

Fronius responses use negative values for several power flows leaving a component. The application normalizes them into unambiguous positive values:

| Fronius field | Raw sign | Dashboard meaning |
| --- | ---: | --- |
| `P_Grid` | negative | positive grid export |
| `P_Grid` | positive | positive grid import |
| `P_Load` | negative | positive household load |
| `P_Akku` | negative | battery charging |
| `P_Akku` | positive | battery discharging |
| `P_PV` | positive | current PV DC power |
| `PAC` | positive | inverter AC active power |

MPPT power is calculated independently as `UDC × IDC` and `UDC_2 × IDC_2`. Their sum can be compared with `P_PV` as a consistency check.

## Curtailment evidence

The Solar API does **not** expose the currently available uncurtailed PV power. The monitor therefore does not invent an exact lost-power or lost-energy value.

It classifies observable evidence:

- `Possible`: Grid export is within the configured tolerance of the export limit.
- `Likely`: Grid export is near the limit and either the battery is full or a stable plateau at the limit is present.
- `Very likely`: Grid export remains on a stable plateau at the limit while the battery is full.

The score shown by the dashboard is a heuristic evidence score, **not a statistical probability**.

A single cloud-related measurement can accidentally be close to the limit. A sustained plateau is materially stronger evidence.

### Load-step test

This is the strongest local test without changing inverter settings:

1. Wait until the battery is full and grid export is stable at the configured limit.
2. Prefer stable irradiance without fast-moving clouds.
3. Switch on a known large load, for example a 2 kW heater.
4. If `P_PV` rises by approximately the additional load while grid export remains at the limit, the monitor records a `LOAD_STEP` event.

The observed PV increase is reported as a **lower-bound observation under these test conditions**, not as an exact amount of previously lost power. Repeating the test under stable irradiance makes the evidence substantially stronger.

## Data retention

- Raw measurements: 14 days by default
- Older measurements: compacted into minute aggregates
- Preserved information: averages, short PV and export peaks, MPPT maxima, and evidence durations
- systemd database: `/var/lib/fronius-monitor/fronius-monitor.sqlite`

Create a safe backup:

```bash
sudo systemctl stop fronius-monitor
sudo cp /var/lib/fronius-monitor/fronius-monitor.sqlite /PATH/TO/BACKUP/
sudo systemctl start fronius-monitor
```

The database schema is unchanged when upgrading from the former `better-sqlite3` implementation. Existing monitor databases remain compatible.

## Update

From the cloned repository directory:

```bash
git pull --ff-only
sudo bash scripts/install-service.sh
```

The installer preserves the existing configuration and database, updates the application files, and restarts an existing service.

## REST API

The API is read-only:

- `GET /api/v1/health`
- `GET /api/v1/status`
- `GET /api/v1/days/YYYY-MM-DD`
- `GET /api/v1/measurements?date=YYYY-MM-DD&maxPoints=1200`
- `GET /api/v1/events?date=YYYY-MM-DD`

See [`docs/api.md`](docs/api.md) for the complete contract.

## Development

The project uses plain JavaScript without TypeScript, React, external packages, or a build step.

```bash
node --watch src/index.js
node --test
node --check src/database.js
```

The npm scripts remain available as optional shortcuts if npm is installed:

```bash
npm run dev
npm test
npm run check
```

Project structure:

```text
src/       Collector, analysis, SQLite, REST API, and server
public/    HTML, CSS, JavaScript, and SVG chart
test/      Unit and integration tests
config/    Example configuration
scripts/   systemd unit and installer
docs/      API, German guide, and architecture decisions
```

## Troubleshooting

### No data

```bash
curl http://FRONIUS-IP/solar_api/v1/GetPowerFlowRealtimeData.fcgi
```

If this request fails, enable the Solar API on the GEN24 and verify its network address and reachability.

### Port already in use

```bash
sudo ss -ltnp | grep ':3200'
```

Change `port` in the configuration and restart the service.

### Service does not start

```bash
sudo systemctl status fronius-monitor
sudo journalctl -u fronius-monitor -n 100 --no-pager
```

Confirm that the system-wide Node.js version is at least `v24.15.0` and lower than `v25.0.0`.

### Wrong time or day boundary

Use `Europe/Berlin` as `timeZone` for Germany. Measurements are stored as timestamps and grouped into local calendar days only when queried.

## Security

The Fronius Solar API is normally readable without authentication inside the local network. The monitor exposes no write operation and does not accept a user-controlled target URL through the dashboard. Do not forward the dashboard port directly to the internet. Use a VPN such as WireGuard or Tailscale for remote access.
