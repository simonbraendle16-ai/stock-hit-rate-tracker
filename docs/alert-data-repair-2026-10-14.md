# Alarmdaten und bestätigte Feedpausen

## Änderung

Frische Anbieterantworten enthalten außerhalb der regulären Aktienhandelssitzung den letzten Schlusskurs und einen PRE/POST/CLOSED-Marktstatus. Dieser Status wurde zuvor verworfen; der unverändert alte Kurs galt dann bei jedem Alarmdurchlauf als Datenfehler.

Migration 0053 ergänzt nullable marketState/quoteType am Kurssnapshot und quotesPaused am Laufprotokoll. Der bestehende gebündelte Kursabruf speichert diese Metadaten mit der tatsächlichen Abrufzeit; Anbieterbudgets und Takt bleiben erhalten. Ein alter Kurs löst weiterhin keinen Alarm aus. Eine frisch bestätigte Pause des regulären Feeds wird als wartend gezählt und sichtbar angezeigt. Unbekannte Börsen/Statuswerte, Krypto, fehlgeschlagene oder alte Abrufe, Zukunftswerte und Ausfälle bei geöffneter regulärer Sitzung bleiben Fehler. PRE/POST aus einem früheren Abruf kann nach der nächsten regulären Öffnung keine Lücke entschuldigen.

Snapshots werden an Anbieter und Symbol gemeinsam gebunden; gleiche Symboltexte eines anderen Anbieters dürfen weder Kursprüfung noch Versandtext beeinflussen. HTTP-Ergebnisse bleiben 200 vollständig, 202 gespeicherte Restarbeit, 409 bestehender Lauf, 503 echter Fehler/Teilfehler. quotesPaused ergänzt den vorhandenen Antwort-/Statusvertrag; keine neue Route oder Berechtigung.

## Prüfung und produktiver Bestand

90 Testdateien / 1.358 Tests bestanden; separate Typprüfung und Produktionsbuild bestanden. Pause/Ausfall, zukünftiger Abruf/Kurs, falscher Anbieter, unbekannte Quelle, Krypto, Wiederöffnung und Zeitzonen/DST isoliert geprüft. Migration zweimal auf PGlite ausgeführt.

Produktive additive Migration mit unveränderten Trade-, Depot-, Ereignis- und Kursfingerabdrücken geprüft. Vorbereitete eindeutige Metadatenkorrekturen owner-begrenzt mit aktuellem Anbieterbeleg, Besitz-/Versionsprüfung und Transaktion durchgeführt: neun Marktklassen, zwei bereits belegte Instrumente, bestehende Trade-/Alarmverknüpfungen und einzelne historische Klassifikation. Keine Preise, Mengen, FX, Ergebnisse, Ereignisse oder Planbedingungen verändert. Lesender Nachlauf zeigt keine weitere erforderliche Änderung. Persönliche Zuordnungen und Reparaturprüfer ausschließlich im privaten Projekt dokumentiert.

Nach Veröffentlichung echten Zeitgeber-/App-Abgleich durchführen. Ein erfolgreicher Build ersetzt keine automatische Betriebsabnahme; 24 Stunden auf dem reparierten Stand bleiben eine zeitliche Nachprüfung. Rücknahme: Code gezielt revertieren, additive Spalten zunächst erhalten; Datensätze nur anhand ihrer geprüften Vorwerte einzeln zurücknehmen. Keine pauschale Wiederherstellung oder historische FX-Ergänzung.
