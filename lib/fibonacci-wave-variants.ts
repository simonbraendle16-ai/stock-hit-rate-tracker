/** Explicit analyst classifications; never inferred from a level or structure. */
export const WAVE_VARIANTS = [
  { code: "b_overshooting", wave: "B", label: "B überschießend" },
  { code: "b_undershooting", wave: "B", label: "B unterschießend" },
  { code: "c_truncated", wave: "C", label: "C truncated" },
] as const;
export type WaveVariant = (typeof WAVE_VARIANTS)[number]["code"];
export const waveVariant = (code: unknown) => WAVE_VARIANTS.find(v => v.code === code);
export function waveChoice(value: string) {
  const variant = waveVariant(value);
  return { wave: variant?.wave ?? value, waveVariant: variant?.code ?? null };
}
export function waveVariantError(wave: string | undefined, code: unknown) {
  if (code == null) return null;
  const variant = waveVariant(code);
  if (!variant) return "Unbekannte Wellenvariante.";
  if (wave && wave.trim().toUpperCase() !== variant.wave)
    return "Wellenvariante passt nicht zur Grundwelle.";
  return null;
}
