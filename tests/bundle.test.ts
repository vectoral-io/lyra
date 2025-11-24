import { describe, it, expect } from 'vitest';
import {
  LyraBundle,
  buildManifest,
  createBundle,
  type CreateBundleConfig,
  type LyraManifest,
} from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';


const DATASET_SIZE = 10000;


describe('LyraBundle', () => {

  const config: CreateBundleConfig = {
    datasetId: 'tickets-2025-11-22',
    fields: {
      id: { kind: 'id', type: 'string' },
      customerId: { kind: 'facet', type: 'string' },
      priority: { kind: 'facet', type: 'string' },
      status: { kind: 'facet', type: 'string' },
      productArea: { kind: 'facet', type: 'string' },
      region: { kind: 'facet', type: 'string' },
      createdAt: { kind: 'range', type: 'date' },
      slaHours: { kind: 'range', type: 'number' },
    },
  };


  it('builds a bundle and runs a basic facet query', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Find a customer that exists in the generated data
    const sampleCustomer = tickets[0].customerId;
    const samplePriority = tickets[0].priority;
    const sampleStatus = tickets[0].status;

    const result = bundle.query({
      facets: {
        customerId: sampleCustomer,
        priority: samplePriority,
        status: sampleStatus,
      },
    });

    // Verify query returns results matching all filters
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);

    // Verify all returned items match the query filters
    for (const item of result.items) {
      expect(item.customerId).toBe(sampleCustomer);
      expect(item.priority).toBe(samplePriority);
      expect(item.status).toBe(sampleStatus);
    }

    expect(result.snapshot.datasetId).toBe('tickets-2025-11-22');
  });


  it('supports a basic date range query', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Use dates that should match some tickets in the generated data
    const from = Date.parse('2025-10-01T00:00:00Z');
    const to = Date.parse('2025-12-31T23:59:59Z');

    const result = bundle.query({
      ranges: {
        createdAt: { min: from, max: to },
      },
    });

    expect(result.total).toBeGreaterThan(0);

    // Verify all returned items are within the date range
    for (const item of result.items) {
      const createdAt = Date.parse(item.createdAt);
      expect(createdAt).toBeGreaterThanOrEqual(from);
      expect(createdAt).toBeLessThanOrEqual(to);
    }
  });


  it('round-trips via toJSON/load', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);
    const json = bundle.toJSON();

    const loaded = LyraBundle.load<Ticket>(json);

    const result = loaded.query({
      facets: { status: 'open' },
    });

    const original = bundle.query({ facets: { status: 'open' } });

    expect(result.total).toBe(original.total);
    expect(result.items.length).toBe(original.items.length);
  });


  it('returns consistent results for multi-facet queries via index', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Find facets that exist in the generated data
    const sampleCustomer = tickets[0].customerId;
    const sampleProductArea = tickets[0].productArea;

    const facets = {
      customerId: sampleCustomer,
      productArea: sampleProductArea,
    } as const;

    const byBundle = bundle.query({ facets });

    // Naive baseline
    const expected = tickets.filter(
      (ticket) =>
        ticket.customerId === facets.customerId &&
        ticket.productArea === facets.productArea,
    );

    expect(byBundle.total).toBe(expected.length);
    expect(byBundle.items.map((ticket) => ticket.id).sort()).toEqual(
      expected.map((ticket) => ticket.id).sort(),
    );
  });


  it('returns facet counts matching naive baseline', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({
      facets: {
        status: 'open',
      },
      includeFacetCounts: true,
    });

    expect(result.facets).toBeDefined();
    expect(result.facets?.status).toBeDefined();

    // Naive baseline: count status values in filtered items
    const filteredItems = tickets.filter((ticket) => ticket.status === 'open');
    const statusCounts: Record<string, number> = {};
    for (const item of filteredItems) {
      statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
    }

    expect(result.facets?.status['open']).toBe(statusCounts['open']);

    // Verify counts for other facet fields match
    const priorityCounts: Record<string, number> = {};
    for (const item of filteredItems) {
      priorityCounts[item.priority] = (priorityCounts[item.priority] ?? 0) + 1;
    }

    for (const [priority, count] of Object.entries(priorityCounts)) {
      expect(result.facets?.priority[priority]).toBe(count);
    }
  });


  it('validates manifest structure and capabilities', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);
    const manifest = bundle.describe();

    expect(manifest.datasetId).toBe('tickets-2025-11-22');
    expect(manifest.capabilities.facets).toContain('priority');
    expect(manifest.capabilities.facets).toContain('status');
    expect(manifest.capabilities.facets).toContain('customerId');

    const createdAtField = manifest.fields.find((f) => f.name === 'createdAt');
    expect(createdAtField).toBeDefined();
    expect(createdAtField?.kind).toBe('range');
    expect(createdAtField?.ops).toEqual(['between', 'gte', 'lte']);

    const statusField = manifest.fields.find((f) => f.name === 'status');
    expect(statusField).toBeDefined();
    expect(statusField?.kind).toBe('facet');
    expect(statusField?.ops).toEqual(['eq', 'in']);
  });


  it('buildManifest produces valid manifest', () => {
    const manifest = buildManifest(config);

    expect(manifest.version).toBe('1.0.0');
    expect(manifest.datasetId).toBe('tickets-2025-11-22');
    expect(manifest.fields.length).toBeGreaterThan(0);
    expect(manifest.capabilities.facets.length).toBeGreaterThan(0);
    expect(manifest.capabilities.ranges.length).toBeGreaterThan(0);
  });


  it('createBundle uses builder functions', async () => {
    const tickets = generateTicketArray(1000);
    const bundle1 = await LyraBundle.create<Ticket>(tickets, config);
    const bundle2 = await createBundle<Ticket>(tickets, config);

    const result1 = bundle1.query({ facets: { status: 'open' } });
    const result2 = bundle2.query({ facets: { status: 'open' } });

    expect(result1.total).toBe(result2.total);
    expect(result1.items.length).toBe(result2.items.length);
  });


  it('loads valid bundle format', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);
    const json = bundle.toJSON();

    const loaded = LyraBundle.load<Ticket>(json);

    const result = loaded.query({
      facets: { status: 'open' },
    });

    const original = bundle.query({ facets: { status: 'open' } });

    expect(result.total).toBe(original.total);
    expect(result.items.length).toBe(original.items.length);
  });


  it('throws on invalid bundle format', async () => {
    const tickets = generateTicketArray(100);

    // Missing manifest
    expect(() => {
      LyraBundle.load<Ticket>({
        items: tickets,
        facetIndex: {},
      } as any);
    }).toThrow('Invalid bundle JSON: missing manifest or items');

    // Invalid version
    const bundle = await LyraBundle.create<Ticket>(tickets, config);
    const json = bundle.toJSON();
    json.manifest.version = '2.0.0';

    expect(() => {
      LyraBundle.load<Ticket>(json);
    }).toThrow('Invalid bundle version');

    // Mismatched facetIndex keys
    const bundle2 = await LyraBundle.create<Ticket>(tickets, config);
    const json2 = bundle2.toJSON();
    json2.facetIndex['nonexistentField'] = {};

    expect(() => {
      LyraBundle.load<Ticket>(json2);
    }).toThrow('facetIndex contains field "nonexistentField"');

    // Capabilities referencing non-existent fields
    const bundle3 = await LyraBundle.create<Ticket>(tickets, config);
    const json3 = bundle3.toJSON();
    json3.manifest.capabilities.facets.push('nonexistentField');

    expect(() => {
      LyraBundle.load<Ticket>(json3);
    }).toThrow('capability references non-existent facet field');
  });


  it('empty query returns all items', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({});

    expect(result.total).toBe(tickets.length);
    expect(result.items.length).toBe(tickets.length);
  });


  it('facet with no matches returns empty result', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({
      facets: { status: 'nonexistent' },
    });

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
  });


  it('multiple values per facet (IN) matches naive baseline', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({
      facets: { priority: ['high', 'urgent'] },
    });

    // Naive baseline
    const expected = tickets.filter(
      (ticket) => ticket.priority === 'high' || ticket.priority === 'urgent',
    );

    expect(result.total).toBe(expected.length);
    expect(result.items.map((ticket) => ticket.id).sort()).toEqual(
      expected.map((ticket) => ticket.id).sort(),
    );
  });


  it('range edge cases handle inclusive min/max correctly', async () => {
    const tickets = generateTicketArray(1000);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Find min and max dates in the dataset
    const dates = tickets.map((t) => Date.parse(t.createdAt)).sort((a, b) => a - b);
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];

    // Test inclusive min/max
    const result = bundle.query({
      ranges: {
        createdAt: { min: minDate, max: maxDate },
      },
    });

    // All items should be included
    expect(result.total).toBe(tickets.length);

    // Test that items at boundaries are included
    for (const item of result.items) {
      const createdAt = Date.parse(item.createdAt);
      expect(createdAt).toBeGreaterThanOrEqual(minDate);
      expect(createdAt).toBeLessThanOrEqual(maxDate);
    }

    // Test missing/null values are excluded
    const ticketsWithNulls = [
      ...tickets,
      { ...tickets[0], createdAt: null as any },
      { ...tickets[0], createdAt: undefined as any },
    ];
    const bundleWithNulls = await LyraBundle.create<Ticket>(ticketsWithNulls, config);
    const resultWithNulls = bundleWithNulls.query({
      ranges: {
        createdAt: { min: minDate, max: maxDate },
      },
    });

    // Null/undefined values should be excluded
    expect(resultWithNulls.total).toBeLessThanOrEqual(ticketsWithNulls.length);
    for (const item of resultWithNulls.items) {
      expect(item.createdAt).toBeDefined();
      expect(item.createdAt).not.toBeNull();
    }

    // Test unparseable date strings are excluded
    const ticketsWithBadDates = [
      ...tickets,
      { ...tickets[0], createdAt: 'not-a-date' },
      { ...tickets[0], createdAt: 'invalid' },
    ];
    const bundleWithBadDates = await LyraBundle.create<Ticket>(ticketsWithBadDates, config);
    const resultWithBadDates = bundleWithBadDates.query({
      ranges: {
        createdAt: { min: minDate, max: maxDate },
      },
    });

    // Unparseable dates should be excluded
    expect(resultWithBadDates.total).toBeLessThanOrEqual(ticketsWithBadDates.length);
    for (const item of resultWithBadDates.items) {
      const parsed = Date.parse(item.createdAt);
      expect(Number.isNaN(parsed)).toBe(false);
    }
  });


  it('facet counts exclude items filtered by ranges', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Apply range filter
    const from = Date.parse('2025-10-01T00:00:00Z');
    const to = Date.parse('2025-12-31T23:59:59Z');

    const result = bundle.query({
      ranges: {
        createdAt: { min: from, max: to },
      },
      includeFacetCounts: true,
    });

    // Verify facet counts only include items passing range filter
    const filteredItems = tickets.filter((ticket) => {
      const createdAt = Date.parse(ticket.createdAt);
      return createdAt >= from && createdAt <= to;
    });

    // Count status values in filtered items
    const statusCounts: Record<string, number> = {};
    for (const item of filteredItems) {
      statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
    }

    // Compare with bundle facet counts
    expect(result.facets?.status).toBeDefined();
    for (const [status, count] of Object.entries(statusCounts)) {
      expect(result.facets?.status[status]).toBe(count);
    }
  });


  it('does not compute facet counts when not requested', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({
      facets: {
        status: 'open',
      },
      // includeFacetCounts is false by default
    });

    expect(result.facets).toBeUndefined();
  });
});
