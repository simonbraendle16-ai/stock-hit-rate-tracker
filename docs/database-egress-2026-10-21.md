# Knowledge manifest: reduce unused database column transfer

Status: tested code change; production availability and hybrid migration remain open.

The production API returned HTTP 503 on October 21. October 20 control-plane
metadata identified the existing Neon Free project transfer quota as exhausted.
The user reaffirmed a strict zero-additional-cost requirement on October 21.
This change does not reset that allowance or restore a suspended database.

## Change

`lib/knowledge-manifest.ts` now selects fingerprint-relevant columns in SQL:
17 trade columns, 12 journal columns and 9 insight columns. Child rows retain
all fingerprint-relevant columns; their owner columns remain SQL predicates.
Previously, complete rows were fetched and unused columns discarded in JS.

The manifest remains complete, owner-scoped, repeatable-read and read-only.
The six batched reads, fingerprint algorithm, ETag, schema version, polling
frequency, deletion detection and public response shape remain unchanged.
No schema migration, production data writes, archival or deletion is involved.
Repeated full-manifest scans still need a separately verified incremental design.

## Verification and cross-examination

- 111 test files / 1,638 tests passed; separate TypeScript check passed.
- Production build passed. Existing local Better Auth base-URL warnings remain;
  no authentication configuration was changed.
- New local PGlite suite compares actual projected SQL results against the legacy
  full-row fingerprint path using every real schema column and 120 owned trades.
- Checks foreign owners, parent edits, journal/insight edits, each child table
  without parent version updates, nulls, deletions, empty owners and reappearance.
- Synthetic SQL-result JSON bytes fall below one tenth of baseline when a
  deliberately oversized unused 64-KiB column is present. This demonstrates the
  projection mechanism, not production savings or PostgreSQL protocol bytes.
- Snapshot settings are asserted from emitted SQL. No production connection or
  environment loader is used by the added database test.

## Remaining acceptance gates

Restore access without charges or data reset. Then obtain a consistent encrypted
full backup, restore it in isolation and reconcile all later changes before any
migration/deletion. Measure representative production query/job transfer and
forecast the month with reserve. Test the hybrid archive as an additional copy,
including computer-off cloud operation, interruptions, concurrent writes and a
rollback preserving post-cutover edits. Verify the real website and statistics
studio. Code deployment alone does not satisfy these gates.

Neon documents suspension until the next billing period or upgrade, and says the
quota does not delete stored data:
https://neon.com/docs/introduction/plans#what-happens-if-i-exceed-my-free-plan-limits
