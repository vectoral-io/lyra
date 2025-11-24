import { describe, it, expect } from 'vitest';
import {
  LyraBundle,
  createBundle,
  type CreateBundleConfig,
} from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';
import { DATASET_SIZE, testConfig } from './test-config';


describe('getFacetSummary', () => {
  const config = testConfig;


  it('returns global domain without filters', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const summary = bundle.getFacetSummary('status');

    expect(summary.field).toBe('status');
    expect(summary.values.length).toBeGreaterThan(0);

    // Verify counts match naive baseline
    const statusCounts: Record<string, number> = {};
    for (const ticket of tickets) {
      statusCounts[ticket.status] = (statusCounts[ticket.status] ?? 0) + 1;
    }

    for (const { value, count } of summary.values) {
      expect(typeof value).toBe('string');
      expect(count).toBe(statusCounts[value as string]);
    }
  });


  it('respects facet filters', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const sampleCustomer = tickets[0].customerId;

    // Get summary without filters
    const globalSummary = bundle.getFacetSummary('status');

    // Get summary with customer filter
    const filteredSummary = bundle.getFacetSummary('status', {
      facets: { customerId: sampleCustomer },
    });

    expect(filteredSummary.field).toBe('status');
    expect(filteredSummary.values.length).toBeGreaterThan(0);

    // Filtered counts should be <= global counts
    const globalCountMap = new Map(
      globalSummary.values.map((v) => [v.value, v.count]),
    );
    for (const { value, count } of filteredSummary.values) {
      const globalCount = globalCountMap.get(value) ?? 0;
      expect(count).toBeLessThanOrEqual(globalCount);
    }

    // Verify filtered counts match naive baseline
    const filteredTickets = tickets.filter(
      (t) => t.customerId === sampleCustomer,
    );
    const filteredStatusCounts: Record<string, number> = {};
    for (const ticket of filteredTickets) {
      filteredStatusCounts[ticket.status] =
        (filteredStatusCounts[ticket.status] ?? 0) + 1;
    }

    for (const { value, count } of filteredSummary.values) {
      expect(count).toBe(filteredStatusCounts[value as string]);
    }
  });


  it('handles multi-valued facets', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], tags: ['tag1', 'tag2'] },
      { ...generateTicketArray(1)[0], tags: ['tag1', 'tag3'] },
      { ...generateTicketArray(1)[0], tags: ['tag2'] },
      { ...generateTicketArray(1)[0], tags: ['tag1', 'tag1', 'tag2'] }, // Duplicates
    ];
    const configWithTags: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        tags: { kind: 'facet', type: 'string' },
      },
    };
    const bundle = await LyraBundle.create<Ticket>(tickets, configWithTags);

    const summary = bundle.getFacetSummary('tags');

    expect(summary.field).toBe('tags');

    // Find counts for each tag
    const tag1Entry = summary.values.find((v) => v.value === 'tag1');
    const tag2Entry = summary.values.find((v) => v.value === 'tag2');
    const tag3Entry = summary.values.find((v) => v.value === 'tag3');

    // tag1 appears in items: [0] (once), [1] (once), [3] (twice) = 4 total
    expect(tag1Entry?.count).toBe(4);

    // tag2 appears in items: [0] (once), [2] (once), [3] (once) = 3 total
    expect(tag2Entry?.count).toBe(3);

    // tag3 appears in items: [1] (once) = 1 total
    expect(tag3Entry?.count).toBe(1);
  });


  it('returns empty for unknown facet field', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const summary = bundle.getFacetSummary('unknownField');

    expect(summary.field).toBe('unknownField');
    expect(summary.values).toEqual([]);
  });


  it('returns empty for range field', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // createdAt is a range field, not a facet field
    const summary = bundle.getFacetSummary('createdAt');

    expect(summary.field).toBe('createdAt');
    expect(summary.values).toEqual([]);
  });


  it('parses numeric facet values', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], count: 10 },
      { ...generateTicketArray(1)[0], count: 20 },
      { ...generateTicketArray(1)[0], count: 10 },
      { ...generateTicketArray(1)[0], count: 30 },
    ];
    const configWithCount: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        count: { kind: 'facet', type: 'number' },
      },
    };
    const bundle = await LyraBundle.create<Ticket>(tickets, configWithCount);

    const summary = bundle.getFacetSummary('count');

    expect(summary.field).toBe('count');
    expect(summary.values.length).toBe(3);

    // Verify values are numbers, not strings
    for (const { value } of summary.values) {
      expect(typeof value).toBe('number');
    }

    // Verify counts
    const count10 = summary.values.find((v) => v.value === 10);
    const count20 = summary.values.find((v) => v.value === 20);
    const count30 = summary.values.find((v) => v.value === 30);

    expect(count10?.count).toBe(2);
    expect(count20?.count).toBe(1);
    expect(count30?.count).toBe(1);

    // Verify sorting (numbers should be ascending)
    const sortedValues = summary.values.map((v) => v.value as number);
    expect(sortedValues).toEqual([10, 20, 30]);
  });


  it('parses boolean facet values', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], isEscalated: true },
      { ...generateTicketArray(1)[0], isEscalated: false },
      { ...generateTicketArray(1)[0], isEscalated: true },
      { ...generateTicketArray(1)[0], isEscalated: true },
    ];
    const configWithBoolean: CreateBundleConfig<Ticket> = {
      datasetId: 'test',
      fields: {
        id: { kind: 'id', type: 'string' },
        isEscalated: { kind: 'facet', type: 'boolean' },
      },
    };
    const bundle = await LyraBundle.create<Ticket>(tickets, configWithBoolean);

    const summary = bundle.getFacetSummary('isEscalated');

    expect(summary.field).toBe('isEscalated');
    expect(summary.values.length).toBe(2);

    // Verify values are booleans, not strings
    for (const { value } of summary.values) {
      expect(typeof value).toBe('boolean');
    }

    // Verify counts
    const trueEntry = summary.values.find((v) => v.value === true);
    const falseEntry = summary.values.find((v) => v.value === false);

    expect(trueEntry?.count).toBe(3);
    expect(falseEntry?.count).toBe(1);

    // Verify sorting (false should come before true)
    expect(summary.values[0].value).toBe(false);
    expect(summary.values[1].value).toBe(true);
  });


  it('handles empty dataset', async () => {
    const tickets: Ticket[] = [];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const summary = bundle.getFacetSummary('status');

    expect(summary.field).toBe('status');
    expect(summary.values).toEqual([]);
  });


  it('excludes null/undefined values from counts', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], status: 'open' },
      { ...generateTicketArray(1)[0], status: null as any },
      { ...generateTicketArray(1)[0], status: undefined as any },
      { ...generateTicketArray(1)[0], status: 'closed' },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const summary = bundle.getFacetSummary('status');

    expect(summary.field).toBe('status');

    // Should only have 'open' and 'closed', not null/undefined
    const valueStrings = summary.values.map((v) => String(v.value));
    expect(valueStrings).not.toContain('null');
    expect(valueStrings).not.toContain('undefined');

    const openEntry = summary.values.find((v) => v.value === 'open');
    const closedEntry = summary.values.find((v) => v.value === 'closed');

    expect(openEntry?.count).toBe(1);
    expect(closedEntry?.count).toBe(1);
  });


  it('respects range filters', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Get summary without filters
    const globalSummary = bundle.getFacetSummary('status');

    // Apply a date range filter
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const filteredSummary = bundle.getFacetSummary('status', {
      ranges: {
        createdAt: { min: oneWeekAgo, max: now },
      },
    });

    expect(filteredSummary.field).toBe('status');

    // Filtered counts should be <= global counts
    const globalCountMap = new Map(
      globalSummary.values.map((v) => [v.value, v.count]),
    );
    for (const { value, count } of filteredSummary.values) {
      const globalCount = globalCountMap.get(value) ?? 0;
      expect(count).toBeLessThanOrEqual(globalCount);
    }
  });


  it('handles combined facet and range filters', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const sampleCustomer = tickets[0].customerId;
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const summary = bundle.getFacetSummary('status', {
      facets: { customerId: sampleCustomer },
      ranges: {
        createdAt: { min: oneWeekAgo, max: now },
      },
    });

    expect(summary.field).toBe('status');
    expect(summary.values.length).toBeGreaterThan(0);

    // Verify counts are correct by comparing with direct query
    const queryResult = bundle.query({
      facets: { customerId: sampleCustomer },
      ranges: {
        createdAt: { min: oneWeekAgo, max: now },
      },
      includeFacetCounts: true,
      limit: 0,
    });

    const directCounts = queryResult.facets?.status ?? {};
    for (const { value, count } of summary.values) {
      const directCount = directCounts[String(value)] ?? 0;
      expect(count).toBe(directCount);
    }
  });
});

