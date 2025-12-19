import { describe, it, expect } from 'vitest';
import { LyraBundle, createBundle, type SimpleBundleConfig } from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';
import { DATASET_SIZE, testConfig } from './test-config';

describe('LyraBundle - V2 Query Operators', () => {
  const config = testConfig;

  it('supports equal operator with scalar values', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const sampleStatus = tickets[0].status;
    const result = bundle.query({
      equal: { status: sampleStatus },
    });

    expect(result.total).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.status).toBe(sampleStatus);
    }
  });

  it('supports equal operator with array values (IN semantics)', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({
      equal: { priority: ['high', 'urgent'] },
    });

    const expected = tickets.filter(
      (t) => t.priority === 'high' || t.priority === 'urgent',
    );

    expect(result.total).toBe(expected.length);
    for (const item of result.items) {
      expect(['high', 'urgent']).toContain(item.priority);
    }
  });

  it('supports notEqual operator with scalar values', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const excludeStatus = 'closed';
    const result = bundle.query({
      notEqual: { status: excludeStatus },
    });

    expect(result.total).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.status).not.toBe(excludeStatus);
    }
  });

  it('supports notEqual operator with array values (NOT IN)', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({
      notEqual: { status: ['closed', 'cancelled'] },
    });

    for (const item of result.items) {
      expect(['closed', 'cancelled']).not.toContain(item.status);
    }
  });

  it('normalizes equal: { field: null } to isNull', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], category: null },
      { ...generateTicketArray(1)[0], category: 'A' },
      { ...generateTicketArray(1)[0], category: null },
    ];
    const configWithCategory: SimpleBundleConfig<Ticket> = {
      datasetId: 'test',
      facets: ['category'],
    };
    const bundle = await createBundle(tickets, configWithCategory);

    // Using equal: { field: null } should normalize to isNull
    const result = bundle.query({
      equal: { category: null },
    });

    expect(result.total).toBe(2);
    for (const item of result.items) {
      expect(item.category).toBeNull();
    }
  });

  it('normalizes notEqual: { field: null } to isNotNull', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], category: null },
      { ...generateTicketArray(1)[0], category: 'A' },
      { ...generateTicketArray(1)[0], category: 'B' },
    ];
    const configWithCategory: SimpleBundleConfig<Ticket> = {
      datasetId: 'test',
      facets: ['category'],
    };
    const bundle = await createBundle(tickets, configWithCategory);

    // Using notEqual: { field: null } should normalize to isNotNull
    const result = bundle.query({
      notEqual: { category: null },
    });

    expect(result.total).toBe(2);
    for (const item of result.items) {
      expect(item.category).not.toBeNull();
    }
  });

  it('normalizes equal: { field: [val, null] } to equal + isNull', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], category: null },
      { ...generateTicketArray(1)[0], category: 'A' },
      { ...generateTicketArray(1)[0], category: 'B' },
    ];
    const configWithCategory: SimpleBundleConfig<Ticket> = {
      datasetId: 'test',
      facets: ['category'],
    };
    const bundle = await createBundle(tickets, configWithCategory);

    // Array with null should split to equal + isNull
    const result = bundle.query({
      equal: { category: ['A', null] },
    });

    // Should match items with category='A' OR category=null
    expect(result.total).toBe(2);
    const categories = result.items.map((i) => i.category);
    expect(categories).toContain('A');
    expect(categories).toContain(null);
  });

  it('supports explicit isNull operator', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], category: null },
      { ...generateTicketArray(1)[0], category: 'A' },
      { ...generateTicketArray(1)[0], category: null },
    ];
    const configWithCategory: SimpleBundleConfig<Ticket> = {
      datasetId: 'test',
      facets: ['category'],
    };
    const bundle = await createBundle(tickets, configWithCategory);

    const result = bundle.query({
      isNull: ['category'],
    });

    expect(result.total).toBe(2);
    for (const item of result.items) {
      expect(item.category).toBeNull();
    }
  });

  it('supports explicit isNotNull operator', async () => {
    const tickets = [
      { ...generateTicketArray(1)[0], category: null },
      { ...generateTicketArray(1)[0], category: 'A' },
      { ...generateTicketArray(1)[0], category: 'B' },
    ];
    const configWithCategory: SimpleBundleConfig<Ticket> = {
      datasetId: 'test',
      facets: ['category'],
    };
    const bundle = await createBundle(tickets, configWithCategory);

    const result = bundle.query({
      isNotNull: ['category'],
    });

    expect(result.total).toBe(2);
    for (const item of result.items) {
      expect(item.category).not.toBeNull();
    }
  });

  it('supports mixed operators (equal + notEqual + isNull)', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const sampleCustomer = tickets[0].customerId;
    const excludeStatus = 'closed';

    const result = bundle.query({
      equal: { customerId: sampleCustomer },
      notEqual: { priority: 'low' },
      isNotNull: ['status'],
    });

    expect(result.total).toBeGreaterThanOrEqual(0);
    for (const item of result.items) {
      expect(item.customerId).toBe(sampleCustomer);
      expect(item.priority).not.toBe('low');
      expect(item.status).not.toBeNull();
    }
  });

  it('supports ranges operator', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const from = Date.parse('2025-10-01T00:00:00Z');
    const to = Date.parse('2025-12-31T23:59:59Z');

    const result = bundle.query({
      ranges: {
        createdAt: { min: from, max: to },
      },
    });

    expect(result.total).toBeGreaterThan(0);
    for (const item of result.items) {
      const createdAt = Date.parse(item.createdAt);
      expect(createdAt).toBeGreaterThanOrEqual(from);
      expect(createdAt).toBeLessThanOrEqual(to);
    }
  });

  it('all operators are intersected (AND logic)', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const sampleCustomer = tickets[0].customerId;
    const sampleStatus = tickets[0].status;

    const result = bundle.query({
      equal: {
        customerId: sampleCustomer,
        status: sampleStatus,
      },
      notEqual: { priority: 'low' },
      isNotNull: ['productArea'],
    });

    // All conditions must match
    for (const item of result.items) {
      expect(item.customerId).toBe(sampleCustomer);
      expect(item.status).toBe(sampleStatus);
      expect(item.priority).not.toBe('low');
      expect(item.productArea).not.toBeNull();
    }
  });
});

