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

> **Zwei Zählungen, nicht verwechseln.** Die **nummerierten** Etappen 2–7 hier sind
> *Feature*-Arbeit. Die **Design-Arbeit** wird mit **Buchstaben** geführt (Design A–D, siehe
> Abschnitt am Ende dieser Datei) — genau deshalb, weil es früher zwei „Etappe 1" gab: das
> Geld-Fundament und das Cockpit-Design.

**Status:** Etappe 1 (Geld-Fundament) ist erledigt — Migration `drizzle/0010` ist angewendet,
Historie nachweislich unverändert (0 geänderte Altfelder bei 15 Trades).
**Etappe 4 (Emotions-Check-in) ist erledigt** — Migration `drizzle/0011_emotions.sql` ist
angewendet, ebenfalls 0 geänderte Altfelder bei 15 Trades. Details unten bei der Etappe.
**Etappe 3 (Live-Kurse und Alerts) ist erledigt** — Migration `drizzle/0012_alerts.sql`
(neue Tabelle `price_alert`) ist angewendet, Trade-Dump vorher/nachher byte-identisch
(15/15). Details unten bei der Etappe. Damit ist die Voraussetzung für Etappe 6 erfüllt.
**Etappe 2 (Freunde) ist erledigt** — Migration `drizzle/0013_friendship.sql` (neue Tabellen
`friendship` + `invite_code`) ist angewendet, Trade-Dump vorher/nachher byte-identisch (15/15).
Details unten bei der Etappe.
**Etappe 6 (Teilverkäufe und Event-Log) ist erledigt** — Migration `drizzle/0014_trade_events.sql`
(neue Tabelle `trade_event`) ist angewendet, Trade-Dump vorher/nachher byte-identisch (15/15).
Echte Teilverkäufe/Nachkäufe, eine lesbare Chronik je Trade und event-aware Geldkennzahlen.
Details unten bei der Etappe.
**Etappe 7a (Monte-Carlo-Simulator) ist erledigt** — **ohne Migration und ohne jede
Schreiboperation**: die Simulation rechnet ausschließlich über bereits vorhandene Trades.
Neu sind `lib/monte-carlo.ts` (rein, seed-fest, 27 Tests) und das Panel auf `/tracking`.
Details unten bei Etappe 7.
**Etappe 5 (Bot-Zwilling) ist erledigt** — Migration `drizzle/0015_bot_twin.sql` (neue Tabelle
`bot_manual_outcome`, **nur** für von Hand nachgetragene Ausgänge) ist angewendet, Trade-Dump
vorher/nachher byte-identisch (16/16). Die Simulation selbst schreibt nichts: sie rechnet live
über den Kerzen-Cache. Neu sind `lib/bot-twin.ts` (rein, 49 Tests) und der Vergleichsblock auf
`/tracking`. Details unten bei der Etappe.
**Etappe 7b (Setup-Vergleich) ist erledigt** — Migration `drizzle/0016_setup_tags.sql` (eine
additive Spalte `setupTags` am `trade`, **ohne Backfill**) ist angewendet, Trade-Dump
vorher/nachher byte-identisch (16/16). Der Strategie-Freitext bleibt als Begründung und als
Vorlage für Tags erhalten. Neu sind `lib/setups.ts` (rein, 28 Tests), `computeSetupStats` und
das Vergleichs-Panel auf `/tracking`. Details unten bei Etappe 7.

**Damit sind alle nummerierten Etappen bis auf 7c–7d abgearbeitet.**

---

# Etappe 2 — Freunde ✅ ERLEDIGT

**Aufwand:** mittel (~1 Sitzung) · **Migration:** `0013_friendship.sql` (angewendet)

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
| `lib/db/schema.ts` · `drizzle/0013_friendship.sql` | neu: `friendship`, `invite_code` (ohne `visibility`) |
| `lib/friends.ts` · `lib/friends.test.ts` | **neu** — reine Logik: Code-Erzeugung/Ablauf, R-Projektion, Whitelist-Filter (`projectFriendTrades`, `toFriendSummary`) |
| `app/actions/friends.ts` | **neu** — `createInvite`, `redeemInvite`, `listFriends`, `getFriendJournal`, `removeFriend`; intern `assertCanView`, `friendshipBetween`, `summaryFor` |
| `app/friends/page.tsx` | **neu** — Freundesliste (nach Regelbrüchen sortiert) + Einladen/Einlösen |
| `app/friends/[id]/page.tsx` | **neu** — Journal eines Freundes (geplant + abgeschlossen in R), guarded |
| `components/invite-panel.tsx` · `friend-remove-button.tsx` · `friend-stats.tsx` | **neu** — Client-/Präsentations-Teile |
| `components/cockpit-nav.tsx` | Navigationspunkt „Freunde" |
| `lib/trade-stats.ts` | unverändert wiederverwendet (`computeDisciplineStats`, `tradePnl`, `tradeRisk`) |

## Konkretes Ergebnis

Du erzeugst unter `/friends` einen Code, schickst ihn deinem Bekannten, er löst ihn ein. Danach
siehst du unter `/friends/[id]` seinen Disziplin-Score, seine Plan-Streak und seine
abgeschlossenen Trades in R — und er deine. Laufende Trades bleiben auf beiden Seiten verdeckt.
Bricht einer von euch eine Regel, taucht das beim anderen auf.

## Vor dem Bauen geklärt — so ist es entschieden

- **Keine wählbaren Sichtbarkeitsstufen.** Statt der drei Stufen (`disziplin` /
  `r_vielfache` / `vollstaendig`) gibt es genau **eine feste Stufe**, nicht einstellbar: ein
  Freund sieht die Disziplin-Kennzahlen (Score, Quote, Erwartungswert in R, Plan-Streak,
  Regelbrüche, Anzahl) **und** die Trades in **R-Vielfachen** — **nie einen Betrag**. Das ist
  der Douglas-konforme Kern (größenunabhängig, verrät die Kontogröße nicht) ohne die Komplexität
  einer Stufen-Wahl. Deshalb hat `friendship` **keine** `visibility`-Spalte und es gibt **kein**
  `setVisibility`.
- **Freundschaft ist gegenseitig** und gleich für beide Seiten (eine Zeile pro Paar). Da es nur
  eine Stufe gibt, entfällt die Richtungs-Frage.
- **Accountability passiv.** Regelbrüche eines Freundes erscheinen in der Übersicht (die
  Freundesliste ist nach protokollierten Regelbrüchen absteigend sortiert) und im Journal —
  sichtbar beim Nachsehen, keine aktive Benachrichtigung. Kein Eingriff in den Etappe-3-Watcher.
- **Entfernen macht sofort blind.** `removeFriend` löscht die Freundschaftszeile beidseitig;
  `assertCanView` wirft ab dem nächsten Zugriff. Nichts bleibt zwischengespeichert sichtbar.
- **Geplante Trades sind sichtbar** (Nutzer-Entscheidung dieser Sitzung, bewusst über die
  ursprüngliche „erst nach Abschluss"-Regel hinweg): Der aktuelle Bestand hat 0 abgeschlossene,
  aber 14 geplante Trades — ohne geplante sähe ein Freund fast nichts. Sichtbar sind damit
  **geplante** (mit geplantem Chance-Risiko-Verhältnis) **und abgeschlossene** (Ergebnis in R);
  **laufende (`aktiv`) und abgebrochene bleiben verborgen** — ein offener Trade wäre kopierbar,
  ohne dass ein Ergebnis daraus lernbar ist.

## Abweichungen von der ursprünglichen Beschreibung

| Geplant | Gebaut | Warum |
|---|---|---|
| `0011_friendship.sql` | `0013_friendship.sql` | 0011 (Emotions) und 0012 (Alerts) sind belegt; 0013 war die nächste freie Nummer. |
| `friendship(… visibility …)` + drei Stufen + `setVisibility` | eine feste Stufe, **keine** `visibility`-Spalte, kein `setVisibility` | Entscheidung der Sitzung: eine Stufe genügt und spart die Stufen-Komplexität; die feste Stufe ist der Douglas-Kern (R + Disziplin, nie Beträge). |
| Trades erst **nach Abschluss** sichtbar | **geplante** Trades zusätzlich sichtbar (mit geplantem CRV) | Nutzer-Wunsch; der reale Bestand hat 0 abgeschlossene / 14 geplante Trades — ohne geplante wäre das Journal leer. `aktiv`/`abgebrochen` bleiben verborgen (Copy-Trading-Schutz). |
| `getFriendJournal`/`assertCanView` in der Action | zusätzlich reines Modul `lib/friends.ts` (+ `lib/friends.test.ts`) | Projektionslogik (was ist teilbar) und Code-/Ablauf-Logik gehören in eine reine, testbare Quelle (wie `lib/alerts.ts`) — nicht in die `'use server'`-Action. Die Action liest nur und ruft hinein. |
| E-Mail-Einladung | Einladungscode, `createInvite` verwendet einen noch gültigen, nicht eingelösten Code wieder | Kein Mailer konfiguriert (wie geplant); Wiederverwendung verhindert, dass wiederholtes Klicken Dutzende Codes anlegt. |
| — | `FriendSummary`/`toFriendSummary` als Whitelist-Filter | Zweite Verteidigungslinie: `computeDisciplineStats` rechnet auch Geldfelder — `toFriendSummary` lässt nur die betragsfreien durch, getestet gegen Durchsickern. |

## Nachweis

- Migration `0013_friendship.sql` gegen die Produktions-DB angewendet (additiv, nur neue
  Tabellen): **Trade-Dump vorher/nachher byte-identisch, 15/15 Trades unverändert** (einziger
  Diff: der Report-eigene Zeitstempel).
- `friendship` verifiziert: 6 Spalten wie entworfen, **0 Zeilen**, `status`-Default `angenommen`,
  Unique-Index `friendship_pair_idx` + `friendship_addressee_idx` angelegt,
  `friendship_status_check` greift (Einfügung mit `status = 'quatsch'` abgelehnt, gültiger Wert
  akzeptiert, beides zurückgerollt).
- `invite_code` verifiziert: 5 Spalten wie entworfen, **0 Zeilen** (kein Backfill), Teilindex
  `invite_code_user_idx` angelegt.
- **121 Tests grün** (`vitest`, davon 12 neu in `lib/friends.test.ts`: Code-Erzeugung/Alphabet,
  Ablauf, R-Projektion Long/Short, Sichtbarkeits-Filter geplant/aktiv/abgeschlossen,
  Whitelist ohne Geld-Leck), `tsc --noEmit` sauber, `next build` erfolgreich (Routen `/friends`
  und `/friends/[id]` registriert).

## Offen

- ~~**Klick-Test mit echtem Login steht aus**~~ ✅ **erledigt (26.07.2026)** — Code `BBMZ8HXJ`
  unter `/friends` erzeugt („gültig bis 02. Aug. · einmal einlösbar"), mit einem zweiten Konto
  eingelöst, Freundschaft erschien sofort beidseitig. Das Journal des Freundes zeigt den
  abgeschlossenen Trade als **`+2.36R`** unter der Zeile „Ergebnis in R-Vielfachen —
  größenunabhängig, ohne Beträge": kein Kapitaleinsatz, keine Gebühr, kein Kontostand.
  **Weiterhin ungeprüft im Klickweg:** Regelbruch beim Freund provozieren und die Sortierung
  danach, sowie „Freundschaft entfernen → `/friends/[id]` zeigt kein Zugriff".

---

# Etappe 3 — Live-Kurse und Alerts ✅ ERLEDIGT

**Aufwand:** mittel (~1 Sitzung) · **Migration:** `0012_alerts.sql` (angewendet)

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

## Vor dem Bauen geklärt — so ist es entschieden

- **Alerts nur bei geöffneter App**, über die `Notification`-API — kein Service Worker, kein
  VAPID, kein Push-Dienst. Der „Was gebaut wird"-Abschnitt oben legt das bereits fest; der Preis
  ist, dass der Tab offen sein muss. Verpasste Alerts gehen aber nicht verloren: ausgelöste
  Alerts bleiben als Eintrag im Cockpit-Panel stehen, bis man sie wegräumt.
- **Kursabruf gestaffelt über den bestehenden Cache.** Es gibt keinen neuen Dienst: der Kurs ist
  der Schluss der letzten Kerze aus `getCachedCandles` (15 Min intraday gecacht). Der Abgleich
  (`checkAlerts`) holt je **Symbol nur einen** Kurs — mehrere Alerts/Positionen auf dasselbe
  Instrument teilen sich einen Abruf. Der Hintergrund-Abgleich läuft alle 5 Minuten (plus beim
  Zurückkehren auf den Tab), was zum 15-Min-Cache passt, ohne ihn oft zu verfehlen.
- **Ja, Alerts auch ohne Trade.** `price_alert` trägt `ticker`/`market` eigenständig (plus
  optional `stockId`/`tradeId`), der Kursabruf braucht keinen Join. Ein Alert lässt sich damit
  auf jedem Instrument setzen — der „Alert setzen"-Dialog hängt an der Live-Position, ist aber
  nicht an einen laufenden Trade gebunden.

## Abweichungen von der ursprünglichen Beschreibung

| Geplant | Gebaut | Warum |
|---|---|---|
| `price_alert(… stockId …)` | zusätzlich `ticker`, `market`, `tradeId`, `kind`, `active` | Ein Trade kann ohne `stockId` existieren; das Symbol muss eigenständig auf der Zeile stehen, damit der Kursabruf ohne Join geht. `kind` trennt Plan-Alerts (einstieg/stop/ziel) von manuellen, `active` räumt Ausgelöste weg, ohne die Historie zu löschen. |
| `direction` | `'above'` / `'below'` (Kreuzungsrichtung) statt long/short | Ein Level wird durch Steigen ODER Fallen erreicht — das ist unabhängig von der Trade-Richtung und deckt auch „BTC unter 50k" auf einem reinen Watchlist-Instrument ab. |
| `lib/market-data/quote.ts` | dazu `lib/alerts.ts` (rein, getestet) | Auslöse- und Richtungslogik gehört in eine reine, testbare Quelle (wie `lib/emotions.ts`) — nicht in die 'use server'-Action. |
| Auto-Alerts: Einstieg, Stop, Ziel | Stop + Ziel immer, **Einstieg nur mit aktuellem Kurs** | Ohne Live-Kurs ist die Einstiegs-Richtung nicht bestimmbar (Level == Bezug); Stop und Ziel liegen dagegen immer eindeutig auf je einer Seite des Einstiegs. Bereits erreichte Level werden übersprungen, statt sofort auszulösen. |
| Abgleich „beim Laden der Kerzen" | eigener `checkAlerts()` + 5-Min-`AlertWatcher` im Cockpit | Der Abgleich hängt nicht an einer zufälligen Chart-Ansicht, sondern läuft verlässlich, solange das Cockpit offen ist — und nutzt High/Low der letzten Kerze, um eine kurze Berührung innerhalb der Kerze nicht zu übersehen. |
| `unrealizedPnl(trade, kurs)` | dazu `unrealizedR` + `pricePositionFraction` | R-Vielfaches ist größenunabhängig und direkt mit dem Erwartungswert vergleichbar; die Balken-Position braucht eine eigene, richtungsbewusste reine Funktion. |
| — | Anlege-Guard gegen Sofort-Auslösung | Ein Alert, dessen Level der Kurs schon erreicht hat, wird beim Anlegen abgelehnt — sonst wäre er kein „setzen und weggehen", sondern feuerte sofort. |

## Nachweis

- Migration `0012_alerts.sql` gegen die Produktions-DB angewendet (additiv, nur neue Tabelle):
  **Trade-Dump vorher/nachher byte-identisch, 15/15 Trades unverändert.**
- `price_alert` verifiziert: 13 Spalten wie entworfen, **0 Zeilen** (kein Backfill), beide
  `CHECK`-Bedingungen (direction/kind) vorhanden und wirksam (Testeinfügung mit `direction =
  'sideways'` abgelehnt, zurückgerollt), Teilindex `price_alert_active_idx` angelegt.
- **109 Tests grün** (`vitest`, davon neu: `lib/alerts.test.ts` und die unrealized-/Balken-Tests
  in `lib/trade-stats.test.ts`), `tsc --noEmit` sauber, `next build` erfolgreich (Route
  `/api/quote` registriert).

## Offen

- **Klick-Test teilweise erledigt (26.07.2026):** Beim Aktivieren eines Trades legt der Haken
  „Kurs-Alerts aus dem Plan setzen" **automatisch zwei Alerts** an — 95 `below` (Stop) und
  115 `above` (Ziel), beide mit `triggeredAt = null`. Der Weg Plan → Alert ist damit belegt.
  **Weiterhin ungeprüft:** das tatsächliche Auslösen (Kurs kreuzt das Level) samt
  Browser-Notification und Cockpit-Eintrag — dafür müsste ein echter Kurs durch die Marke laufen.
- **Twelve-Data-Gratislimit unter Last ungetestet:** der Ein-Abruf-je-Symbol-Ansatz plus
  15-Min-Cache hält das Limit bei wenigen Positionen problemlos; bei vielen offenen Positionen
  auf verschiedenen Instrumenten wäre eine zusätzliche Staffelung/Priorisierung zu prüfen.

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

- ~~**Klick-Test mit echtem Login steht aus**~~ ✅ **erledigt (26.07.2026)** — im eigenen
  Sandbox-Konto durchgespielt: „Aktivieren" bleibt **gesperrt**, solange kein Skalenwert gewählt
  ist; mit Wert (2 · gefasst + Tag „Zuversicht") ging es durch und `openedAt` wurde gesetzt.
  Beim Abschließen verlangt der Dialog denselben Check-in erneut, die Momentaufnahme des
  Einstiegs steht dabei sichtbar darüber („BEIM EINSTIEG: EIN · 2 · GEFASST").

---

# Etappe 5 — Der Bot-Zwilling ✅ ERLEDIGT (25.07.2026)

**Aufwand:** groß · **Migration:** `0015_bot_twin.sql` (angewendet) — **nur für die
von Hand nachgetragenen Ausgänge**; die Simulation selbst speichert nichts

## Warum

Das ist das Feature, das keine andere Trading-App hat, und es beantwortet die einzige Frage, die
für einen Douglas-Trader wirklich zählt:

> **Was kostet mich mein eigenes Eingreifen?**

Die App kennt deinen Plan (Einstieg, Stop, Ziel) und kennt den tatsächlichen Kursverlauf. Damit
lässt sich ausrechnen, was passiert *wäre*, wenn der Plan mechanisch ausgeführt worden wäre —
ohne Zögern, ohne vorzeitigen Ausstieg, ohne verschobenen Stop.

## Was gebaut wird

**Die Simulation.** Für jeden abgeschlossenen Trade werden die Kerzen ab `openedAt` geladen
(`lib/market-data/`) und Kerze für Kerze durchlaufen — **über den echten Ausstieg hinaus**, bis
der Plan selbst endet:

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
| `lib/bot-twin.ts` | **neu** — `simulateTrade`, `simulateMissedTrade`, `manualOutcomeRun`, `compareBotAndTrader`, `classifyDifference`, `preferredInterval` — rein und testbar |
| `lib/bot-twin.test.ts` | **neu** — 49 Tests: Stop zuerst, Ziel zuerst, beides in einer Kerze, Short, Gebühren, Nenner, jede Abbruchursache, Nachträge, Aggregation, Auflösungswahl |
| `app/actions/bot-twin.ts` | **neu** — Kerzen laden (anbieter-getrenntes Limit), Auflösung wählen, simulieren; `setBotOutcome` / `clearBotOutcome` |
| `components/bot-twin-panel.tsx` | **neu** — Aussage, Abrechnung, Aufschlüsselung, Lücken, Nachträge, Grenzen |
| `components/bot-twin-curve.tsx` | **neu** — Doppelkurve (Bot gestrichelt/neutral, du durchgezogen) |
| `components/bot-outcome-dialog.tsx` | **neu** — Ausgang von Hand nachtragen, ändern, entfernen |
| `lib/db/schema.ts` · `drizzle/0015_bot_twin.sql` | **neu** — Tabelle `bot_manual_outcome` |
| `lib/trade-stats.ts` | `tradeRMultiple` + `tradePlannedRisk` exportiert — beide Seiten teilen denselben Nenner |
| `app/tracking/page.tsx` | Panel eingehängt |
| `lib/market-data/cached.ts` · `lib/alerts.ts` | wiederverwendet (Kerzen-Cache, `candleReachesLevel`, `directionForLevel`) |

## Konkretes Ergebnis

Auf `/tracking` steht eine Zahl, die dir sagt, was dich dein Eingreifen in R gekostet hat — und
eine Aufschlüsselung, durch welches Verhalten. Nach einem Monat weißt du nicht mehr nur, *dass* du
diszipliniert sein solltest, sondern *wie viel* Undiszipliniertheit kostet.

## Vor dem Bauen geklärt — so ist es entschieden

- **Live bei jedem Aufruf**, nicht gespeichert. Gerechnet wird über den bestehenden Kerzen-Cache
  (`getCachedCandles`: 15 min intraday, 12 h täglich), ein Abruf je Symbol und Auflösung. Damit
  gibt es kein Ergebnis, das veraltet, während neue Kerzen nachlaufen — und keine
  Invalidierungsregel, die irgendwann falsch liegt.
- **Kerzen-Auflösung adaptiv nach Haltedauer:** bis 3 Tage Stundenkerzen, bis ~1 Monat
  4-Stunden-Kerzen, darüber Tageskerzen. Reicht die Historie nicht bis zum Einstieg zurück, fällt
  die Rechnung automatisch auf die nächstgröbere Auflösung. `15min` ist bewusst nicht dabei: im
  Gratis-Tier reichen 500 Kerzen damit nur ~19 Handelstage zurück.
- **Trades ohne Kursdaten werden ausgewiesen, nicht ausgelassen** — mit Grund
  („Ticker unbekannt", „Minutenlimit", „Historie reicht nicht zurück"). **Ergänzung des Nutzers:**
  dort lässt sich von Hand nachtragen, was aus dem Handel geworden wäre. Genau dafür — und nur
  dafür — gibt es Migration `0015`.
- **Nicht eingegangene Trades (`kein_handel`) werden bewertet, aber streng getrennt.** Eigener
  Block mit eigener Summe, außerhalb der Hauptdifferenz: nicht eingegangen zu sein ist eine andere
  Fehlerart als falsch auszusteigen, und beides zu vermischen macht beide Aussagen unbrauchbar.

## Wie der Nachtrag ehrlich bleibt

Ein Feld, in das man selbst schreibt, was „gewesen wäre", ist eine offene Flanke. Drei Regeln
halten sie zu:

1. **Kein frei erfundener Betrag.** Nachgetragen wird nur die *Aussage* „ins Ziel gelaufen" oder
   „in den Stop gelaufen" — der Kurs kommt dann aus dem Plan. Nur „weder noch" braucht einen
   eigenen Bewertungskurs.
2. **Messung schlägt Eingabe.** Ein Nachtrag greift ausschließlich dort, wo die Simulation nichts
   liefert. Kommen später Kerzen, gilt wieder die Rechnung; der Nachtrag tritt zurück.
3. **Sichtbar bis zum Schluss.** Nachgetragene Ergebnisse stehen in einem eigenen Block, sind
   jederzeit änderbar und löschbar, und die Ehrlichkeitszeile nennt ihre Zahl.

## Abweichungen von der ursprünglichen Beschreibung

| Beschrieben | Gebaut | Warum |
|---|---|---|
| „Migration: keine" | `0015_bot_twin.sql` (neue Tabelle `bot_manual_outcome`) | Der Nachtrag muss überleben. Die Simulation selbst schreibt weiterhin nichts. |
| Kerzen „zwischen `openedAt` und `closedAt`" | Kerzen ab `openedAt` **über den echten Ausstieg hinaus**, bis Stop oder Ziel berührt sind | Sonst wäre ein vorzeitiger Ausstieg per Konstruktion gleichwertig mit dem Plan — genau die Differenz, um die es geht, wäre nie messbar. |
| Differenz als „Bot − Du" | `Du − Bot` | Die Zahl beschreibt **deine** Seite: negativ = das Eingreifen hat gekostet. So steht sie auch im Beispiel dieser Roadmap. |
| eine feste Auflösung | adaptiv nach Haltedauer, mit Rückfallkette | Bei Tageskerzen entscheidet die konservative Stop-Regel fast jeden kurzen Trade; bei Stundenkerzen fehlt die Reichweite für lange. |
| — | Minutenlimit **je Anbieter** statt global | Ein erschöpftes Twelve-Data-Kontingent hatte im ersten Live-Lauf auch alle Binance-Abrufe blockiert. Krypto und Aktien haben nichts miteinander zu tun. |
| — | eigener Block „Von Hand nachgetragen" | Ein Nachtrag zählt mit und verschwand dadurch aus der Lückenliste — er war danach weder zu erkennen noch zu korrigieren. |
| — | Abrechnung mit zwei Nachkommastellen | Mit einer Stelle ergab −1,0 und +2,0 optisch +3,0, während die Differenz +3,1 war. Eine Abrechnung, die sichtbar nicht aufgeht, kostet mehr Vertrauen als eine Stelle mehr. |

## Nachweis

- **49 Tests** in `lib/bot-twin.test.ts`, gesamte Suite **226/226 grün**, `tsc --noEmit` und
  `next build` sauber.
- **Trockenlauf gegen echte Kerzen:** 500 BTC-Stundenkerzen von Binance, synthetischer Trade,
  Ergebnis unabhängig gegengerechnet — identischer Ausgang, identischer Ausstiegskurs.
- **Sichtprüfung mit echten Daten** über einen wegwerfbaren Sandbox-Nutzer (eigene Trades, eigene
  Kurse): Aussage, Doppelkurve, Aufschlüsselung, Lücken, Nachtrag (setzen → zählt mit → ändern →
  entfernen → wieder Lücke) und der getrennte Block für nicht eingegangene Trades. Sandbox
  anschließend restlos entfernt.
- **Deine Daten unangetastet:** Trade-Dump vor der Migration und nach dem Aufräumen
  byte-identisch (16/16 Trades, 0 geänderte Felder).

## Offen

- **Noch keine echten Zahlen.** Die Datenbank enthält aktuell keinen abgeschlossenen Trade; der
  Block zeigt deshalb seinen Leerzustand. Mit dem ersten Abschluss rechnet er los.
- **Slippage und Spread** fehlen weiterhin — der Bot ist dadurch leicht zu optimistisch. Eine
  pauschale Annahme wäre eine erfundene Zahl; ehrlicher ist der Hinweis unter der Auswertung.
- **Teilverkäufe (Etappe 6) simuliert der Bot nicht.** Er handelt den Plan: ganze Position, ein
  Ausstieg. Die echte Seite rechnet dagegen event-aware. Das ist gewollt — der Vergleich lautet
  „Plan gegen Wirklichkeit", nicht „Plan gegen Plan".

---

# Etappe 6 — Teilverkäufe und Event-Log ✅ ERLEDIGT

**Aufwand:** groß (~1–2 Sitzungen) · **Migration:** `0014_trade_events.sql` (angewendet) · **setzt Etappe 3 voraus (erledigt)**

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

## Vor dem Bauen geklärt — so ist es entschieden

- **Voller Umfang gebaut:** echte Teilverkäufe (`partialClose`), Nachkauf/Pyramidisieren
  (`addToPosition`, gewichteter Durchschnittseinstieg), Event-Log (`trade_event`) und die
  lesbare Timeline auf der Detailseite.
- **Status-Modell:** Teilverkäufe/Nachkäufe sind Events an einem weiter **`aktiven`** Trade; der
  Trade wird erst **`abgeschlossen`**, wenn die letzte Einheit über das bestehende `closeTrade`
  geschlossen wird — so bleiben die Douglas-Guards (Verlust bewusst annehmen, Emotions-Check-in,
  Ausstiegskurs) intakt. Kein neuer Status `teilweise_geschlossen`. Der Restbestand wird über den
  Live-Kurs aus Etappe 3 bewertet (realisiert vs. unrealisiert getrennt).
- **Stop-Nachziehen nach Teilverkauf:** Sobald ein Teilverkauf stattfand, ist risiko-**reduzierendes**
  Nachziehen des Stops (Long höher / Short tiefer, auch in den Profit) **kein** Regelbruch und
  braucht kein `force` — der Kern-Workflow „bei 1 R die Hälfte verkaufen, Stop auf Einstand ziehen".
  **Vor** dem ersten Teilverkauf bleibt der Plan-Lock streng (jede Stop-Verschiebung = `stop_moved`);
  das **Aufweiten** (Risiko rauf) bleibt immer ein Regelbruch. Die **Invalidation bleibt streng**
  (jede Änderung = `invalidation_ignored`), unabhängig von Teilverkäufen. Kein neues Plan-Feld
  „Stop nachziehen ab X R" — die richtungsbewusste Regel deckt den Fall ohne zusätzliches Feld ab.
- **Additiv, kein Backfill:** bestehende `ruleViolations` werden **nicht** rückwirkend in Events
  umgewandelt. Alt-Trades ohne Events bekommen ihre Timeline zur Anzeigezeit aus vorhandenen
  Feldern **abgeleitet** (openedAt / ruleViolations / closedAt) — ohne erfundene Zeitstempel
  (`deriveTimeline`, markiert als „abgeleitet"). Entspricht der Projektkonvention (0 Backfill).
- **Nachkauf ist kein Regelbruch** (geplantes Pyramidisieren ist Douglas-konform); er erhöht aber
  das Risiko über den ursprünglichen Einsatz hinaus, was in der R-Anzeige sichtbar wird.

## Abweichungen von der ursprünglichen Beschreibung

| Geplant | Gebaut | Warum |
|---|---|---|
| `trade_event(… payload JSON …)` als einziger Träger | zusätzlich Spalten `quantity`/`price`/`fee`; `payload` nur für Level-Events (`{from,to,violation}`) | Die Geldmathematik (Menge × Kurs) bleibt spaltenbasiert und ohne JSON-Parsing rechenbar; nur die Level-Änderungen brauchen ein freies Feld. |
| Rechenlogik teils in der Action | reines Modul `lib/trade-events.ts` (+ Test): `settlePosition`, `deriveTimeline`, `isRiskReducingStop` | Wie bei `lib/alerts.ts`/`lib/emotions.ts`: die testbare Logik gehört nicht in die `'use server'`-Action. |
| Durchschnittsrechnung in `trade-stats.ts` dupliziert | **event-aware** `computeDisciplineStats`/`-Equity`/`-Mood` + `getMoneyVsPaperStats` + CSV; ohne Event-Map identisch zum Alt-Verhalten | Ein Trade MIT Events wird vollständig aus dem Settlement gerechnet, ein event-loser Trade exakt wie bisher — dadurch bleiben alle Altkennzahlen unverändert. |
| `ruleViolations` „ab dann abgeleitet" | `ruleViolations` bleibt weiter **führend** geschrieben; Timeline liest Events (bzw. leitet ab) | Der Disziplin-Score hängt an `ruleViolations`; ihn umzustellen hätte den Kern-Guard berührt, ohne Mehrwert. |
| — | `entryPrice`/`positionSize` wandern bei Nachkauf auf den gewichteten Durchschnitt / die Gesamtmenge | Damit Risiko- und Live-Anzeige stimmen; das ursprüngliche 1R bleibt über das eröffnende Event erhalten (Settlement bezieht R immer auf den Ursprungsplan). |
| — | Teilverkauf erzwingt eine offene Restmenge (`< openQty`) | Der letzte Rest läuft bewusst über `closeTrade`, damit dort die Douglas-Guards greifen. |

## Nachweis

- Migration `0014_trade_events.sql` gegen die Produktions-DB angewendet (additiv, nur neue
  Tabelle): **Trade-Dump vorher/nachher byte-identisch, 15/15 Trades unverändert.**
- `trade_event` verifiziert: 11 Spalten wie entworfen, **0 Zeilen** (kein Backfill), Index
  `trade_event_trade_idx` angelegt, `trade_event_type_check` greift (Einfügung mit ungültigem
  `type` abgelehnt, gültiger akzeptiert, beides zurückgerollt).
- **139 Tests grün** (`vitest`, davon 14 neu in `lib/trade-events.test.ts`: Teilverkauf Long/Short,
  Nachkauf-Durchschnitt, verschachtelt, vollständige Schließung, Ableitung ohne Events,
  Richtungslogik; + 4 Integrationstests in `lib/trade-stats.test.ts`: event-aware Disziplin-/Equity-
  Kennzahlen und Row-Fallback), `tsc --noEmit` sauber, `next build` erfolgreich (Route `/trades/[id]`
  mit Timeline).

## Offen

- **Klick-Test teilweise erledigt (26.07.2026):** Teilverkauf über 40 von 100 Stück zu 108 mit
  4,50 € Gebühr gebucht → „Realisiert (R) +0,64 · Realisiert (Geld) +315,50 € · Rest offen
  60 / 100", und der Trade blieb **aktiv** (wie vorgesehen bis zur letzten Einheit). Nach dem
  Abschluss steht die vollständige Kette `eroeffnet → teilverkauf → geschlossen` in
  `trade_event`. **Weiterhin ungeprüft im Klickweg:** Stop in Gewinnrichtung ziehen (kein
  Regelbruch) gegen Aufweiten (Regelbruch) und der Nachkauf mit wanderndem Durchschnittseinstieg.
- **R-Konvention bei verschachteltem Nachkauf + Teilverkauf** ist eine dokumentierte
  Modellierung (gewichteter Durchschnittseinstieg zum Zeitpunkt jedes Teilverkaufs, 1R fix aus dem
  Ursprungsplan); bei reinen Teilverkäufen ohne Nachkauf exakt.

---

# Etappe 7 — Statistik-Ausbau

**Aufwand:** groß, aber gut teilbar · **Migration:** nur 7b (`0016`, eine Spalte) ·
**7a und 7b sind erledigt, 7c–7d sind offen**

## Warum

Alle vier Bausteine rechnen ausschließlich mit Daten, die bereits da sind — sie brauchen kein
neues Feld, keine neue Eingabe, keinen neuen Dienst. Diese Etappe kann in vier unabhängige
Prompts zerlegt werden.

## 7a · Monte-Carlo-Simulator ✅ ERLEDIGT (25.07.2026)

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
(Die Zahlen im Kasten oben sind ein Beispiel, keine echten Werte.)

### Wie es gebaut wurde — die Entscheidungen

- **Verfahren: Bootstrap statt Verteilungsannahme.** Jeder simulierte Trade ist ein zufällig
  gezogenes R-Vielfaches aus dem eigenen Bestand (mit Zurücklegen). Damit bleibt die
  tatsächliche Form der Verteilung inklusive Ausreißern erhalten — eine unterstellte
  Normalverteilung hätte genau die dicken Ränder wegglättet, um die es hier geht.
  Die Annahme, die dabei bleibt (Trades unabhängig, gleiche Verteilung), steht in der UI.
- **Fester Zufalls-Seed.** `Math.random()` wäre hier falsch: dieselbe Seite zeigte bei jedem
  Aufruf andere Zahlen, und kein Test könnte etwas festnageln. Der PRNG (`mulberry32`) ist
  ein Dutzend Zeilen und macht das Ergebnis reproduzierbar.
- **Mindestens 20 abgerechnete Trades** (offene Frage der Etappe, so entschieden). Darunter
  erscheint **keine einzige Wahrscheinlichkeit**, sondern der Zähler „x von 20" — dieselbe
  Haltung wie bei der Emotions-Auswertung: eine Verteilung aus fünf Trades sieht aus wie ein
  Befund und ist Rauschen.
- **Dieselbe Grundlage wie der Erwartungswert daneben.** `ratedRMultiples` benutzt exakt die
  Auswahl und die Rechnung von `computeDisciplineStats` (entschieden, P&L bekannt,
  event-aware). Die Simulation kann dadurch nie auf anderen Zahlen stehen als die Kachel
  daneben. Echtgeld und Demo zählen gemeinsam — R ist größenunabhängig.
- **Prozent nur mit Deckung.** Ein Rückgang in R wird nur dann in Kontoprozent übersetzt,
  wenn sich ein typisches Risiko je Trade bestimmen lässt (`medianRiskFraction`: Median über
  **Echtgeld**-Trades mit echter Stopdistanz). Sonst zeigt die Kachel den Rückgang in R statt
  einer geschätzten Prozentzahl. Bewusst der Median, nicht der Durchschnitt — ein einzelner
  überdimensionierter Trade darf den Maßstab nicht verschieben.
- **Douglas-Filter bestanden:** Der Block sagt nichts über den nächsten Trade. Er ordnet die
  eigene Verlustserie in die eigene Verteilung ein — genau die Denkbewegung, die Douglas
  verlangt. Deshalb steht die Serien-Aussage groß oben und die Endstand-Bandbreite darunter,
  nicht umgekehrt.

### Dateien

| Datei | Änderung |
|---|---|
| `lib/monte-carlo.ts` | **neu** — Simulation, PRNG, Perzentile, Serien-Statistik |
| `lib/monte-carlo.test.ts` | **neu** — 27 Tests |
| `lib/trade-stats.ts` | `ratedRMultiples`, `medianRiskFraction` (beide event-aware) |
| `lib/trade-stats.test.ts` | 11 Tests für die beiden neuen Funktionen |
| `app/actions/trades.ts` | `getMonteCarloStats()` — lädt Zeilen, rechnet nichts selbst |
| `components/monte-carlo-panel.tsx` | **neu** — Panel inkl. Leerzustand und Ehrlichkeitsgrenzen |
| `app/tracking/page.tsx` | Panel unter den Risiko-Kennzahlen eingehängt |

### Nachweis

- **Keine Migration, kein Schreibzugriff.** Die Etappe fügt kein Feld und keine Tabelle hinzu
  und führt keine einzige schreibende Abfrage aus — der Trade-Bestand kann sich nicht geändert
  haben. Deshalb wurde bewusst kein Baseline-Dump-Vergleich gefahren.
- **Die Verlustserien-Wahrscheinlichkeit ist gegen eine geschlossene Lösung geprüft.** Der Test
  rechnet dieselbe Wahrscheinlichkeit exakt per Markov-Kette (Zustand = Länge der laufenden
  Verluststrecke) und vergleicht sie mit der Simulation — für den fairen Münzwurf *und* für
  eine schiefe Verteilung (25 % Treffer à +3 R). Abweichung unter 2 Prozentpunkten bei 10.000
  Verläufen, wie es der Standardfehler erlaubt. Die Zahlen im Panel sind damit nicht nur
  „plausibel", sondern nachgerechnet.
- **Randfälle abgedeckt:** leere Eingabe, unter der Mindestzahl, nicht-endliche Werte, nur
  Gewinner, nur Verlierer, Serie jenseits des Horizonts, fehlender Risikoanteil.
  Determinismus (gleicher Seed → identisches Ergebnis) ist ein eigener Test.
- **Prüfläufe grün:** `tsc --noEmit`, `vitest run` (177 Tests, 7 Dateien), `next build`.
- **Visuell geprüft** über eine temporäre Vorschau-Route (danach gelöscht): gefüllter Zustand,
  Leerzustand, seltene Serie (8,7 %), fehlender Risikoanteil — und derselbe Weg einmal mit den
  **echten** Zeilen aus der Datenbank (nur lesend), der korrekt „0 von 20" zeigt.

### Abweichungen von der ursprünglichen Beschreibung

| Ursprünglich | Jetzt | Warum |
|---|---|---|
| „Aus deiner Trefferquote und deiner R-Verteilung" | ausschließlich aus der R-Verteilung (Bootstrap) | Trefferquote und R-Verteilung getrennt zu ziehen hieße, die Verteilung zweimal zu modellieren; die Trefferquote steckt bereits in ihr. Sie wird als Kennzahl der Stichprobe trotzdem angezeigt. |
| „Wahrscheinlichkeit eines Drawdowns über 20 %" | nur bei bestimmbarem Risikoanteil, sonst Rückgang in R | Ohne Echtgeld-Trades mit Stopdistanz gäbe es keinen ehrlichen Umrechnungsschlüssel. |
| — | Verlustserien-Tabelle lässt praktisch sichere Längen weg | „1 in Folge: 100 %" ist keine Information und verdrängte genau die Zeilen, wegen derer man hinschaut. Die selbst erlebte Serie steht immer drin. |
| — | Leerzustand zählt mit („0 von 20", es fehlen 20) | Ein leerer Block ohne Zähler wirkt wie ein Fehler; so ist sichtbar, wann er sich füllt. |

### Offen

- **Der Block ist bis auf Weiteres leer:** der Bestand hat 0 abgeschlossene Trades. Die
  Simulation ist damit gebaut und geprüft, aber am echten Journal noch nie sichtbar gewesen.
  Ab dem 20. abgerechneten Trade schaltet sie sich von selbst frei.
- **Autokorrelation wird ignoriert.** Wer nach einem Verlust anders handelt (Rache-Trade,
  Zögern), erzeugt abhängige Trades — der Bootstrap unterstellt Unabhängigkeit. Sichtbar wäre
  das erst mit deutlich mehr Daten; die Emotions-Auswertung (Etappe 4) greift dieselbe Frage
  von der anderen Seite an.
- **Zinseszins ist nicht abgebildet** (gleichbleibendes Risiko je Trade). Steht so in der UI.

## 7b · Setup-Vergleich ✅ ERLEDIGT (25.07.2026)

`strategy` war ein Freitextfeld und dadurch nicht auswertbar. Neu ist eine zweite Spalte mit
kurzen, vergleichbaren Setup-Tags; je Setup zeigt `/tracking` Anzahl, Trefferquote,
Erwartungswert, Ø Haltedauer und bestes/schlechtestes R.

Die Frage, die es beantwortet: *Welches meiner Setups verdient das Geld — und welches halte ich
nur aus Gewohnheit?*

```
Setup          Trades  Treffer     Ø R   best/schlecht.  Ø Dauer  Plan
Breakout           13     62 %  +0,92 R  +3,00 / −1,00     2,2 T   92 %
Rücksetzer         11     36 %  −0,09 R  +1,50 / −1,00    11,7 T   82 %
Range               4     noch zu wenige Daten (ab 10)
ohne Angabe         3     noch zu wenige Daten (ab 10)
```
(Zahlen aus dem Sandbox-Durchlauf der Sichtprüfung, keine echten Werte.)

### Wie es gebaut wurde — die Entscheidungen

- **Freie Tags statt festem Katalog.** Bei den Emotionen ist eine feste Liste richtig — FOMO
  heißt bei jedem dasselbe. Setups sind das persönliche Handwerk des Traders: ein vorgegebener
  Katalog würde entweder nicht passen oder in fremde Schubladen zwingen und damit genau die
  Auswertung verfälschen, um die es geht. Die Vergleichbarkeit kommt deshalb nicht aus einer
  Liste, sondern aus der **Normalisierung**: „Breakout", „breakout", „Break-Out" haben denselben
  Schlüssel (klein, Umlaute deutsch gefaltet ä→ae, alles außer Buchstaben/Ziffern raus).
  Angezeigt wird die geschriebene Form, verglichen wird der Schlüssel.
- **Neue Spalte, kein Typwechsel.** `setupTags` (JSON-Array, wie `moodEntryTags`) steht neben
  `strategy`. Der Freitext behält eine eigene Aufgabe — er ist ab jetzt die **Begründung**
  („warum genau jetzt"), das Tag die **Schublade** („welches Setup"). Beide Felder stehen im
  Formular untereinander, das Textfeld heißt jetzt „Begründung / Strategie".
- **Kein Backfill.** Aus „Long, weil der Markt stark aussah" automatisch ein Tag zu machen hieße,
  sich die Kategorien auszudenken, auf denen anschließend die ganze Auswertung steht.
  Stattdessen ist der Freitext **Migrationshilfe**: `suggestSetupTags` schlägt daraus Tags vor,
  übernommen wird nur, was der Mensch anklickt. Der Vorschlag kommt bewusst nur, wenn der Text
  **als Ganzes** eine Aufzählung ist (jeder Teil ≤ 3 Wörter). Sobald ein Teil Prosa ist, kommt
  gar kein Vorschlag — sonst würde aus dem Satz oben „Long" vorgeschlagen, also eine
  Handelsrichtung, die anschließend als Setup gezählt würde. Ein falscher Vorschlag ist hier
  teurer als keiner: er landet mit einem Klick in der Auswertung.
- **Höchstens 3 Tags je Trade.** Ein Trade hat in aller Regel *ein* Setup. Bei zehn erlaubten
  Tags stünde jeder Trade in jeder Zeile und die Frage „welches Setup trägt mich" verlöre ihre
  Schärfe; Kombinationen wie „Breakout + Trendfolge" bleiben mit drei Plätzen möglich.
- **Mindestens 10 entschiedene Trades je Setup** (die offene Frage der Etappe, so entschieden —
  wie in der Roadmap vorgeschlagen). Darunter steht „noch zu wenige Daten (ab 10)" statt einer
  Quote. Hier ist die Scheinpräzision besonders teuer: man sortiert sonst ein funktionierendes
  Setup aus, das nur eine schlechte Woche hatte.
- **Dieselbe Grundlage wie Erwartungswert und Emotions-Auswertung.** Gezählt werden nur
  **entschiedene** Trades (Gewinn/Verlust), der Erwartungswert nur über die mit berechenbarem
  P&L, event-aware. Eine Kennzahl darf nicht je nach Block auf einer anderen Auswahl stehen.
- **Sortierung: belastbare Setups zuerst, nach Erwartungswert.** Sonst stünde ein Setup mit zwei
  Glückstreffern ganz oben — und genau daraus würde man die falsche Entscheidung ableiten.
- **Tags sind auch bei abgeschlossenen Trades nachtragbar** (`updateTradeSetupTags`, eigener
  Weg neben `updateTradePlan`, der abgeschlossene Trades zu Recht ablehnt). Ein Tag ist kein
  Planbestandteil: es verändert weder Risiko noch Ergebnis noch eine Geldkennzahl, nur die
  Zeile, in der der Trade erscheint. Ohne diesen Weg bliebe die gesamte Historie unauswertbar.
- **Douglas-Filter bestanden:** Der Block sagt nichts über den nächsten Trade voraus. Er zeigt,
  welcher Teil des eigenen Prozesses trägt — und macht damit das Aussortieren eines Setups zu
  einer Entscheidung auf Zahlen statt auf Gefühl. Die Zeile „ohne Angabe" bleibt sichtbar, damit
  die Auswertung nicht vollständiger aussieht, als sie ist.

### Dateien

| Datei | Änderung |
|---|---|
| `lib/setups.ts` | **neu** — Schlüsselbildung, Normalisierung, Grenzen, Vorschläge, Rangliste |
| `lib/setups.test.ts` | **neu** — 28 Tests |
| `lib/trade-stats.ts` | `computeSetupStats` + Typen (`SetupBucket`, `SetupStats`), event-aware |
| `lib/trade-stats.test.ts` | 15 Tests für den Setup-Vergleich |
| `lib/db/schema.ts` | Spalte `setupTags` am `trade` |
| `drizzle/0016_setup_tags.sql` | **neu** — additiv, idempotent, ohne Backfill |
| `app/actions/trades.ts` | `getSetupStats`, `listSetupTagOptions`, `updateTradeSetupTags`; `setupTags` in `createTrade`/`updateTradePlan`; CSV-Spalte `setups` |
| `components/setup-tags-input.tsx` | **neu** — Chips, Katalog, Freitext-Vorschlag (kontrolliert) |
| `components/setup-comparison-panel.tsx` | **neu** — Tabelle inkl. Leerzustand und Ehrlichkeitsgrenzen |
| `components/setup-tags-card.tsx` | **neu** — Setup auf `/trades/[id]`, auch nachträglich |
| `components/{trade-form,edit-trade-dialog,trade-card}.tsx` | Eingabe eingehängt, Tags auf der Karte |
| `app/tracking/page.tsx`, `app/trades/[id]/page.tsx` | Panel bzw. Karte eingehängt |

### Nachweis

- **Migration nachgewiesen:** `.baseline-etappe7b-vorher` gegen `.baseline-etappe7b-final`
  verglichen — 16 Trades vorher wie nachher, **0 Abweichungen** in allen bestehenden Feldern,
  einzige Änderung ist die neue, überall leere Spalte. Gegen `information_schema` geprüft:
  `setupTags text, nullable`, 0 gefüllte Zeilen.
- **Prüfläufe grün:** `tsc --noEmit`, `vitest run` (270 Tests, 9 Dateien), `next build`.
- **Sichtprüfung mit einem Wegwerf-Account** (angelegt, befüllt, danach samt Trades und Konto
  gelöscht — die echten Trades wurden nie angefasst): 31 abgeschlossene Sandbox-Trades zeigten
  die gefüllte Tabelle (Zahlen oben, gegen die Erwartung nachgerechnet), die Zeilen „zu wenige
  Daten" ab 4 Trades, den Mehrfach-Tag-Trade in zwei Zeilen, den Hinweis auf 2 Trades mit
  Freitext ohne Setup — und nach dem Entfernen aller Tags den Leerzustand.
- **Der Schreibweg ist end-to-end geprüft:** auf einem **abgeschlossenen** Trade zwei Tags über
  die Karte gesetzt und gespeichert; die Spalte stand danach als `["Vortageshoch","Breakout"]`
  in der Datenbank. Ebenso geprüft: Tippen + Enter erzeugt einen Chip und zählt 1/3, der
  Katalog bietet nur noch die nicht gewählten Tags an, und aus „Breakout, Vortageshoch" wird
  ein Vorschlag, aus einem ganzen Satz keiner.
- **Die Gruppierung ist gegen Schreibweisen getestet:** „Breakout", „breakout" und „Break-Out"
  landen in einer Zeile; „Rücksetzer" und „Ruecksetzer" ebenso; „Welle 3" und „Welle 5" bleiben
  getrennt.

### Abweichungen von der ursprünglichen Beschreibung

| Ursprünglich | Jetzt | Warum |
|---|---|---|
| „Umbau auf Tags" (statt Freitext) | Tags **neben** dem Freitext, beide bleiben | Ein Typwechsel wäre destruktiv; und der Freitext hat eine eigene Aufgabe (Begründung), die ein Tag nicht übernehmen kann. |
| „Etappe 7: Migration keine" | Migration `0016` (eine Spalte) | Ohne eigene Spalte gäbe es keinen Ort für die Tags. Additiv, ohne Backfill, Bestand unverändert. |
| — | Ø Haltedauer weist ihre Stichprobe aus | Alt-Trades ohne `openedAt`/`closedAt` würden den Schnitt sonst stumm verzerren. |
| — | Zeile „ohne Angabe" + Zähler „x von y mit Setup" | Ein Block, der nur die getaggten Trades zeigt, sieht vollständiger aus, als er ist. |
| — | Nachtragen auch bei abgeschlossenen Trades | Sonst wäre der Vergleich erst in Monaten aussagefähig und die „Migrationshilfe" wirkungslos. |

### Offen

- **Der Block ist bis auf Weiteres leer:** der echte Bestand hat 0 abgeschlossene Trades, also
  auch keine Setup-Zeile. Gebaut und geprüft ist er über den Sandbox-Durchlauf; am eigenen
  Journal wird er ab dem ersten abgeschlossenen, getaggten Trade sichtbar.
- **Die 13 geplanten Trades tragen noch keine Tags.** Sie lassen sich im Bearbeiten-Dialog
  vergeben; ein Vorschlag aus dem Freitext erscheint nur bei aufzählungsartigen Texten.
- **Keine Zusammenführung zweier Setups im Nachhinein.** Wer „Breakout" und „Ausbruch" parallel
  benutzt, hat zwei Zeilen und muss sie von Hand angleichen. Ein Umbenennen über alle Trades
  hinweg wäre der nächste Schritt, wenn der Fall auftritt.
- **Ø Haltedauer ist ein arithmetisches Mittel.** Ein einzelner Monate-Trade verschiebt sie;
  ein Median wäre robuster, braucht aber mehr Daten, um sich zu lohnen.

## 7c · MAE / MFE ✅ ERLEDIGT (25.07.2026)

**M**aximum **A**dverse/**F**avourable **E**xcursion: Wie weit lief der Kurs gegen dich, bevor
er drehte — und wie weit für dich, bevor du ausgestiegen bist? Berechnet aus den Kerzen der
Haltedauer (dieselbe Mechanik wie der Bot-Zwilling, teilt sich den Kerzen-Ladeweg).

Beantwortet zwei sehr konkrete Fragen:
- „Deine Stops werden im Schnitt bei 0,8 R getroffen, bevor der Kurs dreht" → **Stops zu eng**
- „Deine Gewinner liefen im Schnitt bis 2,3 R, du bist bei 1,4 R ausgestiegen" → **Ziele zu nah**

### Wie es gebaut wurde — die Entscheidungen

- **Ein Kerzen-Durchlauf für beide Auswertungen.** MAE/MFE hängt sich an den Bot-Zwilling:
  derselbe memoisierte Loader (jetzt in `lib/market-data/candle-loader.ts`), dieselbe
  Auflösungs-Kette, dieselbe Rate-Limit-Buchführung. Ein eigener Ladeweg hätte jedes Symbol ein
  zweites Mal angefragt — und genau daran scheitert das Trade-Replay heute schon.
- **Zwei Fragen, ein Datensatz:** der Bot rechnet **über** den echten Ausstieg hinaus („was wäre
  passiert"), MAE/MFE misst **nur** die Zeit im Markt („was ist passiert, während ich drin
  war"). Deshalb ist MAE/MFE auch für Trades messbar, die der Bot mit „kein Ziel" überspringt.
- **Messfenster:** ab der ersten Kerze **nach** dem Einstieg (die angebrochene Einstiegskerze
  enthält Bewegung von davor — dieselbe Strenge wie `simulateTrade`) bis **einschließlich** der
  Kerze, die den Ausstieg enthält. Ohne die letzte Kerze fiele das Fenster bei kurzen Trades
  leer aus.
- **„Grob gemessen" als eigener Zustand.** Ist die Kerze länger als die Haltedauer, kann das
  Extrem aus Zeit stammen, in der gar keine Position offen war. Solche Messungen zählen mit,
  werden aber gekennzeichnet (Karte + Fußnote) — und sie sind der **einzige** Fall, in dem eine
  Handeingabe eine vorhandene Messung überstimmen darf. Die Regel aus Etappe 5 („Messung schlägt
  Eingabe") bleibt damit unangetastet: was nicht das Haltefenster misst, ist keine Messung
  dieses Trades.
- **Nachgetragen werden Kurse, nie R-Werte.** „Wie tief lief es" liest man am Chart ab; das R
  ergibt sich zwingend aus Einstieg und Stopdistanz — genau wie bei `bot_manual_outcome`. Ein
  in die falsche Richtung getippter Kurs wird auf 0 gekappt statt still umgedeutet.
- **Gewinner und Verlierer getrennt**, Schwelle **5** je Gruppe (`MIN_EXCURSION_TRADES`). Der
  Gegenlauf der *Gewinner* ist das Maß für die Stopweite: diese Trades gingen am Ende auf, ein
  engerer Stop hätte sie nur unnötig beendet.
- **Der Block beobachtet, er ordnet nicht an.** „Deine Gewinner liefen im Schnitt 0,5 R weiter,
  als du sie gehalten hast" — kein „zieh deine Ziele weiter". Der Plan entsteht vor dem Trade,
  nicht aus einer Statistik über fünf Trades. Die Beobachtung erscheint erst ab 0,25 R Abstand
  (darunter ist es Rauschen) bzw. ab −0,5 R Gegenlauf.
- **Teilverkäufe:** das Fenster läuft bis zum **letzten** Abschluss — bis dahin war die Position
  im Markt. Verglichen wird gegen den gewichteten Gesamt-R aus dem Settlement, wie überall sonst.

### Dateien

| Datei | Änderung |
|---|---|
| `lib/excursion.ts` (+ Test) | **neu** — `computeExcursion`, `manualExcursionRun`, `resolveRun`, `aggregateExcursion` |
| `lib/market-data/candle-loader.ts` | **neu** — `createCandleLoader` (aus `bot-twin.ts` herausgezogen) + `resolveExcursion` |
| `drizzle/0017_excursion_manual.sql`, `lib/db/schema.ts` | **neu** — Tabelle `trade_excursion` (nur Nachträge) |
| `app/actions/bot-twin.ts` | misst im selben Durchlauf mit (`measureExcursion`), gibt `excursion` mit zurück |
| `app/actions/excursion.ts` | **neu** — `getTradeExcursion`, `setTradeExcursion`, `clearTradeExcursion` |
| `components/excursion-panel.tsx`, `components/excursion-card.tsx` | **neu** — `/tracking` und `/trades/[id]` |

### Nachweis

- **Migration nachgewiesen:** `.baseline-etappe7c-vorher` gegen `.baseline-etappe7c-nachher` —
  16 Trades vorher wie nachher, inhaltlich **byte-identisch** (nur der Report-Zeitstempel
  unterscheidet sich). Gegen `information_schema` geprüft: `trade_excursion` mit
  `worstPrice`/`bestPrice` als `double precision, nullable`, 0 Zeilen; beide CHECK-Constraints
  vorhanden, und ein Insert ohne jeden Kurs wird von `trade_excursion_price_check` abgewiesen.
- **Prüfläufe grün:** `tsc --noEmit`, `vitest run` (301 Tests, 10 Dateien), `next build`.
- **Sichtprüfung mit echten Kerzen** über einen Wegwerf-Account (danach restlos gelöscht,
  Restzeilen 0): 10 Sandbox-Trades auf **BTCUSDT**, deren Fenster aus echten Binance-Stundenkerzen
  konstruiert wurden — die erwarteten MAE/MFE wurden im Prüfskript **unabhängig nachgerechnet**
  und stimmten mit der Anzeige überein (Gewinner Ø MAE −0,39 R / MFE +0,82 R / Ausstieg +0,58 R
  → angezeigt −0,4 / +0,8 / +0,6; Einzeltrade erwartet −0,41 / +0,61 / +0,38 → angezeigt
  −0,4 / +0,6 / +0,4). Ebenfalls geprüft: die Verlierer-Zeile mit 4 Trades zeigte „noch zu wenige
  Daten (ab 5)", der 30-Minuten-Trade wurde als **grob** gekennzeichnet, der Trade auf einem
  unbekannten Symbol erschien als Lücke mit Grund — und nach dem Nachtrag stand er als
  „1 von Hand nachgetragen" in der Auswertung.

### Abweichungen von der ursprünglichen Beschreibung

| Ursprünglich | Jetzt | Warum |
|---|---|---|
| „Etappe 7: Migration keine" | Migration `0017` (eine Tabelle) | Ohne sie gäbe es keinen Ort für den Nachtrag. Additiv, ohne Backfill, Bestand unverändert. |
| Nur ein Panel auf `/tracking` | Zusätzlich eine Karte je Trade | Beim Nachbesprechen eines Trades sucht man genau diese Zahl — und nur dort lässt sie sich auch nachtragen. |
| — | Zustand „grob gemessen" | Ohne ihn läse man eine Tageskerze wie eine Messung des Haltefensters. |
| — | `createCandleLoader` liegt jetzt in `lib/market-data/` | Zwei Auswertungen teilen ihn; im Action-Modul wäre er nicht wiederverwendbar gewesen. |

### Offen

- **Kein MAE/MFE je Setup.** Wäre der nächste sinnvolle Schnitt („bei Breakouts sind meine Stops
  zu eng, bei Rücksetzern nicht"), braucht aber pro Setup denselben Bestand — dafür fehlen auf
  Monate die Trades.
- **Die Genauigkeit hängt an der Kerze.** Innerhalb einer Kerze ist nicht bekannt, wann Hoch und
  Tief lagen; bewusst wird nicht interpoliert. Bei Trades, die kürzer sind als die feinste
  verfügbare Auflösung, bleibt nur „grob" oder der Nachtrag.
- **Der Nachtrag ist ungeprüft gegen den Chart.** Er ist eine Angabe des Nutzers und wird als
  solche ausgewiesen — die App kann nicht erkennen, ob der eingetippte Kurs stimmt.

## 7d · Zeit-Heatmap und Haltedauer ✅ ERLEDIGT (25.07.2026)

Wochentag × Tageszeit als Gitter, eingefärbt nach Erwartungswert. Dazu Haltedauer gegen
Ergebnis. Daten liegen in `openedAt` und `closedAt` bereits vollständig vor.

Findet Muster wie „montags vormittags verlierst du systematisch" oder „Trades, die du länger als
zwei Wochen hältst, sind im Schnitt negativ".

### Wie es gebaut wurde — die Entscheidungen

- **Maßgeblich ist die Einstiegszeit (`openedAt`), nicht der Ausstieg.** Dort fällt die
  Entscheidung. Die Frage lautet „wann setze ich schlecht auf" — nicht „wann löse ich auf".
- **Vier Tagesblöcke statt 24 Stundenspalten:** Vormittag 6–12 · Mittag 12–14 · Nachmittag
  14–18 · Abend/Nacht 18–6 (lokale Zeit, der Abend-Block läuft über Mitternacht). Ein
  Stundenraster hätte 168 Felder — bei einem privaten Journal wären davon 90 % leer, und man
  läse Rauschen als Muster.
- **Schwelle 3 Trades je Zelle** (`MIN_TIME_CELL_TRADES`), bewusst niedriger als die 10 aus 7b:
  das Gitter teilt denselben Bestand auf über 20 Felder auf. Unter der Schwelle zeigt eine
  Zelle **nur ihre Anzahl** — keine Quote, kein Erwartungswert, keine Farbe.
- **Wochenende bekommt eine eigene Zeile „Sa/So", die nur erscheint, wenn sie Trades trägt.**
  Krypto läuft durch; ein Mo–Fr-Gitter hätte diese Trades stumm verschluckt. Zwei getrennte
  Zeilen für Sa und So wären bei Aktien dagegen fast immer leer.
- **Zeitzone ist die lokale Zeit der Anwendung, nicht die Handelszeit der Börse.** Für „wann
  sitze ich schlecht vor dem Bildschirm" ist genau das die richtige Achse. Eine
  Börsenphasen-Zuordnung (Eröffnung/US-Open) wäre eine andere Frage und bräuchte eine
  Zuordnung Instrument→Börse, die es nicht gibt. Der Block sagt das in seiner Fußnote.
- **Trades ohne Einstiegszeit fallen aus dem Gitter, aber nicht aus dem Blick:** die Kopfzeile
  zählt „x von y entschiedenen Trades mit Einstiegszeit", die Fußnote benennt die Lücke. Kein
  Backfill — eine geschätzte Uhrzeit wäre eine erfundene Zahl.
- **Haltedauer in vier Klassen** (unter 1 Tag · 1–3 · 3–14 · über 14 Tage) gegen Trefferquote
  und Erwartungswert, mit derselben Schwelle. Beantwortet „lohnt sich das lange Halten?".
- **Eine Aufräumung nebenbei:** Zustand (4), Setup (7b) und Zeit (7d) rechneten denselben Kern.
  Er liegt jetzt einmal in `baseBucket` (+ `bucketRs`); alle drei setzen darauf auf. Dadurch
  kann dieselbe Kennzahl nicht mehr je Block auseinanderlaufen.

### Dateien

| Datei | Änderung |
|---|---|
| `lib/trade-stats.ts` | **neu**: `computeTimeStats`, `dayBlockOf`, `timeRowOf`, `holdingClassOf`, `DAY_BLOCKS`, `TIME_ROWS`, `HOLDING_CLASSES`, `MIN_TIME_CELL_TRADES`; `holdingDays` exportiert; `baseBucket`/`bucketRs` als gemeinsamer Kern |
| `lib/trade-stats.test.ts` | 13 neue Tests (Blockgrenzen, Mitternacht, Schwelle, Wochenende, fehlende Zeitstempel, Haltedauer-Klassen, event-aware) |
| `app/actions/trades.ts` | `getTimeStats()` |
| `components/time-heatmap-panel.tsx` | **neu** — Gitter + Haltedauer + Fußnote |
| `app/tracking/page.tsx` | Panel hinter dem Setup-Vergleich eingehängt |

**Keine Migration** — 7d rechnet ausschließlich über vorhandene Spalten.

### Nachweis

- **Prüfläufe grün:** `tsc --noEmit`, `vitest run` (283 Tests, 9 Dateien), `next build`.
- **Sichtprüfung mit einem Wegwerf-Account** (angelegt, befüllt, danach samt Trades und Konto
  gelöscht — die echten Trades wurden nie angefasst; Restzeilen nach dem Aufräumen: 0):
  17 abgeschlossene Sandbox-Trades zeigten das Gitter mit vier belegten Zellen, jede gegen die
  Erwartung nachgerechnet — Mo Vormittag 4 Trades −0,5 R (rot), Di Nachmittag 3 Trades +2,0 R
  (grün), Do Abend 3 Trades +0,3 R, Sa/So Nachmittag 3 Trades −0,8 R. Die Mittwochs-Zelle mit
  2 Trades stand ohne Quote da („2 Trades"), die Sa/So-Zeile erschien nur wegen der
  Wochenend-Trades, und der eine Trade ohne Zeitstempel tauchte als „16 von 17" plus Fußnote
  auf. Nach dem Entfernen aller Zeitstempel stand der Leerzustand.
- **Nebenbefund aus der Sichtprüfung (kein App-Fehler):** `openedAt` ist eine `timestamp`-Spalte
  **ohne** Zeitzone, in die Drizzle die UTC-Wandzeit schreibt und beim Lesen wieder als UTC
  deutet — der Weg der App ist also in sich stimmig. Wer für Testdaten am ORM vorbei per SQL
  schreibt, muss `toISOString()` benutzen, sonst liegen die Zeiten um den Zonen-Versatz daneben
  (im ersten Durchlauf genau so passiert und dort korrigiert).

### Abweichungen von der ursprünglichen Beschreibung

| Ursprünglich | Jetzt | Warum |
|---|---|---|
| „Wochentag × Tageszeit" | Mo–Fr **plus** eine Sa/So-Zeile, die nur bei Bedarf erscheint | Krypto läuft am Wochenende; diese Trades dürfen nicht stumm verschwinden. |
| Schwelle offen („Vorschlag 20/10") | 3 je Zelle | Das Gitter teilt den Bestand auf 20+ Felder; mit 10 bliebe es auf Jahre grau. |
| — | Fußnote zur Zeitzone und zu fehlenden Zeitstempeln | Ohne sie liest man lokale Uhrzeiten als Börsenzeiten und die Abdeckung als vollständig. |

### Offen

- **Das Gitter braucht Bestand.** Mit 0 abgeschlossenen echten Trades zeigt es bis auf Weiteres
  den Leerzustand; belastbar wird eine Zelle ab 3, das Bild insgesamt ab etwa 30 Trades.
- **Keine Börsenphasen.** „US-Open" ließe sich erst zuordnen, wenn am Instrument eine Börse
  hinge. Bis dahin ist die Achse die eigene Uhr — was für die Frage nach dem eigenen Zustand
  auch die richtige ist.
- **Der Erwartungswert je Zelle ist ein Mittelwert über wenige Trades.** Er zeigt eine Richtung,
  keine Signifikanz; die Zellfarbe ist bewusst dreistufig und nicht fein abgestuft.

## Dateien

| Datei | Änderung |
|---|---|
| `lib/monte-carlo.ts` (+ Test) | **neu** — 7a |
| `lib/trade-stats.ts` | `computeSetupStats` ✅ (7b), `computeTimeStats` ✅ (7d) |
| `lib/setups.ts` (+ Test) | **neu** ✅ — 7b |
| `lib/excursion.ts` (+ Test) | **neu** ✅ — 7c |
| `app/actions/trades.ts` | Setup-Tags neben `strategy` ✅ — 7b |
| `components/{monte-carlo,setup-comparison,excursion,time-heatmap}-panel.tsx` | **neu** |
| `app/tracking/page.tsx` | Panels einhängen |

## Konkretes Ergebnis

`/tracking` beantwortet nach dieser Etappe vier Fragen, die es heute nicht kann: Ist meine
Verlustserie normal? Welches Setup trägt mich? Sind meine Stops zu eng? Wann handle ich
schlecht?

## Vor dem Bauen zu klären

- Ab wie vielen Trades wird eine Auswertung überhaupt angezeigt? (Vorschlag: 20 für
  Monte-Carlo, 10 je Setup — darunter „noch zu wenige Daten".)
  → **Für 7a entschieden: 20** (`MIN_TRADES` in `lib/monte-carlo.ts`).
  → **Für 7b entschieden: 10** je Setup (`MIN_SETUP_TRADES` in `lib/setups.ts`), wie
  vorgeschlagen.
  → **Für 7d entschieden: 3** je Zelle (`MIN_TIME_CELL_TRADES` in `lib/trade-stats.ts`) —
  bewusst niedriger, weil das Gitter denselben Bestand auf über 20 Felder verteilt.
  → **Für 7c entschieden: 5** je Gruppe (`MIN_EXCURSION_TRADES` in `lib/excursion.ts`) —
  zwischen beiden: eine Aussage über die eigene Stopweite sollte nicht auf drei Trades stehen,
  zehn wären bei nur zwei Gruppen aber unnötig streng.
- Sollen alle vier Teile zusammen kommen oder einzeln als eigene Prompts?
  → **Einzeln**, wie es die Reihenfolge-Empfehlung unten vorsieht: 7a und 7b sind je als
  eigener Schritt gebaut und abgeschlossen, 7c und 7d bleiben je ein eigener Arbeitsschritt.

---

# Reihenfolge-Empfehlung

```
Etappe 4 (Emotionen)  ─┐  ✅ erledigt — sammelt ab jetzt bei jedem Trade mit
                       │
Etappe 3 (Live+Alerts) ─┤  ✅ erledigt — Voraussetzung für Etappe 6
                       │
Etappe 2 (Freunde)     ─┤  ✅ erledigt
                       │
Etappe 7a (Monte-Carlo)─┤  ✅ erledigt — bester Erkenntnisgewinn ohne neue Eingaben
                       │
Etappe 5 (Bot-Zwilling)─┤  ✅ erledigt — das stärkste Feature und der größte Brocken
                       │
Etappe 6 (Teilverkäufe)─┤  ✅ erledigt — nach Etappe 3
                       │
Etappe 7b (Setups)     ─┤  ✅ erledigt — erste Etappe, die eine neue Eingabe verlangt
                       │
Etappe 7d (Zeit)       ─┤  ✅ erledigt — ohne Migration, rein aus vorhandenen Zeitstempeln
                       │
Etappe 7c (MAE/MFE)    ─┘  ✅ erledigt — teilt sich den Kerzen-Ladeweg mit dem Bot-Zwilling

Design E (Formulare/Chart) ─   ✅ erledigt — der letzte offene Punkt; die Roadmap ist vollständig.
```

**Warum Etappe 4 zuerst:** Emotionsdaten sind nur rückwirkend nutzlos. Jeder Trade, der ohne
Check-in läuft, fehlt später in der Auswertung. Alle anderen Etappen rechnen mit Daten, die
ohnehin schon entstehen — diese eine nicht. (Deshalb ist sie erledigt; ab jetzt sammelt jeder
Trade seinen Zustand mit.)

---

# Offene Punkte aus Etappe 1

- ~~**Klick-Test steht aus**~~ ✅ **erledigt (26.07.2026)**, im eigenen Sandbox-Konto:
  Trade mit **Hebel 2** und **abweichenden Gebühren** (12,50 € Kauf / 7,25 € Verkauf) geplant —
  die Karte rechnete Ordergebühr 19,75 €, Positionswert 10.000 €, Stückzahl 100,
  Netto-Verlust −519,75 €. Ein **Abschluss ohne Ausstiegskurs wurde abgelehnt**: der Trade blieb
  `aktiv`, `actualExitPrice` und `result` blieben leer. Mit Kurs 112 abgeschlossen und die
  Verkaufsgebühr dabei auf 6,90 € korrigiert → in der Datenbank steht `feeExit: 6.9` am Trade,
  die Gebühr ist also tatsächlich beim Abschluss eingefroren worden.
- **ESLint bleibt bewusst uninstalliert** (Entscheidung vom 26.07.2026). `pnpm lint` schlägt
  deshalb weiter fehl — das ist kein Defekt, sondern der Stand: die tatsächlichen Prüfungen
  sind `tsc --noEmit` und Vitest. Eine Installation über npm brächte ein zweites Lockfile
  neben `pnpm-lock.yaml` ein, worüber Next schon heute warnt.
- **Währungswechsel ungetestet gegen echte Daten** — die Umrechnung ist gebaut und typgeprüft,
  aber noch nie ausgeführt worden. Vor dem ersten echten Einsatz mit einem Testkonto prüfen.

---

# Design A–D — Visuelle Überarbeitung ✅ ERLEDIGT (25.07.2026)

Eigene Zählung mit **Buchstaben**, damit sie sich nicht mit den Feature-Etappen oben beißt.
Vorlauf: `drill`-Briefing zu Gestaltung und Bewegung; Vorbild war ein Cockpit-Entwurf
(Lovable) mit Radial-Ring, Statuszeichen und Hintergrund-Atmosphäre.

## Die Leitplanken, die dabei entschieden wurden

- **Navy → Indigo.** Die alte „Privatbank-Nacht" hatte zu wenig Abstand zwischen Seite
  (`#0b1522`) und Karte (`#162534`) — die Oberfläche wirkte flach. Neu: „Indigo-Nacht"
  mit klar getrennten Ebenen. Werte stehen in `CLAUDE.md`.
- **Glow ist die Ausnahme.** Erlaubt nur am Disziplin-Ring (`.svg-glow`) und an
  Statuspunkten (`.dot-glow`). Nicht auf Geldbeträgen — das rückt Ergebnis vor Prozess.
- **Bewegung braucht einen Grund.** Aufbau beim Mount und bei Zustandswechseln.
  Dauerbewegung nur, wo echter Zustand dahintersteht: ein offener Alert pulst, ein
  ausgelöster nicht. **Nie an Kursdaten** — die sind bis zu 5 Minuten alt, ein
  „LIVE"-Signal wäre eine Falschaussage.
- **Kein Index-Ticker.** Fällt unter den Douglas-Feature-Filter und hat keine Datenquelle.
- **Handgebaut in SVG/CSS**, kein `@remotion/player` — das Bundle bleibt unverändert.

## Was gebaut wurde

| Block | Inhalt | Kern-Dateien |
|---|---|---|
| **A** | Analyse-Flächen auf die gemeinsame Sprache; `ChartHeader`/`ChartEmpty` statt Einzellösungen | `stat-cards.tsx`, `assessment-list.tsx`, `stock-ranking.tsx`, 6 Chart-Dateien |
| **B** | Trade-Karte und Trades-Liste, gestaffelter Aufbau | `trade-card.tsx`, `app/trades/page.tsx` |
| **C** | Restrouten angeglichen, `glass-card` → `panel sheen` | Watchlist, Stock-Detail, Freunde, Tracking, Trade-Detail |
| **D** | Trade-Replay: Plan wird gezeichnet, echter Kursverlauf läuft hinein | `trade-replay.tsx` (neu) |

Davor (dieselbe Sitzung): Disziplin-Ring mit neutralem Ruhezustand, animierte Leerzustände,
Alert-Puls, Sheen, App-Hintergrund mit leuchtenden Kerzen, Palette, Video-Re-Render.

## Bewusst NICHT dabei

- **Formulare** (`trade-form.tsx`, `settings-form.tsx`, Pre-Trade-Fragen, Mood-Check) und
  **`components/chart/*`** — sie erben Palette und Panel-Optik, wurden aber nicht angefasst.
  Sie tragen Douglas-Guards, die nicht verrutschen dürfen.
- Keine Änderung an Server Actions, Schema, Migrationen oder Geschäftslogik.

## Offen

- **Trade-Replay zeigt meist den Fallback.** Das Gratis-Limit von Twelve Data
  (~8 Anfragen/Minute) wird durch Watchlist und `AlertWatcher` schnell ausgeschöpft.
  Sobald Kerzen kommen, läuft der Kurs in den Plan hinein — der Weg ist gebaut und getestet.
- ~~**Drei Trades ohne Watchlist-Verknüpfung:** `ADBE`, `TEAM`, `FI`~~ ✅ **erledigt
  (26.07.2026)** — und die Ursache mit. `createTrade` verknüpft nur im Moment des Anlegens
  (`app/actions/trades.ts:171`): fehlt das Instrument da noch, bleibt `stockId` für immer leer.
  `addStock` holt das jetzt nach und hängt bestehende Trades desselben Tickers an das neue
  Instrument (nur `stockId IS NULL`, eine bestehende Zuordnung wird nie überschrieben).
  Adobe, Fiserv und Atlassian angelegt → Trades 22, 18, 21 hängen automatisch daran.
  **Nachweis:** `.baseline-stockid-vorher` gegen `.baseline-stockid-nachher` — genau drei
  Felder geändert (die drei `stockId`), alle übrigen Felder und die Settings identisch.

---

# Etappe 8 — Schneller Trade ✅ ERLEDIGT (26.07.2026)

Zwei Erfassungswege statt einem. Die Idee kam vom Nutzer und ist bewusst so
gewollt — sie steht damit *neben* der Douglas-Strenge, nicht gegen sie.

## Warum

Bisher ging jeder Trade durch dasselbe Nadelöhr: neun Fragen als Gate, Elliott-Zählung,
Setup, Begründung, Emotions-Check-in. Für einen geplanten Positions-Trade ist genau das der
Sinn der App. Für eine Intraday-Reaktion ist es zu viel — der Trade wäre vorbei, bevor das
Formular ausgefüllt ist. Das Ergebnis wäre kein disziplinierterer Trader, sondern ein
Journal, in dem die schnellen Trades **gar nicht erst auftauchen**: die schlechteste
Variante, weil dann ausgerechnet die impulsiven Trades unsichtbar bleiben.

## Wie es gebaut wurde — die Entscheidungen

- **Ein Feld am Trade, kein stiller Modus.** `tradeKind` (`langfristig` | `schnell`,
  Migration `0018`) steht in der Zeile und im Abzeichen an der Karte. Ein Trade ohne Gate
  muss als solcher erkennbar sein, sonst stünde er später neben den geprüften Trades, als
  wäre er denselben Weg gegangen.
- **`preTradeAnswered` bleibt `false`.** Es wäre einfach gewesen, das Feld beim schnellen
  Trade auf `true` zu setzen, damit das Gate durchlässt — dann würden die Daten aber
  behaupten, die Fragen seien beantwortet worden. Stattdessen entscheidet allein
  `requiresPreTradeGate(tradeKind)`, ob das Gate überhaupt gilt.
- **Der Stop bleibt Pflicht, in beiden Wegen.** „Risiko ist vor dem Einstieg definiert" ist
  nicht die Formalie, die einen schnellen Trade langsam macht — es ist der Kern. Weggelassen
  wird die *Begründungs*-Schicht, nicht die Risikogrenze. Ebenso bleibt die **bewusste
  Verlustannahme** beim Schließen in beiden Wegen bestehen.
- **Der Emotions-Check-in wird freiwillig, nicht abgeschafft.** Wer eine Bewegung mitnimmt,
  füllt keine Skala aus — er würde sie hastig wegklicken, und eine hastig weggeklickte Skala
  ist schlechter als keine, weil sie die Auswertung mit Zufallswerten füllt. Wird trotzdem
  einer erfasst, zählt er ganz normal mit.
- **Was im schnellen Weg entfällt:** die neun Fragen, Elliott (Grad/Zählung/Invalidation),
  Setup-Tags, Begründung, Notizen, Broker, Gebühren-Eingabe und der Verkaufsanteil. Gebühren
  kommen aus den Einstellungen, der Verkaufsanteil ist 100 %. Setup-Tags lassen sich
  jederzeit nachtragen (`updateTradeSetupTags`).
- **Der Default ist der volle Weg.** Die Abkürzung wählt man bewusst, nicht aus Versehen.

## Dateien

| Datei | Änderung |
|---|---|
| `lib/trade-kind.ts` (+ Test) | **neu** — Wege, Beschriftungen und die beiden Guard-Fragen |
| `drizzle/0018_trade_kind.sql` | **neu** — Spalte + CHECK, `DEFAULT 'langfristig'` |
| `lib/db/schema.ts` | Feld `tradeKind` |
| `app/actions/trades.ts` | `TradeInput.tradeKind`, Gate wegabhängig, `moodForKind` |
| `components/trade-form.tsx` | Umschalter oben, Blöcke je Weg, Absenden ohne Dialog |
| `components/trade-card.tsx` | `SCHNELL`-Abzeichen, Gate-/Check-in-Regel in beiden Dialogen |

## Nachweis

- **Migration:** Spalte `tradeKind text NOT NULL DEFAULT 'langfristig'`, CHECK auf die zwei
  Werte — gegen die Produktions-DB angewendet und geprüft: alle 17 Bestandstrades stehen auf
  `langfristig`, ein ungültiger Wert wird mit `23514 check_violation` abgewiesen.
  `.baseline-0018-vorher` gegen `.baseline-0018-nachher`: keine Abweichung.
- **Prüfläufe grün:** `tsc --noEmit`, `vitest run` (308 Tests, 11 Dateien), `next build`.
- **Klickweg im Sandbox-Konto:** Umschalter auf „Schneller Trade" → Fragen-Karte, Elliott und
  Einordnung verschwinden; TSLA 200/190/230 mit 4.000 € angelegt → **kein Fragen-Dialog**,
  Trade sofort aktivierbar (der Hinweis „Erst die 4 Fragen" bleibt aus); aktiviert **ohne**
  Skalenwert. In der Zeile steht danach `tradeKind: 'schnell'`, `preTradeAnswered: false`,
  `moodEntry: null`, Gebühren 9/9 aus den Einstellungen.
- **Take-Profit geprüft** (offene Frage aus Etappe 1): am Ziel 230 abgeschlossen →
  Netto-Ergebnis **582 €** = (230 − 200) × 20 − 18 € Gebühren, exakt die Projektion, die das
  Formular vor dem Trade angezeigt hatte.

## Offen

- **Kein eigener Schnitt in der Auswertung.** Schnelle Trades laufen in Disziplin-Score,
  Erwartungswert und Trefferquote ganz normal mit. Die naheliegende nächste Frage — „wie
  schneiden meine schnellen gegen meine geplanten Trades ab?" — wäre eine eigene Zeile in
  `computeDisciplineStats`; das Feld dafür liegt jetzt bereit.
- **Der Weg ist nach dem Anlegen fest.** Ein schneller Trade lässt sich nicht nachträglich zum
  geplanten machen (und umgekehrt). Das ist bewusst so: der Weg beschreibt, wie der Trade
  *entstanden* ist — das ändert sich nicht rückwirkend.
- **Der Revenge-Guard greift auch hier.** Ein schneller Trade kurz nach einem Verlust bekommt
  dieselbe Warnung und denselben Regelbruch-Eintrag. Genau so gedacht: der kurze Weg soll den
  Rache-Trade erfassen, nicht ihn verstecken.

---

# Design E — Formulare und Chart-Cockpit ✅ ERLEDIGT (26.07.2026)

Der Nachzügler aus A–D: die beiden Flächen, die damals bewusst ausgespart blieben, weil sie
Douglas-Guards tragen. Nichts an diesen Guards wurde angefasst — geändert wurde ausschließlich,
**wie** sie aussehen.

## Warum es nötig war

Nach A–D sprachen die Analyse-Flächen eine Sprache und die Formulare eine zweite: Karten in
`.glass-card` statt der drei Ebenen, Beschriftungen mal in 9, mal in 10, mal in 11 px, mal in
Akzentfarbe, mal grau. Sichtbar wurde das auf `/settings`, wo Einstellungs-Formular und
Ein-/Auszahlungen direkt untereinander stehen. Das Chart-Cockpit war noch schlimmer dran: es
trug **die komplette alte Navy-Palette** als Hex-Werte im Quelltext (`#45a8ec`, `#4FBE8C`,
`#D8505F`, `#D4AC4E`, `#f1ece0`, `#0b1522`) — die Kerzen und Plan-Linien hatten die Umstellung
auf „Indigo-Nacht" nie mitbekommen.

## Die zwei gemeinsamen Quellen, die dabei entstanden sind

| Datei | Was sie einmal festhält |
|---|---|
| `components/form-frame.tsx` | `FormSection` · `Field` · `ChoiceButton` · `ResultBlock` · `ResultRow` · `InlineNotice` — das Gegenstück zu `chart-frame.tsx` auf den Analyse-Flächen |
| `components/chart/colors.ts` | `CHART_COLORS` + `PLAN_COLORS` — die Hex-Entsprechung der Tokens aus `globals.css`, für Canvas/SVG, wo `var(--positive)` nicht greift |

**Neue Formularteile dort aufsetzen, neue Chart-Farben dort nachschlagen** — nicht daneben
neu bauen. Ausgenommen bleibt das TradingView-Schema in `price-chart.tsx`: das sind die
Originalfarben von TradingView und dürfen sich *nicht* mitbewegen.

## Was gebaut wurde

| Block | Inhalt | Dateien |
|---|---|---|
| **Formular-Sprache** | Karte = Ebene 2 mit demselben Kopf wie jedes Diagramm (Icon · Titel · `.note`), Beschriftung = `.eyebrow`, Ergebnis = vertiefte Ebene, Auswahl = ein Knopf-Typ | `form-frame.tsx` (neu) |
| **Trade-Formular** | fünf benannte Abschnitte statt einer losen Feldkette: Die Fragen von Douglas · Der Plan · Kapital und Gebühren · Elliott-Wellen · Ausführung und Einordnung; gestaffelter Aufbau | `trade-form.tsx` |
| **Einstellungen** | Konto · Risiko · Standard-Gebühren, dazu Ein-/Auszahlungen in derselben Form | `settings-form.tsx`, `cashflow-list.tsx` |
| **Douglas-Dialog + Mood-Check** | Ja/Nein und die Skala 1–5 auf denselben Knopf, Notizen über `Field` | `pre-trade-questions-dialog.tsx`, `mood-check.tsx` |
| **Chart-Palette** | 63 Hex-Werte maschinell ersetzt (Zeichenebene, Indikatoren, Bilderkennung, Import), das App-Schema und die Plan-Leiste von Hand; Kerzen, Zeichnungen, Indikatoren und Plan-Linien tragen jetzt Indigo-Nacht | `colors.ts` (neu), `price-chart.tsx`, `drawing-layer.tsx`, `indicators.ts`, `detect-drawings.ts`, `analysis-import.tsx`, `plan-bar.tsx` |
| **Chart-Rahmen** | `.glass-card` → `.panel`, schwebende Menüs → `.panel-raised`, Kopf über `ChartHeader`, „keine Kerzen" über `ChartEmpty` | `price-chart.tsx`, `chart-toolbar.tsx`, `indicator-menu.tsx`, `tradingview-widget.tsx`, `plan-bar.tsx` |

Nebenbei: `ChartHeader.subtitle` ist jetzt optional, `<Label>` ist aus den umgebauten
Formularen verschwunden — die Beschriftung umschließt ihr Feld, damit sie ohne `id` mit ihm
verbunden ist. Und **`.glass-card` ist weg**: Formulare und Chart-Cockpit waren die letzten
Nutzer, damit bleiben app-weit die drei Ebenen `.panel` / `.panel-raised` / `.panel-sunken`.

## Zwei inhaltliche Änderungen, die dabei entstanden sind

- **Die Warn-Emojis sind raus.** „⚠️ Risiko überwiegt!" heißt jetzt „Risiko überwiegt." — Ton
  und Farbe der Zeile sagen dasselbe, ohne zu rufen.
- **Der Chart-Kopf sagt, was er zeigt:** „Kerzen aus dem Zwischenspeicher — kein Echtzeitkurs."
  Das ist die Regel aus A–D (nie ein „LIVE"-Signal an Kursdaten), jetzt auch ausgeschrieben.

## Bewusst NICHT dabei

- **Keine Guard-Logik.** Pre-Trade-Gate, Plan-Lock, Revenge-Guard, Verlustannahme und die
  Pflicht-Skala des Emotions-Check-ins sind unverändert; kein Server-Action-, Schema- oder
  Rechenweg wurde angefasst.
- **Die übrigen Dialoge** (`edit-trade-dialog`, `set-alert-dialog`, `bot-outcome-dialog`,
  `add-stock-dialog`, `currency-change-dialog`, `risk-calculator`, `position-adjust`) tragen
  weiter ihre eigene Beschriftung. Sie waren nie Teil von E; mit `form-frame.tsx` liegt der
  Weg dorthin aber jetzt bereit.
- **Kein neuer Ladeweg, keine Migration, keine neue Abhängigkeit.**

## Nachweis

- `node node_modules/typescript/bin/tsc --noEmit` — sauber.
- `node node_modules/vitest/vitest.mjs run` — 301 Tests in 10 Dateien grün.
- `node node_modules/next/dist/bin/next build` — alle 18 Routen gebaut.
- **Sichtprüfung im laufenden Dev-Server** mit einem Wegwerf-Nutzer: `/trades/new` (leer,
  gefüllt mit Echtgeld-Zweig und beiden Ergebniskästen), Douglas-Dialog, `/settings`,
  `/stock/[id]` mit Kerzen aus echten Kursdaten — dazu derselbe Durchlauf mit
  `prefers-reduced-motion: reduce`, weil der Endzustand ohne Bewegung stimmen muss.
- **Datenbestand unberührt:** `.baseline-design-e-vorher` gegen `.baseline-design-e-nachher` —
  Trades und Settings byteweise identisch (der einzige Unterschied im Dump ist sein eigener
  Zeitstempel). Die vier Sandbox-Nutzer der Sichtprüfung sind samt ihrer beiden Instrumente
  wieder gelöscht.

## Offen

- **Zwei Rotationsfarben ohne Bedeutung** (`EXTRA_SERIES_COLORS`, Teal und Orange) bleiben
  außerhalb der Palette. Sie stehen für nichts — sie sind nur da, damit sich acht gleichzeitig
  eingeblendete Indikatoren unterscheiden lassen.
- **Das helle Chart-Schema** ist nur nachgezogen, nicht geprüft: die App läuft dark, `LIGHT`
  greift erst, wenn jemand das Theme umstellt.
- Die Umstellung ist rein visuell und deshalb **nicht testgedeckt** — Vitest prüft Logik, kein
  Aussehen. Die Sichtprüfung oben ist der Beleg.

---

# Etappe 13 — Teilziele ✅ ERLEDIGT (31.07.2026)

Mehrere Take-Profits je Trade: vor dem Einstieg geplant, einzeln ausführbar.

## Der Befund, der das ausgelöst hat

Zwei Dinge auf einmal.

**Erstens ein Fehler, der das Anlegen von Trades unmöglich machte.** Migration `0022`
(Etappe 12, Depots) lag bereits auf der Datenbank — `trade."portfolioId"` ist dort `NOT NULL`.
Der veröffentlichte Stand (`cf8134b`) kannte die Spalte aber nicht und schrieb sie nicht mit.
Jedes `INSERT` scheiterte serverseitig mit `23502 null value in column "portfolioId" … violates
not-null constraint`; im Browser kam davon nur die anonyme Meldung „An error occurred in the
Server Components render" an. Der Code von Etappe 12 lag vollständig, aber **unversioniert** im
Arbeitsverzeichnis: Datenbank und veröffentlichter Code waren auseinandergelaufen. Behoben ist
das nicht durch eine Reparatur, sondern dadurch, dass beide Etappen jetzt zusammen live gehen.

**Zweitens die eigentliche Lücke.** Am Trade stand genau EIN Ziel (`takeProfit`) und ein
Verkaufsanteil dazu (`takeProfitPct`, seit `0005`). Wer in Stufen aussteigt — die halbe Position
bei 1 R, der Rest läuft —, konnte das nur im Kopf planen. Den Teilverkauf gab es seit `0014`,
aber ohne vorher festgelegtes Level: Man entschied **mitten im Trade**, wie viel man bei welchem
Kurs abgibt. Genau diese Entscheidung soll die App aus dem laufenden Trade heraushalten.

## Datenmodell

Migration `0023_trade_targets.sql`, Tabelle `trade_target` (`tradeId`, `userId`, `sortOrder`,
`price`, `sharePct`, `executedAt`/`executedPrice`/`executedQty`, `eventId`, `note`). Additiv,
idempotent, **ohne Backfill**.

- **Warum eine Tabelle und keine JSON-Spalte:** Anders als die Setup-Tags (`0016`, reine
  Einordnung) trägt eine Stufe einen ZUSTAND — erreicht oder nicht, zu welchem Kurs, mit welchem
  Ereignis verbunden. Die Ausführung einer Stufe IST ein `teilverkauf`-Event; die Zeile zeigt
  über `eventId` nur darauf, statt dasselbe ein zweites Mal zu behaupten.
- **`trade.takeProfit`/`takeProfitPct` bleiben** und sind ab hier die *abgeleitete Schreibweise
  der ersten Stufe* — dieselbe Bauart wie `tradedWithMoney` seit `0022`. Dadurch bleiben alle
  reinen Funktionen in `lib/` (trade-stats, trade-events, bot-twin, excursion, instrument-stats)
  und jede bestehende Anzeige unverändert gültig: Das Stufenmodell wirkt über die Daten, nicht
  über neue Rechenwege.
- Ein Trade **ohne** Zeilen verhält sich exakt wie vorher; sein `takeProfit` wird über
  `effectiveTargets` als eine implizite Stufe gelesen. Der gesamte Altbestand ist unberührt.

## Regeln (alle in `lib/trade-targets.ts`, rein und getestet)

- Höchstens `MAX_TARGETS` = **4** Stufen. Jede auf der Gewinnseite des Einstiegs, Anteil > 0 %,
  Summe ≤ 100 %, keine zwei Stufen auf demselben Kurs.
- **Sortiert wird nach Abstand zum Einstieg**, nicht nach Eingabereihenfolge — die Reihenfolge im
  Formular ist Eingabe, keine Aussage.
- Eine Summe **unter** 100 % ist erlaubt: Wer einen Rest laufen lassen will, plant das
  ausdrücklich. Der Rest wird bis zur **letzten** Stufe gehalten und dort auch gerechnet.
- Das gespeicherte `riskRewardRatio` ist bei Stufen das **nach Anteilen gewichtete** CRV. Bei
  genau einer Stufe kommt exakt `computeRiskReward` heraus — für Trades mit einem Ziel ändert
  sich also nichts.
- **Ausgeführte Stufen sind unveränderlich.** Eine Planänderung darf keine Geschichte
  umschreiben; sie wandern unverändert in den neuen Plan zurück und werden mitgeprüft.
- Bezug der Anteile ist die **Anfangsposition** — nur so ergeben 50/30/20 wieder die ganze
  Position. Ein späterer Nachkauf verschiebt die Stufen nicht.

## Warum die letzte Stufe NICHT über `executeTarget` läuft

Sie schließt die Position, und am vollständigen Ausstieg hängen die Douglas-Guards: bewusste
Verlustannahme, Plan-Treue, Emotions-Check-in. Ein geplanter Ausstieg darf daran nicht
vorbeigehen, nur weil er geplant war. `executeTarget` lehnt eine Stufe, die alles schließen
würde, deshalb ab; die Karte schaltet den Knopf automatisch auf „Abschließen" um und öffnet den
Abschluss-Dialog mit dem Kurs dieser Stufe (`closeTrade(…, { targetId })`). Nicht erreichte
Stufen bleiben nach dem Abschluss offen — sie werden nicht nachträglich geglättet.

## Dateien

- `lib/trade-targets.ts` + `lib/trade-targets.test.ts` (28 Tests)
- `drizzle/0023_trade_targets.sql`, `lib/db/schema.ts` (`tradeTarget`)
- `app/actions/trades.ts`: `resolveTargetPlan` · `listTradeTargets` · `listTargetsForTrades` ·
  `executeTarget`, Einbau in `createTrade`/`updateTradePlan`/`closeTrade`/`deleteTrade`
- `app/actions/alerts.ts`: ein Kurs-Alert **je Stufe** (Dubletten jetzt über Art UND Level)
- `components/target-stages.tsx` (Eingabe, gemeinsam für Formular und Bearbeiten-Dialog),
  `components/trade-targets-card.tsx` (Anzeige + Ausführen)
- `components/trade-form.tsx`, `components/edit-trade-dialog.tsx`, `components/trade-card.tsx`
  (Fortschritt in der Liste), `components/chart/plan-bar.tsx`, `app/stock/[id]/page.tsx`
  (eine Chart-Linie je Stufe), `app/trades/[id]/page.tsx`, `app/trades/page.tsx`

## Nebenbefund, mitbehoben

`updateTradePlan` hat das `riskRewardRatio` nie nachgezogen. Nach einer Planänderung stand
deshalb eine Zahl in der Karte, die zum Plan nicht mehr passte. Es wird jetzt neu gerechnet,
sobald Einstieg, Stop oder Ziel sich bewegen.

## Nachweis

- `node node_modules/typescript/bin/tsc --noEmit` — sauber.
- `node node_modules/vitest/vitest.mjs run` — 429 Tests in 17 Dateien grün (28 davon neu).
- `node node_modules/next/dist/bin/next build` — vollständig gebaut.
- **Datenbestand unberührt:** `.baseline-0023-vorher` gegen `.baseline-0023-nachher` — Trades
  und Settings byteweise identisch (einziger Unterschied ist der Zeitstempel des Dumps selbst).
  `trade_target` danach: 12 Spalten, beide CHECK-Constraints, vier Indizes, **0 Zeilen**.
- **Klick-Test im echten Browser** (Sandbox-Konto, Dev-Server): Trade AAPL long, Einstieg 200,
  Stop 190, Einsatz 5.000 € → 25 Stück. Drei Stufen bewusst UNSORTIERT eingegeben
  (210/50 %, 250/20 %, 230/30 %).
  - Gespeichert wurde sortiert: 210·50 %, 230·30 %, 250·20 %; `takeProfit` = 210,
    `takeProfitPct` = 50, `riskRewardRatio` = **2,4** (= 0,5·1 R + 0,3·3 R + 0,2·5 R). Das
    Formular zeigte denselben Wert live an.
  - Aktivieren mit Plan-Alerts: **5 Alerts** (Einstieg, Stop, drei Ziele) statt bisher drei.
  - Stufe 1 ausgeführt mit abweichendem Fill 209,5 → 12,5 Stück, realisiert +118,75 € /
    +0,48 R. Stufe 2 → 7,5 Stück, zusammen +343,75 € / +1,38 R, Rest offen 5 von 25.
  - Stufe 3 schaltete daraufhin von selbst auf **„Abschließen"** um und öffnete den
    Abschluss-Dialog mit vorbelegtem Kurs 250 samt Verlust-Annahme, Plan-Treue und Check-in.
  - Endstand in der Datenbank: Events `eroeffnet 25 → teilverkauf 12,5 → teilverkauf 7,5 →
    geschlossen 5` (Summe 25), jede Stufe mit ihrem `eventId` verknüpft.

## Offen / bewusst nicht dabei

- **Keine Automatik.** Eine erreichte Stufe wird nicht selbsttätig gebucht — die App hat keinen
  Broker-Zugang, und ein Verkauf, den sie nur vermutet, wäre eine erfundene Bilanz. Der Alert
  meldet, gebucht wird von Hand.
- **Kein Backfill.** Bestehende Trades bekommen keine erfundene Stufe.
- **Der Bot-Zwilling rechnet weiter gegen EIN Ziel** (die erste Stufe). Ein gestaffelter
  Vergleich wäre eine eigene Etappe — und er beantwortet eine andere Frage.
- **Browser-MCP auf `/trades/[id]`:** Die Detailseite eines aktiven Trades erreicht wegen des
  Minutentakts der Kursaktualisierung nie `document_idle`; die Automatisierung muss deshalb
  unmittelbar nach dem Laden zugreifen. Für die Bedienung von Hand ist das folgenlos.
