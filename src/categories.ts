import type { Category, ClassificationBasis, FeedNamespace, MessagePhase } from "./types.js";

/**
 * Category codes are not one list.
 *
 * The live `alerts.json` field `cat` and the history field `category` use
 * different numbers. The tables below follow code that parses those feeds:
 *
 * - Live codes: eladnava/pikud-haoref-api `getAlertTypeByCategory`
 *   (lib/alerts.js, commit e40da77) and the real-time map in
 *   amitfin/oref_alert `categories.py`.
 * - History codes: `getAlertTypeByHistoricalCategory` in the same file, and
 *   amitfin's comments on https://www.oref.org.il/alerts/alertCategories.json
 *   (that file returned HTTP 403 here, so its body was not re-fetched).
 *
 * Where those sources disagree, `disputed` is set and the README table says so.
 * Hebrew titles override the number for pre-alerts and all-clears, because the
 * live code 10 is documented as a shared "news" channel and history codes 13
 * and 14 are the end / advance-notice channels.
 */

export interface ClassifiedMessage {
  category: Category;
  phase: MessagePhase;
  relatedCategory: Category | null;
  drill: boolean;
  disputed: boolean;
  basis: ClassificationBasis;
}

interface NumericClass {
  category: Category;
  phase: MessagePhase;
  disputed: boolean;
  relatedCategory?: Category | null;
}

const ALL_CLEAR_PHRASES = ["האירוע הסתיים", "ניתן לצאת מהמרחב המוגן"];
const PRE_ALERT_PHRASES = [
  "בדקות הקרובות צפויות להתקבל התרעות",
  "הנחיה מקדימה",
  "התרעה מוקדמת",
];

const THREAT_PHRASES: ReadonlyArray<{ phrase: string; category: Category }> = [
  { phrase: "ירי רקטות וטילים", category: "missiles" },
  { phrase: "ירי טילים ורקטות", category: "missiles" },
  { phrase: "חדירת כלי טיס עוין", category: "aircraft" },
  { phrase: "כלי טיס עוין", category: "aircraft" },
  { phrase: "רעידת אדמה", category: "earthquake" },
  { phrase: "צונאמי", category: "tsunami" },
  { phrase: "חומרים מסוכנים", category: "hazardous-materials" },
  { phrase: "חדירת מחבלים", category: "terrorist-infiltration" },
  { phrase: "רדיולוגי", category: "radiological" },
  { phrase: "בלתי קונבנציונלי", category: "nonconventional" },
];

/** Longer phrases first so a title that contains a shorter one still matches. */
const TITLE_ENGLISH: ReadonlyArray<[string, string]> = [
  ["ירי רקטות וטילים - האירוע הסתיים", "Rocket and missile fire — the event has ended"],
  ["ירי טילים ורקטות - האירוע הסתיים", "Rocket and missile fire — the event has ended"],
  ["חדירת כלי טיס עוין - האירוע הסתיים", "Hostile aircraft intrusion — the event has ended"],
  ["ירי רקטות וטילים", "Rocket and missile fire"],
  ["ירי טילים ורקטות", "Rocket and missile fire"],
  ["חדירת כלי טיס עוין", "Hostile aircraft intrusion"],
  ["ניתן לצאת מהמרחב המוגן", "You may leave the protected space"],
  ["האירוע הסתיים", "The event has ended"],
  ["בדקות הקרובות צפויות להתקבל התרעות באזורך", "Alerts are expected in your area in the coming minutes"],
  ["בדקות הקרובות צפויות להתקבל התרעות באיזורים הבאים", "Alerts are expected in the following areas in the coming minutes"],
  ["הנחיה מקדימה", "Advance notice"],
  ["רעידת אדמה", "Earthquake"],
  ["חדירת מחבלים", "Terrorist infiltration"],
];

const INSTRUCTION_ENGLISH: Record<string, string> = {
  "היכנסו למרחב המוגן": "Enter the protected space",
  "היכנסו למרחב המוגן ושהו בו 10 דקות": "Enter the protected space and stay there for 10 minutes",
};

const LIVE: Record<number, NumericClass> = {
  1: { category: "missiles", phase: "active", disputed: false },
  // eladnava: general. homebridge-redalert: nonconventional. Not in amitfin's real-time map.
  2: { category: "general", phase: "active", disputed: true },
  3: { category: "earthquake", phase: "active", disputed: false },
  4: { category: "radiological", phase: "active", disputed: false },
  5: { category: "tsunami", phase: "active", disputed: false },
  6: { category: "aircraft", phase: "active", disputed: false },
  7: { category: "hazardous-materials", phase: "active", disputed: false },
  // Shared info channel. Title decides pre-alert vs all-clear; the number alone does not.
  10: { category: "informational", phase: "none", disputed: false },
  13: { category: "terrorist-infiltration", phase: "active", disputed: false },
};

const HISTORY: Record<number, NumericClass> = {
  1: { category: "missiles", phase: "active", disputed: false },
  2: { category: "aircraft", phase: "active", disputed: false },
  // amitfin slug nonconventional; eladnava collapses this to general.
  3: { category: "nonconventional", phase: "active", disputed: true },
  4: { category: "informational", phase: "none", disputed: true },
  5: { category: "informational", phase: "none", disputed: true },
  6: { category: "informational", phase: "none", disputed: true },
  7: { category: "earthquake", phase: "active", disputed: false },
  8: { category: "earthquake", phase: "active", disputed: false },
  // eladnava: radiologicalEvent. amitfin slug: cbrne. Real-time radiological maps here.
  9: { category: "radiological", phase: "active", disputed: true },
  10: { category: "terrorist-infiltration", phase: "active", disputed: false },
  11: { category: "tsunami", phase: "active", disputed: false },
  12: { category: "hazardous-materials", phase: "active", disputed: false },
  13: { category: "all-clear", phase: "ended", disputed: false },
  14: { category: "pre-alert", phase: "pre-alert", disputed: false },
};

const HISTORY_DRILL_RELATED: Record<number, Category> = {
  15: "missiles",
  16: "aircraft",
  21: "earthquake",
  22: "earthquake",
  23: "radiological",
  24: "terrorist-infiltration",
  25: "tsunami",
  26: "hazardous-materials",
};

function threatInTitle(title: string): Category | null {
  return THREAT_PHRASES.find((item) => title.includes(item.phrase))?.category ?? null;
}

function fromLive(code: number): ClassifiedMessage | null {
  if (code >= 100 && code < 200) {
    const base = LIVE[code - 100];
    return {
      category: "drill",
      phase: "active",
      relatedCategory: base?.category && base.category !== "informational" ? base.category : null,
      drill: true,
      disputed: false,
      basis: "live-cat",
    };
  }
  const known = LIVE[code];
  if (!known) return null;
  return {
    category: known.category,
    phase: known.phase,
    relatedCategory: null,
    drill: false,
    disputed: known.disputed,
    basis: "live-cat",
  };
}

function fromHistory(code: number): ClassifiedMessage | null {
  if (code >= 15 && code <= 28) {
    return {
      category: "drill",
      phase: "active",
      relatedCategory: HISTORY_DRILL_RELATED[code] ?? null,
      drill: true,
      disputed: false,
      basis: "history-category",
    };
  }
  const known = HISTORY[code];
  if (!known) return null;
  return {
    category: known.category,
    phase: known.phase,
    relatedCategory: null,
    drill: false,
    disputed: known.disputed,
    basis: "history-category",
  };
}

export function classifyMessage(
  title: string,
  namespace: FeedNamespace,
  code: number | null,
): ClassifiedMessage {
  const text = title.trim();
  const threat = text ? threatInTitle(text) : null;
  const allClear = ALL_CLEAR_PHRASES.some((phrase) => text.includes(phrase));
  const preAlert = PRE_ALERT_PHRASES.some((phrase) => text.includes(phrase));

  if (allClear) {
    return {
      category: "all-clear",
      phase: "ended",
      relatedCategory: threat,
      drill: false,
      disputed: false,
      basis: "title",
    };
  }
  if (preAlert) {
    return {
      category: "pre-alert",
      phase: "pre-alert",
      relatedCategory: threat,
      drill: false,
      disputed: false,
      basis: "title",
    };
  }

  const numeric = code == null ? null : namespace === "live" ? fromLive(code) : fromHistory(code);
  if (numeric?.drill) {
    return {
      ...numeric,
      relatedCategory: threat ?? numeric.relatedCategory,
    };
  }
  if (threat && numeric && numeric.category !== threat) {
    return {
      category: threat,
      phase: "active",
      relatedCategory: null,
      drill: false,
      disputed: true,
      basis: "title",
    };
  }
  if (threat) {
    return {
      category: threat,
      phase: "active",
      relatedCategory: null,
      drill: false,
      disputed: numeric?.disputed ?? false,
      basis: numeric ? "title-and-code" : "title",
    };
  }
  if (numeric) return numeric;
  return {
    category: "unknown",
    phase: "none",
    relatedCategory: null,
    drill: false,
    disputed: false,
    basis: "title",
  };
}

export function englishTitle(title: string): string | null {
  const text = title.trim();
  if (!text) return null;
  return TITLE_ENGLISH.find(([phrase]) => text.includes(phrase))?.[1] ?? null;
}

export function englishInstructions(instructions: string): string | null {
  const text = instructions.trim();
  if (!text) return null;
  return INSTRUCTION_ENGLISH[text] ?? null;
}

export function parseCategoryCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}
