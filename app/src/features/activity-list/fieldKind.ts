// docs/superpowers/specs/2026-08-02-activity-detail-system-design.md
// "The data contract" + "Placeholder denylist" sections are the source of
// truth for everything below — copied verbatim, not paraphrased. The
// backend half of this same contract lives in
// `backend/shared/contentkind/` (different language/repo, hand-copied
// independently — T11 adds a parity test asserting the two lists stay
// textually identical). If you touch the denylist or the kind limits here,
// update that package too.

export type FieldKind = 'scalar' | 'phrase' | 'prose';

// Verbatim from the spec's "Placeholder denylist" section. Extended per
// supported language as languages are added — keep in sync with
// `backend/shared/contentkind`.
export const PLACEHOLDER_DENYLIST: string[] = [
  'not specified',
  'unspecified',
  'not available',
  'n/a',
  'na',
  'unknown',
  'none',
  '--',
  '-',
  'nije navedeno',
  'nije poznato',
  'nema podataka',
  'nepoznato',
];

// Case-insensitive, whitespace- and (trailing-)punctuation-normalized —
// matches the backend's normalization so the same denylisted phrase is
// caught under either casing/spacing/trailing-punctuation variant.
function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/, '')
    .trim();
}

export function matchesDenylist(value: string): boolean {
  const normalized = normalize(value);
  return PLACEHOLDER_DENYLIST.some((entry) => normalize(entry) === normalized);
}

const SCALAR_MAX_CHARS = 18;
const SCALAR_MAX_WORDS = 4;
const PHRASE_MAX_CHARS = 80;
const TERMINAL_PUNCTUATION = /[.!?]$/;

// The spec's Absence rule: undefined when the value is empty, denylisted,
// or fails its kind's limits. Never relocated, never placeheld — the caller
// simply omits the slot. `prose` gets absence checks only (no length
// rejection): over-length prose clamps in the UI instead of being omitted.
export function classifyField(
  kind: FieldKind,
  raw: string | undefined | null,
): string | undefined {
  if (raw == null) return undefined;
  const value = raw.trim();
  if (value === '') return undefined;

  if (matchesDenylist(value)) {
    // ponytail: plain console.warn — no logging convention exists in
    // app/src today (grepped first). Greppable prefix per spec: "a denylist
    // hit is logged, not silently dropped, so a backend regression stays
    // visible."
    console.warn(`[fieldKind] denylisted value omitted: "${value}"`);
    return undefined;
  }

  switch (kind) {
    case 'scalar': {
      if (value.length > SCALAR_MAX_CHARS) return undefined;
      if (value.split(/\s+/).length > SCALAR_MAX_WORDS) return undefined;
      if (TERMINAL_PUNCTUATION.test(value)) return undefined;
      return value;
    }
    case 'phrase': {
      if (value.length > PHRASE_MAX_CHARS) return undefined;
      if (TERMINAL_PUNCTUATION.test(value)) return undefined;
      return value;
    }
    case 'prose':
      return value;
  }
}
