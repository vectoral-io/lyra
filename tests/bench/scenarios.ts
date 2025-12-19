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

  const configWithAliases = {
    datasetId: 'tickets-bench-aliases',
    fields: {
      id: { kind: 'id' as const, type: 'string' as const },
      customerId: { kind: 'facet' as const, type: 'string' as const },
      customerName: { kind: 'alias' as const, type: 'string' as const, targetField: 'customerId' },
      status: { kind: 'facet' as const, type: 'string' as const },
      priority: { kind: 'facet' as const, type: 'string' as const },
      createdAt: { kind: 'range' as const, type: 'date' as const },
      slaHours: { kind: 'range' as const, type: 'number' as const },
    },
  };

  const [bundle1k, bundle10k, bundle100k, bundle100kWithAliases] = await Promise.all([
    createBundle(data1k, config),
    createBundle(data10k, config),
    createBundle(data100k, config),
    createBundle(data100k, configWithAliases),
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
    {
      name: '100k / canonical facet (baseline)',
      setup: async () => ({
        run: () => {
          bundle100kWithAliases.query({
            equal: { customerId: 'C-ACME' },
            enrichAliases: false,
          });
        },
      }),
    },
    {
      name: '100k / alias resolution',
      setup: async () => ({
        run: () => {
          bundle100kWithAliases.query({
            equal: { customerName: 'Acme Corp' },
            enrichAliases: false,
          });
        },
      }),
    },
    {
      name: '100k / enrichAliases: true',
      setup: async () => ({
        run: () => {
          bundle100kWithAliases.query({
            equal: { customerId: 'C-ACME' },
            enrichAliases: true,
          });
        },
      }),
    },
    {
      name: '100k / enrichAliases: false',
      setup: async () => ({
        run: () => {
          bundle100kWithAliases.query({
            equal: { customerId: 'C-ACME' },
            enrichAliases: false,
          });
        },
      }),
    },
    {
      name: '100k / alias + enrichment',
      setup: async () => ({
        run: () => {
          bundle100kWithAliases.query({
            equal: { customerName: 'Acme Corp' },
            enrichAliases: true,
          });
        },
      }),
    },
    {
      name: '100k / bundle creation with aliases',
      setup: async () => {
        const data = generateTicketArray(100_000);
        return {
          run: async () => {
            await createBundle(data, configWithAliases);
          },
        };
      },
    },
    {
      name: '100k / utility: getAliasMap (deduplicated)',
      setup: async () => {
        const result = await bundle100kWithAliases.query({
          equal: { customerId: 'C-ACME' },
          limit: 100,
        });
        const uniqueIds = [...new Set(result.items.map(item => item.customerId))];
        return {
          run: () => {
            bundle100kWithAliases.getAliasMap('customerName', uniqueIds);
          },
        };
      },
    },
    {
      name: '100k / utility: enrichResult',
      setup: async () => {
        const result = await bundle100kWithAliases.query({
          equal: { customerId: 'C-ACME' },
          limit: 100,
        });
        return {
          run: () => {
            bundle100kWithAliases.enrichResult(result, ['customerName']);
          },
        };
      },
    },
    {
      name: '100k / utility: enrichItems',
      setup: async () => {
        const result = await bundle100kWithAliases.query({
          equal: { customerId: 'C-ACME' },
          limit: 100,
        });
        return {
          run: () => {
            bundle100kWithAliases.enrichItems(result.items, ['customerName']);
          },
        };
      },
    },
  ];
}