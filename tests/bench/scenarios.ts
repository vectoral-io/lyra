// bench/scenarios.ts
import { createBundle } from '../../src/bundle';
import { generateTicketArray } from '../tickets.fixture';

export type ScenarioResult = {
  name: string;
  iterations: number;
  meanMs: number;
};

export interface Scenario {
  name: string;
  setup: () => Promise<{
    run: () => void | Promise<void>;
  }>;
}

export async function getScenarios(): Promise<Scenario[]> {
  // Adjust sizes and shapes to match your Vitest benches
  const data1k = generateTicketArray(1_000);
  const data10k = generateTicketArray(10_000);
  const data100k = generateTicketArray(100_000);

  const config = {
    datasetId: 'tickets-bench',
    fields: {
      id: { kind: 'id' as const, type: 'string' as const },
      status: { kind: 'facet' as const, type: 'string' as const },
      priority: { kind: 'facet' as const, type: 'string' as const },
      customerId: { kind: 'facet' as const, type: 'string' as const },
      createdAt: { kind: 'range' as const, type: 'date' as const },
      slaHours: { kind: 'range' as const, type: 'number' as const },
    },
  };

  const [bundle1k, bundle10k, bundle100k] = await Promise.all([
    createBundle(data1k, config),
    createBundle(data10k, config),
    createBundle(data100k, config),
  ]);

  return [
    {
      name: '100k / single facet (customerId)',
      setup: async () => ({
        run: () => {
          bundle100k.query({
            equal: { customerId: 'C-ACME' },
          });
        },
      }),
    },
    {
      name: '100k / multi-facet + ranges + pagination',
      setup: async () => ({
        run: () => {
          bundle100k.query({
            equal: {
              customerId: 'C-ACME',
              status: ['open', 'blocked'],
              priority: ['high', 'urgent'],
            },
            ranges: {
              createdAt: { min: Date.now() - 7 * 24 * 3600_000 },
              slaHours: { min: 0, max: 72 },
            },
            offset: 20,
            limit: 50,
          });
        },
      }),
    },
    {
      name: '10k / full feature set',
      setup: async () => ({
        run: () => {
          bundle10k.query({
            equal: {
              status: ['open', 'blocked'],
              priority: ['high'],
            },
            ranges: {
              createdAt: { min: Date.now() - 30 * 24 * 3600_000 },
            },
            includeFacetCounts: true,
            offset: 0,
            limit: 100,
          });
        },
      }),
    },
  ];
}