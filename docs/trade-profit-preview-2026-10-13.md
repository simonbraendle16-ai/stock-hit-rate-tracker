# Gewinn-/Verlustvorschau im Tradeformular

Stand 13.10.2026: lokal repariert; keine Veröffentlichung und keine Tracker-Schreibtests.

## Ausgang und Ursache

Führendes Repository: `C:/Users/sabin/Documents/Agentic Coding/Apps/stock-hit-rate-tracker/`.
Isolierter Worktree: `C:/Users/sabin/Documents/Trading-Assistent/.worktrees/trade-profit-preview`.
Branch: `codex/trade-profit-preview-2026-10-13`, Basis `6915d71` (bestehende Speicherreparatur).
Die anderen Worktrees zur Symbol-/Kursreparatur und Integration bleiben unverändert.

Das echte offene Formular wurde im verbundenen Edge gelesen und weder geändert noch abgeschickt:
BAYN, Aktien, Demo in USD, Kurswährung EUR, Short, Einstieg 45,28, Stop 46,80, Ziel 39,41,
500 USD Einsatz, Hebel 5, keine Teilziele. Stückzahl „—“, CRV 3,86.
Die UI und der Nutzer-Screenshot zeigen den Fehler für einen FX-Zeitpunkt außerhalb der erlaubten letzten sieben Tage oder in der Zukunft.
Ob der echte Depotzeitpunkt veraltet oder zukünftig ist, ist ohne verfügbaren API-Lesezugriff nicht entschieden.

Belegte Codepfade:

- `resolveMoneyCurrency` verweigert den ungültigen FX-Snapshot. Diese Schutzprüfung bleibt bestehen.
- `TradeForm.money` gab bei fehlender Umrechnung `null` zurück; die Ergebnisblöcke wurden komplett ausgeblendet.
- Die gleiche Projektion verlangte `investedAmount`, weshalb manuelle Mengen keine Vorschau erhielten; Kontrakte waren ausdrücklich ausgeschlossen.
- Nur das erste Teilziel wurde projiziert. Die übrigen Zielgewinne fehlten.
- `parseFloat` las z. B. `45,28` als `45`. Mengenübermittlung nutzte einen anderen Parser.

## Patch

`tradeFormPreview` verwendet weiterhin `computeShares`, `projectStopLoss`, `projectTakeProfit`,
`contractTradeFelder` und `buildTargetPlan`. Kapital bzw. Kontrakte bestimmen die Größe; eine manuelle
Menge wird unverändert verwendet und nicht nochmals gehebelt. Veraltete versteckte Kontrakte werden
bei einem Instrument ohne Spezifikation nicht übertragen.

Jedes Ziel zeigt Kurswährung, Anteil an der Anfangsposition, Teilmenge und Bruttogewinn in Depotwährung.
Stop: volle Anfangsposition vor Teilverkäufen. Die Gesamtprojektion zieht die erfasste Einstiegsgebühr einmal
und je Ziel eine Ausstiegsgebühr ab. Demo bleibt gemäß bestehender Abrechnung gebührenfrei.
Spread, Slippage, Finanzierung und andere unbekannte Kosten sind ausdrücklich nicht berücksichtigt.

Fehlende Voraussetzungen stehen sichtbar in der Vorschau. Bei ungültigem FX werden Depot, Währungspaar,
Zeitpunkt und Einstellungsweg genannt. Ein Link öffnet Einstellungen in einem neuen Tab. Der Button
„Depotkurse neu lesen“ verwendet die bestehende authentifizierte Leseaktion `getPortfolioFxRates`;
er schreibt keine Kurse, erhält die Eingaben und setzt eine frühere Risikobestätigung zurück.
FX-Alter wird bei jedem Render erneut geprüft. Keine Lockerung der Sieben-Tage-Prüfung.

Dezimale Textfelder und `formNumber` verwenden denselben vollständigen Parser für Vorschau,
Zielstufen und Übermittlung. Komma, Punkt und wissenschaftliche Schreibweise sind erlaubt;
mehrdeutige Gruppierungszeichen und ungültige Zeichen werden nicht teilweise als Zahlen übernommen.

## Nachweise

- Final: neun gezielte Testdateien, 153 Tests erfolgreich. Formularvorschau, Mengenauswahl,
  Trade-Mathematik, Währungsregression/-integration, Zielplanung, Instrumentabruf, lokale DB-Verträge und Kontraktmathematik.
- Separate Typprüfung: `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
  Nach Entfernung der temporären QA-Seite müssen deren generierte Next-Routentypen ebenfalls entfernt sein.
- `git diff --check`.
- Echter Browser: lokale QA-Kopie des tatsächlichen Formulars mit ausschließlich ersetzten IO-Imports.
  Instrument-/FX-/Depotdaten synthetisch, Speicherfunktion absichtlich deaktiviert. Keine Anmeldung,
  Produktionsdatenbank, persönlichen Testtrades oder Brokeraktionen. Temporäre Seite wieder entfernt.
- BAYN-Werte mit Dezimalkomma und altem synthetischem FX: konkrete Fehlermeldung statt leerer Vorschau.
  „Depotkurse neu lesen“ liefert im Test 1 EUR = 1,10 USD und erhält alle Eingaben:
  50,1927 Einheiten, Stop −83,92 USD, Ziel +324,09 USD.
- BAYN-Short mit manuellen 20,5 Einheiten, Hebel 5: Stop −34,28 USD, Ziel +132,37 USD;
  keine erneute Hebelung der Menge.
- Long, 100/90/120 EUR und zehn manuelle Einheiten: Stop −100 EUR, Ziel +200 EUR.
- Long, 1.000 EUR Einsatz, Hebel 1: zehn Einheiten. 50 % bei 110,50 und Rest bei 120:
  fünf/fünf Einheiten, +52,50/+100 EUR, zusammen +152,50 EUR.
- Derselbe Kapitalplan im synthetischen USD-Depot: 9,0909 Einheiten,
  4,5455 je Ziel, −100 USD Stop, +52,50/+100 USD Zielgewinne.
- Rechenprüfungen zusätzlich für Long/Short und gleiche/verschiedene Währungen sowie ES-Kontrakte.

## Grenzen und Freigabe

Die lokale Assistenten-API-Konfiguration enthält keine nutzbare Base-URL/Token-Kombination;
`GET /portfolios` wurde deshalb nicht ausgeführt. Der echte Formularstand wurde stattdessen direkt gelesen.
RAG war erreichbar, meldete aber offenen Tracker-Abgleich; historische Tracker-Treffer sind kein Live-Nachweis.
Zeitweise Browser-CDP-Aussetzer wurden mit dem dokumentierten Browser-/AX-Zugriff umgangen.

Der echte EUR→USD-Depotkurs wurde nicht korrigiert, keine FX-Zahl erfunden und kein Trade gespeichert.
Nach Veröffentlichung ist ein gültiger belegter Depotkurs nötig. Dessen echte Aktualisierung und
authentifiziertes Neulesen bleiben als produktive Abnahme offen. Kein vollständiger Build in diesem Auftrag;
die separate Typprüfung ist erforderlich, da die bestehende Next-Konfiguration Build-Typfehler ignoriert.
Keine Migration, Handelsregeländerung, Zusammenführung oder Veröffentlichung.
Freigabe betrifft ausschließlich diesen Formularpatch; vor einer späteren Integration aktuellen Zielbranch und Konflikte frisch prüfen.
