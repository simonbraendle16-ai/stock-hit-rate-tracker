# Roadmap — Etappen 2 bis 7

Jede Etappe ist **ein eigener Arbeitsschritt** (ein Prompt, eine Sitzung, ein Commit) und
liefert für sich genommen etwas Benutzbares. Sie bauen nicht zwingend aufeinander auf —
Ausnahme ist Etappe 6, die Etappe 3 voraussetzt.

Jede Beschreibung enthält: **warum** es gebaut wird, **was genau** entsteht, **welche Dateien**
betroffen sind, **was du danach konkret kannst**, und **welche Fragen vor dem Bauen zu klären
sind**. Die offenen Fragen sind bewusst notiert und nicht vorentschieden — sie kommen zu Beginn
der jeweiligen Sitzung in den `drill`.

Der vollständige Ideenkatalog (alles, was nicht in diesen sechs Etappen steckt) liegt in
[`IDEEN-BACKLOG.md`](./IDEEN-BACKLOG.md).

**Status:** Etappe 1 (Geld-Fundament) ist erledigt — Migration `drizzle/0010` ist angewendet,
Historie nachweislich unverändert (0 geänderte Altfelder bei 15 Trades).
**Etappe 4 (Emotions-Check-in) ist erledigt** — Migration `drizzle/0011_emotions.sql` ist
angewendet, ebenfalls 0 geänderte Altfelder bei 15 Trades. Details unten bei der Etappe.

---

# Etappe 2 — Freunde

**Aufwand:** mittel (~1 Sitzung) · **Migration:** `0011_friendship.sql`

## Warum

Ein Trading-Journal wird allein geführt, und genau das ist sein Schwachpunkt: Niemand sieht,
wenn du deine Regeln brichst. Der Wert dieser Etappe liegt **nicht** darin, die Trades eines
Freundes zu sehen — sondern darin, dass jemand deine Regelbrüche sieht. Das verändert
Verhalten, ein Trade-Feed tut das nicht.

## Der Douglas-Konflikt, der die Bauweise bestimmt

Ein Live-Feed der Trades deines Freundes ist eine Copy-Trading-Maschine und damit exakt das,
was der Feature-Filter in `CLAUDE.md` verbietet („Social-Ideas-Feeds: BAUE NICHT"). Die Lösung,
die beides rettet:

> **Trades eines Freundes werden erst nach Abschluss sichtbar.**

Nachahmen wird dadurch unmöglich, Lernen bleibt vollständig möglich. Ein laufender Trade zeigt
dem Freund nur, *dass* eine Position offen ist — nicht Einstieg, Ziel oder Richtung.

## Was gebaut wird

**Datenmodell** (`lib/db/schema.ts` + `drizzle/0011_friendship.sql`):

```
friendship(id, requesterId, addresseeId, status, visibility, createdAt, respondedAt)
  status:     offen | angenommen | abgelehnt
  visibility: disziplin | r_vielfache | vollstaendig
invite_code(code, userId, expiresAt, usedByUserId)
```

Kein E-Mail-Versand: `lib/auth.ts` hat keinen Mailer konfiguriert, und einen Dienst dafür
einzurichten wäre eine eigene Baustelle. Stattdessen **Einladungscode** — du erzeugst einen,
schickst ihn über einen beliebigen Kanal, der andere löst ihn ein.

**Drei Sichtbarkeitsstufen**, je Freundschaft einzeln wählbar:

| Stufe | Was der Freund sieht |
|---|---|
| `disziplin` | Disziplin-Score, Plan-Streak, Regelbrüche, Anzahl Trades — **keine Beträge** |
| `r_vielfache` | zusätzlich alle Trades in **R-Vielfachen** statt Euro — vergleichbar, ohne die Kontogröße zu verraten |
| `vollstaendig` | zusätzlich echte Beträge |

Stufe 2 ist der eigentlich interessante Fall: R-Vielfache machen einen 500-Euro-Account mit
einem 50.000-Euro-Account vergleichbar, weil sie die Kontogröße herausrechnen.

**Sicherheit — der kritische Teil.** Jede bestehende Server Action filtert heute hart auf
`getUserId()`. Diese Actions werden **nicht** aufgebohrt, sonst entsteht ein Datenleck an der
Stelle, an der die App am meisten zu verlieren hat. Stattdessen eine eigene Ebene:

```
app/actions/friends.ts
  assertCanView(viewerId, ownerId, benoetigteStufe)  → wirft, wenn nicht erlaubt
  getFriendJournal(friendId)                          → liest über assertCanView
```

Nur `getFriendJournal` liest fremde Daten, und nur über diese eine Prüffunktion. Die
Statistik-Berechnung wird nicht dupliziert: `computeDisciplineStats` und `computeEquityStats`
aus `lib/trade-stats.ts` sind bereits reine Funktionen über übergebene Zeilen und funktionieren
unverändert für fremde Daten.

**Accountability-Meldung** (der eigentliche Wert): Bricht jemand eine Regel — `ruleViolations`
wird in `updateTradePlan` gesetzt — bekommen seine Freunde das zu sehen. Nicht als Anklage,
sondern als Eintrag in einer gemeinsamen Übersicht.

## Dateien

| Datei | Änderung |
|---|---|
| `lib/db/schema.ts` · `drizzle/0011_friendship.sql` | neu: `friendship`, `invite_code` |
| `app/actions/friends.ts` | **neu** — `createInvite`, `redeemInvite`, `listFriends`, `setVisibility`, `removeFriend`, `getFriendJournal`, `assertCanView` |
| `app/friends/page.tsx` | **neu** — Freundesliste, Einladungscode erzeugen/einlösen |
| `app/friends/[id]/page.tsx` | **neu** — Journal eines Freundes, gefiltert nach Stufe |
| `components/cockpit-nav.tsx` | Navigationspunkt „Freunde" |
| `lib/trade-stats.ts` | unverändert wiederverwendet |

## Konkretes Ergebnis

Du erzeugst unter `/friends` einen Code, schickst ihn deinem Bekannten, er löst ihn ein. Danach
siehst du unter `/friends/[id]` seinen Disziplin-Score, seine Plan-Streak und seine
abgeschlossenen Trades in R — und er deine. Laufende Trades bleiben auf beiden Seiten verdeckt.
Bricht einer von euch eine Regel, taucht das beim anderen auf.

## Vor dem Bauen zu klären

- Sollen Freundschaften **gegenseitig** sein (beide sehen einander) oder **je Richtung
  einstellbar** (du zeigst Stufe 2, er zeigt Stufe 1)?
- Soll die Accountability-Meldung **aktiv** sein (Benachrichtigung) oder **passiv** (nur in der
  Übersicht sichtbar)? Aktiv braucht Etappe 3 als Unterbau.
- Was passiert beim Entfernen einer Freundschaft — sofort blind, oder bleiben bereits gesehene
  Daten sichtbar?

---

# Etappe 3 — Live-Kurse und Alerts

**Aufwand:** mittel (~1 Sitzung) · **Migration:** `0012_alerts.sql`

## Warum

Zwei Lücken, die zusammengehören:

**Offene Trades sind blind.** Ein Trade mit Status `aktiv` zeigt heute nur den Plan — keinen
aktuellen Kurs, keinen unrealisierten Gewinn, keine Distanz zum Stop. Die Marktdaten-Anbindung
(`lib/market-data/`) liegt bereits vollständig da, wird aber ausschließlich im Chart genutzt.

**Es gibt kein „setzen und weggehen".** Der Masterplan führt den In-App-Alert als optionalen
Ausbau, und der Douglas-Filter nennt ihn ausdrücklich als BAUEN-Feature: Wer einen Alert setzt,
muss nicht am Chart kleben — und wer nicht am Chart klebt, greift nicht impulsiv ein.

## Was gebaut wird

**Live-Kurs für offene Trades.** Aus der letzten Kerze der bestehenden Datenanbindung — kein
neuer Dienst, keine Kosten. `lib/market-data/cached.ts` cacht bereits 15 Minuten (intraday)
bzw. 12 Stunden (daily); das schont das Twelve-Data-Gratislimit und wird **sichtbar
beschriftet** („Kurs von 14:32"). Ein Kurs, der so tut, als wäre er live, wäre schlimmer als
gar keiner.

Angezeigt wird pro aktivem Trade:
- aktueller Kurs + Zeitstempel
- unrealisierter Gewinn/Verlust (in Kontowährung **und** in R)
- Abstand zu Stop und Ziel in Prozent
- ein Balken, der zeigt, wo der Kurs zwischen Stop und Ziel steht

**Alerts.** Eine Tabelle `price_alert(id, userId, stockId, price, direction, note, triggeredAt)`
plus ein Abgleich, der beim Laden der Kerzen prüft, ob ein Level gekreuzt wurde. Ausgelöste
Alerts erscheinen als Browser-Notification (`Notification` API, kostenlos, kein Push-Dienst) und
zusätzlich als Eintrag im Cockpit — damit nichts verloren geht, wenn der Browser zu war.

**Automatisch aus dem Plan.** Beim Aktivieren eines Trades entstehen auf Wunsch drei Alerts:
Einstieg erreicht, Stop erreicht, Ziel erreicht. Genau die drei Punkte, an denen ein
disziplinierter Trader etwas tun muss — und sonst nichts.

## Dateien

| Datei | Änderung |
|---|---|
| `lib/db/schema.ts` · `drizzle/0012_alerts.sql` | neu: `price_alert` |
| `app/actions/alerts.ts` | **neu** — `createAlert`, `listAlerts`, `checkAlerts`, `dismissAlert` |
| `lib/market-data/quote.ts` | **neu** — letzte Kerze → aktueller Kurs, über `getCachedCandles` |
| `components/live-position.tsx` | **neu** — Kurs, unrealisierter P&L, Abstände, Balken |
| `components/trade-card.tsx` | `LivePosition` bei Status `aktiv` einhängen |
| `app/page.tsx` | offene Positionen mit Live-Stand im Cockpit |
| `lib/trade-stats.ts` | `unrealizedPnl(trade, kurs)` ergänzen — dieselbe Vorzeichenlogik wie `tradeGrossPnl` |

## Konkretes Ergebnis

Im Cockpit siehst du auf einen Blick, wo deine offenen Positionen stehen: „AAPL +1,2 R · noch
3,4 % bis zum Ziel · 8,1 % über dem Stop, Kurs von 14:32". Du setzt einen Alert auf dein
Einstiegslevel, schließt den Browser-Tab, und bekommst eine Meldung, wenn der Kurs ankommt —
statt drei Stunden auf den Chart zu starren.

## Vor dem Bauen zu klären

- Alerts nur bei **geöffneter App** (kostenlos, aber du musst den Tab offen haben) oder echte
  Push-Benachrichtigungen (braucht Service Worker + VAPID, deutlich mehr Arbeit, weiterhin
  gratis)?
- Wie oft darf der Kurs abgerufen werden? Twelve Data Free liegt bei ~800 Anfragen/Tag —
  bei vielen offenen Positionen wird das knapp und braucht eine Staffelung.
- Sollen Alerts auch für **Watchlist-Instrumente ohne Trade** möglich sein („sag Bescheid, wenn
  BTC unter 50k fällt")?

---

# Etappe 4 — Emotions-Check-in ✅ ERLEDIGT

**Aufwand:** klein (~halbe Sitzung) · **Migration:** `0011_emotions.sql` (angewendet)

## Warum

Die App misst heute *was* du getan hast, nie *in welchem Zustand*. Genau dieser Zusammenhang ist
aber der Kern von „Trading in the Zone": Nicht die Strategie versagt, sondern der Zustand, in
dem sie ausgeführt wird. Von allen Ideen im Katalog hat diese das beste Verhältnis von Aufwand
zu Erkenntnis.

## Was gebaut wird

**Zwei Momentaufnahmen** pro Trade — beim Aktivieren und beim Schließen:

- eine Skala von 1 bis 5 (ruhig ↔ aufgewühlt)
- Tags aus einer festen Liste: `fomo`, `rache`, `langeweile`, `angst`, `gier`, `ungeduld`,
  `zuversicht`, `gleichmut`
- ein optionales Freitextfeld

Feste Tags statt Freitext, weil nur eine geschlossene Liste später auswertbar ist. Die Liste
lebt in `lib/emotions.ts` als gemeinsame Quelle für Dialog und Auswertung — genau wie
`lib/pre-trade-questions.ts` es für die Douglas-Fragen macht.

**Die Auswertung ist der eigentliche Punkt.** Auf `/tracking` entsteht eine Tabelle:

```
Zustand beim Einstieg    Trades    Trefferquote    Erwartungswert
ruhig (1-2)                 24          61 %           +0,42 R
angespannt (3)              11          45 %           +0,05 R
aufgewühlt (4-5)             7          29 %           −0,38 R

Nach Tag:
  fomo          6 Trades    −0,51 R
  gleichmut    18 Trades    +0,47 R
```

Das ist eine Zahl, die man nicht wegdiskutieren kann. Sie sagt nicht „sei ruhiger", sondern
„deine FOMO-Trades kosten dich im Schnitt 0,5 R".

**Erst ab genug Daten.** Unter ~10 Trades je Gruppe zeigt die Auswertung „noch zu wenige Daten"
statt einer Scheinpräzision — sonst liest man aus drei Trades ein Muster heraus, das keines ist.

## Dateien

| Datei | Änderung |
|---|---|
| `lib/db/schema.ts` · `drizzle/0013_emotions.sql` | `trade.moodEntry`, `moodEntryTags`, `moodExit`, `moodExitTags`, `moodNote` |
| `lib/emotions.ts` | **neu** — Tag-Liste + Gruppierung, gemeinsame Quelle |
| `components/mood-check.tsx` | **neu** — Skala + Tag-Auswahl |
| `components/trade-card.tsx` | Check-in beim Aktivieren und im Schließen-Dialog |
| `lib/trade-stats.ts` | `computeMoodStats(rows)` — rein, testbar |
| `app/tracking/page.tsx` | Auswertungsblock |

## Konkretes Ergebnis

Vor jeder Aktivierung zwei Klicks (Skala + Tag). Nach ein paar Wochen zeigt `/tracking`, in
welchem Zustand du Geld verdienst und in welchem du es verlierst — mit deinen eigenen Zahlen,
nicht mit einer Binsenweisheit aus einem Buch.

## Vor dem Bauen geklärt — so ist es entschieden

- **Check-in ist verpflichtend**, beim Aktivieren wie beim Abschließen. Ein überspringbarer
  Check-in würde genau dann übersprungen, wenn man aufgewühlt ist — also in exakt den Fällen,
  die die Auswertung sichtbar machen soll. Das Ergebnis wäre nicht bloß lückenhaft, es wäre
  systematisch schöngefärbt. Pflicht ist dabei nur die **Skala**; Tags und Notiz bleiben
  freiwillig. Grund: die Skala ist die Aufteilung, die vollständig sein muss (jeder Trade
  gehört in genau eine Gruppe), Tags sind eine Mehrfach-Ebene darüber — ein erzwungenes Tag,
  das nicht passt, wäre Rauschen statt Aussage. Die Abdeckungszeile über der Tabelle nennt
  offen, wie viele Trades getaggt sind.
- **Die Tag-Liste ist fest** — acht Einträge, keine eigenen. Ein selbst erfundenes Tag
  zersplittert die Stichprobe und macht die Auswertung über Monate unschärfer, statt sie zu
  verfeinern.

## Abweichungen von der ursprünglichen Beschreibung

| Geplant | Gebaut | Warum |
|---|---|---|
| `0013_emotions.sql` | `0011_emotions.sql` | Etappe 2 und 3 sind nicht gebaut; 0011 war die nächste freie Nummer. |
| ein Feld `moodNote` | `moodEntryNote` + `moodExitNote` | Bei zwei Momentaufnahmen und einem Feld überschreibt der Ausstieg die Einstiegs-Notiz — der Vergleich vorher/nachher wäre weg. |
| Auswertungsblock in `app/tracking/page.tsx` | `components/mood-stats.tsx`, eingebunden in `page.tsx` | Die Seite hatte schon 254 Zeilen; die Tabelle ist eine eigene Einheit. |
| — | `moodExit`-Auswertung + Plan-Treue-Spalte | Die Daten fallen ohnehin an; der Ausstiegs-Zustand erklärt keine Ergebnisse, zeigt aber, was der Trade mit einem gemacht hat. |
| — | CSV-Export um sechs Spalten erweitert | Sonst wäre der Zustand nur als fertige Quote in der App sichtbar, nicht nachrechenbar. |
| — | `CHECK`-Bedingung auf 1–5 in der Datenbank | Ein Wert außerhalb der Skala wäre stumm in keiner Gruppe gelandet. |

## Nachweis

- Migration angewendet gegen die Produktions-DB, Vorher-Nachher-Dump verglichen:
  **15/15 Trades, 0 geänderte Altfelder**, 6 neue Spalten vorhanden und leer (kein Backfill —
  für den Altbestand gibt es keinen Zustand, den man ohne Erfindung eintragen könnte).
- `CHECK`-Bedingungen greifen nachweislich (Testeinfügung mit Wert 9 abgelehnt, zurückgerollt).
- 82 Tests grün (`pnpm test`), `tsc --noEmit` sauber, `pnpm build` erfolgreich.
- Oberfläche visuell geprüft (Tabelle, Badges, Check-in in beiden Varianten, Auswahl-Zustände).

## Offen

- **Klick-Test mit echtem Login steht aus:** einen geplanten Trade aktivieren → Check-in →
  abschließen → auf `/tracking` prüfen, dass die Zeile erscheint. Ohne Zugangsdaten nicht
  durchführbar; Server-Validierung und Rechenlogik sind durch Tests abgedeckt, der Weg durch
  die echte Anmeldung nicht.

---

# Etappe 5 — Der Bot-Zwilling

**Aufwand:** groß (~1–2 Sitzungen) · **Migration:** keine (Berechnung, keine neuen Daten)

## Warum

Das ist das Feature, das keine andere Trading-App hat, und es beantwortet die einzige Frage, die
für einen Douglas-Trader wirklich zählt:

> **Was kostet mich mein eigenes Eingreifen?**

Die App kennt deinen Plan (Einstieg, Stop, Ziel) und kennt den tatsächlichen Kursverlauf. Damit
lässt sich ausrechnen, was passiert *wäre*, wenn der Plan mechanisch ausgeführt worden wäre —
ohne Zögern, ohne vorzeitigen Ausstieg, ohne verschobenen Stop.

## Was gebaut wird

**Die Simulation.** Für jeden abgeschlossenen Trade werden die Kerzen zwischen `openedAt` und
`closedAt` geladen (`lib/market-data/`) und Kerze für Kerze durchlaufen:

1. Wird der Stop berührt → Trade endet als Verlust, exakt am Stop
2. Wird das Ziel berührt → Trade endet als Gewinn, exakt am Ziel
3. Beides in derselben Kerze → **konservativ der Stop** (die Kerze verrät nicht, was zuerst kam;
   die pessimistische Annahme verhindert, dass der Bot künstlich gut aussieht)
4. Keins von beidem bis zum Ende → offen bewertet zum letzten Kurs

Gerechnet wird mit denselben Gebühren, die auf dem echten Trade eingefroren sind — sonst
vergleicht man Äpfel mit Birnen.

**Der Vergleich.** Eine zweite Kurve neben deiner Equity-Kurve, plus die eine Zahl, um die es
geht:

```
Bot (Plan mechanisch):   +12,4 R
Du (tatsächlich):         +4,1 R
─────────────────────────────────
Differenz:                −8,3 R   ← der Preis deiner Eingriffe
```

**Die Differenz kann auch positiv sein** — dann greifst du besser ein, als dein Plan es
vorsieht, und dein Plan gehört überarbeitet. Beide Richtungen sind ein Erkenntnisgewinn, und
genau so wird es formuliert. Kein moralischer Zeigefinger, eine Messung.

**Aufschlüsselung**, wo die Differenz entsteht: zu früh ausgestiegen · zu spät ausgestiegen ·
Stop verschoben (`ruleViolations` liegt bereits vor) · Trade gar nicht eingegangen.

## Ehrlichkeitsgrenzen — müssen in der UI stehen

- **Slippage und Spread** sind nicht abgebildet; der Bot ist dadurch leicht zu optimistisch.
- **Kerzen-Auflösung:** Bei Tageskerzen ist die Reihenfolge innerhalb des Tages unbekannt.
- **Nur Trades mit Zieldefinition** können simuliert werden.
- Twelve Data Free liefert **begrenzte Historie** — bei alten Trades fehlen womöglich Kerzen.

Diese vier Punkte stehen sichtbar unter der Auswertung. Ein Vergleich, der seine eigenen
Grenzen verschweigt, ist manipulativ.

## Dateien

| Datei | Änderung |
|---|---|
| `lib/bot-twin.ts` | **neu** — `simulateTrade(trade, candles)`, rein und testbar |
| `lib/bot-twin.test.ts` | **neu** — Stop zuerst, Ziel zuerst, beides in einer Kerze, Short, keine Daten |
| `app/actions/bot-twin.ts` | **neu** — Kerzen laden, simulieren, Ergebnis cachen |
| `components/bot-twin-panel.tsx` | **neu** — Doppelkurve + Differenz + Aufschlüsselung |
| `app/tracking/page.tsx` | Panel einhängen |
| `lib/market-data/cached.ts` | wiederverwendet |

## Konkretes Ergebnis

Auf `/tracking` steht eine Zahl, die dir sagt, was dich Emotionen in R gekostet haben — und eine
Aufschlüsselung, durch welches Verhalten. Nach einem Monat weißt du nicht mehr nur, *dass* du
diszipliniert sein solltest, sondern *wie viel* Undiszipliniertheit kostet.

## Vor dem Bauen zu klären

- Simulation **live bei jedem Aufruf** (langsam, kostet Datenabrufe) oder **einmal berechnet und
  gespeichert** (schneller, braucht eine Spalte oder Tabelle)?
- Was passiert bei Trades ohne verfügbare Kerzen — auslassen oder als „nicht simulierbar"
  ausweisen?
- Soll der Bot auch **geplante, aber nie eingegangene** Trades bewerten (Status `kein_handel`)?
  Das wäre die Antwort auf „was hätte ich verpasst" — psychologisch heikel, aber ehrlich.

---

# Etappe 6 — Teilverkäufe und Event-Log

**Aufwand:** groß (~1–2 Sitzungen) · **Migration:** `0014_trade_events.sql` · **setzt Etappe 3 voraus**

## Warum

Zwei strukturelle Schwächen im Datenmodell:

**Ein Trade hat heute genau ein Ende.** `takeProfitPct` existiert, ist aber nur eine
*Projektion* im Formular — es gibt keinen echten Teilverkauf. Wer bei 1 R die Hälfte verkauft
und den Rest laufen lässt (eine der verbreitetsten Methoden überhaupt), kann das in der App
nicht abbilden.

**Die Trade-Geschichte ist ein JSON-String.** `ruleViolations` speichert Regelbrüche als
`["stop_moved"]` — ohne Zeitpunkt, ohne alten und neuen Wert, ohne Begründung. Man sieht *dass*
ein Stop verschoben wurde, nie *wann*, *wohin* und *warum*.

## Was gebaut wird

**Event-Log.** Eine Tabelle, die jede Veränderung eines Trades als Ereignis festhält:

```
trade_event(id, tradeId, userId, type, at, payload, note)
  type: eroeffnet | teilverkauf | nachkauf | stop_verschoben |
        ziel_geaendert | invalidation_ignoriert | notiz | geschlossen
```

Daraus ergibt sich eine lesbare Chronik auf der Trade-Detailseite:

```
02.03. 09:14  Eröffnet — 10 Stück zu 100,00
04.03. 11:02  Teilverkauf — 5 Stück zu 112,00 (+1,2 R)
04.03. 11:03  Stop verschoben — 90,00 → 100,00  ⚠ Regelbruch
07.03. 15:40  Geschlossen — 5 Stück zu 118,00
```

Der bestehende `ruleViolations`-String bleibt erhalten und wird weiter geschrieben (damit
nichts bricht), ist aber ab dann abgeleitet statt führend.

**Echte Teilverkäufe.** Ein Trade kann mehrfach teilweise geschlossen werden. Die
Durchschnittsrechnung wandert in `lib/trade-stats.ts`:

- gewichteter Durchschnitts-Ausstieg über alle Teilverkäufe
- verbleibende Stückzahl und deren aktueller Stand (nutzt den Live-Kurs aus Etappe 3)
- realisierter vs. unrealisierter Anteil getrennt ausgewiesen

**Nachkauf/Pyramidisieren** mit gewichtetem Durchschnittseinstieg — dieselbe Mechanik in die
andere Richtung.

**Warum Etappe 3 vorher kommen muss:** Ein Trade mit Teilverkauf ist per Definition halb offen.
Ohne Live-Kurs ließe sich der verbleibende Teil nicht bewerten, und die Anzeige wäre unvollständig.

## Dateien

| Datei | Änderung |
|---|---|
| `lib/db/schema.ts` · `drizzle/0014_trade_events.sql` | neu: `trade_event` |
| `app/actions/trades.ts` | `partialClose`, `addToPosition`; jede Mutation schreibt ein Event |
| `lib/trade-stats.ts` | gewichteter Durchschnitt, realisiert/unrealisiert getrennt |
| `lib/trade-stats.test.ts` | Tests für Teilverkauf, Nachkauf, gemischte Fälle |
| `components/trade-timeline.tsx` | **neu** — die Chronik |
| `app/trades/[id]/page.tsx` | Chronik einhängen |

## Konkretes Ergebnis

Du verkaufst bei 1 R die Hälfte, ziehst den Stop auf Einstand, lässt den Rest laufen — und die
App bildet das korrekt ab statt es auf einen einzigen Ausstiegskurs zu verkürzen. Auf der
Detailseite steht die vollständige Geschichte des Trades mit Zeitstempeln.

## Vor dem Bauen zu klären

- Ist ein Stop-Nachziehen auf Einstand ein **Regelbruch**? Nach reiner Douglas-Lesart ja (der
  Plan stand vorher fest), nach gängiger Praxis nein. Möglich wäre ein Plan-Feld „Stop
  nachziehen ab X R erlaubt" — dann ist es regelkonform statt Bruch.
- Sollen bestehende `ruleViolations` **rückwirkend** in Events umgewandelt werden (ohne
  Zeitstempel, da unbekannt) oder bleibt die Historie unberührt?

---

# Etappe 7 — Statistik-Ausbau

**Aufwand:** groß, aber gut teilbar · **Migration:** keine

## Warum

Alle vier Bausteine rechnen ausschließlich mit Daten, die bereits da sind — sie brauchen kein
neues Feld, keine neue Eingabe, keinen neuen Dienst. Diese Etappe kann in vier unabhängige
Prompts zerlegt werden.

## 7a · Monte-Carlo-Simulator

**Das nützlichste Einzelfeature der ganzen Etappe.** Aus deiner eigenen Trefferquote und deiner
R-Verteilung werden 10.000 Mal die nächsten 50 Trades simuliert. Ergebnis:

```
Eine Verlustserie von 6 Trades ist bei deinen Zahlen
in 34 % der Verläufe völlig normal.

Wahrscheinlichkeit eines Drawdowns über 20 %:  12 %
Bandbreite nach 50 Trades:  −8 R bis +31 R (90 %-Intervall)
```

Das ist Douglas in Reinform: Es nimmt einer Verlustserie den Schrecken, indem es zeigt, dass sie
zur Wahrscheinlichkeitsverteilung gehört und kein Beweis dafür ist, dass „das System kaputt"
ist. Genau dieser Denkfehler zerstört Systeme.

Neu: `lib/monte-carlo.ts` (rein, testbar mit festem Zufalls-Seed) + Panel auf `/tracking`.

## 7b · Setup-Vergleich

`strategy` ist heute ein Freitextfeld und dadurch nicht auswertbar. Umbau auf Tags (bestehende
Freitexte bleiben als Migrationshilfe erhalten), dann je Setup: Anzahl, Trefferquote,
Erwartungswert, Ø Haltedauer, bestes/schlechtestes R.

Die Frage, die es beantwortet: *Welches meiner Setups verdient das Geld — und welches halte ich
nur aus Gewohnheit?*

## 7c · MAE / MFE

**M**aximum **A**dverse/**F**avourable **E**xcursion: Wie weit lief der Kurs gegen dich, bevor
er drehte — und wie weit für dich, bevor du ausgestiegen bist? Berechnet aus den Kerzen der
Haltedauer (dieselbe Mechanik wie der Bot-Zwilling, kann sich den Kerzen-Ladeweg teilen).

Beantwortet zwei sehr konkrete Fragen:
- „Deine Stops werden im Schnitt bei 0,8 R getroffen, bevor der Kurs dreht" → **Stops zu eng**
- „Deine Gewinner liefen im Schnitt bis 2,3 R, du bist bei 1,4 R ausgestiegen" → **Ziele zu nah**

## 7d · Zeit-Heatmap und Haltedauer

Wochentag × Tageszeit als Gitter, eingefärbt nach Erwartungswert. Dazu Haltedauer gegen
Ergebnis. Daten liegen in `openedAt` und `closedAt` bereits vollständig vor.

Findet Muster wie „montags vormittags verlierst du systematisch" oder „Trades, die du länger als
zwei Wochen hältst, sind im Schnitt negativ".

## Dateien

| Datei | Änderung |
|---|---|
| `lib/monte-carlo.ts` (+ Test) | **neu** — 7a |
| `lib/trade-stats.ts` | `computeSetupStats`, `computeTimeStats` — 7b, 7d |
| `lib/excursion.ts` (+ Test) | **neu** — 7c |
| `app/actions/trades.ts` | `strategy` → Tags — 7b |
| `components/{monte-carlo,setup-comparison,excursion,time-heatmap}-panel.tsx` | **neu** |
| `app/tracking/page.tsx` | Panels einhängen |

## Konkretes Ergebnis

`/tracking` beantwortet nach dieser Etappe vier Fragen, die es heute nicht kann: Ist meine
Verlustserie normal? Welches Setup trägt mich? Sind meine Stops zu eng? Wann handle ich
schlecht?

## Vor dem Bauen zu klären

- Ab wie vielen Trades wird eine Auswertung überhaupt angezeigt? (Vorschlag: 20 für
  Monte-Carlo, 10 je Setup — darunter „noch zu wenige Daten".)
- Sollen alle vier Teile zusammen kommen oder einzeln als eigene Prompts?

---

# Reihenfolge-Empfehlung

```
Etappe 4 (Emotionen)  ─┐  kleiner Aufwand, sofort Datensammlung startet
                       │  → je früher, desto mehr Daten für später
Etappe 3 (Live+Alerts) ─┤  Voraussetzung für Etappe 6
                       │
Etappe 2 (Freunde)     ─┤  unabhängig, jederzeit möglich
                       │
Etappe 7a (Monte-Carlo)─┤  bester Erkenntnisgewinn ohne neue Eingaben
                       │
Etappe 5 (Bot-Zwilling)─┤  das stärkste Feature, aber der größte Brocken
                       │
Etappe 6 (Teilverkäufe)─┘  nach Etappe 3
```

**Warum Etappe 4 zuerst:** Emotionsdaten sind nur rückwirkend nutzlos. Jeder Trade, der ohne
Check-in läuft, fehlt später in der Auswertung. Alle anderen Etappen rechnen mit Daten, die
ohnehin schon entstehen — diese eine nicht. (Deshalb ist sie erledigt; ab jetzt sammelt jeder
Trade seinen Zustand mit.)

---

# Offene Punkte aus Etappe 1

- **Klick-Test steht aus:** Trade mit Hebel und abweichender Gebühr planen → aktivieren →
  schließen; prüfen, dass ein Abschluss ohne Ausstiegskurs abgelehnt wird und die Gebühr danach
  in der Datenbank steht.
- **ESLint ist nicht installiert** — `pnpm lint` schlägt deshalb fehl. Vorbefund, nicht durch
  Etappe 1 verursacht.
- **Währungswechsel ungetestet gegen echte Daten** — die Umrechnung ist gebaut und typgeprüft,
  aber noch nie ausgeführt worden. Vor dem ersten echten Einsatz mit einem Testkonto prüfen.
