import { pruefeAchsenBreite } from '@/lib/chart-coords'

/**
 * Breite der rechten Preisachse — am DOM gemessen.
 *
 * Die Chart-Bibliothek gibt sie nicht her: `priceScale().width()` liefert in
 * diesem Chart 0 (über den Chart wie über die Serie), und
 * `timeScale().width()` schließt einen Teil der Achse mit ein — daraus
 * gerechnet blieben statt der echten 62 px nur ein paar übrig. Beide Wege
 * sahen nach einer Messung aus und waren doch falsch, und ein falsch
 * gemessener Nullwert ist hier teuer: Er bedeutet „keine Achse", und dann
 * liegt die Zeichenebene über der Preisachse und schluckt die Klicks zum
 * Ziehen.
 *
 * Der Chart rendert eine Tabelle: In der ersten Zeile steht links die
 * Zeichenfläche und rechts die Preisachse. Deren Zelle lässt sich schlicht
 * ausmessen — das ist die Wahrheit, an der auch der Nutzer klickt.
 *
 * Die Plausibilitätsprüfung liegt daneben in `pruefeAchsenBreite`
 * (`lib/chart-coords.ts`, rein und getestet).
 */
export function preisachsenBreite(container: Element | null | undefined): number {
  if (!container) return pruefeAchsenBreite(0, 0)
  const zeile = container.querySelector('table tr')
  const zelle = zeile?.lastElementChild
  if (!zelle) return pruefeAchsenBreite(0, 0)
  return pruefeAchsenBreite(
    container.getBoundingClientRect().width,
    zelle.getBoundingClientRect().width,
  )
}
