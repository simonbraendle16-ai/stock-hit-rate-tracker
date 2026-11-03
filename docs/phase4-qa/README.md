# Phase 4: release and operational read proof

Phase-2/3 implementation preserved; same 66 accepted source fingerprints. Phase-3 full regression (1811 tests), final build and desktop/mobile functional acceptance remain historical source-specific evidence.

Phase 4 adds only authenticated bounded stored-market health reads (one series and one candle, no provider fetch or data values) and 3 security/error tests. Together with 2 collector contract tests: 5 passed, separate typecheck and isolated production build passed. See release-checks.json and build.log.

Production migration/release evidence is maintained in the Trading-Assistent project: 06_Integrationen/Zwei-Projekte-Phase4-Uebernahme-2026-11-03.md. Do not infer production completion from this prepared release. Hourly market-only workflow is now prepared for the Phase-4 release under the confirmed 60-minute active-trade requirement. No demo, broker or alert activation. See hourly-workflow.json; actual GitHub activation is checked after publication.

## Exact timestamp repair before release

The final full SQL comparison detected microsecond truncation in all 120 collect-run start timestamps, despite the original JavaScript-level SHA comparisons. Candle and series contents matched. Only those copied target timestamp fields were repaired from the still-fenced source using PostgreSQL JSONB. No source or personal records changed. The migration reader now emits exact six-digit UTC timestamp text. A new isolated microsecond/NULL/timezone/resume/reverse regression failed before the change; all 11 relevant tests passed afterward, followed by a separate typecheck. 64 of 66 previously accepted sources remain byte-identical; the two reviewed changes are the migration operator and its new regression. App/UI code and final isolated application build remain unchanged. Full real SQL contents, schema, keys/indexes, coverage and sequence now match exactly. See precision-proof.json, precision-before/after.json and verify-ready.json.
