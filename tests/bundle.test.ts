import { describe, it, expect } from 'vitest';
import { LyraBundle, type CreateBundleConfig, type LyraManifest } from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';


const DATASET_SIZE = 100000;


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
    const json = bundle.toJSON() as { manifest?: LyraManifest; items?: Ticket[] };

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

  
});
