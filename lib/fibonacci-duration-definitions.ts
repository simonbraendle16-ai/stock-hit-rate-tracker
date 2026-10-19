/** Versioned measurement meanings; a legacy "reversal" never implies these endpoints. */
export const ZONE_TO_PIVOT = "first_entry_to_pivot" as const;
export const CALENDAR_TIME_NOTE = "Kalenderzeit einschließlich Nächten, Wochenenden und Feiertagen.";
export const durationDefinitions = {
  reversal: {
    convention: ZONE_TO_PIVOT,
    label: "Zielzonenkontakt bis Wellenwendepunkt",
    description: "Vom ersten Kontakt mit der dokumentierten Zielzone bis zum rückblickend bestimmten Ende der untersuchten Welle und Beginn der Folgewelle. Nicht bis zur späteren Bestätigung der Trendwende. Zwischenzeitliche Austritte unterbrechen diese Zeitspanne nicht.",
  },
  residence: {
    label: "Verweildauer in der Zielzone",
    description: "Zeit innerhalb der dokumentierten Zielzone: erster Aufenthalt vom ersten Kontakt bis zum ersten Austritt oder Summe aller Aufenthalte. Die Austrittsrichtung ist beliebig; Zeiten außerhalb der Zone zählen nicht mit. Die Messweise wird ausdrücklich ausgewählt.",
  },
} as const;
