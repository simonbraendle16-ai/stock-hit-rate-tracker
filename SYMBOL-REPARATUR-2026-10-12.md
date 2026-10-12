# Symbol- und Kursversorgung: prüfbarer Reparaturstand

Stand: 12.10.2026. Umsetzung des genehmigten Plans, auf veröffentlichtem Commit `6915d71`. Branch `codex/symbols-data-repair-2026-10-12`. **Lokal umgesetzt; Veröffentlichung und fachliche Datenkorrekturen noch nicht ausgeführt.** Die vereinbarte Prüfung vor Veröffentlichung bleibt bestehen.

## Belegte Ursachen

- Der allgemeine Kerzensammler war ausschließlich im manuell deaktivierten Workflow „Alarme prüfen“ eingebunden. Der aktive Demo-Workflow sammelte keine allgemeinen Kursreihen. Letzter protokollierter Sammellauf: 09.08.2026. Ein aktueller Kurs-Snapshot belegt keine aktuelle Minutenhistorie.
- Der Sammler akzeptierte nach Anbieterfehlern alten Cache als erfolgreichen Abruf. Jetzt fordert er einen tatsächlichen erfolgreichen Refresh; einzelne Fehler beenden die anderen Reihen nicht.
- XAUUSD war `GC=F` (Gold-Future), SILVER `SI=F` (Silber-Future) als Näherung. Eine solche Reihe darf keinen exakten Spot-Trade automatisch ausführen.
- Fünf Trade-/Instrument-Anlageklassen widersprachen einander. Der vollständige Anbieterabgleich ergab insgesamt neun falsch als Aktien klassifizierte Instrumente.
- Zwei Trades hatten keine Instrumentverknüpfung: CBK #146, TDOC #180. Anbieterbelege: CBK.DE = Commerzbank AG, XETRA, EUR; TDOC = Teladoc Health, NYSE, USD.
- Yahoo liefert teilweise einen einzelnen Live-Kurspunkt mit ungeradem Sekunden-Zeitstempel. Dieser ist keine abgeschlossene Intervallkerze und wird von der Demo-Ausführung ausgeschlossen. Bestehende Kerzen werden dabei nicht umgeschrieben.

## Umgesetzt

- Selektive Übernahme der vorhandenen Symbolreparaturen: explizite Börse und Paarwährung bewahren; keine Gleichsetzung verschiedener Unternehmen allein über Tickerwurzel/Bilanzwährung; gewählte Suchnotierung auch bei Bestätigungsfehler bewahren; tatsächliche Kurszeit anzeigen. Der Schneller-Trade-Fix bleibt erhalten.
- Allgemeiner Sammler im aktiven Demo-Workflow vor dem Demo-Lauf, mit bestehender stündlicher Fälligkeit und unveränderten Abruf-/Zeitbudgets. HTTP- und JSON-Ergebnisprüfung; Sammelfehler verhindern den Demo-Schritt nicht, machen den Workflow am Ende aber sichtbar fehlerhaft. Alarm-Workflow unverändert deaktiviert.
- Demo prüft bestätigte Zuordnung, Anlageklasse und Näherungsstatus vor dem Refresh und erneut unter der Buchungssperre. Auch die historische Archivreparatur verwendet keine Näherungsquelle. XAUUSD/GC=F wird zusätzlich unabhängig von einem falsch gesetzten Näherungsflag erkannt.
- Exakte XAU/USD-Quelle über den vorhandenen Twelve-Data-Zugang angebunden, eigener Speicher-Schlüssel `XAUUSD`, Anbieter `twelvedata`; keine Vermischung mit `GC=F`. Bei Ausfall keine Futures-Ersatzquelle. Hintergrundsammlung für diese Quelle auf 5min/1h/1day begrenzt. Kein neues Konto, kein Upgrade.
- Neue Demo-Buchungen tragen Symbol und Anbieter in `payload.kursquelle`. Historische Ereignisse bleiben unverändert.
- Quote-Verknüpfungen berücksichtigen Anbieter und Symbol gemeinsam.
- Lesendes owner-begrenztes Inventar: `scripts/audit-market-data.mjs <Anker-Trade-ID>`, mit vorhandener Umgebung über `node --env-file=<führende .env.local>`. Keine Zugangsdaten, Preise oder persönlichen Notizen in dessen Ausgabe; lokale Inventardateien sind gitignoriert.

## Ausgeführte Prüfung

- Vollständiger Lauf: **84 Testdateien, 1.277 Tests bestanden**. Separate Typprüfung bestanden, einschließlich letzter Anbieter-Join-Korrekturen.
- `next build --webpack` erfolgreich. Das Repository überspringt Typfehler beim Build; deshalb wurde TypeScript separat geprüft. Build ohne Produktionsumgebung: Better-Auth-Hinweise wegen fehlender URL/Secret; keine Zugangsdaten übernommen.
- Workflow-YAML eingelesen, Takt/Fehlertrennung geprüft; sämtliche drei Shellblöcke mit Git-Bash `-n` geprüft. Kein Workflow live angestoßen.
- Alle 96 bestehenden Anbieter-Symbole in einem gezielten Yahoo-Abgleich mit Chart-Rückfall geprüft: alle lieferten Kurs, Name, Börse, Währung und Kurszeit. Das belegt Anbieter-Erreichbarkeit und dargestellte Identität, keine Gleichheit mit einem AvaTrade-CFD-Kurs.
- XAU/USD-Spotprobe mit bestehendem Schlüssel erfolgreich: Metadaten `Precious Metal`, Gold Spot/US Dollar, fünfminütige UTC-Kerzen. Ohne UTC-Parameter war die Standard-Zeitzone abweichend; der implementierte Client verlangt UTC.
- META: vom gespeicherten Prüfstand 02.10.2026 18:05 UTC bis 12.10.2026 18:15 UTC **471 abgeschlossene Kerzen, zusammenhängend und ohne Lücke nach bestehender Coverage-Prüfung**. Noch nicht produktiv zurückgeschrieben oder ausgeführt.
- Echter Edge-Browser wieder erreichbar: angemeldete Trades-Seite und Warnungen gelesen, neues Trade-Formular sichtbar geöffnet, keine Anlage/Änderung abgesendet. Der neue lokale Patch ist damit noch nicht produktiv im Browser abgenommen.

## Konkrete Datenkorrekturen zur Prüfung

Noch nicht angewandt. Vor jedem Schreiben frisch lesen, Besitz/Version/erwarteten Ausgangswert prüfen; nur benannte Felder ändern und rücklesen. Preise, Mengen, Status, Ergebnisse, Events und damalige FX-Werte unverändert lassen.

| Datensatz | Ausgang | Vorgesehene Korrektur |
|---|---|---|
| Instrument #20 CL1! | aktien, CL=F | market=rohstoffe |
| Instrument #22 BTCUSD | aktien, BTC-USD | market=krypto |
| Instrument #23 SPX500 | aktien, ^GSPC | market=sonstiges (Index) |
| Instrument #24 NDX | aktien, ^NDX | market=sonstiges (Index) |
| Instrument #25 ETHUSD | aktien, ETH-USD | market=krypto |
| Instrument #26 SOLUSD | aktien, SOL-USD | market=krypto |
| Instrument #55 YM1! | aktien, YM=F | market=rohstoffe |
| Instrument #84 DAX | aktien, ^GDAXI | market=sonstiges (Index) |
| Instrument #105 DXY | aktien, DX-Y.NYB, Name/Währung fehlen | market=sonstiges; Anbietername US Dollar Index, Währung USD, Börse ICE Futures bestätigen |
| Instrument #111 ILMN | resolvedName=ILMN | Anbieter-Metadaten Illumina, Inc., NasdaqGS, USD bestätigen; gleiche Instrument-ID und Notierung |
| Trade #146 CBK, Version 1 | stockId=null | Eindeutig bestätigtes neues Instrument CBK.DE/XETRA/EUR anlegen und verknüpfen; kein zweiter Trade |
| Trade #180 TDOC, Version 1 | stockId=null | Eindeutig bestätigtes neues Instrument TDOC/NYSE/USD anlegen und verknüpfen; kein zweiter Trade |
| Trade #182 ETHUSD, Version 1 | market=aktien, stockId=25, abgebrochen | Ausschließlich Klassifikation auf krypto berichtigen; ursprüngliche Ereignisse/Ergebnis erhalten |
| Instrument #97 XAUUSD | yahoo/GC=F, approximate=true | Nach Quellen-/Historienprüfung auf twelvedata/XAUUSD umstellen; vorhandene GC=F-Historie nicht umbenennen |
| Trade #192 XAUUSD, zuletzt Version 86 | bestehende Future-basierte Demo-Historie | Herkunft der drei vorhandenen Ereignisse gesondert prüfen; keine automatische Umdeutung zum Spotbeleg; Warnung über ungeprüfte Historie erhalten |
| Instrument #103 SILVER | yahoo/SI=F, approximate=true | Näherung sichtbar lassen; automatische Simulation gesperrt; exakte Silberquelle in diesem Auftrag nicht bestätigt |

## Währungsaltbestand

29 Trades haben keine eingefrorenen Depot-/Kurswährungen und keinen FX-Kurs. Ihre Ereignispayloads enthalten auch verschachtelt keine entsprechenden Nachweise; keiner dieser Trades hat einen verknüpften Brokerauftrag. Eine aktuelle Instrumentwährung und heutige Depotwährung beweisen die historischen Angaben nicht.

Betroffen: #3 FMC, #5 LUMN, #10 SOLUSD, #11 ETHUSD, #12 NIO, #13 XPEV, #14 RGTI, #15 AI, #17 NOW, #18 FI, #19 ORCL, #20 UAA, #21 TEAM, #22 ADBE, #127 THE TRADE DESK, #129 SOL, #146 CBK, #147 BAYN, #148 CL1!, #179 DRO, #180 TDOC, #182 ETHUSD, #191 NVDA, #192 XAUUSD, #193 UAA, #194 ILMN, #199 META, #200 INTEL, #201 INTEL.

Gebündelte Rückfrage nach vorhandenen historischen Belegen gestellt. Keine rückwirkende 1:1-Umrechnung und kein heutiger FX-Backfill. Offene Warnungen sind sachlich erforderlich, solange Bestätigung/Beleg fehlt. Geplante Fälle können anschließend über den vorhandenen Planeditor mit dokumentierter neuer Bestätigung aktualisiert werden; abgeschlossene Fälle benötigen einen dafür geeigneten historischen Korrekturpfad.

## Soll-Ist und Veröffentlichung

| Plananforderung | Ergebnis |
|---|---|
| Bestehenden Schneller-Trade-Fix erhalten | erfüllt; isolierte Basis 6915d71, Regressionen grün |
| Alle eigenen Symbole/Trades inventarisieren | erfüllt; 96/33, Tabellen unten, Live-Leseabgleich und Anbieterprobe |
| Zuordnung, Quelle, Markt und Kursalter dauerhaft absichern | lokal umgesetzt und getestet; Bestandskorrekturen oben noch ausstehend |
| Sammler unabhängig von Alarmen, bestehende Budgets | lokal umgesetzt; echter GitHub-Betrieb nach Veröffentlichung offen |
| META nachladen und Warnung erst nach Prüfung entfernen | verfügbare Coverage belegt; produktives Nachladen/Nachprüfen steht aus |
| XAU echter Spot, keine neuen Proxy-Fills | lokale Umsetzung und Quellprobe erfüllt; produktive Umstellung/Historienreview offen |
| 29 Altfälle anhand Belegen korrigieren | geprüft; vorhandene Nachweise reichen nicht, Bestätigung offen |
| Tests/Typen/Build/Browser | lokale Tests, Typen, Build erfüllt; echte Produktionsbasis gesehen; Patch-Sichtprüfung nach Auslieferung offen |
| Patch und Datenkorrekturen vor Veröffentlichung vorlegen | dieser Bericht und lokaler Branch; kein Push |
| Zwei zeitlich getrennte automatische Sammelläufe abnehmen | erst nach Veröffentlichung möglich, nicht als erledigt gemeldet |

Nächster veröffentlichungsabhängiger Ablauf: Branch erneut gegen origin/main prüfen; konkret geprüfte Änderungen veröffentlichen; Ready-Revision nachweisen; vorbereitete Bestandskorrekturen mit frischen Versionen ausführen/rücklesen; META über bestehenden Speicherpfad nachladen, anschließend Coverage/normalen Demo-Gate prüfen. Geplante Trades mit fehlenden Planangaben bleiben inaktiv. Zwei wirklich automatische stündliche Sammelläufe getrennt nachweisen, inklusive Fehlerzahlen und Kerzenfortschritt. Keine automatische Reaktivierung des Alarm-Workflows.

API-Grenze: `scripts/tracker-api.mjs GET '/trades?limit=100'` scheitert aktuell an fehlenden `ASSISTANT_API_BASE_URL`/`ASSISTANT_API_TOKEN` im führenden Repository. Live-Inventar stattdessen mit `BEGIN READ ONLY` auf die vorhandene DB-Verbindung begrenzt. Kein Token aus alten Ablagen kopiert. Für spätere API-Schreib-/GET-Abnahme muss diese lokale Konfiguration wieder vollständig sein.

Rücknahme: nur den Reparaturcommit zurücknehmen. Datenkorrekturen getrennt anhand frisch gesicherter Vorwerte; keine pauschale Datenbankwiederherstellung über zwischenzeitliche Trades. Keine kostenpflichtigen Dienste, Brokerhandlungen, Dienstneustarts oder Suspend-Tests ausgeführt.

Quellen zur Identität: [Commerzbank-Aktie](https://investor-relations.commerzbank.com/de/unser-aktie), [Teladoc-Aktie](https://ir.teladochealth.com/stock-info/stock-quote/default.aspx), [Twelve-Data-Instrumentliste](https://twelvedata.com/exchanges/commodity?group=reference), [Twelve-Data-API](https://twelvedata.com/docs). Maßgeblicher Zugangstest ist die ausgeführte Probe mit dem vorhandenen Schlüssel, keine pauschale Zusage aller Gratisdatensätze.

## Einzelcheck aller 96 Instrumente

Anbieterprobe: 2026-10-12T18:19:52.382Z. Bestandslesung: 2026-10-12T18:17:04.648Z. „Bestätigt“ bezeichnet die aktuelle Anbieteridentität; Bestandskorrekturen bleiben bis zur Prüfung offen. Die Minutenabdeckung ist der gespeicherte Stand vor dem Nachladen.

| ID / Ticker | Anbieter-Symbol | Börse / Währung (Probe) | Kurszeit UTC | gespeicherte 5min: Anzahl / letzter Stand UTC | Ergebnis |
|---|---|---|---|---|---|
| 1 MBG | MBG.DE | XETRA / EUR | 2026-10-12T15:36:04Z | 0 / — | Anbieteridentität bestätigt |
| 2 BAYN | BAYN.DE | XETRA / EUR | 2026-10-12T15:36:55Z | 954 / 2026-10-12T09:05:47Z | Anbieteridentität bestätigt |
| 3 NOW | NOW | NYSE / USD | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 4 MSFT | MSFT | NasdaqGS / USD | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 5 COIN | COIN | NasdaqGS / USD | 2026-10-12T18:19:47Z | 0 / — | Anbieteridentität bestätigt |
| 6 XYZ | XYZ | NYSE / USD | 2026-10-12T18:19:40Z | 0 / — | Anbieteridentität bestätigt |
| 7 HOOD | HOOD | NasdaqGS / USD | 2026-10-12T18:19:49Z | 0 / — | Anbieteridentität bestätigt |
| 8 MOH | MOH | NYSE / USD | 2026-10-12T18:18:32Z | 0 / — | Anbieteridentität bestätigt |
| 9 TLRY | TLRY | NasdaqGS / USD | 2026-10-12T18:19:48Z | 0 / — | Anbieteridentität bestätigt |
| 10 TSLA | TSLA | NasdaqGS / USD | 2026-10-12T18:19:50Z | 2051 / 2026-10-09T20:00:00Z | Anbieteridentität bestätigt |
| 11 SAP | SAP.DE | XETRA / EUR | 2026-10-12T15:38:27Z | 0 / — | Anbieteridentität bestätigt |
| 12 META | META | NasdaqGS / USD | 2026-10-12T18:19:50Z | 532 / 2026-10-02T20:00:00Z | Anbieteridentität bestätigt |
| 13 NKE | NKE | NYSE / USD | 2026-10-12T18:19:49Z | 0 / — | Anbieteridentität bestätigt |
| 14 NOVO_B | NOVO-B.CO | Copenhagen / DKK | 2026-10-12T14:59:41Z | 0 / — | Anbieteridentität bestätigt |
| 15 LAC | LAC | NYSE / USD | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 16 JD | JD | NasdaqGS / USD | 2026-10-12T18:19:44Z | 0 / — | Anbieteridentität bestätigt |
| 17 NVDA | NVDA | NasdaqGS / USD | 2026-10-12T18:19:51Z | 3199 / 2026-10-02T20:00:00Z | Anbieteridentität bestätigt |
| 18 DOW | DOW | NYSE / USD | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 19 INTC | INTC | NasdaqGS / USD | 2026-10-12T18:19:51Z | 485 / 2026-10-02T20:00:00Z | Anbieteridentität bestätigt |
| 20 CL1! | CL=F | NY Mercantile / USD | 2026-10-12T18:09:51Z | 0 / — | Markt -> rohstoffe |
| 21 SMHN | SMHN.DE | XETRA / EUR | 2026-10-12T15:35:15Z | 0 / — | Anbieteridentität bestätigt |
| 22 BTCUSD | BTC-USD | CCC / USD | 2026-10-12T17:51:26Z | 16994 / 2026-10-04T13:16:01Z | Markt -> krypto |
| 23 SPX500 | ^GSPC | SNP / USD | 2026-10-12T18:19:51Z | 0 / — | Markt -> sonstiges |
| 24 NDX | ^NDX | Nasdaq GIDS / USD | 2026-10-12T18:19:49Z | 0 / — | Markt -> sonstiges |
| 25 ETHUSD | ETH-USD | CCC / USD | 2026-10-12T17:56:13Z | 0 / — | Markt -> krypto |
| 26 SOLUSD | SOL-USD | CCC / USD | 2026-10-12T17:53:22Z | 0 / — | Markt -> krypto |
| 27 1810 | 1810.HK | HKSE / HKD | 2026-10-12T08:08:15Z | 0 / — | Anbieteridentität bestätigt |
| 28 XPEV | XPEV | NYSE / USD | 2026-10-12T18:19:47Z | 0 / — | Anbieteridentität bestätigt |
| 29 NIO | NIO | NYSE / USD | 2026-10-12T18:19:47Z | 0 / — | Anbieteridentität bestätigt |
| 30 TKA | TKA.DE | XETRA / EUR | 2026-10-12T15:39:22Z | 0 / — | Anbieteridentität bestätigt |
| 31 DRO | DRO.AX | ASX / AUD | 2026-10-12T05:10:20Z | 0 / — | Anbieteridentität bestätigt |
| 32 FMC | FMC | NYSE / USD | 2026-10-12T18:19:41Z | 0 / — | Anbieteridentität bestätigt |
| 33 LUMN | LUMN | NasdaqGS / USD | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 34 RGTI | RGTI | NasdaqCM / USD | 2026-10-12T18:19:43Z | 0 / — | Anbieteridentität bestätigt |
| 35 AI | AI | NYSE / USD | 2026-10-12T18:19:24Z | 0 / — | Anbieteridentität bestätigt |
| 36 HIMS | HIMS | NYSE / USD | 2026-10-12T18:19:44Z | 0 / — | Anbieteridentität bestätigt |
| 38 PYPL | PYPL | NasdaqGS / USD | 2026-10-12T18:19:28Z | 0 / — | Anbieteridentität bestätigt |
| 39 RKLB | RKLB | NasdaqGS / USD | 2026-10-12T18:19:49Z | 0 / — | Anbieteridentität bestätigt |
| 40 B | B | NYSE / USD | 2026-10-12T18:19:25Z | 0 / — | Anbieteridentität bestätigt |
| 41 AAPL | AAPL | NasdaqGS / USD | 2026-10-12T18:19:51Z | 3199 / 2026-10-02T20:00:00Z | Anbieteridentität bestätigt |
| 42 RHM | RHM.DE | XETRA / EUR | 2026-10-12T15:39:27Z | 0 / — | Anbieteridentität bestätigt |
| 43 AMZN | AMZN | NasdaqGS / USD | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 44 AMD | AMD | NasdaqGS / USD | 2026-10-12T18:19:48Z | 0 / — | Anbieteridentität bestätigt |
| 45 ORCL | ORCL | NYSE / USD | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 47 BAS | BAS.DE | XETRA / EUR | 2026-10-12T15:35:07Z | 0 / — | Anbieteridentität bestätigt |
| 48 BMW | BMW.DE | XETRA / EUR | 2026-10-12T15:36:55Z | 0 / — | Anbieteridentität bestätigt |
| 49 MC | MC.PA | Paris / EUR | 2026-10-12T15:39:15Z | 0 / — | Anbieteridentität bestätigt |
| 50 UNH | UNH | NYSE / USD | 2026-10-12T18:19:51Z | 0 / — | Anbieteridentität bestätigt |
| 51 BABA | BABA | NYSE / USD | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 52 GOOGL | GOOGL | NasdaqGS / USD | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 53 LLY | LLY | NYSE / USD | 2026-10-12T18:19:40Z | 0 / — | Anbieteridentität bestätigt |
| 54 AVGO | AVGO | NasdaqGS / USD | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 55 YM1! | YM=F | CBOT / USD | 2026-10-12T18:09:48Z | 0 / — | Markt -> rohstoffe |
| 56 MTX | MTX.DE | XETRA / EUR | 2026-10-12T15:35:12Z | 0 / — | Anbieteridentität bestätigt |
| 57 DB | DB | NYSE / USD | 2026-10-12T18:19:41Z | 0 / — | Anbieteridentität bestätigt |
| 58 ADS | ADS.DE | XETRA / EUR | 2026-10-12T15:39:24Z | 0 / — | Anbieteridentität bestätigt |
| 59 NFLX | NFLX | NasdaqGS / USD | 2026-10-12T18:19:49Z | 0 / — | Anbieteridentität bestätigt |
| 60 AXP | AXP | NYSE / USD | 2026-10-12T18:19:38Z | 0 / — | Anbieteridentität bestätigt |
| 61 AIR | AIR.PA | Paris / EUR | 2026-10-12T15:36:55Z | 0 / — | Anbieteridentität bestätigt |
| 62 ALV | ALV.DE | XETRA / EUR | 2026-10-12T15:36:55Z | 0 / — | Anbieteridentität bestätigt |
| 63 BEI | BEI.DE | XETRA / EUR | 2026-10-12T15:35:23Z | 0 / — | Anbieteridentität bestätigt |
| 64 BNR | BNR.DE | XETRA / EUR | 2026-10-12T15:35:13Z | 0 / — | Anbieteridentität bestätigt |
| 65 CON | CON.DE | XETRA / EUR | 2026-10-12T15:35:19Z | 0 / — | Anbieteridentität bestätigt |
| 66 DTE | DTE.DE | XETRA / EUR | 2026-10-12T15:38:53Z | 0 / — | Anbieteridentität bestätigt |
| 67 SPOT | SPOT | NYSE / USD | 2026-10-12T18:19:41Z | 0 / — | Anbieteridentität bestätigt |
| 68 EOAN | EOAN.DE | XETRA / EUR | 2026-10-12T15:35:09Z | 0 / — | Anbieteridentität bestätigt |
| 69 FRE | FRE.DE | XETRA / EUR | 2026-10-12T15:35:05Z | 0 / — | Anbieteridentität bestätigt |
| 70 G1A | G1A.DE | XETRA / EUR | 2026-10-12T15:35:28Z | 0 / — | Anbieteridentität bestätigt |
| 71 HNR1 | HNR1.DE | XETRA / EUR | 2026-10-12T15:35:29Z | 0 / — | Anbieteridentität bestätigt |
| 72 HEI | HEI.DE | XETRA / EUR | 2026-10-12T15:35:24Z | 0 / — | Anbieteridentität bestätigt |
| 75 CAT | CAT | NYSE / USD | 2026-10-12T18:19:51Z | 0 / — | Anbieteridentität bestätigt |
| 76 CVX | CVX | NYSE / USD | 2026-10-12T18:19:48Z | 0 / — | Anbieteridentität bestätigt |
| 77 GS | GS | NYSE / USD | 2026-10-12T18:19:45Z | 0 / — | Anbieteridentität bestätigt |
| 78 HD | HD | NYSE / USD | 2026-10-12T18:19:49Z | 0 / — | Anbieteridentität bestätigt |
| 79 HON | HON | NasdaqGS / USD | 2026-10-12T18:19:49Z | 0 / — | Anbieteridentität bestätigt |
| 80 JNJ | JNJ | NYSE / USD | 2026-10-12T18:19:49Z | 0 / — | Anbieteridentität bestätigt |
| 81 JPM | JPM | NYSE / USD | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 82 TRV | TRV | NYSE / USD | 2026-10-12T18:18:32Z | 0 / — | Anbieteridentität bestätigt |
| 83 VZ | VZ | NYSE / USD | 2026-10-12T18:19:49Z | 0 / — | Anbieteridentität bestätigt |
| 84 DAX | ^GDAXI | XETRA / EUR | 2026-10-12T16:00:00Z | 0 / — | Markt -> sonstiges |
| 85 ASML | ASML.AS | Amsterdam / EUR | 2026-10-12T15:39:29Z | 0 / — | Anbieteridentität bestätigt |
| 86 INTU | INTU | NasdaqGS / USD | 2026-10-12T18:19:37Z | 0 / — | Anbieteridentität bestätigt |
| 87 ADSK | ADSK | NasdaqGS / USD | 2026-10-12T18:18:00Z | 0 / — | Anbieteridentität bestätigt |
| 88 CMCSA | CMCSA | NasdaqGS / USD | 2026-10-12T18:19:49Z | 0 / — | Anbieteridentität bestätigt |
| 89 SYM | SYM | NasdaqGM / USD | 2026-10-12T18:19:51Z | 0 / — | Anbieteridentität bestätigt |
| 90 UAA | UAA | NYSE / USD | 2026-10-12T18:19:51Z | 0 / — | Anbieteridentität bestätigt |
| 93 ADBE | ADBE | NasdaqGS / USD | 2026-10-12T18:19:41Z | 0 / — | Anbieteridentität bestätigt |
| 94 FI | FISV | NasdaqGS / USD | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 95 TEAM | TEAM | NasdaqGS / USD | 2026-10-12T18:19:36Z | 0 / — | Anbieteridentität bestätigt |
| 96 TTD | TTD | NasdaqGM / USD | 2026-10-12T18:19:48Z | 0 / — | Anbieteridentität bestätigt |
| 97 XAUUSD | GC=F | COMEX / USD | 2026-10-12T18:09:47Z | 3030 / 2026-10-12T09:11:08Z | Spot/Future offen |
| 103 SILVER | SI=F | COMEX / USD | 2026-10-12T18:09:14Z | 0 / — | Spot/Future offen |
| 104 EURUSD | EURUSD=X | CCY / USD | 2026-10-12T18:19:26Z | 0 / — | Anbieteridentität bestätigt |
| 105 DXY | DX-Y.NYB | ICE Futures / USD | 2026-10-12T18:09:49Z | 0 / — | Markt -> sonstiges; Metadaten berichtigen |
| 106 USDJPY | USDJPY=X | CCY / JPY | 2026-10-12T18:19:50Z | 0 / — | Anbieteridentität bestätigt |
| 111 ILMN | ILMN | NasdaqGS / USD | 2026-10-12T18:19:34Z | 3196 / 2026-10-02T20:00:00Z | Metadaten berichtigen |

## Einzelcheck aller 33 Trades

| ID / Ticker | Status | Instrument / Anbieter-Symbol | Zuordnung | eingefrorene Währung | gespeicherter Demo-Hinweis |
|---|---|---|---|---|---|
| 3 FMC | geplant | 32 / FMC | bestehende Zuordnung | Bestätigung fehlt | — |
| 5 LUMN | geplant | 33 / LUMN | bestehende Zuordnung | Bestätigung fehlt | — |
| 10 SOLUSD | geplant | 26 / SOL-USD | Markt widersprüchlich | Bestätigung fehlt | — |
| 11 ETHUSD | geplant | 25 / ETH-USD | Markt widersprüchlich | Bestätigung fehlt | — |
| 12 NIO | geplant | 29 / NIO | bestehende Zuordnung | Bestätigung fehlt | — |
| 13 XPEV | geplant | 28 / XPEV | bestehende Zuordnung | Bestätigung fehlt | — |
| 14 RGTI | aktiv | 34 / RGTI | bestehende Zuordnung | Bestätigung fehlt | — |
| 15 AI | geplant | 35 / AI | bestehende Zuordnung | Bestätigung fehlt | — |
| 17 NOW | geplant | 3 / NOW | bestehende Zuordnung | Bestätigung fehlt | — |
| 18 FI | geplant | 94 / FISV | bestehende Zuordnung | Bestätigung fehlt | — |
| 19 ORCL | geplant | 45 / ORCL | bestehende Zuordnung | Bestätigung fehlt | — |
| 20 UAA | geplant | 90 / UAA | bestehende Zuordnung | Bestätigung fehlt | — |
| 21 TEAM | geplant | 95 / TEAM | bestehende Zuordnung | Bestätigung fehlt | — |
| 22 ADBE | geplant | 93 / ADBE | bestehende Zuordnung | Bestätigung fehlt | — |
| 127 THE TRADE DESK | aktiv | 96 / TTD | bestehende Zuordnung | Bestätigung fehlt | — |
| 129 SOL | abgebrochen | 26 / SOL-USD | Markt widersprüchlich | Bestätigung fehlt | — |
| 146 CBK | abgeschlossen | — / — | Verknüpfung fehlt | Bestätigung fehlt | — |
| 147 BAYN | abgeschlossen | 2 / BAYN.DE | bestehende Zuordnung | Bestätigung fehlt | — |
| 148 CL1! | abgeschlossen | 20 / CL=F | Markt widersprüchlich | Bestätigung fehlt | — |
| 179 DRO | geplant | 31 / DRO.AX | bestehende Zuordnung | Bestätigung fehlt | — |
| 180 TDOC | geplant | — / — | Verknüpfung fehlt | Bestätigung fehlt | — |
| 182 ETHUSD | abgebrochen | 25 / ETH-USD | bestehende Zuordnung | Bestätigung fehlt | — |
| 191 NVDA | abgeschlossen | 17 / NVDA | bestehende Zuordnung | Bestätigung fehlt | — |
| 192 XAUUSD | aktiv | 97 / GC=F | Näherungsquelle | Bestätigung fehlt | Lücke in den 5-Minuten-Kursdaten. Bitte frühere Ausführungen manuell prüfen. |
| 193 UAA | abgeschlossen | 90 / UAA | bestehende Zuordnung | Bestätigung fehlt | — |
| 194 ILMN | abgeschlossen | 111 / ILMN | bestehende Zuordnung | Bestätigung fehlt | — |
| 199 META | geplant | 12 / META | bestehende Zuordnung | Bestätigung fehlt | Demo-Automatik: Keine Kursdaten für „META“ gefunden. |
| 200 INTEL | abgeschlossen | 19 / INTC | bestehende Zuordnung | Bestätigung fehlt | — |
| 201 INTEL | abgeschlossen | 19 / INTC | bestehende Zuordnung | Bestätigung fehlt | — |
| 202 META | geplant | 12 / META | bestehende Zuordnung | vorhanden | — |
| 203 BAYN | geplant | 2 / BAYN.DE | bestehende Zuordnung | vorhanden | Lücke in den 5-Minuten-Kursdaten. Bitte frühere Ausführungen manuell prüfen. |
| 204 MSFT | geplant | 4 / MSFT | bestehende Zuordnung | vorhanden | — |
| 205 SOLUSD | geplant | 26 / SOL-USD | Markt widersprüchlich | vorhanden | — |
