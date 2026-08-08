# Etappe 15 — Übergeordneter Kontext im Replay-Trainer

**Stand:** 07.08.2026 · Anforderungs-Drill abgeschlossen, noch nichts gebaut.
**Auslöser:** Nach einer Trainingseinheit gemeldet: „Ich kann nicht sicher sagen, in welchem
Mainzyklus wir uns befinden — und ich weiß nicht, wo ich die Retracements ansetzen soll, weil
der Wellenanfang vor der ersten Kerze der Übung liegt."

---

## 1. Warum das keine Bequemlichkeitsfrage ist

Der Trainer misst, ob eine These vor dem Ergebnis stand. Eine These über eine Wellenzählung
setzt aber voraus, dass die übergeordnete Struktur überhaupt lesbar ist. Ist sie es nicht, misst
der Trainer **Raten statt Lesen** — und die Trainingsstatistik behauptet trotzdem eine Quote.
Das ist dieselbe Sorte stiller Falschaussage, gegen die die App gebaut ist.

Douglas-seitig: Risiko wird vor dem Einstieg definiert. Wer den Kontext nicht sieht, kann
Invalidation und Ziel nicht begründen — er kann sie nur behaupten.

---

## 2. Befunde aus der Messung (nicht aus dem Code gelesen, sondern im laufenden System geprüft)

### 2.1 Der eigentliche Fehler: Woche und Monat sind Quartalskerzen

Yahoo stuft bei `range=max` **still** auf `dataGranularity: "3mo"` herunter. Die App übernimmt
das ungeprüft, legt es im Kerzenspeicher unter `1week` **und** `1month` ab und liefert es als
„W" und „M" aus.

Gemessen an AAPL (`/api/candles?symbol=AAPL&market=aktien&interval=…`) und an der
Trainingssitzung 17:

| Ebene | Kerzen | erste Kerze | Abstände |
|---|---|---|---|
| T (`1day`) | 2517 | 2016-08-03 | 1 Tag ✓ |
| W (`1week`) | 169 | 1984-12-01 | **90–92 Tage** ✗ |
| M (`1month`) | 169 | 1984-12-01 | **90–92 Tage** ✗ |

W und M liefern **denselben Datensatz**. Deshalb „passiert nichts", wenn man zwischen ihnen
umschaltet — es ist zweimal dasselbe, zu grobe Bild, auf genau der Ebene, auf der der Mainzyklus
abgelesen wird.

Direkt gegen Yahoo geprüft:

```
range=max  interval=1wk -> 3mo     range=max  interval=1mo -> 3mo
range=30y  interval=1wk -> 1wk     range=30y  interval=1mo -> 1mo
range=20y  interval=1wk -> 1wk     range=10y  interval=1mo -> 1mo
```

**`30y` liefert echte Wochen- und Monatskerzen.** Das ist der Fix an der Wurzel.

### 2.2 Was NICHT kaputt ist

Der Ebenenwechsel im Trainer ist korrekt verdrahtet und funktioniert. Belegt über die
Netzwerkspur (`/api/candles?trainingSessionId=17&tf=W` → 200) und den Zustand der Knöpfe.
`lib/replay-timeframes.ts` schneidet die höhere Ebene korrekt am Replay-Moment ab; die
angebrochene Kerze wird aus der Basis nachgerechnet, es scheint keine Zukunft durch.
**Der Mechanismus stimmt, die Daten stimmten nicht.**

### 2.3 Die harte Anbietergrenze (`lib/market-data/yahoo.ts`, `YAHOO_RANGE`)

| Ebene | verfügbar |
|---|---|
| 15m / 30m | 60 Tage |
| 1h / 4h | 2 Jahre |
| 1 Tag | 10 Jahre |
| 1 Woche / 1 Monat | nach dem Fix 30 Jahre |

Der Kerzenspeicher (Migration `0027`) wächst darüber hinaus, aber nur für Zeiträume, die seit
seiner Einführung durchlaufen wurden. **Für eine Übung, die zwei Jahre zurück startet, existieren
auf 15m keine älteren Kerzen — kein Nachladen kann sie beschaffen.** Der Mainzyklus ist auf der
Arbeitsebene technisch unerreichbar; er muss über die höheren Ebenen kommen. Das ist keine
Bauentscheidung, das ist eine Tatsache über die Datenquelle.

### 2.4 Wo der linke Rand einer Übung herkommt

Der Replay zeigt die **ersten** `sichtbar` Kerzen des gelieferten Satzes. Der linke Rand ist
damit die älteste gelieferte Kerze der Basisebene — links davon gibt es nichts, auch nicht durch
Rauszoomen. In Sitzung 17 (Basis 1h) beginnt die Reihe am 2024-11-20, der Vorlauf endet nach
260 Kerzen ≈ elf Handelstage. Genau deshalb ist der Wellenanfang unsichtbar.

`LEAD_IN_OPTIONS` (`lib/training.ts`) bietet höchstens 800, Standard 250.

---

## 3. Was gebaut wird

### Baustein 1 — Wochen- und Monatskerzen reparieren  *(zuerst, alles andere hängt daran)*

1. `lib/market-data/yahoo.ts`: `YAHOO_RANGE['1week']` und `['1month']` von `'max'` auf `'30y'`.
2. **Granularitätsprüfung als reine Funktion**, z. B. `passtGranularitaet(interval, granularity)`
   (getestet): Yahoos `meta.dataGranularity` gegen das angefragte Intervall. Weicht es ab, wird
   die Antwort **verworfen** (`MarketDataError('upstream')`) statt gespeichert.
   Begründung: Der Zeitraum ist nur der heute bekannte Auslöser. Die Prüfung ist die eigentliche
   Absicherung — Yahoo ist inoffiziell und kann das jederzeit anderswo tun. Ohne sie wiederholt
   sich der Fall an der nächsten Ebene, und wieder still.
3. **Aufräumen des Kerzenspeichers.** `scripts/clean-candle-cache.mjs` folgen (gleicher Ton,
   `--dry` zuerst): Reihen in `candle_cache`/`candle_series` mit `interval` `1week`/`1month`
   löschen, deren **Median-Abstand** nicht zum Intervall passt. Nur nachweisbar Falsches — im
   Zweifel liegen lassen und melden. Ohne diesen Schritt bleiben die Quartale liegen: Der
   Speicher konserviert Irrtümer (bekannter Fallstrick aus `CLAUDE.md`).
4. Prüfen: Nach dem Lauf muss `/api/candles?symbol=AAPL&market=aktien&interval=1week` Abstände
   von 7 Tagen liefern und deutlich mehr als 169 Kerzen.

**Ergebnis für dich:** W und M zeigen endlich Unterschiedliches, und die Wochenebene reicht bis
zu 30 Jahre zurück — genug für jeden Mainzyklus.

### Baustein 2 — Aufklappbarer Kontext-Chart im Trainer

- Neuer Baustein `components/trainer/context-chart.tsx`, eingehängt in
  `components/trainer/training-workspace.tsx` oberhalb oder neben dem Arbeitschart,
  **auf- und zuziehbar**.
- Innen ein zweiter `PriceChart` mit `trainingSessionId`, `replayMode`,
  `replayBasisTimeframe={session.timeframe}` und einer **abweichenden** `defaultTimeframe`.
  Damit greift der bestehende Zuschnitt aus `lib/replay-timeframes.ts` unverändert — der
  Kontext-Chart steht garantiert auf demselben Moment und verrät keine Zukunft. Kein zweiter
  Ladeweg, keine zweite Wahrheit.
- Welche Ebene: **zwei Stufen über der Basis**, abgeleitet aus `CHART_TIMEFRAME_IDS`. Als reine,
  getestete Funktion `kontextEbene(basis)` in `lib/chart-timeframes.ts` — nicht in der
  Komponente entscheiden. Im Kontext-Chart bleibt die Ebene frei umschaltbar.
- **Zeichnen im Kontext-Chart ist erlaubt und ist der Kern der Fib-Lösung.** Zeichnungen liegen
  in `{time, price}` (`training_annotation`, keine `timeframe`-Spalte) und gelten deshalb
  ebenenübergreifend: Fib auf der Wochenebene über die ganze Welle ziehen — die Linien stehen
  danach im Arbeitschart. So wird der Anker erreichbar, ohne dass die Arbeitsebene weiter
  zurückreichen müsste.
- **Prüfpunkt (erwartete Fehlerquelle):** Was macht `components/chart/drawing-layer.tsx` mit
  einem Punkt, dessen `time` **vor** der ersten Kerze der aktuellen Reihe liegt? Wenn die
  Zeit-zu-x-Abbildung dort `null` liefert, verschwindet die Zeichnung still — und der ganze
  Baustein wäre wirkungslos. Das wird als Erstes geprüft und, falls nötig, auf Extrapolation
  über die Kerzenbreite umgestellt.
- Auf-/Zugeklappt-Zustand in `localStorage` (reiner Ansichtszustand, keine Messgröße —
  keine Migration).

### Baustein 3 — Vorlauf ausreizen und links nachladen

- `LEAD_IN_OPTIONS` um eine Stufe erweitern, die nimmt, was da ist (statt bei 800 zu deckeln).
- `/api/candles` bekommt einen `before`-Parameter, `getStoredCandles` die passende Option;
  `PriceChart` lädt nach, wenn der sichtbare Bereich an den linken Rand stößt.
- **Der Fallstrick, der hier zwingend beachtet werden muss:** Der Replay-Stand zählt
  **Kerzen ab Index 0** (`replayStand` / `replayEnde`). Kommen links Kerzen dazu, verschiebt
  sich damit der erreichte Moment — mitten in der Übung, und zwar unbemerkt. Entweder wird der
  Stand beim Nachladen um die Anzahl neuer Kerzen erhöht, oder er wird auf **Zeit** umgestellt
  (sauberer, aber der größere Eingriff). Das ist dieselbe Klasse Fehler wie `startIndex` vs.
  `startCandleTime` beim Kerzenspeicher — dort wurde sie schon einmal gemacht.
- Nachladen läuft **nur nach links**. Der rechte Rand bleibt am Replay-Stand, ohne Ausnahme.

### Baustein 4 — Feld „übergeordneter Kontext" je Übung

- Migration `0033`: Spalte `higherContext` (Text) an `training_session`.
- Eingabe im Analyse-Schritt, **vor dem Aufdecken festgeschrieben** — dieselbe Logik wie die
  These: nachträglich änderbar wäre sie wertlos. Freitext, kein Katalog (die Formulierung einer
  Zählung ist persönlich, wie die Setup-Tags und anders als die Fehler-Tags).
- **Kein Backfill**, keine Pflicht: Altbestand steht auf „ohne Angabe".
- Auswertung erst später — erst muss sich zeigen, wie du tatsächlich hineinschreibst. Notiert im
  `IDEEN-BACKLOG.md`.

---

## 4. Reihenfolge und warum

1. **Baustein 1** zuerst und allein. Danach wird gemessen, ob dein ursprüngliches Problem damit
   schon halb erledigt ist — gut möglich, dass eine funktionierende Wochenebene den größten Teil
   des fehlenden Kontexts liefert. Alles Weitere auf kaputten Daten zu bauen, wäre blind.
2. **Baustein 2**, beginnend mit dem Prüfpunkt zur Zeichenebene.
3. **Baustein 3** — der Eingriff mit dem höchsten Risiko (Replay-Stand), deshalb nicht neben
   anderen Änderungen.
4. **Baustein 4** zuletzt, als kleinste und unabhängigste Änderung.

## 5. Prüfungen

- `pnpm test` (Vitest) und `pnpm exec tsc --noEmit` — **`pnpm lint` gibt es nicht**, ESLint ist
  nicht installiert.
- Neue reine Logik bekommt Tests: `passtGranularitaet`, `kontextEbene`, die Stand-Korrektur beim
  Nachladen.
- Sichtprüfung im echten Browser über den `claude-in-chrome`-MCP, nicht per Headless-Skript.
- Migration additiv und idempotent, angewandt über `node scripts/apply-migration.mjs`,
  davor/danach `scripts/baseline-report.mjs`.
- Vor dem Commit `tsc` — ein Typfehler in der Zeichenebene hat schon einmal die ganze App
  lahmgelegt, und der grüne Dev-Server hat es nicht gezeigt.

## 6. Ausdrücklich nicht dabei

Der Instrument-Chart außerhalb des Trainers · automatische Swing-Punkt- oder Wellenerkennung
(sie nähme dir genau das ab, was der Trainer messen soll) · Änderungen an Trefferquote oder
Trainingsstatistik · ein zweiter Ladeweg für Kerzen neben `getCachedCandles`.

## 7. Offene Annahmen und Risiken

- **Angenommen:** Die Quartals-Reihen betreffen alle Symbole gleichermaßen. Geprüft sind AAPL
  und Sitzung 17. Falls einzelne Reihen echt sind, löscht das Aufräumen sie unnötig — sie werden
  beim nächsten Abruf neu geholt, der Schaden wäre Ladezeit, keine Daten.
- **Angenommen:** Der Kerzenspeicher hat für die geübten Instrumente genug Wochenhistorie. Bei
  einem frisch aufgenommenen Instrument steht der Kontext-Chart anfangs dünn da; er muss das
  **sagen**, statt eine kurze Reihe wie eine vollständige aussehen zu lassen.
- **Ungeklärt:** Ein Kontext-Chart über Jahrzehnte macht ein verdecktes Instrument leichter
  erratbar — eine markante Kursgeschichte ist ein Fingerabdruck. Die Entscheidung im Drill war:
  echter Kontext geht vor perfekter Verdeckung. Sollte sich zeigen, dass die Übungen dadurch
  wertlos werden, ist die Rückfallebene, im Kontext-Chart die Preisachse zu unterdrücken.
- **Risiko:** Baustein 3 fasst den Replay-Stand an. Geht das schief, springt eine laufende Übung
  an eine falsche Stelle. Deshalb allein und mit Tests.

## 8. Nach der Umsetzung

- `CLAUDE.md` → Abschnitt „Fallstricke, die schon Zeit gekostet haben": Eintrag zu Yahoos stiller
  Herabstufung bei `range=max` samt der Prüfung, die sie künftig abfängt.
- Den `validierung`-Skill anbieten (Soll-Ist gegen dieses Dokument).
