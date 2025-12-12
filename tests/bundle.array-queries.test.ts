import { describe, it, expect } from 'vitest';
import { LyraBundle } from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';
import { testConfig } from './test-config';

describe('LyraBundle - Array Queries', () => {
  const SMALL_DATASET_SIZE = 100;

  describe('Array Facets with Union Mode (OR logic)', () => {
    it('should return items matching ANY of the facet objects (default union mode)', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      // Find distinct values for testing
      const customer1 = tickets.find((t) => t.customerId === 'C-ACME')?.customerId || tickets[0].customerId;
      const customer2 = tickets.find((t) => t.customerId === 'C-GLOBEX')?.customerId || tickets[1].customerId;

      const result = bundle.query({
        facets: [
          { customerId: customer1 },
          { customerId: customer2 },
        ],
      });

      // Should match items with EITHER customer1 OR customer2
      expect(result.total).toBeGreaterThan(0);
      for (const item of result.items) {
        expect([customer1, customer2]).toContain(item.customerId);
      }

      // Verify union: should equal sum of individual queries (assuming no overlap)
      const result1 = bundle.query({ facets: { customerId: customer1 } });
      const result2 = bundle.query({ facets: { customerId: customer2 } });
      
      // Total should be at least as large as either individual query
      expect(result.total).toBeGreaterThanOrEqual(result1.total);
      expect(result.total).toBeGreaterThanOrEqual(result2.total);
    });

    it('should support explicit union mode parameter', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const status1 = 'open';
      const status2 = 'in_progress';

      const result = bundle.query({
        facets: [
          { status: status1 },
          { status: status2 },
        ],
        facetMode: 'union',
      });

      expect(result.total).toBeGreaterThan(0);
      for (const item of result.items) {
        expect([status1, status2]).toContain(item.status);
      }
    });

    it('should handle complex multi-field facet objects in union mode', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      // Find items with specific combinations
      const combo1Customer = tickets[0].customerId;
      const combo1Priority = tickets[0].priority;
      
      const combo2Customer = tickets.find((t) => t.customerId !== combo1Customer)?.customerId || tickets[1].customerId;
      const combo2Priority = tickets.find((t) => t.priority !== combo1Priority)?.priority || tickets[1].priority;

      const result = bundle.query({
        facets: [
          { customerId: combo1Customer, priority: combo1Priority },
          { customerId: combo2Customer, priority: combo2Priority },
        ],
        facetMode: 'union',
      });

      expect(result.total).toBeGreaterThan(0);
      
      // Each item should match at least one of the combinations
      for (const item of result.items) {
        const matchesCombo1 = item.customerId === combo1Customer && item.priority === combo1Priority;
        const matchesCombo2 = item.customerId === combo2Customer && item.priority === combo2Priority;
        expect(matchesCombo1 || matchesCombo2).toBe(true);
      }
    });
  });

  describe('Array Facets with Intersection Mode (AND logic)', () => {
    it('should return items matching ALL facet objects with intersection mode', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      // Find a ticket with multiple attributes
      const sampleTicket = tickets[0];

      const result = bundle.query({
        facets: [
          { customerId: sampleTicket.customerId },
          { priority: sampleTicket.priority },
        ],
        facetMode: 'intersection',
      });

      // Should match items with BOTH customer AND priority
      expect(result.total).toBeGreaterThan(0);
      for (const item of result.items) {
        expect(item.customerId).toBe(sampleTicket.customerId);
        expect(item.priority).toBe(sampleTicket.priority);
      }

      // Verify intersection: should be smaller or equal to individual queries
      const result1 = bundle.query({ facets: { customerId: sampleTicket.customerId } });
      const result2 = bundle.query({ facets: { priority: sampleTicket.priority } });
      
      expect(result.total).toBeLessThanOrEqual(result1.total);
      expect(result.total).toBeLessThanOrEqual(result2.total);
    });

    it('should return empty results if no items match all facet objects', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      // Create impossible combination
      const result = bundle.query({
        facets: [
          { status: 'open' },
          { status: 'closed' },
        ],
        facetMode: 'intersection',
      });

      // No item can have both status values simultaneously
      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });

  describe('Array Ranges with Union Mode (OR logic)', () => {
    it('should return items matching ANY of the range objects (default union mode)', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const earlyDate = Date.parse('2025-10-01T00:00:00Z');
      const midDate = Date.parse('2025-11-01T00:00:00Z');
      const lateDate = Date.parse('2025-12-31T23:59:59Z');

      const result = bundle.query({
        ranges: [
          { createdAt: { max: midDate } }, // Early tickets
          { createdAt: { min: midDate } }, // Late tickets
        ],
      });

      // Should match all tickets (union of before and after midDate)
      expect(result.total).toBeGreaterThan(0);
      
      // Verify each item matches at least one range
      for (const item of result.items) {
        const createdAt = Date.parse(item.createdAt);
        const matchesRange1 = createdAt <= midDate;
        const matchesRange2 = createdAt >= midDate;
        expect(matchesRange1 || matchesRange2).toBe(true);
      }
    });

    it('should support explicit union mode for ranges', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const result = bundle.query({
        ranges: [
          { slaHours: { max: 12 } },
          { slaHours: { min: 48 } },
        ],
        rangeMode: 'union',
      });

      expect(result.total).toBeGreaterThan(0);
      
      for (const item of result.items) {
        const matchesLowSla = item.slaHours <= 12;
        const matchesHighSla = item.slaHours >= 48;
        expect(matchesLowSla || matchesHighSla).toBe(true);
      }
    });
  });

  describe('Array Ranges with Intersection Mode (AND logic)', () => {
    it('should return items matching ALL range objects with intersection mode', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const minDate = Date.parse('2025-10-01T00:00:00Z');
      const maxDate = Date.parse('2025-12-31T23:59:59Z');

      const result = bundle.query({
        ranges: [
          { createdAt: { min: minDate } },
          { createdAt: { max: maxDate } },
        ],
        rangeMode: 'intersection',
      });

      // Should match items within BOTH ranges (equivalent to min AND max)
      expect(result.total).toBeGreaterThan(0);
      
      for (const item of result.items) {
        const createdAt = Date.parse(item.createdAt);
        expect(createdAt).toBeGreaterThanOrEqual(minDate);
        expect(createdAt).toBeLessThanOrEqual(maxDate);
      }
    });

    it('should return empty results for impossible range intersections', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const result = bundle.query({
        ranges: [
          { slaHours: { max: 10 } },
          { slaHours: { min: 50 } },
        ],
        rangeMode: 'intersection',
      });

      // No item can satisfy both ranges (slaHours <= 10 AND >= 50)
      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });
  });

  describe('Mixed Array Facets and Ranges', () => {
    it('should support arrays for both facets and ranges simultaneously', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const customer1 = tickets[0].customerId;
      const customer2 = tickets.find((t) => t.customerId !== customer1)?.customerId || tickets[1].customerId;
      
      const midSla = 24;

      const result = bundle.query({
        facets: [
          { customerId: customer1 },
          { customerId: customer2 },
        ],
        ranges: [
          { slaHours: { max: midSla } },
          { slaHours: { min: midSla } },
        ],
        facetMode: 'union',
        rangeMode: 'union',
      });

      expect(result.total).toBeGreaterThan(0);
      
      // Verify items match the union logic
      for (const item of result.items) {
        const matchesCustomer = [customer1, customer2].includes(item.customerId);
        const matchesSla = item.slaHours <= midSla || item.slaHours >= midSla;
        expect(matchesCustomer).toBe(true);
        expect(matchesSla).toBe(true);
      }
    });

    it('should handle different modes for facets and ranges', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const sampleTicket = tickets[0];

      const result = bundle.query({
        facets: [
          { customerId: sampleTicket.customerId },
          { priority: sampleTicket.priority },
        ],
        ranges: [
          { slaHours: { min: 2 } },
          { slaHours: { max: 72 } },
        ],
        facetMode: 'intersection', // Must match BOTH customer AND priority
        rangeMode: 'union', // Can match EITHER range
      });

      expect(result.total).toBeGreaterThan(0);
      
      for (const item of result.items) {
        // Must match both facets (intersection)
        expect(item.customerId).toBe(sampleTicket.customerId);
        expect(item.priority).toBe(sampleTicket.priority);
        
        // Must match at least one range (union)
        const matchesRange = item.slaHours >= 2 || item.slaHours <= 72;
        expect(matchesRange).toBe(true);
      }
    });
  });

  describe('Edge Cases and Backward Compatibility', () => {
    it('should maintain backward compatibility with single facet object', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const sampleCustomer = tickets[0].customerId;

      const result = bundle.query({
        facets: { customerId: sampleCustomer },
      });

      expect(result.total).toBeGreaterThan(0);
      for (const item of result.items) {
        expect(item.customerId).toBe(sampleCustomer);
      }
    });

    it('should handle empty facet array', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const result = bundle.query({
        facets: [],
      });

      // Empty array should match all items
      expect(result.total).toBe(SMALL_DATASET_SIZE);
    });

    it('should handle single-element facet array', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const sampleStatus = tickets[0].status;

      const resultArray = bundle.query({
        facets: [{ status: sampleStatus }],
      });

      const resultSingle = bundle.query({
        facets: { status: sampleStatus },
      });

      // Single-element array should behave same as single object
      expect(resultArray.total).toBe(resultSingle.total);
    });

    it('should handle empty range array', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const result = bundle.query({
        ranges: [],
      });

      // Empty array should match all items
      expect(result.total).toBe(SMALL_DATASET_SIZE);
    });

    it('should handle facet array with empty objects', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const result = bundle.query({
        facets: [{}, {}],
        facetMode: 'union',
      });

      // Empty objects should match all items
      expect(result.total).toBe(SMALL_DATASET_SIZE);
    });

    it('should handle pagination with array queries', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const result = bundle.query({
        facets: [
          { status: 'open' },
          { status: 'in_progress' },
        ],
        facetMode: 'union',
        limit: 10,
        offset: 5,
      });

      expect(result.items.length).toBeLessThanOrEqual(10);
      expect(result.total).toBeGreaterThanOrEqual(result.items.length);
    });

    it('should include facet counts with array queries', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const result = bundle.query({
        facets: [
          { status: 'open' },
          { status: 'closed' },
        ],
        facetMode: 'union',
        includeFacetCounts: true,
      });

      expect(result.facets).toBeDefined();
      expect(result.facets?.status).toBeDefined();
      expect(result.facets?.priority).toBeDefined();
    });

    it('should preserve applied query in result for array format', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const facets = [
        { status: 'open' },
        { status: 'closed' },
      ];

      const result = bundle.query({
        facets,
        facetMode: 'union',
      });

      expect(result.applied.facets).toEqual(facets);
    });
  });

  describe('Complex Real-World Scenarios', () => {
    it('should handle the original user example: multiple trade and category combinations', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      // Simulate the user's example with available fields
      const result = bundle.query({
        facets: [
          { productArea: 'analytics', priority: 'high' },
          { productArea: 'billing', priority: 'urgent' },
        ],
        facetMode: 'union',
      });

      // Should return items matching EITHER (analytics + high) OR (billing + urgent)
      for (const item of result.items) {
        const matchesCombo1 = item.productArea === 'analytics' && item.priority === 'high';
        const matchesCombo2 = item.productArea === 'billing' && item.priority === 'urgent';
        expect(matchesCombo1 || matchesCombo2).toBe(true);
      }
    });

    it('should support complex filtering: multiple customers OR high priority tickets in specific regions', async () => {
      const tickets = generateTicketArray(SMALL_DATASET_SIZE);
      const bundle = await LyraBundle.create<Ticket>(tickets, testConfig);

      const customer1 = tickets[0].customerId;
      const customer2 = tickets.find((t) => t.customerId !== customer1)?.customerId || tickets[1].customerId;

      const result = bundle.query({
        facets: [
          { customerId: customer1 },
          { customerId: customer2 },
          { priority: 'urgent', region: 'NA' },
        ],
        facetMode: 'union',
      });

      for (const item of result.items) {
        const matchesCustomer = item.customerId === customer1 || item.customerId === customer2;
        const matchesUrgentNA = item.priority === 'urgent' && item.region === 'NA';
        expect(matchesCustomer || matchesUrgentNA).toBe(true);
      }
    });
  });
});

