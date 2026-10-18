# Categorical Fibonacci research — local implementation

Branch `feat/fibonacci-form-20261018`, based on `13ff78d`. Implements the confirmed form and duration-grouping plan from 18 October 2026. Not deployed; no personal data migrated.

## Contract

The existing observation routes and CSV format remain. GET adds a versioned `catalogue` (levels, waves, structures and duration classes). `stats.categorical` and `statsByKind.*.categorical` expose level reach frequencies, observed reversal distributions, target reversal hit rates, structure families/subtypes and duration class distributions with observation IDs and exclusions. `structure=<code>` and `structure=family:<code>` filters combine with `wave`, `degree` and `timeframe`.

Additive evidence fields: `catalogueVersion:1`, `structureCode`, `entryZone`, `targetContact`, `expectationTiming`, `reversalLocation`, `durations`. The duration subkeys `wave`, `reversal`, `residence` store a class code, time basis and convention; residence additionally stores its own zone snapshot. Existing `targetZone`, `reversalZone`, `reachedLevels`, `missedLevels` and `targetZoneResidence` remain available. Categorical input does not create an exact `percent` measurement.

At-level reversal uses equal boundaries and explicitly identifies a reached level. A zone explicitly marked not reached identifies the contained catalogue levels as missed. Other missing level information remains unknown. No arbitrary intermediate level or exact maximum is inferred. Between-level reversals remain interval categories. Target hit means reversal inside the expected zone, including boundaries; merely touching/passing through does not establish a hit. Overlapping ambiguous reversal intervals remain unknown.

New observations require known direction and timeframe in the shared save service; older incomplete rows remain editable. Notes and source references are optional. Expansion does not require a measurement basis. Technical provenance is added by the form without another user input.

Duration groups are separated by duration type, wave, degree, timeframe, measurement kind, zone, time basis, measurement convention, and applicable trading unit. Class frequencies do not have an arithmetic mean. Historical exact residence averages are also stratified by wave, degree, timeframe, measurement kind and zone. Generic historical wave/reversal durations no longer expose a mixed average.

## Compatibility and migration

Migration `0057_fibonacci_categorical_form.sql` removes the expansion-basis constraint, permits empty notes within the existing 2,000-character limit, and adds an empty-note default. It changes no observation or revision values and can be applied repeatedly. The base migration helper includes 0057 so rerunning it cannot silently reinstate the old requirements. The separate migration CLI defaults to no database access; explicit application fingerprints all existing rows.

Apply 0057 before deploying the new writer. Preserve the evidence column and revisions. Older PATCH clients retain new fields they omit; catalogue-v1 evidence also retains previously known evidence fields. Explicit individual null/empty values clear supported fields, subject to consistency validation. `evidence:null` is rejected when it would discard protected new metadata. New residence classes have an independent zone snapshot even if the general target changes.

Historical exact percentages and unresolved structure text are retained. Only unambiguous legacy structure aliases are mapped when reading. Legacy arbitrary levels are never rounded into catalogue levels. Rollback must retain new evidence; restoring the old SQL requirements or deploying an older strict writer is not automatically compatible with newly valid rows.

## Verification

- Full local suite: 102 files / 1,488 tests passed, including real isolated PGlite/HTTP route tests.
- Separate TypeScript validation passed. Final production-build result and actual local Next.js HTTP evidence are recorded in the Trading-Assistent integration report.
- Cases include the C target miss, no note/basis, known-only denominators, reversal frequency without a target, inclusive edges, unknown/overlapping intervals, deduplication and retries, timeframe/degree/zone separation, calendar versus trading time, class boundaries, repeated migration with unchanged rows/revisions, and older PATCH preservation.
- Browser automation could not complete: Edge CDP focus/navigation timed out repeatedly; the integrated browser was unavailable. No desktop/mobile visual acceptance is claimed. Local QA uses only synthetic data on ports 3026/5549.

Reproduce synthetic runtime QA with `FIBONACCI_QA_PORT=3026`, `FIBONACCI_QA_DB_PORT=5549`, `node --experimental-strip-types scripts/fibonacci-local-preview.mjs --production`, then `node scripts/verify-fibonacci-categorical-local.mjs`. The runner verifies the dedicated QA owner before writing and removes its temporary API token.
