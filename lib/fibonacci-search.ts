import { subdivisionLabel, subdivisionConfidenceLabel } from "./fibonacci-subdivision";
import { FIB_DEGREES, FIB_TIMEFRAMES, type FibFilters } from "./fibonacci";
import { waveVariant, waveVariantError } from "./fibonacci-wave-variants";
import {
  RESEARCH_LEVELS,
  RESEARCH_WAVES,
  STRUCTURES,
} from "./fibonacci-catalogue";
import {
  levelMeaningLabels,
  type LevelMeaning,
} from "./fibonacci-level-search";

export type SearchInstrument = { id: number; name: string; ticker: string };
export type SearchChoice = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};
export type SearchResolutions = Record<string, string>;
const filterLabels: Record<string, string> = {
  stockId: "Instrument",
  wave: "Welle",
  waveVariant: "Wellenvariante",
  from: "Zeitraum von",
  to: "Zeitraum bis",
  timeBasis: "Zeitbasis",
  waveLabelScope: "Wellenumfang",
  structure: "Muster der untersuchten Welle",
  subdivision: "Innere Unterteilung",
  subdivisionConfidence: "Sicherheit der Unterteilung",
  degree: "Wellengrad",
  timeframe: "Zeiteinheit",
  status: "Status",
  measurementKind: "Messart",
  levelFrom: "Fibonacci-Level / von",
  levelTo: "Fibonacci-Bereich bis",
  levelMeaning: "Levelbedeutung",
};
export function describeSearchCriterion(
  c: { key: string; value: string },
  instruments: readonly SearchInstrument[],
) {
  let value = c.value;
  if (c.key === "subdivision") value = subdivisionLabel(value);
  else if (c.key === "subdivisionConfidence") value = subdivisionConfidenceLabel(value);
  else if (c.key === "waveVariant") value = waveVariant(value)?.label ?? value;
  else if (c.key === "stockId") {
    const i = instruments.find((i) => String(i.id) === value);
    value = i ? `${i.ticker} · ${i.name}` : value;
  } else if (c.key === "structure")
    value = value.startsWith("family:")
      ? `Hauptstruktur ${value.slice(7).toUpperCase()}`
      : (STRUCTURES.find(([code]) => code === value)?.[1] ?? value);
  else if (c.key === "levelMeaning")
    value = levelMeaningLabels[value as LevelMeaning] ?? value;
  else if (c.key === "waveLabelScope")
    value =
      value === "descendants" ? "einschließlich Unterwellen" : "Welle selbst";
  else if (c.key === "timeBasis")
    value =
      value === "historical" ? "historische Wellenzeit" : "Erfassungsdatum";
  else if (c.key === "levelFrom" || c.key === "levelTo")
    value = Number(value).toLocaleString("de-DE") + " %";
  return `${filterLabels[c.key] ?? c.key}: ${value}`;
}
export const normalizeSearch = (s: string) =>
  s
    .normalize("NFC")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .trim();
const fold = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Deterministic grammar. Unconsumed tokens and conflicts block application. */
export function interpretFibSearch(
  query: string,
  instruments: readonly SearchInstrument[],
  base: FibFilters = {},
  resolutions: SearchResolutions = {},
) {
  let remaining = normalizeSearch(query);
  const filters: FibFilters = { ...base };
  const unknown: string[] = [];
  const recognized: { key: string; value: string }[] = [],
    conflicts: string[] = [],
    pending: SearchChoice[] = [];
  if (remaining.length > 2000)
    return {
      filters,
      recognized,
      pending,
      unknown,
      conflicts: ["Suchtext auf 2000 Zeichen begrenzen"],
      ready: false,
    };
  const assigned = new Map<string, string>();
  const assign = (key: keyof FibFilters, value: string | number) => {
    const text = String(value),
      previous =
        assigned.get(key) ??
        (base[key] === undefined ? undefined : String(base[key]));
    if (previous !== undefined && previous !== text)
      conflicts.push(`${filterLabels[key] ?? key}: ${previous} / ${text}`);
    else {
      Object.assign(filters, { [key]: value });
      assigned.set(key, text);
      recognized.push({ key, value: text });
    }
  };
  const choose = (
    key: string,
    label: string,
    options: SearchChoice["options"],
    apply: (value: string) => void,
  ) => {
    if (resolutions[key] && options.some((o) => o.value === resolutions[key]))
      apply(resolutions[key]);
    else pending.push({ key, label, options });
  };
  const consume = (pattern: RegExp, callback: (...parts: string[]) => void) => {
    remaining = remaining.replace(pattern, (...args: unknown[]) => {
      callback(...(args.slice(0, -2) as string[]));
      return " ";
    });
  };
  consume(/\b(?:unterteilungssicherheit|subdivisionConfidence)\s*[:=]\s*(bestaetigt|bestätigt|vermutet|unbekannt)\b/gi, (_, value) => assign("subdivisionConfidence", value.toLowerCase().replace("bestätigt","bestaetigt")));
  consume(/\b(?:unterteilung|subdivision)\s*[:=]\s*(three_part|five_part|unknown|dreiteilig|fünfteilig|fuenfteilig|unbekannt)(?![\p{L}\p{N}_])/giu, (_, value) => assign("subdivision", ({dreiteilig:"three_part",fünfteilig:"five_part",fuenfteilig:"five_part",unbekannt:"unknown"} as Record<string,string>)[value.toLowerCase()] ?? value.toLowerCase()));
  consume(/(?<![\p{L}\p{N}_])(dreiteilig|fünfteilig|fuenfteilig)(?:e|en|er|es)?(?![\p{L}\p{N}_])/giu, (_, value) => assign("subdivision", value.toLowerCase()==="dreiteilig" ? "three_part" : "five_part"));
  consume(/\b(\d{4})\s*-\s*(\d{4})\b/g, (_, a, b) => {
    assign("from", a);
    assign("to", b);
    assign("timeBasis", "historical");
    if (a > b) conflicts.push("Umgekehrter Jahresbereich");
  });
  consume(/\b(?:einschlie(?:ß|ss)lich|inklusive|mit)\s+unterwellen\b/gi, () =>
    assign("waveLabelScope", "descendants"),
  );
  consume(/\bnur\s+(?:die\s+)?(?=welle\s+[1-5ABCDEWXYZ]\b)/gi, () =>
    assign("waveLabelScope", "self"),
  );
  consume(/\bwelle\s+(X₂|[1-5ABCDEWXYZ])\s+selbst\b/gi, (_, wave) => {
    assign("wave", wave.toUpperCase());
    assign("waveLabelScope", "self");
  });
  consume(/\bwelle\s+selbst\b/gi, () => assign("waveLabelScope", "self"));
  const assignVariant = (code: "b_overshooting" | "b_undershooting" | "c_truncated") => {
    assign("wave", waveVariant(code)!.wave);
    assign("waveVariant", code);
  };
  consume(/(?<![\p{L}\p{N}_])(über|unter)schie(?:ß|ss)end(?:e|en|er|es)?\s+(?:welle\s+)?b\b/giu,
    (_, direction) => assignVariant(direction.toLowerCase() === "über" ? "b_overshooting" : "b_undershooting"));
  consume(/\b(?:welle\s+)?b\s+(über|unter)schie(?:ß|ss)end(?:e|en|er|es)?\b/gi,
    (_, direction) => assignVariant(direction.toLowerCase() === "über" ? "b_overshooting" : "b_undershooting"));
  consume(/\b(?:welle\s+)?c\s+truncated\b/gi, () => assignVariant("c_truncated"));
  consume(/\bwelle\s+(X₂|[1-5ABCDEWXYZ])(?![\p{L}\p{N}_])/giu, (_, wave) =>
    assign("wave", wave.toUpperCase()),
  );
  // Multiword instrument names are matched first, longest matching phrase wins.
  const words = remaining.trim().split(/\s+/).filter(Boolean);
  const matched: {
    start: number;
    length: number;
    candidates: SearchInstrument[];
  }[] = [];
  for (let start = 0; start < words.length; start++)
    for (let length = words.length - start; length > 0; length--) {
      const phrase = fold(words.slice(start, start + length).join(" "));
      const candidates = instruments.filter(
        (i) =>
          fold(i.ticker) === phrase ||
          fold(i.name) === phrase ||
          fold(i.name).startsWith(phrase + " "),
      );
      if (candidates.length) {
        matched.push({ start, length, candidates });
        start += length - 1;
        break;
      }
    }
  const consumed = new Set<number>();
  for (const match of matched) {
    for (let j = match.start; j < match.start + match.length; j++)
      consumed.add(j);
    if (match.candidates.length === 1)
      assign("stockId", match.candidates[0].id);
    else
      choose(
        `instrument:${match.start}`,
        "Instrument eindeutig auswählen",
        match.candidates.map((i) => ({
          value: String(i.id),
          label: `${i.ticker} · ${i.name}`,
        })),
        (v) => assign("stockId", Number(v)),
      );
  }
  remaining = words.filter((_, i) => !consumed.has(i)).join(" ");
  let meaning: LevelMeaning | undefined;
  consume(
    /\b(endlevel|umkehrzone|zielzone|durchlaufen|erreicht)\b/gi,
    (_, word) => {
      const next: LevelMeaning = (
        {
          endlevel: "end",
          umkehrzone: "reversal",
          zielzone: "target",
          durchlaufen: "passed",
          erreicht: "passed",
        } as const
      )[word.toLowerCase() as "endlevel"];
      if (meaning && meaning !== next)
        conflicts.push("Widersprüchliche Levelbedeutung");
      meaning = next;
    },
  );
  consume(/\b(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*%?/g, (_, a, b) => {
    assign("levelFrom", Number(a));
    assign("levelTo", Number(b));
  });
  for (const token of remaining.split(/\s+/).filter(Boolean)) {
    const t = fold(token),
      numeric = token.replace(/%$/g, "");
    if (/^\d{4}$/.test(token)) {
      assign("from", token);
      assign("to", token);
      assign("timeBasis", "historical");
      continue;
    }
    if (/^\d+(?:\.\d+)?$/.test(numeric)) {
      assign("levelFrom", Number(numeric));
      continue;
    }
    const degree = FIB_DEGREES.find((d) => fold(d) === t && d !== "unbekannt");
    if (degree) {
      assign("degree", degree);
      continue;
    }
    const tf = FIB_TIMEFRAMES.find(
      (f) => f !== "unbekannt" && f.toLowerCase() === token.toLowerCase(),
    );
    if (tf) {
      assign("timeframe", tf);
      continue;
    }
    const structure = STRUCTURES.find(
      ([code, label]) => fold(code) === t || fold(label.split(" · ")[0]) === t,
    );
    if (
      ["abc", "flat", "dreieck", "impuls", "diagonal", "wxy", "wxyxz"].includes(
        t,
      )
    ) {
      assign(
        "structure",
        (
          {
            abc: "family:abc",
            flat: "family:abc_flat",
            dreieck: "family:triangle",
            impuls: "impulse",
            diagonal: "family:diagonal",
            wxy: "wxy",
            wxyxz: "wxyxz",
          } as Record<string, string>
        )[t],
      );
      continue;
    }
    if (structure) {
      assign("structure", structure[0]);
      continue;
    }
    if (
      ["laufend", "abgeschlossen", "unklar", "ungultig", "ungueltig"].includes(
        t,
      )
    ) {
      assign("status", t === "ungultig" ? "ungueltig" : t);
      continue;
    }
    if (RESEARCH_WAVES.includes(token.toUpperCase())) {
      assign("wave", token.toUpperCase());
      continue;
    }
    if (["retracement", "expansion"].includes(t)) {
      assign("measurementKind", t);
      continue;
    }
    unknown.push(token);
  }
  if (filters.wave && !filters.waveLabelScope)
    choose(
      "waveLabelScope",
      "Wellenumfang auswählen",
      [
        { value: "self", label: "Welle selbst" },
        { value: "descendants", label: "Einschließlich Unterwellen" },
      ],
      (v) => assign("waveLabelScope", v),
    );
  if (meaning) assign("levelMeaning", meaning);
  if (filters.levelFrom !== undefined && !filters.levelMeaning)
    choose(
      "levelMeaning",
      "Was bedeutet das Level?",
      Object.entries(levelMeaningLabels).map(([value, label]) => ({
        value,
        label,
      })),
      (v) => assign("levelMeaning", v),
    );
  if (
    filters.levelFrom !== undefined &&
    !RESEARCH_LEVELS.includes(filters.levelFrom)
  )
    conflicts.push("Level liegt außerhalb des festen Fibonacci-Katalogs");
  if (
    filters.levelTo !== undefined &&
    (!RESEARCH_LEVELS.includes(filters.levelTo) ||
      filters.levelFrom === undefined ||
      filters.levelTo < filters.levelFrom)
  )
    conflicts.push("Ungültiger Fibonacci-Bereich");
  if (filters.levelMeaning && filters.levelFrom === undefined)
    conflicts.push("Levelwert fehlt");
  const variantError = waveVariantError(filters.wave, filters.waveVariant);
  if (variantError) conflicts.push(variantError);
  return {
    filters,
    recognized,
    pending,
    unknown,
    conflicts,
    ready:
      !!query.trim() && !pending.length && !unknown.length && !conflicts.length,
  };
}
