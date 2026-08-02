import { classifyField, PLACEHOLDER_DENYLIST } from './fieldKind';

describe('classifyField — absence rule', () => {
  it('omits undefined, null, and empty/whitespace-only values for every kind', () => {
    expect(classifyField('scalar', undefined)).toBeUndefined();
    expect(classifyField('scalar', null)).toBeUndefined();
    expect(classifyField('scalar', '')).toBeUndefined();
    expect(classifyField('scalar', '   ')).toBeUndefined();
    expect(classifyField('phrase', undefined)).toBeUndefined();
    expect(classifyField('prose', undefined)).toBeUndefined();
  });

  it('trims a legitimate value before returning it', () => {
    expect(classifyField('scalar', '  60–90 min  ')).toBe('60–90 min');
  });
});

describe('classifyField — scalar kind', () => {
  it('accepts exactly the spec examples', () => {
    expect(classifyField('scalar', '60–90 min')).toBe('60–90 min');
    expect(classifyField('scalar', 'from €25')).toBe('from €25');
    expect(classifyField('scalar', 'Smart casual')).toBe('Smart casual');
    expect(classifyField('scalar', '2 h 30 min')).toBe('2 h 30 min');
    expect(classifyField('scalar', 'EN, DE')).toBe('EN, DE');
  });

  it('accepts at the 18-char boundary, rejects one over', () => {
    const at18 = 'x'.repeat(18);
    const at19 = 'x'.repeat(19);
    expect(classifyField('scalar', at18)).toBe(at18);
    expect(classifyField('scalar', at19)).toBeUndefined();
  });

  it('accepts at the 4-word boundary, rejects a 5th word', () => {
    expect(classifyField('scalar', 'one two three four')).toBe('one two three four');
    expect(classifyField('scalar', 'one two three four five')).toBeUndefined();
  });

  it('rejects on word count alone, independent of the char-count check', () => {
    // 9 chars — well under the 18-char cap — but 5 words. Only reachable via
    // SCALAR_MAX_WORDS: a removed word-count branch would let this through.
    expect(classifyField('scalar', 'a b c d e')).toBeUndefined();
    expect(classifyField('scalar', 'a b c d')).toBe('a b c d');
  });

  it('rejects a terminal period, exclamation, or question mark', () => {
    expect(classifyField('scalar', 'Not stated.')).toBeUndefined();
    expect(classifyField('scalar', 'Really!')).toBeUndefined();
    expect(classifyField('scalar', 'Open?')).toBeUndefined();
  });

  it('rejects the exact production-bug sentence', () => {
    expect(
      classifyField('scalar', 'Vreme posete nije eksplicitno navedeno.'),
    ).toBeUndefined();
  });
});

describe('classifyField — phrase kind', () => {
  it('accepts at the 80-char boundary, rejects one over', () => {
    const at80 = 'x'.repeat(80);
    const at81 = 'x'.repeat(81);
    expect(classifyField('phrase', at80)).toBe(at80);
    expect(classifyField('phrase', at81)).toBeUndefined();
  });

  // T9 review: real captured Wellness data ("Excellence Massage Belgrade",
  // a live venue) has short, legitimate good_to_know items that naturally
  // end in a period — outright-rejecting any terminal punctuation dropped
  // every one of them, so 0 survivors omitted the whole Good-to-know
  // section. One trailing terminal-punctuation char is now stripped for the
  // length check only; the value that renders still keeps its punctuation.
  it('keeps a short phrase ending in terminal punctuation, punctuation intact', () => {
    const real = 'Gift vouchers for massages are available; they never expire.';
    expect(classifyField('phrase', real)).toBe(real);
    expect(classifyField('phrase', 'Wow!')).toBe('Wow!');
  });

  // The rule's real target — long, multi-clause, sentence-shaped content —
  // still gets omitted: stripping one trailing char isn't enough to bring a
  // genuine sentence under the 80-char cap. Same venue, its own over-length
  // item.
  it('still omits a genuinely long sentence even after stripping trailing punctuation', () => {
    const long =
      "Visitors can come without reservation, but it's advisable to announce 30 minutes in advance.";
    expect(long.length).toBeGreaterThan(81); // sanity: over cap even stripped
    expect(classifyField('phrase', long)).toBeUndefined();
  });

  it('measures after stripping: accepts at 80 stripped chars + punctuation, rejects at 81', () => {
    const at80Stripped = `${'x'.repeat(80)}.`;
    const at81Stripped = `${'x'.repeat(81)}.`;
    expect(classifyField('phrase', at80Stripped)).toBe(at80Stripped);
    expect(classifyField('phrase', at81Stripped)).toBeUndefined();
  });

  it('has no word-count limit (unlike scalar)', () => {
    const words = new Array(10).fill('go').join(' '); // 29 chars, well within 80
    expect(classifyField('phrase', words)).toBe(words);
  });

  // T9 round-3 fix: the trailing-strip above leaves a punctuation-only value
  // measuring as empty; the denylist can't catch it (nothing normalizes to
  // "") and the length check alone doesn't reject an empty string, so
  // without this it would survive as a checklist bullet with no content.
  it('omits a punctuation-only value once stripped to nothing', () => {
    expect(classifyField('phrase', '.')).toBeUndefined();
    expect(classifyField('phrase', '...')).toBeUndefined();
    expect(classifyField('phrase', '!')).toBeUndefined();
  });
});

describe('classifyField — prose kind', () => {
  it('has no length-based rejection — over-length prose still passes through (UI clamps it)', () => {
    const long = 'x'.repeat(500);
    expect(classifyField('prose', long)).toBe(long);
  });

  it('allows terminal punctuation and multiple sentences', () => {
    const text = 'A full sentence. With more than one clause!';
    expect(classifyField('prose', text)).toBe(text);
  });
});

describe('classifyField — denylist, both languages, all kinds', () => {
  it.each(PLACEHOLDER_DENYLIST)('omits denylisted value "%s"', (entry) => {
    expect(classifyField('scalar', entry)).toBeUndefined();
    expect(classifyField('phrase', entry)).toBeUndefined();
    expect(classifyField('prose', entry)).toBeUndefined();
  });

  it('matches case-insensitively', () => {
    expect(classifyField('scalar', 'NOT SPECIFIED')).toBeUndefined();
    expect(classifyField('scalar', 'Nije Navedeno')).toBeUndefined();
  });

  it('matches across extra/leading/trailing whitespace', () => {
    expect(classifyField('scalar', '  not   specified  ')).toBeUndefined();
    expect(classifyField('scalar', '   n/a   ')).toBeUndefined();
  });

  it('matches with trailing punctuation', () => {
    expect(classifyField('scalar', 'Not specified.')).toBeUndefined();
    expect(classifyField('scalar', 'Unknown!')).toBeUndefined();
    expect(classifyField('scalar', 'Nepoznato.')).toBeUndefined();
  });

  it('logs a denylist hit instead of silently dropping it', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // A denylisted value + exact-casing combo untouched by every earlier
    // assertion in this file — the dedupe Set below is module-level
    // (persists for the whole test file), so re-using an already-warned
    // string here would silently skip the warn and give a false pass.
    classifyField('scalar', 'UNSPECIFIED');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[fieldKind]'));
    warnSpy.mockRestore();
  });

  it('does not log for a legitimate value', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    classifyField('scalar', '60–90 min');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // T4 resolve-round note: classifyField now runs per field per render (every
  // slot wires it in) — dedupe the warn per distinct value so a leaked field
  // logs once per session, not once per re-render.
  it('logs a denylisted value only once, even when classified repeatedly', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // Another casing combo untouched by every earlier assertion — see the
    // module-persistence note above.
    classifyField('scalar', 'Nema Podataka');
    classifyField('scalar', 'Nema Podataka');
    classifyField('scalar', 'Nema Podataka');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});


// T11: denylist parity between this file and the backend's
// `backend/shared/contentkind/contentkind.go` (`denylist` var) — the two are
// hand-copied independently (different language/repo) from the same spec
// text, per this file's own header comment. This test owns the parity
// check (engineer's choice, per product-tasks.md's T11 — could equally live
// Go-side): it hardcodes the Go list inline and asserts set equality against
// `PLACEHOLDER_DENYLIST`, so an edit to either list without updating the
// other fails here rather than silently drifting.
describe('denylist parity with backend/shared/contentkind', () => {
  it('matches contentkind.go\'s denylist var exactly (same set, either order)', () => {
    // keep in sync with backend/shared/contentkind/contentkind.go's `denylist` var
    const goDenylist = [
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
    expect(new Set(PLACEHOLDER_DENYLIST)).toEqual(new Set(goDenylist));
    expect(PLACEHOLDER_DENYLIST).toHaveLength(goDenylist.length);
  });
});
