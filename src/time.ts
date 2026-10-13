const jerusalem = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Jerusalem",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? "00";
}

/** Format an instant as an Israel-local `YYYY-MM-DD HH:MM:SS` wall clock. */
export function formatJerusalem(date: Date): string {
  const parts = jerusalem.formatToParts(date);
  const hour = part(parts, "hour") === "24" ? "00" : part(parts, "hour");
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")} ${hour}:${part(parts, "minute")}:${part(parts, "second")}`;
}

function wallClockAsUtc(instantMs: number): number {
  const parts = jerusalem.formatToParts(new Date(instantMs));
  let hour = Number(part(parts, "hour"));
  if (hour === 24) hour = 0;
  return Date.UTC(
    Number(part(parts, "year")),
    Number(part(parts, "month")) - 1,
    Number(part(parts, "day")),
    hour,
    Number(part(parts, "minute")),
    Number(part(parts, "second")),
  );
}

/**
 * Parse a Pikud HaOref timestamp. Those strings are Israel local time and do
 * not carry an offset. Returns null when the text is not a recognized shape.
 */
export function parseJerusalem(input: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // instant = wallClockAsUtc - offset(instant). Repeat once so a DST boundary
  // uses the offset of the corrected instant rather than the first guess.
  const first = localAsUtc - (wallClockAsUtc(localAsUtc) - localAsUtc);
  const corrected = localAsUtc - (wallClockAsUtc(first) - first);
  return new Date(corrected);
}
