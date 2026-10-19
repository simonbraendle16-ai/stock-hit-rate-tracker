# Zwei getrennte Wellenzeiten – Vertrag vom 19.10.2026

Bestätigter Nutzerauftrag: beide Zeitspannen getrennt erfassen und auswerten, Änderung pushen. Ergänzung: Zeitbasis immer Kalenderzeit; Auswahl Handelszeit/Kalenderzeit entfernen.

## Bedeutung

1. **Zielzonenkontakt bis Wellenwendepunkt:** vom ersten Kontakt mit der dokumentierten Zielzone bis zum rückblickend bestimmten Ende der untersuchten Welle / Beginn der Folgewelle. Auch zwischenzeitliche Austritte gehören zu dieser Zeitspanne. Die spätere Bestätigung des Wellenwechsels ist kein Messende.
2. **Verweildauer in der Zielzone:** ausschließlich Zeit innerhalb derselben dokumentierten Zone. `first_visit` meint ersten Kontakt bis ersten Austritt in beliebiger Richtung; `total_visits` die Summe der Aufenthalte. Zeit außerhalb wird nicht mitgerechnet. Messweisen bleiben getrennt.

Kalenderzeit enthält Nächte, Wochenenden und Feiertage. Neue Formulareingaben setzen `timeBasis=calendar`; es gibt dort keine Auswahl zwischen Kalender- und Handelszeit. Der bestehende Filter „historische Wellenzeit / Erfassungsdatum“ betrifft die Zuordnung von Beobachtungen zu Zeiträumen und bleibt erhalten.

## Speicherung und API

Additives Evidence-Objekt `targetZoneReversal`; keine SQL-Migration, keine Nachpflege aus Notizen oder alten Umkehrdauern.

```json
{
  "targetZoneReversal": {
    "kind": "exact",
    "value": 6,
    "unit": "hour",
    "timeBasis": "calendar",
    "measurementConvention": "first_entry_to_pivot",
    "zone": [50, 61.8],
    "originalText": "Synthetisches Vertragsbeispiel: sechs Stunden bis zum Wendepunkt"
  }
}
```

Die vorhandene `evidence.provenance` bleibt erforderlich. Unterstützte Genauigkeiten wie bei der Verweildauer: `unknown`, `exact`, `approximate`, `range`, `upper_bound`. Zahlen ausschließlich entsprechend der gewählten Genauigkeit; bei Obergrenze kein Punktwert. Ein ausdrücklich mit dem ersten Kontakt zusammenfallender Wendepunkt darf 0 haben. `measurementConvention` ist fest `first_entry_to_pivot`, Zeitbasis fest `calendar`. Zonen-Snapshot und Originaleinheit bleiben erhalten. Unbekannte Schlüssel, fehlende Zone, Bestätigungszeit als Messweise und negative Zahlen werden abgelehnt.

`targetZoneResidence` bleibt eigenes Objekt mit Touch-and-Go/Verweilen, Genauigkeit und Zonenbezug. Im Formular werden auch genaue/ungefähre Angaben und Grenzen angeboten; die Messweise erster/gesamter Aufenthalt ist auswählbar. Historische freie Messweisen bleiben lesbar, bis gezielt korrigiert. Kein automatisches Kopieren zwischen den beiden Größen.

Für Dauerklassen bleibt `durations.reversal` erhalten. Neue ausdrücklich definierte Eingabe: `convention=first_entry_to_pivot`, `timeBasis=calendar`, eigener `zone`-Snapshot. `durations.residence` verwendet weiter `first_visit` oder `total_visits`. Beide können unabhängig erhoben werden. Ist Klasse und exakter Wert im gleichen Kontext vorhanden, prüft der Schreibservice ihre Verträglichkeit; widersprüchliche Neuschreibungen werden mit 422 abgelehnt.

Bestehende POST/PATCH/GET-/Revisionsrouten bleiben zuständig. Ältere PATCH-Clients ohne neuen Schlüssel erhalten bestehende Wendepunktdaten; ausdrückliches `targetZoneReversal:null` löscht nur diese Größe. `evidence:null` darf strukturierte Daten nicht unabsichtlich löschen. Version und Wiederholungsschutz bleiben erhalten. Unerreichte Zielzone erlaubt keine neue vom Zielzonenkontakt ausgehende Dauer.

## Auswertung

- `stats.coverage.targetZoneReversal`: beschreibende Abdeckung mit eigenem n, Nenner und enthaltenen/ausgeschlossenen IDs.
- `stats.coverage.reversalKind`: Genauigkeit der neuen Wendepunktdauer.
- `stats.coverage.reversalComparisons`: Mittelwert/Median ausschließlich explizit exakter abgeschlossener Werte, gruppiert nach Welle, Grad, Timeframe, Messart, Zonen-Snapshot und Messweise. Kalenderzeit wird auf Stunden normalisiert. Grenzen, Schätzungen, ungeklärte Messart und laufende Fälle bleiben außerhalb.
- `stats.categorical.durations`: neue definierte Umkehrklassen und Verweildauerklassen als verschiedene Gruppen. Exakte Kalenderwerte können verlustfrei klassifiziert werden, aber Klassen werden nicht in künstliche Mittelwerte umgerechnet.
- Vorhandene `residenceComparisons` bleibt getrennt. Die beiden Größen verwenden weder einen gemeinsamen Durchschnitt noch dieselbe Fallzahl als Annahme.
- `catalogue.durationDefinitions` beschreibt beide Bedeutungen. CSV enthält beide vollständigen Objekte in der Evidence-Spalte. Kennzahlen basieren auf vollständiger Auswahl vor Pagination.

## Altbestand und Rücknahme

`reversalDurationDays` und Klassen mit `convention=reversal` haben offene Messgrenzen. Sie werden sichtbar als Altangaben geführt, nicht als neue Wendepunktmessung umgedeutet. Historische Handelszeit/offene Zeitbasis bleibt getrennt; keine Multiplikation mit einer erfundenen Handelstagslänge. Neue Formulareingaben und gezielte Daueränderungen verwenden Kalenderzeit.

Kein automatischer Daten-Backfill und keine produktiven Testbeobachtungen. Reine Code-Rücknahme darf neue Evidence nicht durch einen alten strikt validierenden Writer löschen. Bereits gespeicherte neue Werte/Revisionen erhalten; bei Rücknahme einen erhaltenden Leseschreibstand verwenden. Vorherige Appbasis: `36dec6ffa42f656088e00dad8bc6b55d2dc1e3ec`.

## Prüfung und Reproduktion

Volle finale Suite: 106 Testdateien / 1.575 Tests bestanden. Neue Fälle prüfen beide unterschiedlichen Werte, Kalendernormalisierung, Null/Schätzung/Obergrenze, alte offene Bedeutungen, Klassenkonflikte, Idempotenz, Versionskonflikt, Eigentümergrenze, Detail-GET, Revisionen und CSV. Neue Datenbank-/Dauertests zuvor separat: 49 bestanden; danach zusätzliche Regression für die gemeinsame Gruppe identischer exakter Werte und expliziter Klassen ergänzt und mit der Gesamtsuite geprüft. Separate Typprüfung und finaler Next.js-Produktionsbuild geprüft. Neue mobile Entfernen-Aktionen umbrechen ihre Beschriftungen, statt den Formularinhalt zu verbreitern.

Lokaler flüchtiger Prüfbetrieb:

```text
node --experimental-strip-types scripts/fibonacci-local-preview.mjs --duration-definitions --production
node scripts/verify-duration-definitions-local.mjs
```

Nur synthetische lokale Datenbank/Konto; keine Umgebungsdateien oder produktiven Zugangsdaten. Vorhandene lokale `.test-tools` erforderlich, keine Installation durch das Skript. Browserkorrektur im synthetischen Fall: Wendepunktdauer 6→8 Stunden, Verweildauer 18→20 Stunden. Detail-GET, DB, getrennte Mittelwerte und frühere Revision geprüft; Altfall mit zwei Tagen und offener Handelszeit blieb unverändert. Abschlussbericht und produktive Lesebelege werden im Trading-Assistent-Projekt geführt.
