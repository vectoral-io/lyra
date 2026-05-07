// bench/scenarios.ts
import { createBundle, LyraBundle } from '../../src/bundle';
import { intersectSorted, mergeUnionSorted } from '../../src/utils/array-operations';
import { filterByRanges } from '../../src/query/filters';
import { generateTicketArray } from '../tickets.fixture';
import type { LyraBundleJSON } from '../../src/types';

function makeRange(start: number, end: number): number[] {
  const out = new Array(end - start);
  for (let i = 0; i < out.length; i++) out[i] = start + i;
  return out;
}

function makeSubset(source: number[], count: number): number[] {
  const step = Math.max(1, Math.floor(source.length / count));
  const out: number[] = [];
  for (let i = 0; i < source.length && out.length < count; i += step) out.push(source[i]);
  return out;
}

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

  // Micro-bench fixtures: sorted integer arrays for intersection.
  const toU32 = (arr: number[]) => Uint32Array.from(arr);
  const intersectScratch = new Uint32Array(100_000);
  // 50% overlap: A=[0..50000), B=[25000..75000) → 25000 overlap
  const arrSimilarA = toU32(makeRange(0, 50_000));
  const arrSimilarB = toU32(makeRange(25_000, 75_000));
  // 1% overlap: A=[0..50000), B=[49500..99500) → 500 overlap
  const arrLowOverlapA = toU32(makeRange(0, 50_000));
  const arrLowOverlapB = toU32(makeRange(49_500, 99_500));
  // Skewed: A=100 values from B's 100k
  const arrBigB = toU32(makeRange(0, 100_000));
  const arrSmallA = toU32(makeSubset(makeRange(0, 100_000), 100));
  // Multi-list union: 8 sorted arrays of 5k each
  const unionInputs = Array.from({ length: 8 }, (_unused, k) =>
    toU32(makeRange(k * 4_000, k * 4_000 + 5_000)),
  );
  const unionScratch = new Uint32Array(40_000);

  // Range filter micro-bench fixture: 100k indices with two-field range data.
  const rangeIndices = toU32(makeRange(0, 100_000));
  const rangeScratch = new Uint32Array(100_000);
  // Build columns directly from items (mirrors what bundle.ts does at create time).
  const slaHoursCol = new Float64Array(data100k.length);
  const createdAtCol = new Float64Array(data100k.length);
  for (let i = 0; i < data100k.length; i++) {
    slaHoursCol[i] = data100k[i].slaHours;
    const parsed = Date.parse(data100k[i].createdAt);
    createdAtCol[i] = Number.isNaN(parsed) ? Number.NaN : parsed;
  }
  const rangeColumns = { slaHours: slaHoursCol, createdAt: createdAtCol };

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
      name: '100k / utility: getAliasValues (single id)',
      setup: async () => {
        return {
          run: () => {
            bundle100kWithAliases.getAliasValues('customerName', 'C-ACME');
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

    // --- Micro-benchmarks: isolate hot subroutines for phase-by-phase tracking. ---
    {
      name: 'micro / intersectSorted / 50k vs 50k (50% overlap)',
      setup: async () => ({
        run: () => {
          intersectSorted(arrSimilarA, arrSimilarB, intersectScratch);
        },
      }),
    },
    {
      name: 'micro / intersectSorted / 50k vs 50k (1% overlap)',
      setup: async () => ({
        run: () => {
          intersectSorted(arrLowOverlapA, arrLowOverlapB, intersectScratch);
        },
      }),
    },
    {
      name: 'micro / intersectSorted / skewed (100 vs 100k)',
      setup: async () => ({
        run: () => {
          intersectSorted(arrSmallA, arrBigB, intersectScratch);
        },
      }),
    },
    {
      name: 'micro / mergeUnionSorted / 8 × 5k',
      setup: async () => ({
        run: () => {
          mergeUnionSorted(unionInputs, unionScratch);
        },
      }),
    },
    {
      name: 'micro / filterIndicesByRange / 100k × 2 fields',
      setup: async () => ({
        run: () => {
          filterByRanges(
            rangeIndices,
            rangeIndices.length,
            { slaHours: { min: 0, max: 72 }, createdAt: { min: Date.now() - 14 * 24 * 3600_000 } },
            rangeColumns,
            rangeScratch,
          );
        },
      }),
    },
    {
      name: '100k / multi-value IN (8 customers)',
      setup: async () => ({
        run: () => {
          bundle100k.query({
            equal: {
              customerId: [
                'C-ACME', 'C-GLOBEX', 'C-INITECH', 'C-UMBRELLA',
                'C-TECHNOCORP', 'C-DYNAMICS', 'C-SYSTEMS', 'C-ENTERPRISE',
              ],
            },
          });
        },
      }),
    },
    {
      name: '100k / facet counts only (broad equal)',
      setup: async () => ({
        run: () => {
          bundle100k.query({
            equal: { status: ['open', 'in_progress'] },
            includeFacetCounts: true,
            limit: 0,
          });
        },
      }),
    },
    {
      name: '100k / ranges only (no equal)',
      setup: async () => ({
        run: () => {
          bundle100k.query({
            ranges: {
              slaHours: { min: 0, max: 72 },
              createdAt: { min: Date.now() - 14 * 24 * 3600_000 },
            },
            limit: 50,
          });
        },
      }),
    },

    // --- v3.1 serialize / hydrate cost. Informational until baselined. ---
    {
      name: '100k / serialize toJSON (v3.1)',
      setup: async () => ({
        run: () => {
          bundle100k.toJSON();
        },
      }),
    },
    {
      name: '100k / load (v3.1 binary path)',
      setup: async () => {
        const json = bundle100k.toJSON();
        return {
          run: () => {
            LyraBundle.load(json);
          },
        };
      },
    },
    {
      name: '100k / load (v3.0 legacy path, binary fields stripped)',
      setup: async () => {
        const json = bundle100k.toJSON();
        const legacy: LyraBundleJSON = {
          manifest: json.manifest,
          items: json.items,
          facetIndex: json.facetIndex,
          nullIndex: json.nullIndex,
        };
        return {
          run: () => {
            LyraBundle.load(legacy);
          },
        };
      },
    },
    // Cold start including first range-touching query — captures the real
    // win of pre-encoded range columns vs lazy rebuild from items.
    {
      name: '100k / load + first range query (v3.1 binary)',
      setup: async () => {
        const json = bundle100k.toJSON();
        return {
          run: () => {
            const fresh = LyraBundle.load(json);
            fresh.query({ ranges: { slaHours: { min: 0, max: 72 } }, limit: 1 });
          },
        };
      },
    },
    {
      name: '100k / load + first range query (v3.0 legacy)',
      setup: async () => {
        const json = bundle100k.toJSON();
        const legacy: LyraBundleJSON = {
          manifest: json.manifest,
          items: json.items,
          facetIndex: json.facetIndex,
          nullIndex: json.nullIndex,
        };
        return {
          run: () => {
            const fresh = LyraBundle.load(legacy);
            fresh.query({ ranges: { slaHours: { min: 0, max: 72 } }, limit: 1 });
          },
        };
      },
    },

    // --- v4 binary container. Informational until baselined. ---
    {
      name: '100k / serialize binary (v4)',
      setup: async () => ({
        run: () => {
          bundle100k.serialize('binary');
        },
      }),
    },
    {
      name: '100k / loadBinary (v4)',
      setup: async () => {
        const bytes = bundle100k.serialize('binary');
        return {
          run: () => {
            LyraBundle.loadBinary(bytes);
          },
        };
      },
    },
    {
      name: '100k / loadBinary + first range query (v4)',
      setup: async () => {
        const bytes = bundle100k.serialize('binary');
        return {
          run: () => {
            const fresh = LyraBundle.loadBinary(bytes);
            fresh.query({ ranges: { slaHours: { min: 0, max: 72 } }, limit: 1 });
          },
        };
      },
    },

    // --- Wire-form load: includes JSON.parse / decode cost (apples-to-apples
    //     with v4 loadBinary, which always parses items off the wire).
    {
      name: '100k / wire-form JSON.parse + load (v3.1)',
      setup: async () => {
        const wire = JSON.stringify(bundle100k.toJSON());
        return {
          run: () => {
            LyraBundle.load(JSON.parse(wire));
          },
        };
      },
    },
    {
      name: '100k / wire-form JSON.parse + load + first range query (v3.1)',
      setup: async () => {
        const wire = JSON.stringify(bundle100k.toJSON());
        return {
          run: () => {
            const fresh = LyraBundle.load(JSON.parse(wire));
            fresh.query({ ranges: { slaHours: { min: 0, max: 72 } }, limit: 1 });
          },
        };
      },
    },
    // Wire-size measurements (run once per setup; reported via run-time which
    // is dominated by the JSON.stringify / .length scan).
    {
      name: '100k / wire-size: JSON.stringify(v3.1)',
      setup: async () => ({
        run: () => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _len = JSON.stringify(bundle100k.toJSON()).length;
        },
      }),
    },
    {
      name: '100k / wire-size: serialize binary (v4)',
      setup: async () => ({
        run: () => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _len = bundle100k.serialize('binary').byteLength;
        },
      }),
    },
  ];
}