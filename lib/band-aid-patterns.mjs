export const BAND_AID_PATTERNS = [
  { pattern: /\bas\s+any\b/, name: 'as any', severity: 'high' },
  { pattern: /\bas\s+unknown\s+as\b/, name: 'as unknown as', severity: 'high' },
  { pattern: /@ts-ignore/, name: '@ts-ignore', severity: 'high' },
  { pattern: /@ts-expect-error/, name: '@ts-expect-error', severity: 'medium' },
  { pattern: /\w+!\s*[^!=]/, name: 'non-null assertion', severity: 'medium' },
  { pattern: /\/\/\s*eslint-disable/, name: 'eslint-disable', severity: 'medium' },
  { pattern: /\/\*\s*eslint-disable/, name: 'eslint-disable block', severity: 'medium' },
  { pattern: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/, name: 'empty catch', severity: 'high' },
  { pattern: /catch\s*\{\s*\}/, name: 'empty catch', severity: 'high' },
  { pattern: /\/\/\s*(TODO|FIXME|HACK)\b/, name: 'TODO/FIXME/HACK', severity: 'low' },
];

export const POW_IGNORE = /\/\/\s*pow-ignore:/;

export function scanForBandAids(content) {
  const lines = content.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (POW_IGNORE.test(line)) continue;
    for (const { pattern, name, severity } of BAND_AID_PATTERNS) {
      if (pattern.test(line)) {
        hits.push({ line: i + 1, pattern: name, severity, text: line.trim() });
      }
    }
  }
  return hits;
}
