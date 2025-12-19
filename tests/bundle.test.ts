import { describe, it, expect } from 'vitest';
import {
  LyraBundle,
  createBundle,
  type CreateBundleConfig,
  type SimpleBundleConfig,
} from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';
import { DATASET_SIZE, testConfig } from './test-config';


describe('LyraBundle - Core Functionality', () => {
  const config = testConfig;


  it('builds a bundle and runs a basic facet query', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Find a customer that exists in the generated data
    const sampleCustomer = tickets[0].customerId;
    const samplePriority = tickets[0].priority;
    const sampleStatus = tickets[0].status;

    const result = bundle.query({
      equal: {
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
      equal: { status: 'open' },
    });

    const original = bundle.query({ equal: { status: 'open' } });

    expect(result.total).toBe(original.total);
    expect(result.items.length).toBe(original.items.length);
  });


  it('returns consistent results for multi-facet queries via index', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    // Find facets that exist in the generated data
    const sampleCustomer = tickets[0].customerId;
    const sampleProductArea = tickets[0].productArea;

    const equalFilters = {
      customerId: sampleCustomer,
      productArea: sampleProductArea,
    } as const;

    const byBundle = bundle.query({ equal: equalFilters });

    // Naive baseline
    const expected = tickets.filter(
      (ticket) =>
        ticket.customerId === equalFilters.customerId &&
        ticket.productArea === equalFilters.productArea,
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
      equal: {
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


  it('createBundle uses builder functions', async () => {
    const tickets = generateTicketArray(1000);
    const bundle1 = await LyraBundle.create<Ticket>(tickets, config);
    const bundle2 = await createBundle<Ticket>(tickets, config);

    const result1 = bundle1.query({ equal: { status: 'open' } });
    const result2 = bundle2.query({ equal: { status: 'open' } });

    expect(result1.total).toBe(result2.total);
    expect(result1.items.length).toBe(result2.items.length);
  });


  it('loads valid bundle format', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);
    const json = bundle.toJSON();

    const loaded = LyraBundle.load<Ticket>(json);

    const result = loaded.query({
      equal: { status: 'open' },
    });

    const original = bundle.query({ equal: { status: 'open' } });

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

    // Empty fields array
    const bundleWithEmptyFields = await LyraBundle.create<Ticket>(tickets, config);
    const jsonWithEmptyFields = bundleWithEmptyFields.toJSON();
    jsonWithEmptyFields.manifest.fields = [];

    expect(() => {
      LyraBundle.load<Ticket>(jsonWithEmptyFields);
    }).toThrow('Invalid bundle: fields array must not be empty');

    // Invalid version (v2 bundles should load fine)
    const bundle = await LyraBundle.create<Ticket>(tickets, config);
    const json = bundle.toJSON();
    json.manifest.version = '3.0.0';

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
      equal: { status: 'nonexistent' },
    });

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
  });


  it('multiple values per facet (IN) matches naive baseline', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({
      equal: { priority: ['high', 'urgent'] },
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
      equal: {
        status: 'open',
      },
      // includeFacetCounts is false by default
    });

    expect(result.facets).toBeUndefined();
  });


  it('unknown facet field returns empty result', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({
      equal: {
        nonexistentField: 'value',
      },
    });

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
  });


  it('unknown range field returns empty result', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({
      ranges: {
        nonexistentField: { min: 0, max: 100 },
      },
    });

    expect(result.total).toBe(0);
    expect(result.items.length).toBe(0);
  });


  it('negative offset is clamped to 0', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const resultNegative = bundle.query({
      offset: -10,
      limit: 5,
    });

    const resultZero = bundle.query({
      offset: 0,
      limit: 5,
    });

    // Negative offset should behave the same as offset 0
    expect(resultNegative.total).toBe(resultZero.total);
    expect(resultNegative.items.length).toBe(resultZero.items.length);
    expect(resultNegative.items).toEqual(resultZero.items);
  });


  it('negative limit returns no results', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);
    const bundle = await LyraBundle.create<Ticket>(tickets, config);

    const result = bundle.query({
      limit: -5,
    });

    expect(result.total).toBeGreaterThan(0); // Total should still reflect all matches
    expect(result.items.length).toBe(0); // But no items should be returned
  });


  it('throws when creating bundle with empty fields', async () => {
    const tickets = generateTicketArray(10);

    await expect(
      LyraBundle.create<Ticket>(tickets, {
        datasetId: 'test',
        fields: {},
      }),
    ).rejects.toThrow('Invalid bundle: fields array must not be empty');
  });
});


describe('Simple Bundle Config', () => {
  it('creates bundle with simple config and auto-detected id', async () => {
    const tickets = generateTicketArray(100);
    const simpleConfig: SimpleBundleConfig<Ticket> = {
      datasetId: 'tickets-simple',
      equal: ['priority', 'status'],
      ranges: ['createdAt'],
    };

    const bundle = await createBundle(tickets, simpleConfig);
    const manifest = bundle.describe();

    expect(manifest.datasetId).toBe('tickets-simple');
    expect(manifest.fields.find((f) => f.name === 'id')).toBeDefined();
    expect(manifest.fields.find((f) => f.name === 'id')?.kind).toBe('id');
    expect(manifest.capabilities.facets).toContain('priority');
    expect(manifest.capabilities.facets).toContain('status');
    expect(manifest.capabilities.ranges).toContain('createdAt');
  });


  it('creates bundle with simple config and explicit id', async () => {
    const tickets = generateTicketArray(100);
    const simpleConfig: SimpleBundleConfig<Ticket> = {
      datasetId: 'tickets-simple',
      id: 'id',
      equal: ['customerId', 'priority'],
      ranges: ['slaHours'],
    };

    const bundle = await createBundle(tickets, simpleConfig);
    const manifest = bundle.describe();

    expect(manifest.fields.find((f) => f.name === 'id')?.kind).toBe('id');
    expect(manifest.capabilities.facets).toContain('customerId');
    expect(manifest.capabilities.facets).toContain('priority');
    expect(manifest.capabilities.ranges).toContain('slaHours');
  });


  it('infers types correctly in runtime mode', async () => {
    const tickets = generateTicketArray(100);
    const simpleConfig: SimpleBundleConfig<Ticket> = {
      datasetId: 'tickets-simple',
      equal: ['priority', 'status', 'isEscalated'],
      ranges: ['slaHours', 'createdAt'],
      inferTypes: 'runtime',
    };

    const bundle = await createBundle(tickets, simpleConfig);
    const manifest = bundle.describe();

    const priorityField = manifest.fields.find((f) => f.name === 'priority');
    expect(priorityField?.type).toBe('string');

    const isEscalatedField = manifest.fields.find((f) => f.name === 'isEscalated');
    expect(isEscalatedField?.type).toBe('boolean');

    const slaHoursField = manifest.fields.find((f) => f.name === 'slaHours');
    expect(slaHoursField?.type).toBe('number');

    const createdAtField = manifest.fields.find((f) => f.name === 'createdAt');
    expect(createdAtField?.type).toBe('date');
  });


  it('defaults to string type in none mode', async () => {
    const tickets = generateTicketArray(100);
    const simpleConfig: SimpleBundleConfig<Ticket> = {
      datasetId: 'tickets-simple',
      equal: ['priority', 'isEscalated'],
      ranges: ['slaHours'],
      inferTypes: 'none',
    };

    const bundle = await createBundle(tickets, simpleConfig);
    const manifest = bundle.describe();

    const isEscalatedField = manifest.fields.find((f) => f.name === 'isEscalated');
    expect(isEscalatedField?.type).toBe('string');

    const slaHoursField = manifest.fields.find((f) => f.name === 'slaHours');
    expect(slaHoursField?.type).toBe('number'); // ranges default to number in none mode
  });


  it('auto-adds remaining simple fields as meta by default', async () => {
    const tickets = generateTicketArray(100);
    const simpleConfig: SimpleBundleConfig<Ticket> = {
      datasetId: 'tickets-simple',
      equal: ['priority', 'status'],
      ranges: ['createdAt'],
      // autoMeta defaults to true
    };

    const bundle = await createBundle(tickets, simpleConfig);
    const manifest = bundle.describe();

    // Explicitly configured fields
    expect(manifest.fields.find((f) => f.name === 'id')).toBeDefined();
    expect(manifest.fields.find((f) => f.name === 'priority')).toBeDefined();
    expect(manifest.fields.find((f) => f.name === 'status')).toBeDefined();
    expect(manifest.fields.find((f) => f.name === 'createdAt')).toBeDefined();
    expect(manifest.fields.find((f) => f.name === 'createdAt')?.kind).toBe('range');

    // Auto-added meta fields (simple primitives)
    expect(manifest.fields.find((f) => f.name === 'customerId')).toBeDefined();
    expect(manifest.fields.find((f) => f.name === 'customerId')?.kind).toBe('meta');
    expect(manifest.fields.find((f) => f.name === 'customerName')).toBeDefined();
    expect(manifest.fields.find((f) => f.name === 'customerName')?.kind).toBe('meta');
    expect(manifest.fields.find((f) => f.name === 'isEscalated')).toBeDefined();
    expect(manifest.fields.find((f) => f.name === 'isEscalated')?.kind).toBe('meta');
    expect(manifest.fields.find((f) => f.name === 'slaHours')).toBeDefined();
    expect(manifest.fields.find((f) => f.name === 'slaHours')?.kind).toBe('meta'); // auto-added as meta
  });


  it('skips auto-meta when autoMeta is false', async () => {
    const tickets = generateTicketArray(100);
    const simpleConfig: SimpleBundleConfig<Ticket> = {
      datasetId: 'tickets-simple',
      equal: ['priority', 'status'],
      ranges: ['createdAt'],
      autoMeta: false,
    };

    const bundle = await createBundle(tickets, simpleConfig);
    const manifest = bundle.describe();

    // Only explicitly configured fields should be present
    const fieldNames = manifest.fields.map((f) => f.name);
    expect(fieldNames).toContain('id'); // auto-detected
    expect(fieldNames).toContain('priority');
    expect(fieldNames).toContain('status');
    expect(fieldNames).toContain('createdAt');

    // Auto-meta fields should not be present
    expect(fieldNames).not.toContain('customerId');
    expect(fieldNames).not.toContain('customerName');
    expect(fieldNames).not.toContain('isEscalated');
  });


  it('skips complex/nested fields in auto-meta', async () => {
    const ticketsWithComplex = generateTicketArray(10).map((ticket) => ({
      ...ticket,
      metadata: { nested: 'object' },
      tags: ['tag1', 'tag2'], // array of primitives - should be included
    }));

    const simpleConfig: SimpleBundleConfig<typeof ticketsWithComplex[0]> = {
      datasetId: 'tickets-complex',
      equal: ['priority'],
      // autoMeta defaults to true
    };

    const bundle = await createBundle(ticketsWithComplex, simpleConfig);
    const manifest = bundle.describe();

    const fieldNames = manifest.fields.map((f) => f.name);

    // Simple fields should be auto-added
    expect(fieldNames).toContain('tags'); // array of primitives

    // Complex objects should be skipped
    expect(fieldNames).not.toContain('metadata');
  });


  it('handles explicit meta fields', async () => {
    const tickets = generateTicketArray(100);
    const simpleConfig: SimpleBundleConfig<Ticket> = {
      datasetId: 'tickets-simple',
      equal: ['priority'],
      meta: ['customerName', 'ownerTeam'],
    };

    const bundle = await createBundle(tickets, simpleConfig);
    const manifest = bundle.describe();

    const customerNameField = manifest.fields.find((f) => f.name === 'customerName');
    expect(customerNameField?.kind).toBe('meta');
    expect(customerNameField).toBeDefined();

    const ownerTeamField = manifest.fields.find((f) => f.name === 'ownerTeam');
    expect(ownerTeamField?.kind).toBe('meta');
    expect(ownerTeamField).toBeDefined();
  });


  it('produces equivalent results with simple and explicit configs', async () => {
    const tickets = generateTicketArray(DATASET_SIZE);

    const simpleConfig: SimpleBundleConfig<Ticket> = {
      datasetId: 'tickets-simple',
      equal: ['priority', 'status', 'customerId'],
      ranges: ['createdAt'],
    };

    const bundleSimple = await createBundle(tickets, simpleConfig);
    const bundleExplicit = await createBundle(tickets, testConfig);

    const query = {
      equal: {
        priority: 'high',
        status: 'open',
      },
    };

    const resultSimple = bundleSimple.query(query);
    const resultExplicit = bundleExplicit.query(query);

    expect(resultSimple.total).toBe(resultExplicit.total);
    expect(resultSimple.items.length).toBe(resultExplicit.items.length);
  });


  it('throws error for invalid range type', async () => {
    const ticketsWithInvalidRange = [
      {
        id: 'T-1',
        status: 'open',
        invalidRange: 'not-a-number-or-date',
      },
    ];

    const simpleConfig: SimpleBundleConfig<typeof ticketsWithInvalidRange[0]> = {
      datasetId: 'test',
      ranges: ['invalidRange'],
    };

    await expect(createBundle(ticketsWithInvalidRange, simpleConfig)).rejects.toThrow(
      'Cannot infer range type',
    );
  });


  it('handles empty items array gracefully', async () => {
    const simpleConfig: SimpleBundleConfig<Ticket> = {
      datasetId: 'empty',
      equal: ['priority'],
    };

    const bundle = await createBundle([], simpleConfig);
    const manifest = bundle.describe();

    expect(manifest.datasetId).toBe('empty');
    expect(manifest.fields.length).toBeGreaterThan(0); // id should be auto-detected even with empty array
  });


  it('works with createBundle overloads for type inference', async () => {
    const tickets = generateTicketArray(100);

    // Test explicit config overload
    const explicitBundle = await createBundle(tickets, testConfig);
    expect(explicitBundle).toBeDefined();

    // Test simple config overload
    const simpleConfig: SimpleBundleConfig<Ticket> = {
      datasetId: 'test',
      equal: ['priority'],
    };
    const simpleBundle = await createBundle(tickets, simpleConfig);
    expect(simpleBundle).toBeDefined();

    // Both should work
    const result1 = explicitBundle.query({ equal: { priority: 'high' } });
    const result2 = simpleBundle.query({ equal: { priority: 'high' } });
    expect(result1.total).toBe(result2.total);
  });
});
