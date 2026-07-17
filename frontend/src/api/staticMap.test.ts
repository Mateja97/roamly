import { describe, expect, it } from 'vitest';
import { hasValidCoordinates, staticMapUrl } from './staticMap';

describe('hasValidCoordinates', () => {
  it('is false for undefined', () => {
    expect(hasValidCoordinates(undefined)).toBe(false);
  });

  it('is false for null island (0,0) — the missing-coordinates sentinel', () => {
    expect(hasValidCoordinates({ lat: 0, lng: 0 })).toBe(false);
  });

  it('is true for a real coordinate pair', () => {
    expect(hasValidCoordinates({ lat: 44.8, lng: 20.46 })).toBe(true);
  });
});

describe('staticMapUrl', () => {
  it('centers on the location and sizes the requested box', () => {
    const url = staticMapUrl({ lat: 44.8, lng: 20.46 }, 400, 130);
    expect(url).toContain('center=44.8%2C20.46');
    expect(url).toContain('size=400x130');
  });
});
