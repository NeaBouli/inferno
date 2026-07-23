jest.mock('../src/services/sessionService', () => ({ prisma: {} }));

import {
  assertCanonicalBusinessSlug,
  BusinessSlugError,
  normalizeBusinessSlug,
  publicBusinessReference,
  suggestBusinessSlug,
} from '../src/services/businessSlug';

describe('business slug policy', () => {
  it('normalizes public seller names without producing reserved fallbacks', () => {
    expect(normalizeBusinessSlug(' Café & More! ')).toBe('cafe-and-more');
    expect(normalizeBusinessSlug('IFR___Partner---Athens')).toBe('ifr-partner-athens');
    expect(suggestBusinessSlug('AB')).toBe('ifr-ab');
    expect(suggestBusinessSlug('')).toBe('ifr-partner');
  });

  it('accepts only canonical non-reserved seller URLs', () => {
    expect(assertCanonicalBusinessSlug('athens-ifr-cafe')).toBe('athens-ifr-cafe');
    for (const invalid of [
      'Athens-IFR-Cafe',
      'athens--ifr',
      '-athens-ifr',
      'shop',
      `c${'a'.repeat(24)}`,
    ]) {
      expect(() => assertCanonicalBusinessSlug(invalid)).toThrow(BusinessSlugError);
    }
  });

  it('prefers a permanent slug while keeping legacy IDs compatible', () => {
    expect(publicBusinessReference({ id: 'legacy-id', slug: 'athens-ifr-cafe' }))
      .toBe('athens-ifr-cafe');
    expect(publicBusinessReference({ id: 'legacy-id', slug: null })).toBe('legacy-id');
  });
});
