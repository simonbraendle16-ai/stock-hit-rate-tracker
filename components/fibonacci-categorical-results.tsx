import { formatWaveDegree } from "@/lib/wave-degree-labels";
import { durationDefinitions, CALENDAR_TIME_NOTE, ZONE_TO_PIVOT } from "@/lib/fibonacci-duration-definitions";
import type { categoricalStats } from "@/lib/fibonacci-categorical-stats";
import { levelLabel } from "@/components/fibonacci-categorical-inputs";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export function CategoricalResults({
  stats,
}: {
  stats: ReturnType<typeof categoricalStats>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fibonacci-Levels, Zieltreffer und Dauerklassen</CardTitle>
        <CardDescription>
          {stats.definition} Alle Angaben verwenden die aktuellen Filter. Kleine
          Fallzahlen bleiben sichtbar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <details open>
          <summary className="cursor-pointer font-medium">Welche Schlüsselfibonaccis wurden angelaufen?</summary>
          <FieldNote>Ausdrücklich erfasste Schlüssellevel je Welle, Wellengrad, Timeframe und Messart. Zielzone und Umkehrbereich bleiben getrennt. Fehlende Angaben werden ausgeschlossen.</FieldNote>
          {!stats.keyFibonacci.groups.length && <p className="text-sm">Noch kein bestätigtes Schlüsselfibonacci in dieser Auswahl.</p>}
          {stats.keyFibonacci.groups.map((g, i) => (
            <div key={i} className="mt-3 text-sm">
              <p>{g.wave} · {formatWaveDegree(g.degree)} · {g.timeframe} · {g.measurementKind} · n={g.n}</p>
              {g.distribution.map(d => <details key={d.level}>
                <summary>{levelLabel(d.level)} · {d.n}/{g.n} · {d.share.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %</summary>
                <p className="break-words text-xs">Fälle: {d.ids.join(", ")}</p>
              </details>)}
            </div>
          ))}
          <details><summary>Ausschlüsse ({stats.keyFibonacci.excluded.length})</summary>
            {stats.keyFibonacci.excluded.map(r => <p className="break-words text-xs text-muted-foreground" key={r.id}>{r.id}: {r.reason}</p>)}
          </details>
        </details>
        <details open>
          <summary className="cursor-pointer font-medium">
            Wie häufig wurden die Fibonacci-Levels erreicht?
          </summary>
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Levelhäufigkeiten mit bekannten erreichten und verfehlten Fällen
              </caption>
              <thead>
                <tr>
                  <th className="p-2">Level</th>
                  <th className="p-2">Erreicht</th>
                  <th className="p-2">Verfehlt</th>
                  <th className="p-2">Fallzahl</th>
                  <th className="p-2">Anteil erreicht</th>
                </tr>
              </thead>
              <tbody>
                {stats.levels.map((l) => (
                  <tr key={l.level} className="border-t border-border">
                    <td className="p-2">{levelLabel(l.level)}</td>
                    <td className="p-2">{l.reached.length}</td>
                    <td className="p-2">{l.missed.length}</td>
                    <td className="p-2">{l.n}</td>
                    <td className="p-2">
                      {l.share == null
                        ? "—"
                        : `${l.share.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FieldNote>
            Nur ausdrücklich bekannte Levelangaben zählen. Eine fehlende Angabe
            ist keine Verfehlung.
          </FieldNote>
          <details>
            <summary>Fälle und Ausschlüsse je Level</summary>
            {stats.levels.map((l) => (
              <details key={l.level}>
                <summary>
                  {levelLabel(l.level)} · n={l.n}
                </summary>
                <p className="break-words text-xs">
                  Erreicht: {l.reached.join(", ") || "keine"} · Verfehlt:{" "}
                  {l.missed.join(", ") || "keine"}
                </p>
                {l.excluded.map((r) => (
                  <p
                    className="break-words text-xs text-muted-foreground"
                    key={r.id}
                  >
                    {r.id}: {r.reason}
                  </p>
                ))}
              </details>
            ))}
          </details>
        </details>
        <details open>
          <summary className="cursor-pointer font-medium">
            An welchen Fibonacci-Levels drehten die Wellen?
          </summary>
          <FieldNote>
            Beobachtete Umkehrhäufigkeiten je Welle, Wellengrad und Timeframe.
            Bereiche bleiben eigene Kategorien und werden keinem einzelnen Level
            zugeschlagen.
          </FieldNote>
          {!stats.reversals.groups.length && (
            <p className="text-sm">
              Noch keine bestätigte Umkehr in dieser Auswahl.
            </p>
          )}
          {stats.reversals.groups.map((g, i) => (
            <details className="mt-2" key={i}>
              <summary className="text-sm">
                Welle {g.wave} · {formatWaveDegree(g.degree)} · {g.timeframe} ·{" "}
                {g.measurementKind} · n={g.n}
              </summary>
              {g.distribution.map((d) => (
                <p className="text-sm" key={d.zone.join("-")}>
                  {d.zone[0] === d.zone[1]
                    ? `Am ${d.zone[0]}-%-Level`
                    : `Zwischen ${d.zone.join("–")} %`}
                  : {d.n} von {g.n} ·{" "}
                  {d.share.toLocaleString("de-DE", {
                    maximumFractionDigits: 1,
                  })}{" "}
                  % · Fälle: {d.ids.join(", ")}
                </p>
              ))}
            </details>
          ))}
          <details>
            <summary className="text-sm">Ausgeschlossene Umkehrangaben</summary>
            {stats.reversals.excluded.map((r) => (
              <p
                className="break-words text-xs text-muted-foreground"
                key={r.id}
              >
                {r.id}: {r.reason}
              </p>
            ))}
          </details>
        </details>
        <details open>
          <summary className="cursor-pointer font-medium">
            Umkehr innerhalb der erwarteten Zielzone
          </summary>
          <FieldNote>
            Treffer = Umkehr innerhalb der Zone, einschließlich ihrer Grenzen.
            Bloße Berührung oder Durchlaufen zählt nicht als Zieltreffer.
            Rückblickende Erwartungen sind keine Vorhersagen.
          </FieldNote>
          {!stats.targets.length && (
            <p className="text-sm">
              Noch keine erwartete Zielzone in dieser Auswahl erfasst.
            </p>
          )}
          {stats.targets.map((g, i) => (
            <details key={i} className="mt-2">
              <summary className="text-sm">
                Welle {g.wave} · {formatWaveDegree(g.degree)} · {g.timeframe} · {g.zone.join("–")}{" "}
                % · {g.hit.length}/{g.n} Treffer
                {g.share == null
                  ? ""
                  : ` · ${g.share.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`}
              </summary>
              <p className="text-xs">
                Erwartung:{" "}
                {g.timing === "prior"
                  ? "vorher festgelegt"
                  : g.timing === "retrospective"
                    ? "rückblickend"
                    : "Zeitpunkt unbekannt"}
                . {g.unknown.length} Fälle ohne abschließende Bewertung
                (laufend, unklar oder Umkehr nicht eindeutig bekannt).
              </p>
              <p className="break-words text-xs">
                Treffer: {g.hit.join(", ") || "keine"} · Verfehlt:{" "}
                {g.miss.join(", ") || "keine"} · Offen:{" "}
                {g.unknown.join(", ") || "keine"}
              </p>
            </details>
          ))}
        </details>
        <details open>
          <summary className="cursor-pointer font-medium">
            Dauerverteilung · getrennte Vergleichsgruppen
          </summary>
          <FieldNote>
            {durationDefinitions.reversal.label}: {durationDefinitions.reversal.description} {durationDefinitions.residence.label}: {durationDefinitions.residence.description} {CALENDAR_TIME_NOTE} Altangaben behalten ihre bisherige Zeitbasis und Messweise.
          </FieldNote>
          <FieldNote>
            Jede Gruppe hat dieselbe Welle, denselben Wellengrad und Timeframe,
            dieselbe Messart, Zone, Zeitbasis und Messweise. Keine Mittelwerte
            aus Klassenmitten. Ein Handelstag wird nicht in Stunden umgerechnet.
          </FieldNote>
          {!stats.durations.groups.length && (
            <p className="text-sm">
              Noch keine geeigneten Dauerklassen in dieser Auswahl.
            </p>
          )}
          {stats.durations.groups.map((g, i) => (
            <details key={i} className="mt-3">
              <summary className="text-sm">
                {g.type === "wave"
                  ? "Wellendauer"
                  : g.type === "reversal"
                    ? g.convention === ZONE_TO_PIVOT ? "Zielzonenkontakt bis Wellenwendepunkt" : "Umkehrdauer · Altangabe, Messgrenzen offen"
                    : "Zonenaufenthalt"}{" "}
                · Welle {g.wave} · {formatWaveDegree(g.degree)} · {g.timeframe} ·{" "}
                {g.zone ? `${g.zone.join("–")} %` : "gesamte Welle"} · n={g.n}
              </summary>
              <p className="text-xs text-muted-foreground">
                {g.measurementKind} ·{" "}
                {g.timeBasis === "calendar"
                  ? "Kalenderzeit"
                  : g.timeBasis === "trading"
                    ? "Handelszeit"
                    : "Zeitbasis unbekannt"}{" "}
                ·{" "}
                {
                  (
                    {
                      first_visit: "Erster Aufenthalt",
                      total_visits: "Gesamter Aufenthalt",
                      whole_wave: "Gesamte Welle",
                      reversal: "Umkehr",
                      first_entry_to_pivot: "Erster Zielzonenkontakt bis Wellenwendepunkt",
                      unknown: "Messweise unbekannt",
                    } as Record<string, string>
                  )[g.convention]
                }
                {g.legacyConvention ? ` · ${g.legacyConvention}` : ""}
              </p>
              {g.distribution
                .filter((d) => d.n)
                .map((d) => (
                  <p key={d.bucket} className="text-sm">
                    {d.label}: {d.n} von {g.n} ·{" "}
                    {d.share.toLocaleString("de-DE", {
                      maximumFractionDigits: 1,
                    })}{" "}
                    %
                  </p>
                ))}
              <p className="break-words text-xs">
                Fälle: {g.included.map((r) => r.id).join(", ")}
              </p>
            </details>
          ))}
          <details className="mt-3">
            <summary className="text-sm">
              Ausschlüsse und unbekannte Dauern
            </summary>
            {stats.durations.excluded.map((r) => (
              <p
                className="break-words text-xs text-muted-foreground"
                key={r.id + r.type}
              >
                {r.id} · {r.type}: {r.reason}
              </p>
            ))}
          </details>
        </details>
        <details>
          <summary className="cursor-pointer font-medium">
            Wellenstrukturen · Hauptstruktur und Untertyp
          </summary>
          {stats.structures
            .filter((s) => s.ids.length)
            .map((s) => (
              <p key={s.code} className="text-sm">
                {s.label}: {s.ids.length} · Fälle: {s.ids.join(", ")}
              </p>
            ))}
          {stats.structureFamilies
            .filter((s) => s.ids.length)
            .map((s) => (
              <p key={s.parent} className="text-sm">
                Hauptstruktur {s.parent}: {s.ids.length} Fälle
              </p>
            ))}
        </details>
      </CardContent>
    </Card>
  );
}
function FieldNote({ children }: { children: React.ReactNode }) {
  return <p className="my-2 text-xs text-muted-foreground">{children}</p>;
}
