# Closing an already imported broker position

Problem: the initial execution import stores open positions without a realized outcome. A later closed receipt conflicts with that initial immutable import, leaving an obsolete open status.

New endpoint: `POST /api/assistant/v1/trades/{id}/execution-import`, write scope, `X-Expected-Version` and UUID `Idempotency-Key`. Body contains `import` (same complete evidence structure as initial import) and a nonempty `reason`. This endpoint only closes an active broker-execution import. It cannot rewrite an existing closed receipt, change its opening facts, change account/position identity, move a portfolio, or create a broker order.

The existing owner/portfolio lock, transaction, version and idempotency service wraps the update. Actual closing evidence is normalized with the initial validator, including net/fees consistency. Notes, plan fields and personal reviews are preserved. The previous complete receipt and replacement are kept in a note event; no units-based execution is fabricated from lots. The import hash is updated so reimporting the identical final receipt is idempotent. No schema migration.

Validation: 8 isolated PGlite/HTTP import tests passed (including closing history, replay, source identity, version and auth guards); separate TypeScript validation passed; production build with synthetic configuration passed and lists the route. No real accounts or database used in these tests. New endpoint not yet published or used on real data at this document's preparation time. Publishing remains subject to the user's project release authorization.
