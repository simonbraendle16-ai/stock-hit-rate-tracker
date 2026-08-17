# Plan: Supabase-Egress dauerhaft unter das Free-Limit bringen

**Erstellt:** 2026-08-16
**Projekt:** trading-app (Supabase-Ref `jkflmriwaveicnippkkk`, Org „Simon" `xlxsdcrcrbwiswqwgwrj`)
**Status (17.08.2026):** Schritte **A, B, C umgesetzt** — siehe §7. Schritt D freigegeben,
aber bewusst noch nicht umgesetzt. Absicherung 3.2/3.3 und Retention 3.4 offen.
**Ziel:** Der Egress bleibt dauerhaft unter 5 GB/Monat, ohne dass jemand daran denken muss.

---

## 1. Befund (gemessen, nicht vermutet)

### Was gerissen wurde

| Metrik | Verbrauch | Limit | |
|---|---|---|---|
| **Ausgang (Egress)** | **7,03 GB** | 5 GB | **141 % — 2,03 GB drüber** |
| Datenbankgröße | 0,357 GB | 0,5 GB | 71 % |
| Edge Function Calls | 921 | 500.000 | <1 % |
| MAU | 1 | 50.000 | <1 % |
| Storage / Realtime / Cached Egress | 0 | — | 0 % |

Abrechnungszyklus 06.08.–06.09.2026. Das Dashboard nennt es wörtlich „Egress Exceeded".
Quelle: Supabase-Usage-Dashboard, abgelesen am 16.08.2026.

### Wer es verursacht

trading-app zu ~100 %. Die Projektfilter-Ansicht zeigt für trading-app dieselbe Kurve wie
die Org-Summe; task-champion ist flach bei einer Achsenskala von max. 848 KB.

**Tagesverlauf trading-app:** 06.–09.08. ≈ 0 → **11.08. ~2,4 GB, 12.08. ~1,5 GB,
13.08. ~1,3 GB** → seit 14.08. **~0,3 GB/Tag**.

Der Berg ist einmalig (Neon→Supabase-Umzug + Historien-Backfill). Der Sockel von
0,3 GB/Tag läuft weiter — **das ist das eigentliche Problem.**

### Womit

`pg_stat_statements` in trading-app, zwei Queries auf `candle_cache`:

| Query | Aufrufe | ⌀ Zeilen | Zeilen gesamt | Anteil |
|---|---|---|---|---|
| `select time,open,high,low,close,volume from candle_cache where symbol=$1 and interval=$2 order by time desc limit $3` | 63.471 | 751 | **47,6 Mio** | 64 % |
| `… where symbol=$1 and interval=$2 and time >= $3 order by time asc` — **ohne LIMIT** | 7.792 | 3.442 | **26,8 Mio** | 36 % |
| | | | **74,5 Mio** | |

**Gegenprobe:** 74,5 Mio Zeilen × ~90 Byte Postgres-Wire je Zeile (4 B `time` int4 +
5 × 8 B `double` + 6 × 4 B Längenfelder + Row-Header + TLS/TCP-Overhead) ≈ **6,7 GB**.
Gemessen: 7,03 GB. Die Ursache ist damit belegt.

**Warum es über den Pooler läuft:** trading-app hat keine `edge_logs` — nur
`supavisor_logs` (956) und `postgres_logs` (127). Der gesamte Verkehr geht als rohes
Postgres-Wire-Protokoll durch Supavisor, nicht über PostgREST.

### Die drei Stellen im Code

1. **`lib/market-data/candle-store.ts:295`** — das „Vergleichsfenster" liest
   `since = min(frische Kerzen)` **ohne jedes Limit**. Liefert der Provider eine lange
   Reihe, zieht ein einzelner Aufruf mehrere tausend Kerzen. → die 3.442 im Schnitt.

2. **`lib/market-data/types.ts:73`** — `DELIVERY_LIMIT` steht für `15min`/`30min`/`1h`/
   `4h`/`1day` auf **900**, `1week` 600, `1month` 300. Jeder Standard-Abruf schickt also
   bis zu 900 Kerzen; der ⌀ von 751 zeigt, dass das die Regel ist, nicht die Ausnahme.

3. **`lib/market-data/candle-store.ts:88-89`** — `readStoredCandles` hat einen Pfad ganz
   **ohne Limit**:
   ```ts
   if (!begrenzt) {
     return db.select(spalten).from(candleCache).where(and(...bedingungen)).orderBy(asc(candleCache.time))
   }
   ```
   Das ist das strukturelle Loch: Solange dieser Pfad existiert, kann jeder neue Aufrufer
   das Problem morgen wieder aufreißen. Punkt 1 ist nur der eine Aufrufer, der ihn heute trifft.

### Kontext: das ist ein Wiederholungsfall

Die Kommentare in `candle-store.ts:55-60` und `quote.ts:48-49` beschreiben exakt diesen
Mechanismus — er hat vorher schon die **Neon**-Datenbank abgeschaltet („5 GB
Netzwerk-Transfer in wenigen Wochen"). Der Deckel wurde damals eingebaut, aber der Pfad
in Zeile 295 hat keinen abbekommen, und Zeile 88-89 lässt ihn weiterhin zu.

### Warum es eilt

Bei 0,3 GB/Tag ist die **10-GB-Marke um den 26.08.2026** erreicht. Laut Supabase-Mail vom
15.08.2026 kann die Schonfrist dann von 15.09. auf **7 Tage** gekürzt oder sofort
gedrosselt werden („by another full plan limit amount"). Gesperrte Projekte antworten
mit HTTP 402.

### Was NICHT das Problem ist

- **Die DB-Größe** (71 %) — Kerzen löschen senkt sie, ändert am Egress aber fast nichts.
- **Die pausierten Projekte** (ki-radar, Sales-intelligence, Lead_Speicherung,
  „…gmail.com's Project") — sie erzeugen null Egress. Aufräumen ist eine separate Aufgabe.
- **Edge Functions, Realtime, Storage, MAU** — alle <1 %.

---

## 2. Der Plan

### Schritt A — Das strukturelle Loch schließen (`candle-store.ts:88-89`)

**Das ist der wichtigste Schritt**, weil er als einziger verhindert, dass das Problem
wiederkommt. Alles andere behebt nur die heutigen Symptome.

`readStoredCandles` darf keinen unbegrenzten Pfad mehr haben. Statt `if (!begrenzt) →
alles lesen` gilt: fehlt ein `limit`, greift ein harter Deckel (`MAX_DELIVERY_LIMIT`,
aktuell 8000) statt gar keiner.

- `StoredReadOptions.limit` in der Signatur **verpflichtend** machen — dann fällt jeder
  Aufrufer ohne Limit beim Typecheck auf, nicht erst auf der Rechnung.
- Alternativ, falls das zu viele Aufrufer bricht: Default auf `MAX_DELIVERY_LIMIT` und
  ein `console.warn` beim Rückgriff darauf.

**Akzeptanzkriterium:** In `candle-store.ts` existiert kein `db.select(...)` auf
`candleCache` mehr ohne `.limit(...)`. Ein `grep` darauf ist Teil der Abnahme.

### Schritt B — Das Vergleichsfenster deckeln (`candle-store.ts:295`)

Das Fenster dient ausschließlich dem Abgleich mit den frischen Provider-Kerzen. Mehr
Zeilen, als der Provider überhaupt geliefert hat, können mit nichts kollidieren.

```ts
const vergleichsfenster = frisch.length
  ? await readStoredCandles(symbol, interval, {
      since: Math.min(...frisch.map((c) => c.time)),
      limit: frisch.length + 50,          // Puffer für Zeitzonen-/Randfälle
    })
  : []
```

**Wirkung:** eliminiert die 26,8 Mio Zeilen fast vollständig → **−36 % Egress.**
**Risiko:** gering. Der Puffer deckt Randfälle ab; `candlesToWrite` vergleicht danach wie bisher.

### Schritt C — `DELIVERY_LIMIT` senken (`types.ts:73`)

Von 900 auf **300** für `15min`/`30min`/`1h`/`4h`/`1day`. 300 Kerzen füllen einen Chart
dicht; wer mehr braucht, fragt ausdrücklich an (der Replay-Trainer nutzt bereits
`limit: 5000`, siehe `app/actions/training-trades.ts:430` und `:712`).

```ts
export const DELIVERY_LIMIT: Record<Interval, number> = {
  '15min': 300, '30min': 300, '1h': 300, '4h': 300, '1day': 300,
  '1week': 300, '1month': 300,
}
```

**Wirkung:** kappt die 47,6 Mio auf ~16 Mio → **weitere −42 %.**
**Vorher prüfen:** Ob eine Chart-Ansicht sichtbar auf mehr als 300 Kerzen angewiesen ist
(`components/chart/price-chart.tsx`). Falls ja, dort gezielt ein höheres `limit` setzen,
statt den Default für alle anzuheben.

### Schritt D — Den `onload`-Sync entschärfen (`sync.ts:56`)

`QUOTE_STALE_MS = 1000 * 60 * 2` — der Sync darf alle **2 Minuten** feuern, ausgelöst von
jedem Seitenaufruf (`refreshQuotesIfStale`, `sync.ts:460-477`). Ergebnis: 431 Läufe à 142
Symbole. Die `inFlightRefresh`-Klammer (`sync.ts:448`) verhindert nur *parallele* Läufe,
nicht *häufige*.

Auf **10 Minuten** anheben:
```ts
export const QUOTE_STALE_MS = 1000 * 60 * 10
```

**Wirkung:** senkt die Aufrufzahl der teuren Query um bis zu 80 %.
**Trade-off:** Kurse sind im Extremfall 10 statt 2 Minuten alt. Bei 1 MAU verkraftbar —
**vom Nutzer zu bestätigen**, weil es sichtbares Verhalten ändert.

### Erwartetes Gesamtergebnis

| | Zeilen/Zyklus | Egress |
|---|---|---|
| Heute | 74,5 Mio | 7,03 GB |
| Nach A+B+C | ~19 Mio | **~1,7 GB** |
| Nach A+B+C+D | ~8 Mio | **~0,7 GB** |

Free-Limit: 5 GB. Nach A+B+C liegt der Verbrauch bei rund einem Drittel davon.

---

## 3. Damit es nie wieder passiert

Die Schritte oben beheben den heutigen Verbrauch. Diese vier sorgen dafür, dass es
auffällt, **bevor** die Datenbank gesperrt wird.

### 3.1 Der Deckel im Typsystem (siehe Schritt A)

Kein unbegrenzter Lesepfad auf `candle_cache`. Ein Aufrufer, der das Limit vergisst,
scheitert beim Build — nicht erst am Monatsende. Das ist der einzige Schutz, der ohne
Disziplin funktioniert.

### 3.2 Egress-Budget als Test festschreiben

Ein Test, der die Zeilenzahl je Abrufweg gegen eine Obergrenze prüft, z. B.:
„ein Chart-Abruf liefert höchstens `DELIVERY_LIMIT[interval]` Zeilen",
„das Vergleichsfenster liefert höchstens `frisch.length + 50` Zeilen".

So wird die Grenze zur Zusicherung statt zur Konvention.

### 3.3 Wöchentlicher Verbrauchs-Check

Ein Skript (`scripts/check-egress.mjs`), das `pg_stat_statements` nach Zeilen je Query
aggregiert und bei Überschreitung eines Schwellenwerts laut wird:

```sql
select calls, rows, round(rows::numeric/greatest(calls,1),0) as rows_per_call,
       left(regexp_replace(query,'\s+',' ','g'),120) as q
from pg_stat_statements order by rows desc limit 10;
```

Schwelle: **>2 Mio ausgelieferte Zeilen/Tag** (entspricht ~0,18 GB/Tag → ~5,4 GB/Monat).
Das ist derselbe Befehl, der die Ursache hier gefunden hat — er gehört in ein Skript,
nicht in einen Chatverlauf.

**Wichtig:** `pg_stat_statements` ist kumulativ seit dem letzten Reset. Für Tageswerte
entweder Differenzen zum Vorlauf speichern oder `pg_stat_statements_reset()` einplanen.

### 3.4 Retention nachziehen (senkt DB-Größe, nicht Egress)

`RETENTION_LIMIT` (`types.ts:122`) existiert bereits und **läuft auch** — die
`DELETE …`-Query zeigt 3.077 Aufrufe / 218.466 gelöschte Zeilen. Trotzdem offen:

- `candle_cache`: 1.719.478 Zeilen, 215 MB Heap + 97 MB Index = 312 MB.
- **338.178 Dead Tuples.** Autovacuum lief (16.08. 07:06), gibt den Platz aber nicht ans
  Dateisystem zurück. Ein `VACUUM FULL candle_cache` holt grob 60–90 MB.
  ⚠️ `VACUUM FULL` nimmt einen ACCESS EXCLUSIVE Lock — nur in einem Wartungsfenster.
- Vom Nutzer im Drill beschlossene Retention: Intraday (15min/30min/1h/4h) auf **90 Tage**,
  `1day` auf **5 Jahre**, `1week` + `1month` vollständig behalten.
  Dafür existiert bereits `scripts/clean-candle-granularity.mjs` — **zuerst mit `--dry`.**

Aktuelle Historientiefe je Intervall (Stand 16.08.2026):

| Intervall | Zeilen | Symbole | ältester Wert |
|---|---|---|---|
| 1h | 580.709 | 142 | 2023-09-27 |
| 1day | 335.764 | 142 | 2016-08-08 |
| 15min | 272.609 | 142 | 2026-05-13 |
| 4h | 194.927 | 142 | 2020-08-11 |
| 1week | 159.334 | 142 | 1996-08-05 |
| 30min | 138.722 | 142 | 2026-05-13 |
| 1month | 37.413 | 142 | 1996-08-31 |

⚠️ Laut `types.ts:106-108` gibt Yahoo `15min` nur 60 Tage weit heraus — was dort gelöscht
wird, ist **unwiederbringlich weg**. Die 90-Tage-Grenze ist damit knapp; vor dem Löschen
bestätigen.

---

## 4. Reihenfolge für die nächste Session

1. **Messen** — `pg_stat_statements` erneut abfragen und die Zahlen oben gegenprüfen
   (der Zyklus läuft weiter, die Werte sind vom 16.08.).
2. **Schritt A** umsetzen (strukturelles Loch), Typecheck laufen lassen, alle aufgedeckten
   Aufrufer ohne Limit einzeln bewerten.
3. **Schritt B** umsetzen — größte Einzelwirkung bei kleinstem Risiko.
4. **Deployen, 24 h warten, Dashboard prüfen.** Erwartung: Tageswert fällt von ~0,3 GB
   auf ~0,19 GB.
5. **Schritt C** umsetzen, vorher die Chart-Ansichten auf >300 Kerzen prüfen.
6. **Schritt D** nur nach Nutzer-Freigabe (sichtbares Verhalten).
7. Erneut 24 h messen. Ziel: **<0,1 GB/Tag.**
8. **Absicherung 3.2 + 3.3** bauen.
9. **Retention + `VACUUM FULL`** im Wartungsfenster, `--dry` zuerst.

Schritte 2–4 sind das Minimum, um vor dem 26.08. unter der 10-GB-Marke zu bleiben.

---

## 5. Offene Punkte

- **Schritt D braucht eine Freigabe** — 10 statt 2 Minuten Kursalter ist sichtbares Verhalten.
- **Schritt C braucht eine Prüfung** — hängt eine Chart-Ansicht an mehr als 300 Kerzen?
- **Die 90-Tage-Grenze für `15min` ist knapp** (Yahoo liefert nur 60 Tage nach) — vor dem
  Löschen bestätigen, dass ältere Intraday-Kerzen entbehrlich sind.
- **Die 4 pausierten Projekte** sind für die Quota irrelevant (null Egress). Separate
  Aufgabe; die Supabase-Mail vom 03.08.2026 kündigt für eines das permanente Einfrieren an.
- **Nicht verifiziert:** ob die 63.471 Aufrufe überwiegend aus dem `onload`-Sync oder aus
  Chart-Abrufen stammen. 431 Sync-Läufe × 142 Symbole ≈ 61.200 legt den Sync nahe, ist
  aber nicht bewiesen. Falls Schritt D wirkungslos bleibt, ist hier nachzumessen.

---

## 6. Quellen der Zahlen

Alle Werte vom 16.08.2026, erhoben über den Supabase-MCP gegen Projekt
`jkflmriwaveicnippkkk` sowie das Usage-Dashboard der Org `xlxsdcrcrbwiswqwgwrj`:

- Egress/Limits: Usage-Dashboard, Ansicht „Ausgang", Filter `trading-app` bzw. `task-champion`
- Query-Statistik: `select calls, rows, total_exec_time, query from pg_stat_statements order by rows desc`
- Tabellengrößen: `pg_total_relation_size`, `pg_stat_user_tables`
- Historientiefe: `select interval, count(*), count(distinct symbol), min(time), max(time) from candle_cache group by 1`
- Log-Quellen: `select source, count(*) from logs group by source`

---

## 7. Umsetzung am 17.08.2026 (A, B, C)

### Nachgemessen vor dem Eingriff

| Query | 16.08. | 17.08. | Zuwachs in ~1 Tag |
|---|---|---|---|
| Chart-Abruf (mit LIMIT) | 63.471 / 47,6 Mio | 64.719 / 47,64 Mio | +0,04 Mio Zeilen |
| Vergleichsfenster (ohne LIMIT) | 7.792 / 26,8 Mio | 9.031 / **31,77 Mio** | **+4,97 Mio Zeilen** |

Damit war belegt: Der unbegrenzte Pfad erzeugte praktisch den gesamten laufenden Zuwachs —
Schritt B war nicht nur der risikoärmste, sondern der akut wirksamste Eingriff.

### Was geändert wurde

- **A** (`candle-store.ts`): `StoredReadOptions.limit` ist **Pflichtfeld**, `options` nicht mehr
  optional. Der Zweig ohne `limit` ist ersatzlos entfallen; eine Laufzeitklemme fängt ungültige
  Werte auf `MAX_DELIVERY_LIMIT` ab — der Rückfall ist der harte Deckel, nie „unbegrenzt".
- **B** (`candle-store.ts`): Das Vergleichsfenster bekommt `limit: frisch.length + 50`.
- **C** (`types.ts`): `DELIVERY_LIMIT` 900 → **300** für `15min`/`30min`/`1h`/`4h`/`1day`.
  **`1week` bleibt 600, `1month` bleibt 300** — beide Zeitebenen haben in
  `lib/chart-timeframes.ts` `days: null` und zeigen die volle Historie statt eines Fensters
  (1week: 1.500 gespeicherte Kerzen); 300 hätte dort sichtbar Historie abgeschnitten, während
  beide am Übertragungsvolumen kaum beteiligt sind.

### Abnahme

- `tsc --noEmit` sauber — es gab **keine** weiteren Aufrufer ohne `limit`; `readStoredCandles`
  hatte genau drei, alle in derselben Datei.
- 885 Tests in 42 Dateien grün.
- Kein `db.select(...)` auf `candle_cache` ohne `.limit(...)` mehr (Zeile 109-114 ist die
  einzige zeilenweise Lesestelle).
- Gemessen über `/api/candles` (angemeldet, Sandbox): 15min/30min/1h/4h/1day → **300 Kerzen**,
  1week → 600, 1month → 300. Vorher jeweils 900.
- `pg_stat_statements` zeigt die **neue Signatur** des Vergleichsfensters
  (`time >= $3 … order by time desc limit $4`); die alte unbegrenzte Signatur wächst lokal
  nicht mehr.

### Einschränkung, die im Plan zu optimistisch stand

Schritt B eliminiert das Vergleichsfenster **nicht** nahezu vollständig, sondern **halbiert** es:
gemessen ⌀ 1.653 statt ⌀ 3.518 Zeilen je Aufruf. Grund: Das Fenster ist jetzt an die
Liefermenge des Anbieters gekoppelt — und bei `1week`/`1month` liefert Yahoo 1.500+ Kerzen.
Diese Menge ist inhärent (weniger zu lesen hieße, Kollisionen zu übersehen), nicht verschwendet.
Die Egress-Erwartung von ~1,7 GB ist damit die optimistische Kante; der 24-h-Messwert entscheidet.

---

## 8. Für die Messung am 18.08.2026 — hier weitermachen

### Referenzwerte, gezogen NACH dem Deploy

`pg_stat_statements` ist **kumulativ**. Ohne diese Baseline ist die Messung morgen wertlos —
die Differenz zählt, nicht der Absolutwert.

**Stand 17.08.2026, 12:10:58 (Europe/Zurich)**, Deployment `7759a8d` bereits live:

| Signatur (`select time,…from candle_cache`) | calls | rows | ⌀/Aufruf |
|---|---|---|---|
| Chart-Abruf, `limit $3` | 64.981 | 47.643.621 | 733 |
| **Vergleichsfenster ALT**, `>= $3` ohne limit | 9.056 | 31.892.452 | 3.522 |
| **Vergleichsfenster NEU**, `>= $3 … limit $4` | 129 | 381.144 | **2.955** |
| Nachladen nach links, `< $3 … limit $4` | 51 | 43.675 | 856 |

### Was morgen zu tun ist

1. **Dieselbe Abfrage erneut** (Supabase-MCP, Projekt `jkflmriwaveicnippkkk`):
   ```sql
   select now() at time zone 'Europe/Zurich' as stand, calls, rows,
          round(rows::numeric/greatest(calls,1),0) as rpc,
          (query ilike '%limit%') as hat_limit, (query ilike '%>=%') as hat_since
   from pg_stat_statements where query ilike 'select "time"%from "candle_cache"%'
   order by rows desc limit 4;
   ```
   Differenz zur Tabelle oben bilden, auf 24 h normieren, × ~90 Byte je Zeile = Tages-Egress.
2. **Usage-Dashboard** der Org `xlxsdcrcrbwiswqwgwrj`, Ansicht „Ausgang", Filter `trading-app`
   — Tageswert für den 18.08. ablesen. **Erwartung: ~0,19 GB statt ~0,3.**

### Entscheidungsbaum

- **Tageswert ~0,19 GB oder darunter** → A+B+C haben gewirkt. Schritt D umsetzen
  (`QUOTE_STALE_MS` in `lib/market-data/sync.ts:56` von `1000 * 60 * 2` auf `1000 * 60 * 10`),
  vom Nutzer am 17.08. bereits inhaltlich freigegeben. Danach erneut 24 h messen, Ziel <0,1 GB.
- **Tageswert bleibt bei ~0,3 GB** → die Plan-Annahme („der `onload`-Sync verursacht die
  Chart-Aufrufe", §5) ist widerlegt. Dann **nicht** blind D nachschieben, sondern die
  Aufrufquelle nachmessen, bevor weiter geraten wird.

### Konkreter Verdacht, falls es nicht fällt

Das **neue** Vergleichsfenster liegt bei ⌀ 2.955 Zeilen — nur ~16 % unter dem alten Wert, nicht
die Hälfte, die sieben lokale Testabrufe (⌀ 1.653) nahegelegt hatten. Grund: Das Fenster ist an
`frisch.length` gekoppelt, und der Sammellauf lässt Yahoo mit `range=30y` die volle Historie
liefern (`1day`: 2.518 Kerzen je Symbol) — siehe `types.ts:106-108` und `yahoo.ts`.

Der Hebel läge dann **nicht** in einem noch kleineren Fenster (weniger zu lesen hieße,
Kollisionen zu übersehen), sondern darin, dass der **Sammellauf** nicht bei jedem Durchgang die
volle Historie anfordert, sondern nur den aktuellen Rand. Achtung: `range=30y` steht dort aus
einem Grund — Yahoo stuft bei `range=max` still die Granularität herab (CLAUDE.md, Fallstricke).
Ein Eingriff dort braucht einen eigenen Drill, nicht einen schnellen Patch.
