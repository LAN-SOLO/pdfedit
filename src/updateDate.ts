/** Parses the release date the updater reports. Rust hands over the `time`
 *  crate's Display form ("2026-10-19 12:00:00.0 +00:00:00"), which
 *  `new Date()` can't read; RFC 3339 is accepted as well. Null when the
 *  value can't be understood. */
export function parseUpdateDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?\s*(Z|[+-]\d{2}(?::?\d{2})?(?::\d{2})?)?$/.exec(s);
  if (m) {
    let zone = m[4] ?? 'Z';
    if (zone !== 'Z') {
      const z = /^([+-]\d{2}):?(\d{2})?/.exec(zone)!;
      zone = `${z[1]}:${z[2] ?? '00'}`;
    }
    const ms = m[3] ? m[3].slice(0, 4).padEnd(4, '0') : '';
    const d = new Date(`${m[1]}T${m[2]}${ms}${zone}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
