import { bench, describe } from 'vitest';
import { LyraBundle, type CreateBundleConfig } from '../src';
import { generateTicketArray, type Ticket } from './tickets.fixture';

// Setup
// ==============================

const config: CreateBundleConfig = {
  datasetId: 'tickets-benchmark',
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

// Benchmark suites
// ==============================

describe('Query Performance Benchmarks', async () => {
  const datasetSizes = [1000, 10000, 100000];
  const bundles: Map<number, LyraBundle<Ticket>> = new Map();

  // Pre-create bundles for all dataset sizes
  for (const size of datasetSizes) {
    const tickets = generateTicketArray(size);
    bundles.set(size, await LyraBundle.create<Ticket>(tickets, config));
  }

  for (const size of datasetSizes) {
    const tickets = generateTicketArray(size);
    const bundle = bundles.get(size)!;

    describe(`${size.toLocaleString()} items`, () => {
      // Single facet queries
      describe('Single facet queries', () => {
        bench('query - single facet (customerId)', () => {
          const sampleCustomer = tickets[0].customerId;
          bundle.query({ facets: { customerId: sampleCustomer } });
        });

        bench('query - single facet (priority)', () => {
          const samplePriority = tickets[0].priority;
          bundle.query({ facets: { priority: samplePriority } });
        });

        bench('query - single facet (status)', () => {
          const sampleStatus = tickets[0].status;
          bundle.query({ facets: { status: sampleStatus } });
        });
      });

      // Multi-facet queries
      describe('Multi-facet queries', () => {
        bench('query - multi-facet (2 facets)', () => {
          const sampleCustomer = tickets[0].customerId;
          const samplePriority = tickets[0].priority;
          bundle.query({
            facets: {
              customerId: sampleCustomer,
              priority: samplePriority,
            },
          });
        });

        bench('query - multi-facet (3 facets)', () => {
          const sampleCustomer = tickets[0].customerId;
          const samplePriority = tickets[0].priority;
          const sampleStatus = tickets[0].status;
          bundle.query({
            facets: {
              customerId: sampleCustomer,
              priority: samplePriority,
              status: sampleStatus,
            },
          });
        });

        bench('query - multi-facet (5 facets)', () => {
          const sampleCustomer = tickets[0].customerId;
          const samplePriority = tickets[0].priority;
          const sampleStatus = tickets[0].status;
          const sampleProductArea = tickets[0].productArea;
          const sampleRegion = tickets[0].region;
          bundle.query({
            facets: {
              customerId: sampleCustomer,
              priority: samplePriority,
              status: sampleStatus,
              productArea: sampleProductArea,
              region: sampleRegion,
            },
          });
        });
      });

      // Range queries
      describe('Range queries', () => {
        bench('query - single range filter (slaHours)', () => {
          const minSlaHours = 12;
          const maxSlaHours = 48;
          bundle.query({
            ranges: {
              slaHours: { min: minSlaHours, max: maxSlaHours },
            },
          });
        });

        bench('query - single range filter (createdAt)', () => {
          const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
          const now = Date.now();
          bundle.query({
            ranges: {
              createdAt: { min: thirtyDaysAgo, max: now },
            },
          });
        });

        bench('query - multiple range filters', () => {
          const minSlaHours = 12;
          const maxSlaHours = 48;
          const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
          const now = Date.now();
          bundle.query({
            ranges: {
              slaHours: { min: minSlaHours, max: maxSlaHours },
              createdAt: { min: thirtyDaysAgo, max: now },
            },
          });
        });
      });

      // Combined facet and range queries
      describe('Combined facet and range queries', () => {
        bench('query - facets + ranges', () => {
          const sampleCustomer = tickets[0].customerId;
          const samplePriority = tickets[0].priority;
          const minSlaHours = 12;
          const maxSlaHours = 48;
          bundle.query({
            facets: {
              customerId: sampleCustomer,
              priority: samplePriority,
            },
            ranges: {
              slaHours: { min: minSlaHours, max: maxSlaHours },
            },
          });
        });
      });

      // Queries with facet counts
      describe('Queries with facet counts', () => {
        bench('query - single facet with counts', () => {
          const sampleCustomer = tickets[0].customerId;
          bundle.query({
            facets: { customerId: sampleCustomer },
            includeFacetCounts: true,
          });
        });

        bench('query - multi-facet with counts', () => {
          const sampleCustomer = tickets[0].customerId;
          const samplePriority = tickets[0].priority;
          const sampleStatus = tickets[0].status;
          bundle.query({
            facets: {
              customerId: sampleCustomer,
              priority: samplePriority,
              status: sampleStatus,
            },
            includeFacetCounts: true,
          });
        });
      });

      // Queries with pagination
      describe('Queries with pagination', () => {
        bench('query - with limit', () => {
          const sampleCustomer = tickets[0].customerId;
          bundle.query({
            facets: { customerId: sampleCustomer },
            limit: 10,
          });
        });

        bench('query - with offset and limit', () => {
          const sampleCustomer = tickets[0].customerId;
          bundle.query({
            facets: { customerId: sampleCustomer },
            offset: 50,
            limit: 20,
          });
        });
      });

      // Complex queries
      describe('Complex queries', () => {
        bench('query - multi-facet + ranges + pagination', () => {
          const sampleCustomer = tickets[0].customerId;
          const samplePriority = tickets[0].priority;
          const minSlaHours = 12;
          const maxSlaHours = 48;
          bundle.query({
            facets: {
              customerId: sampleCustomer,
              priority: samplePriority,
            },
            ranges: {
              slaHours: { min: minSlaHours, max: maxSlaHours },
            },
            limit: 25,
            offset: 10,
          });
        });

        bench('query - full feature set (facets + ranges + counts + pagination)', () => {
          const sampleCustomer = tickets[0].customerId;
          const samplePriority = tickets[0].priority;
          const sampleStatus = tickets[0].status;
          const minSlaHours = 12;
          const maxSlaHours = 48;
          bundle.query({
            facets: {
              customerId: sampleCustomer,
              priority: samplePriority,
              status: sampleStatus,
            },
            ranges: {
              slaHours: { min: minSlaHours, max: maxSlaHours },
            },
            includeFacetCounts: true,
            limit: 50,
            offset: 0,
          });
        });
      });
    });
  }
});
