# Alarm scheduler recovery

Individual unresolved alarms must not stop recurring checks for every account.
cron-job.org documents automatic deactivation after more than 25 consecutive
failures: https://cron-job.org/en/faq/.

The route now separates an accepted batch from a healthy complete alarm pass:

- 200: complete healthy pass, `ok=true`, `complete=true`.
- 202: batch processed but retry needed, or another worker holds the lease.
  `ok=false`, `complete=false`; quote/mail errors remain persisted and visible.
- 503: worker execution failed; 401 and missing-secret 500 are unchanged.

No unresolved alarm is disabled or assigned an invented quote source. Trade
history, alarm thresholds, recipients, retry cadence and price freshness checks
are unchanged. `processed` is true only after batch processing and checkpoint
handling have returned normally; persistence/release exceptions still yield 503.

The UI now detects a missing heartbeat using the last automatic attempt, even
when no healthy pass has ever succeeded. A fresh failed attempt remains a
visible alarm-processing failure, not a falsely reported dead scheduler.

PostgreSQL integration tests cover degraded multi-batch progress, preserved
unhealthy status, lease contention, and real read failures returning 503.
Deployment and actual scheduled execution must be checked separately; a manual
recovery call does not prove the external scheduler is active.
An authenticated recovery call with `x-alert-check-origin: manual` is stored as
`trigger=manual` and excluded from automatic heartbeat/health evidence. It uses
the same lease and resumable cursor; it does not create another scheduler.
