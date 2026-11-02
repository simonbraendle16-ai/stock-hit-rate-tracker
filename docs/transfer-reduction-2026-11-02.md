# Transfer reduction: wave collection and recurring reads

The collection workspace now loads at most 50 compact rows and SQL population
counts. Details are owner-scoped single-record reads. Form link choices contain
only IDs and labels; large trade metrics, histories and full research datasets
load only when the advanced workspace is opened. Existing research semantics
remain on that full-population path. Normal collection saves skip broad path
revalidation, reread one confirmed observation and reload only the compact page.
Other tabs receive a change signal without personal payloads. An open form is
never replaced by a background response.

Wave validation projects hierarchy and context fields instead of full evidence.
Request-scoped token identity and audit promises avoid duplicate authentication
queries while checking every requested scope; new requests still check revocation.

Migration 0059 enables unchanged warm knowledge manifests to check a revision
token rather than fetch six payload tables. `X-Manifest-Read` reports `full-read`
or `revision-cache`, including conditional 304 responses, for release validation.
Cold starts still need the payload; the cache is bounded and owner-specific.

Migration 0060 and `BACKGROUND_ACTIVITY_GATE=1` track authenticated visible app
usage. Five minutes without a visible session switches automatic alerts, demo
cycles and candle collection to one claim per job per fifteen minutes. Any active
user conservatively keeps the application active. Explicit authorized manual
requests bypass the automatic gate. The UI explains the delayed idle behavior.
No broker orders or personal risk settings are changed.

Candle refresh now compares OHLCV inside `ON CONFLICT ... DO UPDATE ... WHERE
IS DISTINCT FROM`. No provider-sized historical comparison window is fetched.
Unchanged rows are not updated; corrected and new candles retain prior semantics.

Rollback: disable `BACKGROUND_ACTIVITY_GATE` and `KNOWLEDGE_MANIFEST_REVISION`
and redeploy. Derived migration tables can remain. Restore the earlier application
commit if needed; do not restore old personal data over newer user changes.
The legacy manifest path has higher transfer and must be included in the budget.

Local checks cover full-population counts/pagination, detailed readback, existing
wave contracts, token scopes and revocation, idle job claims, real conditional
candle writes, and browser series entry/correction/multiple tabs/responsive layouts.
Synthetic payload sizes and socket comparisons are mechanisms, not provider-billed
monthly usage. A real 24-hour and seven-day observation window remains necessary.
