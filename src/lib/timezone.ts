// A datetime-local input is a wall time, not an instant. Match it against the
// event timezone, rejecting DST gaps and ambiguous repeated wall times.
export function admissionToIso(wallTime: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wallTime);
  if (!match) throw new Error('Enter a valid admission date and time.');
  const [, year, month, day, hour, minute] = match.map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const candidates = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 6) {
    const sample = target + delta * 3600000;
    const parts = Object.fromEntries(formatter.formatToParts(sample).map(p => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    const candidate = target - (asUtc - sample);
    const actual = Object.fromEntries(formatter.formatToParts(candidate).map(p => [p.type, p.value]));
    if (`${actual.year}-${actual.month}-${actual.day}T${actual.hour}:${actual.minute}` === wallTime) candidates.add(candidate);
  }
  if (candidates.size === 0) throw new Error('This time does not exist in the event timezone (daylight-saving change).');
  if (candidates.size > 1) throw new Error('This time is ambiguous during a daylight-saving change. Use an unambiguous time.');
  const instant = [...candidates][0];
  if (instant > Date.now()) throw new Error('Admission time cannot be in the future.');
  return new Date(instant).toISOString();
}
