export function getBusinessDate(timezone?: string | null, now: Date = new Date()): Date {
  const resolvedTimezone = timezone || process.env.TOKEN_TIME_ZONE || 'UTC';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvedTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const localDateString = formatter.format(now);
  return new Date(`${localDateString}T00:00:00.000Z`);
}
