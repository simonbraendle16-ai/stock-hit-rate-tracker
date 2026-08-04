import { ChartHeader } from '@/components/chart-frame'
import { Activity } from 'lucide-react'
import type { InterventionCost } from '@/lib/training-trade'

function fmt(n: number, stellen = 2): string {
  return n.toLocaleString('de-DE', {
    minimumFractionDigits: stellen,
    maximumFractionDigits: stellen,
  })
}

/** Unter so vielen entschiedenen Trades steht die Grundlage statt einer Aussage. */
const MIN_BEHAVIOUR_TRADES = 5

/**
 * Was die Übungen über das eigene VERHALTEN sagen — nicht über die Analyse.
 *
 * Die Trainingsstatistik daneben beantwortet „lag ich richtig". Dieser Block
 * beantwortet die andere Hälfte: „habe ich meinen eigenen Plan auch gehandelt".
 * Beides zu trennen ist der Kern der App — ein Trader kann richtig liegen und
 * trotzdem verlieren, weil er vorher aussteigt.
 *
 * Der Ton ist beobachtend. Hier steht, was passiert ist, nicht was man tun
 * soll — dieselbe Haltung wie bei MAE/MFE und beim Bot-Zwilling.
 */
export function BehaviourPanel({
  eingriff,
  checkpoints,
  keinSetup,
  entschieden,
  enthaltungen,
}: {
  eingriff: InterventionCost
  checkpoints: number
  keinSetup: number
  entschieden: number
  enthaltungen: number
}) {
  const genug = entschieden >= MIN_BEHAVIOUR_TRADES
  const geplant = entschieden + enthaltungen

  return (
    <div className="panel p-4 sm:p-6">
      <ChartHeader
        icon={Activity}
        title="Was du mit deinem Plan machst"
        subtitle="Nicht ob du richtig lagst — ob du deinen eigenen Plan gehandelt hast."
      />

      {geplant === 0 ? (
        <p className="note mt-3">
          Noch keine geübten Trades. Sobald du im Trainer Trades planst und laufen lässt,
          steht hier, wie oft du bei deinem Plan geblieben bist.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="panel-sunken px-3 py-2">
              <p className="note">Geübte Trades</p>
              <p className="font-mono text-lg">{entschieden}</p>
            </div>
            <div className="panel-sunken px-3 py-2">
              <p className="note">Enthaltungen</p>
              <p className="font-mono text-lg">{enthaltungen}</p>
            </div>
            <div className="panel-sunken px-3 py-2">
              <p className="note">Haltepunkte</p>
              <p className="font-mono text-lg">{checkpoints}</p>
            </div>
            <div className="panel-sunken px-3 py-2">
              <p className="note">davon nichts gemacht</p>
              <p className="font-mono text-lg">{keinSetup}</p>
            </div>
          </div>

          {!genug ? (
            <p className="note">
              {entschieden} von {MIN_BEHAVIOUR_TRADES} Trades. Darunter sagt eine Aussage
              über das eigene Verhalten mehr über den Zufall als über dich.
            </p>
          ) : eingriff.ausstiege === 0 ? (
            <p className="note">
              Du wolltest bisher an keinem Haltepunkt vorzeitig aussteigen. Deine Pläne sind
              gelaufen, wie du sie geschrieben hast.
            </p>
          ) : (
            <div className="panel-sunken space-y-1 px-3 py-2.5">
              <p className="eyebrow">Vorzeitig aussteigen</p>
              <p className="note">
                In {eingriff.ausstiege} von {entschieden} Trades wolltest du unterwegs raus.
                {eingriff.waerenAufgegangen > 0 ? (
                  <>
                    {' '}
                    {eingriff.waerenAufgegangen} davon{' '}
                    {eingriff.waerenAufgegangen === 1 ? 'erreichte' : 'erreichten'} danach
                    noch das Ziel —{' '}
                    <span className="text-warning">
                      {fmt(eingriff.entgangenR)} R hätte dich das gekostet.
                    </span>
                  </>
                ) : (
                  ' Keiner davon lief danach noch ins Ziel.'
                )}
                {eingriff.richtigGewesen > 0 && (
                  <>
                    {' '}
                    In {eingriff.richtigGewesen}{' '}
                    {eingriff.richtigGewesen === 1 ? 'Fall' : 'Fällen'} wäre der Ausstieg
                    richtig gewesen.
                  </>
                )}
              </p>
            </div>
          )}

          <p className="note text-muted-foreground">
            Enthaltungen und „nichts gemacht" sind bewusst mitgezählt: Wie oft du hinsiehst
            und dich heraushältst, ist die einzige Zahl gegen das Überhandeln.
          </p>
        </div>
      )}
    </div>
  )
}
