import { describe, it, expect } from 'vitest';
import { encodeFacetKey, decodeFacetKey } from '../src/query/facet-key';
import { createBundle } from '../src';

describe('facet-key codec', () => {
  it('encode is String()', () => {
    expect(encodeFacetKey('open')).toBe('open');
    expect(encodeFacetKey(42)).toBe('42');
    expect(encodeFacetKey(true)).toBe('true');
    expect(encodeFacetKey(false)).toBe('false');
  });

  it('decode inverts encode for string/number/boolean', () => {
    expect(decodeFacetKey('string', encodeFacetKey('open'))).toBe('open');
    expect(decodeFacetKey('number', encodeFacetKey(42))).toBe(42);
    expect(decodeFacetKey('number', encodeFacetKey(3.5))).toBe(3.5);
    expect(decodeFacetKey('boolean', encodeFacetKey(true))).toBe(true);
    expect(decodeFacetKey('boolean', encodeFacetKey(false))).toBe(false);
  });

  it('decode inverts encode for epoch-number date facets (the regression)', () => {
    const epoch = Date.parse('2025-11-22T00:00:00.000Z');
    // Previously String(epoch) -> Date.parse(numeric string) -> NaN -> raw string.
    expect(decodeFacetKey('date', encodeFacetKey(epoch))).toBe(epoch);
  });

  it('decode still parses ISO-string date keys', () => {
    const iso = '2025-11-22T00:00:00.000Z';
    expect(decodeFacetKey('date', iso)).toBe(Date.parse(iso));
  });

  it('decode passes through an unparseable date key', () => {
    expect(decodeFacetKey('date', 'not-a-date')).toBe('not-a-date');
  });
});

describe('getFacetSummary on a date-typed facet', () => {
  it('reports numeric epoch values, sorted ascending', async () => {
    const t1 = Date.parse('2025-01-01T00:00:00.000Z');
    const t2 = Date.parse('2025-06-01T00:00:00.000Z');
    const bundle = await createBundle(
      [
        { id: 'a', when: t2 },
        { id: 'b', when: t1 },
        { id: 'c', when: t1 },
      ],
      {
        datasetId: 'dates',
        fields: {
          id: { kind: 'id', type: 'string' },
          when: { kind: 'facet', type: 'date' },
        },
      },
    );

    const summary = bundle.getFacetSummary('when');
    expect(summary.values).toEqual([
      { value: t1, count: 2 },
      { value: t2, count: 1 },
    ]);
    // Values are numbers, not the raw stringified keys.
    expect(typeof summary.values[0].value).toBe('number');
  });
});
