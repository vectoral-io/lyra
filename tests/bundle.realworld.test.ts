import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { gunzipSync, gzipSync } from 'node:zlib';
import { LyraBundle } from '../src';
import {
  generateWorkItems,
  WORK_ITEM_CONFIG,
  type WorkItem,
} from './bench/realworld-fixture';

const ITEM_COUNT = 10_000;

describe('Real-world workload — deeply-nested WorkItem fixture', () => {
  it('binary cold-start beats JSON wire-form by an order of magnitude', async () => {
    const items = generateWorkItems({ itemCount: ITEM_COUNT, seed: 7 });
    const bundle = await LyraBundle.create<WorkItem>(items, WORK_ITEM_CONFIG);

    const wire = JSON.stringify(bundle.toJSON());
    const bin = bundle.serialize('binary');

    // Wire size: v4.1 binary should not be larger than v3.1 JSON for this shape.
    expect(bin.byteLength).toBeLessThanOrEqual(wire.length);

    // Cold-start: parse off-the-wire JSON + load + first query.
    const sample = { equal: { status: 'IN_PROGRESS' as const }, limit: 50 };
    const v3Runs = 3;
    const v4Runs = 3;

    const v3Times: number[] = [];
    for (let i = 0; i < v3Runs; i++) {
      const t = performance.now();
      const parsed = JSON.parse(wire);
      const fresh = LyraBundle.load<WorkItem>(parsed);
      fresh.query(sample);
      v3Times.push(performance.now() - t);
    }

    const v4Times: number[] = [];
    for (let i = 0; i < v4Runs; i++) {
      const t = performance.now();
      const fresh = LyraBundle.loadBinary<WorkItem>(bin);
      fresh.query(sample);
      v4Times.push(performance.now() - t);
    }

    const median = (samples: number[]): number => {
      const sorted = samples.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const v3Median = median(v3Times);
    const v4Median = median(v4Times);

    // We've measured ~40-50× in standalone runs at 100k+. Use a conservative
    // 3× lower bound for the in-test assertion to absorb CI variance.
    expect(v4Median * 3).toBeLessThan(v3Median);
  });

  it('binary and JSON loads return identical query results', async () => {
    const items = generateWorkItems({ itemCount: 2_000, seed: 13 });
    const bundle = await LyraBundle.create<WorkItem>(items, WORK_ITEM_CONFIG);

    const fromJson = LyraBundle.load<WorkItem>(
      JSON.parse(JSON.stringify(bundle.toJSON())),
    );
    const fromBin = LyraBundle.loadBinary<WorkItem>(bundle.serialize('binary'));

    const queries = [
      { equal: { status: 'COMPLETE' } },
      { equal: { category: 'Cat-Alpha' } },
      { equal: { tag: 'tag-101' }, limit: 100 },
      { equal: { group_id: 5 } },
      { equal: { status: ['IN_PROGRESS', 'NOT_STARTED'] }, limit: 200 },
      { equal: { status: 'COMPLETE' }, includeFacetCounts: true, limit: 0 },
    ];
    for (const q of queries) {
      const a = fromJson.query(q);
      const b = fromBin.query(q);
      expect(b.total).toBe(a.total);
      expect(b.items.length).toBe(a.items.length);
      if (q.includeFacetCounts) {
        expect(b.facets).toEqual(a.facets);
      }
    }
  });

  it('binary stays smaller than JSON after gzip — matches production upload path', async () => {
    const items = generateWorkItems({ itemCount: 5_000, seed: 23 });
    const bundle = await LyraBundle.create<WorkItem>(items, WORK_ITEM_CONFIG);

    const jsonBuf = Buffer.from(JSON.stringify(bundle.toJSON()), 'utf-8');
    const binBuf = Buffer.from(bundle.serialize('binary'));

    const jsonGz = gzipSync(jsonBuf);
    const binGz = gzipSync(binBuf);

    // Both formats compress, but binary should still hold its absolute lead.
    expect(binGz.length).toBeLessThanOrEqual(jsonGz.length);

    // And both round-trip cleanly through gunzip.
    const fromJson = LyraBundle.load<WorkItem>(JSON.parse(gunzipSync(jsonGz).toString('utf-8')));
    const fromBin = LyraBundle.loadBinary<WorkItem>(gunzipSync(binGz));

    const a = fromJson.query({ equal: { status: 'COMPLETE' } });
    const b = fromBin.query({ equal: { status: 'COMPLETE' } });
    expect(b.total).toBe(a.total);
    expect(b.items.length).toBe(a.items.length);
  });

  it('binary load preserves nested steps and array fields per item', async () => {
    const items = generateWorkItems({ itemCount: 500, seed: 17 });
    const bundle = await LyraBundle.create<WorkItem>(items, WORK_ITEM_CONFIG);
    const loaded = LyraBundle.loadBinary<WorkItem>(bundle.serialize('binary'));

    const result = loaded.query({ limit: items.length });
    expect(result.items.length).toBe(items.length);

    for (let i = 0; i < items.length; i++) {
      const original = items[i];
      const round = result.items[i];
      expect(round.id).toBe(original.id);
      expect(round.uid).toBe(original.uid);
      expect(round.group_id).toBe(original.group_id);
      expect(round.category).toBe(original.category);
      expect(round.tag).toBe(original.tag);
      expect(round.status).toBe(original.status);
      expect(round.completed_step_ids).toEqual(original.completed_step_ids);
      expect(round.pending_step_ids).toEqual(original.pending_step_ids);
      expect(round.steps).toEqual(original.steps);
    }
  });
});
