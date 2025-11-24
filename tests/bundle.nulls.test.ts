import { describe, it, expect } from 'vitest';
import { LyraBundle, type CreateBundleConfig } from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';
import { testConfig } from './test-config';


describe('LyraBundle - Null and Undefined Handling', () => {
  const config = testConfig;


  it('excludes null facet values from index', async () => {
    const tickets = generateTicketArray(100);
    const ticketsWithNulls = tickets.map((ticket, idx) =>
      idx % 2 === 0 ? { ...ticket, status: null as any } : ticket,
    );
    const bundle = await LyraBundle.create<Ticket>(ticketsWithNulls, config);

    // Query for a status that exists in non-null items
    const nonNullTickets = ticketsWithNulls.filter((t) => t.status !== null);
    const sampleStatus = nonNullTickets[0]?.status;
    if (sampleStatus) {
      const result = bundle.query({ facets: { status: sampleStatus } });

      // Should only match non-null items
      const expected = nonNullTickets.filter((t) => t.status === sampleStatus);
      expect(result.total).toBe(expected.length);
      for (const item of result.items) {
        expect(item.status).toBe(sampleStatus);
        expect(item.status).not.toBeNull();
      }
    }
  });


  it('excludes undefined facet values from index', async () => {
    const tickets = generateTicketArray(100);
    const ticketsWithUndefined = tickets.map((ticket, idx) =>
      idx % 2 === 0 ? { ...ticket, priority: undefined as any } : ticket,
    );
    const bundle = await LyraBundle.create<Ticket>(ticketsWithUndefined, config);

    const nonUndefinedTickets = ticketsWithUndefined.filter((t) => t.priority !== undefined);
    const samplePriority = nonUndefinedTickets[0]?.priority;
    if (samplePriority) {
      const result = bundle.query({ facets: { priority: samplePriority } });

      const expected = nonUndefinedTickets.filter((t) => t.priority === samplePriority);
      expect(result.total).toBe(expected.length);
      for (const item of result.items) {
        expect(item.priority).toBe(samplePriority);
        expect(item.priority).not.toBeUndefined();
      }
    }
  });


  it('handles querying for null as facet value', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Querying for null should return empty (null values are not indexed)
    const result = bundle.query({ facets: { status: null as any } });

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
  });


  it('handles querying for undefined as facet value', async () => {
    const tickets = generateTicketArray(100);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Querying for undefined should return empty
    const result = bundle.query({ facets: { status: undefined as any } });

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
  });


  it('distinguishes empty strings from null and undefined in facets', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], status: '' },
      { ...generateTicketArray(1)[0], status: null as any },
      { ...generateTicketArray(1)[0], status: undefined as any },
      { ...generateTicketArray(1)[0], status: 'open' },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Empty string should be indexed as the string "empty"
    const emptyResult = bundle.query({ facets: { status: '' } });
    expect(emptyResult.total).toBe(1);
    expect(emptyResult.items[0]?.status).toBe('');

    // Null and undefined should not be indexed
    const openResult = bundle.query({ facets: { status: 'open' } });
    expect(openResult.total).toBe(1);
    expect(openResult.items[0]?.status).toBe('open');
  });


  it('handles mixed null and non-null values in same dataset', async () => {
    const tickets = generateTicketArray(100);
    const mixedTickets = tickets.map((ticket, idx) => {
      if (idx % 3 === 0) return { ...ticket, customerId: null as any };
      if (idx % 3 === 1) return { ...ticket, customerId: undefined as any };
      return ticket;
    });
    const bundle = await LyraBundle.create<Ticket>(mixedTickets, config);

    const validTickets = mixedTickets.filter(
      (t) => t.customerId !== null && t.customerId !== undefined,
    );
    const sampleCustomer = validTickets[0]?.customerId;
    if (sampleCustomer) {
      const result = bundle.query({ facets: { customerId: sampleCustomer } });

      const expected = validTickets.filter((t) => t.customerId === sampleCustomer);
      expect(result.total).toBe(expected.length);
      for (const item of result.items) {
        expect(item.customerId).toBe(sampleCustomer);
      }
    }
  });


  it('handles zero values in numeric ranges', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], slaHours: 0 },
      { ...generateTicketArray(1)[0], slaHours: 5 },
      { ...generateTicketArray(1)[0], slaHours: 10 },
      { ...generateTicketArray(1)[0], slaHours: -5 },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Query including zero
    const result = bundle.query({ ranges: { slaHours: { min: 0, max: 10 } } });

    expect(result.total).toBe(3); // 0, 5, 10
    for (const item of result.items) {
      expect(item.slaHours).toBeGreaterThanOrEqual(0);
      expect(item.slaHours).toBeLessThanOrEqual(10);
    }
  });


  it('handles negative numbers in numeric ranges', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], slaHours: -10 },
      { ...generateTicketArray(1)[0], slaHours: -5 },
      { ...generateTicketArray(1)[0], slaHours: 0 },
      { ...generateTicketArray(1)[0], slaHours: 5 },
    ];
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({ ranges: { slaHours: { min: -10, max: 0 } } });

    expect(result.total).toBe(3); // -10, -5, 0
    for (const item of result.items) {
      expect(item.slaHours).toBeGreaterThanOrEqual(-10);
      expect(item.slaHours).toBeLessThanOrEqual(0);
    }
  });
});

