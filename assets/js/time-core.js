// Unix timestamps arrive as either seconds or milliseconds, and magnitude alone
// cannot separate them for older dates: 31536000000 is 1971 in milliseconds but
// 2969 in seconds, and 946684800000 is 2000 in milliseconds but year 31969 in
// seconds. So a value is read as seconds when that reading lands inside the
// range this archive can plausibly hold, and as milliseconds when only that
// reading does. A value that fits neither is still returned as a date, so the
// caller's range check can report it; clearly millisecond magnitudes keep the
// millisecond reading, so far-future dates still convert.

const PLAUSIBLE_START = Date.UTC(1900, 0, 1);
const PLAUSIBLE_END = Date.UTC(2100, 0, 1);
const MILLISECOND_MAGNITUDE = 1e11;

export function unixTimestampDate(value) {
  if (value === null || value === undefined) return new Date(NaN);
  if (typeof value === 'string' && !value.trim()) return new Date(NaN);
  const n = Number(value);
  if (!Number.isFinite(n)) return new Date(NaN);
  const asSeconds = new Date(n * 1000);
  const asMilliseconds = new Date(n);
  const plausible = date => !Number.isNaN(date.getTime())
    && date.getTime() >= PLAUSIBLE_START
    && date.getTime() <= PLAUSIBLE_END;
  if (plausible(asSeconds)) return asSeconds;
  if (plausible(asMilliseconds)) return asMilliseconds;
  return Math.abs(n) >= MILLISECOND_MAGNITUDE ? asMilliseconds : asSeconds;
}
