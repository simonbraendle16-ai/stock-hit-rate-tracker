/** Display examples only; stored degree identifiers and filters stay unchanged. */
const degreeExamples: Record<string, string> = {
  GrandSupercycle: "Ⓘ",
  Supercycle: "(I)",
  Zyklus: "I",
  Primär: "①",
  Intermediär: "(1)",
  Minor: "1",
  Minute: "ⓘ",
  Minuette: "(i)",
  Subminuette: "i",
};

export function formatWaveDegree(degree: string): string {
  if (degree === "unbekannt") return "Unbekannt";
  const example = degreeExamples[degree];
  return example ? `${degree} · ${example}` : degree;
}
