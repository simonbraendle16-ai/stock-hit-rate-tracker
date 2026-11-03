# Phase 2 · local acceptance · 2026-11-03

Scope: active-trade market-data supply only. No deployment, schedule activation,
second project, migration, personal test records or live broker calls.

Base: main / 4104c590963336b81b68c4c0637a51d706ea82cb, initially clean.
Final changes are local and uncommitted.

- Full regression before final timeout/route changes: 125 files / 1739 tests pass.
- Final affected regression: 24 files / 275 tests pass, 0 failures; regressions.json.
- Final separate TypeScript check: node node_modules/typescript/bin/tsc --noEmit --incremental false, exit 0.
- Final Next build: exit 0, BUILD_ID 7F2M6RqOQHJ-iOEyfysQY, isolated dummy DATABASE_URL.
- git diff --check: exit 0.

Final regression command:
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --testTimeout=20000 lib/market-data lib/fibonacci-db.test.ts lib/analysis-auto-refresh.test.ts lib/demo-cycle.integration.test.ts lib/demo-run.integration.test.ts lib/fx-alert-integration.test.ts --reporter=json --outputFile=docs/phase2-qa/regressions.json

The test timeout was raised only for this local execution: two existing PGlite
startup tests exceeded 5 seconds under competing machine load. They passed
unchanged in the serial final run. The Next build skips integrated typechecking;
TypeScript was therefore run separately. Better Auth warned about the absent
base URL in the isolated build; no production config was changed.

Synthetic PGlite and mocked providers demonstrate mechanics, not live provider
availability, actual Neon-byte savings or independent production hosts. Browser
polling effects were tested with simulated time; there is no new visual layout.
Existing hourly/provider limits and rotation remain; partial coverage is possible.
Historical/personal data is not pruned. The external schedule is prepared only in
.github/workflow-templates/active-trade-market-data.yml.disabled.

Full German acceptance and requirement mapping:
C:/Users/sabin/Documents/Trading-Assistent/06_Integrationen/Zwei-Projekte-Phase2-Kursversorgung-2026-11-03.md

Stop after Phase 2. Do not begin Phase 3 from this report.
