# Ausführungsplan — Demo-Handel mit Kontrakten

> Stand 20.08.2026. Vier Teile, **einzeln** abzuarbeiten und **einzeln** abzunehmen.
> Kein Teil beginnt, bevor der vorherige abgenommen ist. Nach jedem Teil:
> `pnpm test` + `pnpm exec tsc --noEmit`.

## Ziel
Trades im **Demo-Depot** führen sich selbst aus, sobald der Kurs ihr Level berührt —
gehandelt wird in **Kontrakten** mit echter Spezifikation, Margin und Kontodeckung.
Der Chart zeigt auf Wunsch bis zu zwei übergeordnete Zeitebenen.

Douglas-Prüfung: Der Plan steht **vor** dem Einstieg fest, die Ausführung ist
**mechanisch**. Damit fällt der letzte Handgriff weg, mit dem sich ein Ergebnis
nachträglich schönen ließe. Echtgeld bleibt ausdrücklich von Hand.

---

## Ausgangslage (gemessen am 20.08.2026)

| Größe | Wert |
|---|---|
| Datenbank gesamt | 336 MB von **500 MB** (Gratistarif) |
| davon `candle_cache` | 322 MB · 1.733.198 Kerzen · 1.001 Reihen |
| Bytes je Kerze | 80 (Leitung) · 195 (Speicher mit Index) |
| **Obergrenze bei heutiger Retention** | **586 MB** — über dem Tarif |
| Instrumente | 149, davon 25 mit offenem Trade · 75 mit Prognose/altem Trade · **49 ungenutzt** |
| Kerzen der 49 ungenutzten | 576.074 ≈ **107 MB** |
| Trainer-Bedarf auf `1h` | 3.000 Kerzen + 800 Vorlauf → Grenze muss ≥ 5.000 bleiben |
| Sammellauf | stündlich per Cron, letzte 5 Läufe fehlerfrei |

---

## Teil 1 — Speicher staffeln *(Voraussetzung, zuerst)*

**Warum zuerst:** Die Datenbank läuft unabhängig vom Feature voll. Und die zwei
neuen Zeitebenen aus Teil 4 vergrößern das Problem, wenn die Staffelung fehlt.

### Stufenmodell
Wie viel Historie ein Instrument bekommt, hängt davon ab, ob es benutzt wird.

| Stufe | Bedingung | Instrumente | Ebenen |
|---|---|---|---|
| **A** | offener Trade (`aktiv` oder `geplant`) | 25 | alle, inkl. 1min/5min |
| **B** | alter Trade, Prognose **oder Trainer-Sitzung** | 72 | ab 15min aufwärts |
| **C** | ungenutzt | 45 | nur 1h/Tag/Woche/Monat, 1h gekappt |

> **Nachtrag 20.08.2026 — die Trainer-Sitzung gehört zu B.** Gemessen: Auf
> `G24.DE` war trainiert worden, ohne Trade und ohne Prognose. Nach der
> ursprünglichen Fassung fiele es in Stufe C mit 1.500 Stundenkerzen, während
> der Trainer 3.000 anfordert — der Sammellauf holte sie, das Aufräumen
> schnitte sie sofort weg. Verknüpft wird über `stockId`, nie über
> `training_session.symbol`: Dort steht der Rohticker (`CL1!`), im
> Kerzenspeicher liegt `CL=F`.

### Grenzen je Ebene

| Ebene | alt | neu (A/B) | neu (C) | Begründung |
|---|---|---|---|---|
| 1min | — | 1.500 | — | Yahoo gibt nur 7 Tage her |
| 5min | — | 2.000 | — | Yahoo gibt nur 60 Tage her |
| 15min | 5.000 | 2.500 | — | |
| 30min | 3.500 | 1.200 | — | |
| 1h | 5.000 | **5.000** | 1.500 | Trainer fordert bis 5.000 an |
| 4h | 3.000 | 1.500 | 1.500 | |
| 1day | 3.000 | 2.000 | 2.000 | |
| 1week | 1.500 | **1.500** | 1.500 | volle Historie erwünscht |
| 1month | 600 | **600** | 600 | volle Historie erwünscht |

**Erwartung:** Obergrenze fällt von 586 MB auf **rund 333 MB**; das einmalige
Aufräumen gibt sofort etwa **100 MB** frei.

### Schritte
1. `lib/market-data/types.ts`: `Interval` um `1min` und `5min` erweitern.
   `RETENTION_LIMIT` wird von einem festen Record zu `retentionLimit(interval, stufe)`.
   `DEFAULT_OUTPUT_SIZE` und `DELIVERY_LIMIT` um die neuen Ebenen ergänzen.
2. `lib/market-data/yahoo.ts`: `YAHOO_RANGE` um `1min: '7d'`, `5min: '60d'`;
   `passtGranularitaet` muss die neuen Ebenen kennen.
3. `lib/replay-timeframes.ts`: `INTERVAL_SEKUNDEN` um beide Ebenen.
4. `lib/chart-timeframes.ts`: `CHART_TIMEFRAMES` um `1m` und `5m` (Fenster: 1 bzw. 2 Tage).
5. `lib/market-data/candle-collect.ts`: Der Sammellauf ermittelt je Instrument die
   Stufe und holt nur deren Ebenen; das Zurückschneiden nutzt `retentionLimit`.
6. `scripts/apply-retention.mjs [--dry]`: setzt die Grenzen **rückwirkend** durch.
   Löscht je `(symbol, interval)` alles jenseits der Grenze, immer die ältesten,
   per `ORDER BY time DESC OFFSET n` — **nie** ein unbegrenzter Lesepfad.

### Abnahme
- [x] `pnpm test` grün (885/885), `pnpm exec tsc --noEmit` ohne Fehler
- [x] `node scripts/apply-retention.mjs --dry` nennt die Löschmenge, ohne zu löschen:
      354.456 Kerzen ≈ 66 MB (90 Reihen ganz, 230 gekürzt)
- [ ] Nach dem echten Lauf: **verbleibende Kerzenmenge** ≈ 1.379.570 ≈ **257 MB**
- [x] Kein Instrument der Stufe A verliert eine Ebene — 175 A-Reihen geprüft, alle
      innerhalb der A-Staffel
- [x] Ein Trainer-Durchlauf auf `1h` lädt weiterhin 3.000 Kerzen — alle vier
      Trainer-Instrumente liegen jetzt in A oder B (1h = 5.000)

> **Nachtrag 20.08.2026 — warum nicht `pg_total_relation_size`.** Ein `DELETE`
> gibt die Seiten nicht frei; die Relationsgröße bliebe bei 322 MB, egal wie
> viel gelöscht wird. Das Skript läuft deshalb mit einem einfachen `VACUUM`
> (kein `FULL`) und weist die **Nutzdaten** aus. `VACUUM FULL` bräuchte
> kurzzeitig eine zweite vollständige Kopie der Tabelle — 322 MB extra in einem
> 500-MB-Tarif, also genau beim Aufräumen der Tarifbruch.

---

## Teil 2 — Auto-Ausführung im Demo-Depot

### Schritte
1. `lib/demo-fill.ts` — **reine, getestete** Entscheidungsfunktion. Eingabe: Trade,
   Zielplan, eine Kerze. Ausgabe: die auszulösenden Ereignisse.
   - `geplant` + Kerze berührt Einstieg → **Einstieg gefüllt**, Trade wird `aktiv`
   - `aktiv` + Kerze berührt Stop → **geschlossen**
   - `aktiv` + Kerze berührt Teilziel → **Anteil genommen** (`trade_target`)
   - **Konservativ:** Trifft eine Kerze Stop *und* Ziel, gilt der **Stop**.
     Ohne Tickdaten ist die echte Reihenfolge nicht feststellbar; die günstige
     Annahme wäre eine Lüge in der Trefferquote.
2. In `app/actions/alerts.ts` einhängen: Für Trades in einem Depot mit
   `kind = 'demo'` wird gebucht statt nur gemeldet — als `trade_event` mit der
   **Kerzenzeit** als Ausführungszeit, nicht der Uhrzeit des Sammellaufs.
3. Echtgeld-Trades bleiben unverändert bei der Hand-Buchung.

### Abnahme
- [ ] Tests für `demo-fill` decken ab: Lücken-Eröffnung, Stop-und-Ziel-in-einer-Kerze,
      Teilziel vor Ziel, bereits geschlossener Trade
- [ ] Ein bestehender Demo-Trade wird im Sammellauf korrekt gebucht
- [ ] Kein Echtgeld-Trade verändert sich

---

## Teil 3 — Kontrakte, Margin, Kontodeckung

### Schritte
1. Migration in `drizzle/`, **additiv und idempotent**: Kontraktfelder am Instrument
   — Tick-Größe, Tick-Wert, Kontraktgröße, Währung, Einschuss (initial/halten).
2. `lib/contract-specs.ts`: Vorgaben für ES, NQ, YM, RTY, GC, CL, SI und die
   Krypto-Perpetuals. **Handeingabe schlägt die Vorgabe.** Kein Anbieterabruf —
   Yahoo liefert keine verlässlichen Spezifikationen, das wäre ein stiller Falschwert.
3. `lib/trade-math.ts` erweitern: Risiko und P&L als **Ticks × Tick-Wert × Kontrakte**.
4. Margin-Prüfung beim Eröffnen gegen die Depotdeckung — **Ablehnung mit Begründung**
   statt stiller Überziehung.

### Abnahme
- [ ] Ein ES-Trade über 2 Kontrakte mit 10 Ticks Risiko zeigt 2 × 10 × 12,50 $ = 250 $
- [ ] Ein Trade jenseits der Deckung wird abgelehnt, mit lesbarer Begründung
- [ ] Instrumente ohne Spezifikation rechnen wie bisher weiter (kein Bruch im Altbestand)

---

## Teil 4 — Bis zu zwei übergeordnete Chart-Ebenen

### Schritte
1. Die vorhandene `basisTimeframe`-Mechanik (`lib/replay-timeframes.ts`) von einer
   auf **bis zu zwei** übergeordnete Ebenen erweitern — **0, 1 oder 2**, frei wählbar.
2. Auswahl in der Chart-Oberfläche, Bausteine `chart-frame` und `section-label` nutzen.

### Abnahme
- [ ] Ohne Auswahl verhält sich der Chart wie heute
- [ ] Die angebrochene Kerze der höheren Ebene verrät weiterhin **nichts** über die
      Zukunft (Regel aus `replay-timeframes.ts` gilt für beide Ebenen)
- [ ] Sichtprüfung im Browser über den `claude-in-chrome`-MCP

---

## Ausdrücklich nicht dabei
Orderbuch/DOM · Footprint · Teilausführungen innerhalb einer Kerze · Slippage ·
Echtgeld-Automatik · Export nach Quantower.
