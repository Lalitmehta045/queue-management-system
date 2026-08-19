export function getBusinessDate(timezone: string, now: Date = new Date()): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const localDateString = formatter.format(now);
  return new Date(`${localDateString}T00:00:00.000Z`);
}
