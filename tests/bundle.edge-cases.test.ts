import { describe, it, expect } from 'vitest';
import { LyraBundle, type CreateBundleConfig } from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';
import { testConfig } from './test-config';


describe('LyraBundle - Edge Cases and Weird Data', () => {
  const config = testConfig;


  // String Edge Cases
  // ==============================

  it('handles empty strings in facets', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], status: '' },
      { ...generateTicketArray(1)[0], status: 'open' },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({ equal: { status: '' } });
    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe('');
  });


  it('handles very long strings in facets', async () => {
    const longString = 'a'.repeat(2000);
    const tickets = [
      { ...generateTicketArray(1)[0], status: longString },
      { ...generateTicketArray(1)[0], status: 'normal' },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({ equal: { status: longString } });
    expect(result.total).toBe(1);
    expect(result.items[0]?.status).toBe(longString);
  });


  it('handles special characters in facet values', async () => {
    const specialValues = [
      'unicode-测试-🎉',
      'newline\n\ttab',
      'emoji-🚀-💯',
      'quotes-"hello"-world',
      "apostrophe's",
    ];
    const tickets = specialValues.map((value) => ({
      ...generateTicketArray(1)[0],
      status: value,
    }));
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    for (const value of specialValues) {
      const result = bundle.query({ equal: { status: value } });
      expect(result.total).toBe(1);
      expect(result.items[0]?.status).toBe(value);
    }
  });


  it('handles whitespace-only strings', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], status: '   ' },
      { ...generateTicketArray(1)[0], status: '\t\n' },
      { ...generateTicketArray(1)[0], status: 'normal' },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const spaceResult = bundle.query({ equal: { status: '   ' } });
    expect(spaceResult.total).toBe(1);

    const tabResult = bundle.query({ equal: { status: '\t\n' } });
    expect(tabResult.total).toBe(1);
  });


  // Type Coercion
  // ==============================

  it('distinguishes numbers as strings from actual numbers', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], status: '123' },
      { ...generateTicketArray(1)[0], status: 123 as any },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // String '123' should match string '123'
    const stringResult = bundle.query({ equal: { status: '123' } });
    expect(stringResult.total).toBe(2); // Both convert to string '123'

    // Number 123 should also match (converted to string)
    const numberResult = bundle.query({ equal: { status: 123 as any } });
    expect(numberResult.total).toBe(2);
  });


  it('handles boolean values in facets', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], status: true as any },
      { ...generateTicketArray(1)[0], status: false as any },
      { ...generateTicketArray(1)[0], status: 'true' },
      { ...generateTicketArray(1)[0], status: 'false' },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Boolean true should convert to string 'true'
    const trueResult = bundle.query({ equal: { status: true as any } });
    expect(trueResult.total).toBe(2); // true and 'true'

    const falseResult = bundle.query({ equal: { status: false as any } });
    expect(falseResult.total).toBe(2); // false and 'false'
  });


  it('handles string literals "null", "undefined", "true", "false"', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], status: 'null' },
      { ...generateTicketArray(1)[0], status: 'undefined' },
      { ...generateTicketArray(1)[0], status: 'true' },
      { ...generateTicketArray(1)[0], status: 'false' },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    expect(bundle.query({ equal: { status: 'null' } }).total).toBe(1);
    expect(bundle.query({ equal: { status: 'undefined' } }).total).toBe(1);
    expect(bundle.query({ equal: { status: 'true' } }).total).toBe(1);
    expect(bundle.query({ equal: { status: 'false' } }).total).toBe(1);
  });


  // Range Edge Cases
  // ==============================

  it('handles invalid ranges with min > max', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // min > max should return empty result
    const result = bundle.query({
      ranges: { slaHours: { min: 100, max: 10 } },
    });

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
  });


  it('handles range with min only', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], slaHours: 5 },
      { ...generateTicketArray(1)[0], slaHours: 15 },
      { ...generateTicketArray(1)[0], slaHours: 25 },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({ ranges: { slaHours: { min: 10 } } });

    expect(result.total).toBe(2); // 15 and 25
    for (const item of result.items) {
      expect(item.slaHours).toBeGreaterThanOrEqual(10);
    }
  });


  it('handles range with max only', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], slaHours: 5 },
      { ...generateTicketArray(1)[0], slaHours: 15 },
      { ...generateTicketArray(1)[0], slaHours: 25 },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({ ranges: { slaHours: { max: 20 } } });

    expect(result.total).toBe(2); // 5 and 15
    for (const item of result.items) {
      expect(item.slaHours).toBeLessThanOrEqual(20);
    }
  });


  it('handles very large numbers in ranges', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], slaHours: Number.MAX_SAFE_INTEGER },
      { ...generateTicketArray(1)[0], slaHours: 100 },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({
      ranges: { slaHours: { min: Number.MAX_SAFE_INTEGER - 1 } },
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.slaHours).toBe(Number.MAX_SAFE_INTEGER);
  });


  it('handles NaN values in range queries gracefully', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // NaN in range comparisons always evaluate to false, so items pass through
    // This means NaN effectively acts as "no filter" for that bound
    const result = bundle.query({
      ranges: { slaHours: { min: NaN, max: NaN } },
    });

    // NaN comparisons don't exclude items (comparison with NaN is always false)
    expect(result.total).toBe(100);
  });


  it('handles Infinity values in range queries', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], slaHours: 100 },
      { ...generateTicketArray(1)[0], slaHours: 200 },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Infinity as max should include all items
    const result = bundle.query({
      ranges: { slaHours: { min: 0, max: Infinity } },
    });

    expect(result.total).toBe(2);
  });


  // Dataset Edge Cases
  // ==============================

  it('handles empty dataset', async () => {
    const bundle = await LyraBundle.create<Ticket>([], config);

    const result = bundle.query({});

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
    expect(result.snapshot.datasetId).toBe('tickets-2025-11-22');
  });


  it('handles single item dataset', async () => {
    const tickets = generateTicketArray(1);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({});

    expect(result.total).toBe(1);
    expect(result.items.length).toBe(1);
    expect(result.items[0]?.id).toBe(tickets[0]?.id);
  });


  it('handles dataset with all null values for a field', async () => {
    const tickets = generateTicketArray(10).map((ticket) => ({
      ...ticket,
      status: null as any,
    }));
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Querying for any status should return empty
    const result = bundle.query({ equal: { status: 'open' } });
    expect(result.total).toBe(0);

    // Empty query should return all items
    const allResult = bundle.query({});
    expect(allResult.total).toBe(10);
  });


  it('handles dataset with extra fields not in config', async () => {
    const tickets = generateTicketArray(10);
    // Add an extra field that's not in config
    const ticketsWithExtra = tickets.map((ticket) => ({
      ...ticket,
      extraField: 'extraValue',
    }));
    const bundle = await LyraBundle.create<Ticket>(ticketsWithExtra, config);

    // Should work fine - extra fields are ignored
    const result = bundle.query({ equal: { status: 'open' } });
    expect(result.total).toBeGreaterThanOrEqual(0);
  });


  // Pagination Edge Cases
  // ==============================

  it('handles pagination with offset beyond total results', async () => {
    const tickets = generateTicketArray(10);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({ offset: 100 });

    expect(result.total).toBe(10);
    expect(result.items.length).toBe(0);
  });


  it('handles pagination with limit of 0', async () => {
    const tickets = generateTicketArray(10);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({ limit: 0 });

    expect(result.total).toBe(10);
    expect(result.items.length).toBe(0);
  });


  it('handles negative offset or limit', async () => {
    const tickets = generateTicketArray(10);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Negative offset should be treated as 0
    const negativeOffsetResult = bundle.query({ offset: -5 });
    expect(negativeOffsetResult.items.length).toBeGreaterThan(0);

    // Negative limit is normalized to 0 (no items returned)
    const negativeLimitResult = bundle.query({ limit: -5 });
    expect(negativeLimitResult.total).toBeGreaterThan(0); // Total should still reflect all matches
    expect(negativeLimitResult.items.length).toBe(0); // But no items should be returned
    expect(negativeLimitResult.total).toBe(10);
  });


  it('handles very large offset/limit values', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const largeOffsetResult = bundle.query({ offset: Number.MAX_SAFE_INTEGER });
    expect(largeOffsetResult.items.length).toBe(0);

    const largeLimitResult = bundle.query({ limit: Number.MAX_SAFE_INTEGER });
    expect(largeLimitResult.items.length).toBeLessThanOrEqual(100);
  });


  // Query Edge Cases
  // ==============================

  it('handles querying non-existent facet field', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Querying non-existent field should return empty
    const result = bundle.query({ equal: { nonexistentField: 'value' } as any });

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
  });


  it('handles querying non-existent range field', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Querying non-existent range field should return empty
    const result = bundle.query({
      ranges: { nonexistentField: { min: 0, max: 100 } } as any,
    });

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
  });


  it('handles empty facet/range objects in query', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Empty objects should be treated as no filters
    const result = bundle.query({ equal: {}, ranges: {} });

    expect(result.total).toBe(100);
    expect(result.items.length).toBe(100);
  });


  it('handles null/undefined in query object', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Null/undefined should be ignored
    const result = bundle.query({ equal: null as any, ranges: undefined as any });

    expect(result.total).toBe(100);
    expect(result.items.length).toBe(100);
  });
});

