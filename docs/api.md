# Read-only REST API

All responses use JSON and a versioned `/api/v1` prefix. Errors have the shape:

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "date must use YYYY-MM-DD"
  }
}
```

## `GET /api/v1/health`

Returns process health, database availability, collector state, and age of the latest valid measurement. HTTP status is `200` when healthy or degraded and `503` when no usable data has been collected.

## `GET /api/v1/status`

Returns safe configuration, the latest normalized measurement, current evidence analysis, and the most recent collector error. No raw Fronius response or configured host is exposed.

## `GET /api/v1/days/:date`

Returns a summary for a local calendar date in configured time zone. `date` must be `YYYY-MM-DD`.

## `GET /api/v1/measurements?date=YYYY-MM-DD&maxPoints=1200`

Returns chart buckets for one local date. `maxPoints` is limited to 100–2000. Each bucket preserves average and maximum PV/export values so short peaks remain visible without returning every raw sample.

## `GET /api/v1/events?date=YYYY-MM-DD`

Returns at most 100 curtailment-evidence events for the selected date, newest first.
