// A wall clock in a locality's IANA zone. Reject gaps and overlaps instead of
// silently choosing an offset (deployment, manual scheduled tasks, EMR-54).
export function wallTime(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (name: string) => parts.find((part) => part.type === name)?.value;
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

export function taskInstant(wall: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) return null;
  const nominal = new Date(`${wall}:00Z`);
  if (!Number.isFinite(nominal.getTime()) || nominal.toISOString().slice(0, 16) !== wall)
    return null;
  // Sample both sides of any offset transition around this calendar date.
  const offsets = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 6) {
    const sample = new Date(nominal.getTime() + hour * 3_600_000);
    offsets.add(new Date(`${wallTime(sample, timeZone)}:00Z`).getTime() - sample.getTime());
  }
  const matches = [...offsets]
    .map((offset) => new Date(nominal.getTime() - offset))
    .filter((candidate) => wallTime(candidate, timeZone) === wall);
  return matches.length === 1 ? matches[0]! : null;
}
