import { formatJerusalem } from "./time.js";

export const MOCK_STEP_COUNT = 4;

const AREAS = ["תל אביב - מרכז העיר", "רמת גן - מערב"];

export interface MockPayloads {
  step: number;
  cycle: number;
  /** Null means an empty body, which the live feed uses when nothing is sounding. */
  live: unknown | null;
  history: unknown;
}

/** One scripted incident: pre-alert, active missiles, then all-clear. Times are Israel-local. */
export function buildMockPayloads(step: number, cycle: number): MockPayloads {
  const wrapped = ((step % MOCK_STEP_COUNT) + MOCK_STEP_COUNT) % MOCK_STEP_COUNT;
  const base = Date.UTC(2026, 0, 1, 0, 0, 0) + cycle * 3_600_000;
  const preTime = formatJerusalem(new Date(base));
  const activeTime = formatJerusalem(new Date(base + 120_000));
  const clearTime = formatJerusalem(new Date(base + 720_000));

  const preHistory = AREAS.map((area) => ({
    alertDate: preTime,
    title: "בדקות הקרובות צפויות להתקבל התרעות באזורך",
    data: area,
    category: 14,
  }));
  const activeHistory = AREAS.map((area) => ({
    alertDate: activeTime,
    title: "ירי רקטות וטילים",
    data: area,
    category: 1,
  }));
  const clearHistory = AREAS.map((area) => ({
    alertDate: clearTime,
    title: "ירי רקטות וטילים - האירוע הסתיים",
    data: area,
    category: 13,
  }));

  if (wrapped === 0) return { step: wrapped, cycle, live: null, history: [] };
  if (wrapped === 1) {
    return {
      step: wrapped,
      cycle,
      live: {
        id: `mock-${cycle}-pre`,
        cat: "10",
        title: "בדקות הקרובות צפויות להתקבל התרעות באזורך",
        data: AREAS,
        desc: "",
        alertDate: preTime,
      },
      history: preHistory,
    };
  }
  if (wrapped === 2) {
    return {
      step: wrapped,
      cycle,
      live: [
        {
          id: `mock-${cycle}-active`,
          cat: "1",
          title: "ירי רקטות וטילים",
          data: AREAS,
          desc: "היכנסו למרחב המוגן",
          alertDate: activeTime,
        },
      ],
      history: [...preHistory, ...activeHistory],
    };
  }
  return {
    step: wrapped,
    cycle,
    live: null,
    history: [...preHistory, ...activeHistory, ...clearHistory],
  };
}

export function encodePayload(value: unknown | null): Uint8Array {
  if (value == null) return new Uint8Array();
  return new TextEncoder().encode(JSON.stringify(value));
}
