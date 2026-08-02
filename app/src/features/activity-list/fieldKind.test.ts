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

  it('rejects a terminal period, exclamation, or question mark', () => {
    expect(classifyField('phrase', 'Bring your own water.')).toBeUndefined();
    expect(classifyField('phrase', 'Wow!')).toBeUndefined();
  });

  it('has no word-count limit (unlike scalar)', () => {
    const words = new Array(10).fill('go').join(' '); // 29 chars, well within 80
    expect(classifyField('phrase', words)).toBe(words);
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
    classifyField('scalar', 'not specified');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[fieldKind]'));
    warnSpy.mockRestore();
  });

  it('does not log for a legitimate value', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    classifyField('scalar', '60–90 min');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

