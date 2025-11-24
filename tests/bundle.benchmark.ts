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

// Naive filter implementation for comparison
// ==============================

function naiveFilterQuery<T extends Ticket>(
  items: T[],
  facets?: Record<string, unknown>,
): T[] {
  if (!facets || Object.keys(facets).length === 0) {
    return items;
  }

  return items.filter((item) => {
    return Object.entries(facets).every(([field, value]) => {
      const itemValue = item[field as keyof Ticket];

      if (Array.isArray(value)) {
        return value.includes(itemValue);
      }

      return itemValue === value;
    });
  });
}

// Benchmark suites
// ==============================

describe('Query Performance: Naive Filter vs Indexed Query', async () => {
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
      // Single facet query
      bench(`naive filter - single facet`, () => {
        const sampleCustomer = tickets[0].customerId;
        naiveFilterQuery(tickets, { customerId: sampleCustomer });
      });

      bench(`indexed query - single facet`, () => {
        const sampleCustomer = tickets[0].customerId;
        bundle.query({ facets: { customerId: sampleCustomer } });
      });

      // Multi-facet query
      bench(`naive filter - multi-facet (3 facets)`, () => {
        const sampleCustomer = tickets[0].customerId;
        const samplePriority = tickets[0].priority;
        const sampleStatus = tickets[0].status;
        naiveFilterQuery(tickets, {
          customerId: sampleCustomer,
          priority: samplePriority,
          status: sampleStatus,
        });
      });

      bench(`indexed query - multi-facet (3 facets)`, () => {
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

      // Complex multi-facet query
      bench(`naive filter - complex multi-facet (5 facets)`, () => {
        const sampleCustomer = tickets[0].customerId;
        const samplePriority = tickets[0].priority;
        const sampleStatus = tickets[0].status;
        const sampleProductArea = tickets[0].productArea;
        const sampleRegion = tickets[0].region;
        naiveFilterQuery(tickets, {
          customerId: sampleCustomer,
          priority: samplePriority,
          status: sampleStatus,
          productArea: sampleProductArea,
          region: sampleRegion,
        });
      });

      bench(`indexed query - complex multi-facet (5 facets)`, () => {
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
  }
});
