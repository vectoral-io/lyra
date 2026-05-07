/**
 * Real-world workload benchmark using the anonymized `WorkItem` fixture.
 * Reports wire size + cold-start hydrate cost across:
 *   - v3.1 JSON (off-the-wire, includes JSON.parse)
 *   - v4.1 binary (includes header + columnar items decode)
 *   - both forms gzipped (matches a production .gz upload path)
 *   - the post-network main-thread critical path (what `fetch` blocks on)
 *
 * Run: `bun run tests/bench/realworld-bench.ts`
 *
 * Tweak via env: `REALWORLD_BENCH_ITEMS=200000 REALWORLD_BENCH_SEED=7 ...`.
 */

import { performance } from 'node:perf_hooks';
import { gunzipSync, gzipSync } from 'node:zlib';
import { LyraBundle } from '../../src/bundle';
import { generateWorkItems, WORK_ITEM_CONFIG, type WorkItem } from './realworld-fixture';

const ITEM_COUNT = Number(process.env.REALWORLD_BENCH_ITEMS ?? 100_000);
const SEED = Number(process.env.REALWORLD_BENCH_SEED ?? 1);
const COLD_RUNS = Number(process.env.REALWORLD_BENCH_RUNS ?? 5);

function fmtBytes(n: number): string {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`Realworld benchmark — ${ITEM_COUNT.toLocaleString()} work items (seed=${SEED})`);

  const t0 = performance.now();
  const items = generateWorkItems({ itemCount: ITEM_COUNT, seed: SEED });
  // eslint-disable-next-line no-console
  console.log(`  fixture built          : ${(performance.now() - t0).toFixed(0)} ms`);

  const t1 = performance.now();
  const bundle = await LyraBundle.create<WorkItem>(items, WORK_ITEM_CONFIG);
  // eslint-disable-next-line no-console
  console.log(`  createBundle            : ${(performance.now() - t1).toFixed(0)} ms`);

  // Wire sizes ────────────────────────────────────────────────────────────
  const json = bundle.toJSON();
  const wire = Buffer.from(JSON.stringify(json), 'utf-8');
  const bin = bundle.serialize('binary');

  // Gzip both forms — production deployments typically upload `.gz` artifacts
  // so on-the-wire size after compression is the meaningful cost.
  const tGzipJson = performance.now();
  const wireGz = gzipSync(wire);
  const gzJsonMs = performance.now() - tGzipJson;
  const tGzipBin = performance.now();
  const binGz = gzipSync(bin);
  const gzBinMs = performance.now() - tGzipBin;

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('Wire size                 raw                       gzipped              gzip cost');
  // eslint-disable-next-line no-console
  console.log(`  v3.1 JSON          : ${fmtBytes(wire.length).padStart(10)} (${wire.length.toLocaleString().padStart(13)} B) → ${fmtBytes(wireGz.length).padStart(10)} (${wireGz.length.toLocaleString().padStart(11)} B)   ${gzJsonMs.toFixed(0).padStart(4)} ms`);
  // eslint-disable-next-line no-console
  console.log(`  v4.1 binary        : ${fmtBytes(bin.byteLength).padStart(10)} (${bin.byteLength.toLocaleString().padStart(13)} B) → ${fmtBytes(binGz.length).padStart(10)} (${binGz.length.toLocaleString().padStart(11)} B)   ${gzBinMs.toFixed(0).padStart(4)} ms`);
  // eslint-disable-next-line no-console
  console.log(`  raw  ratio (bin/json) : ${((bin.byteLength / wire.length) * 100).toFixed(1)}%`);
  // eslint-disable-next-line no-console
  console.log(`  gzip ratio (bin/json) : ${((binGz.length / wireGz.length) * 100).toFixed(1)}%`);

  // Cold start: wire bytes → ready bundle + first range query ──────────────
  const sampleQuery = { equal: { status: 'IN_PROGRESS' as const }, limit: 50 };

  const v3Times: number[] = [];
  for (let i = 0; i < COLD_RUNS; i++) {
    const t = performance.now();
    const parsed = JSON.parse(wire.toString('utf-8'));
    const fresh = LyraBundle.load<WorkItem>(parsed);
    fresh.query(sampleQuery);
    v3Times.push(performance.now() - t);
  }

  const v4Times: number[] = [];
  for (let i = 0; i < COLD_RUNS; i++) {
    const t = performance.now();
    const fresh = LyraBundle.loadBinary<WorkItem>(bin);
    fresh.query(sampleQuery);
    v4Times.push(performance.now() - t);
  }

  // Gzipped cold path: gunzip + parse/load + first query.
  const v3GzTimes: number[] = [];
  for (let i = 0; i < COLD_RUNS; i++) {
    const t = performance.now();
    const inflated = gunzipSync(wireGz);
    const parsed = JSON.parse(inflated.toString('utf-8'));
    const fresh = LyraBundle.load<WorkItem>(parsed);
    fresh.query(sampleQuery);
    v3GzTimes.push(performance.now() - t);
  }
  const v4GzTimes: number[] = [];
  for (let i = 0; i < COLD_RUNS; i++) {
    const t = performance.now();
    const inflated = gunzipSync(binGz);
    const fresh = LyraBundle.loadBinary<WorkItem>(inflated);
    fresh.query(sampleQuery);
    v4GzTimes.push(performance.now() - t);
  }

  // Production critical path:
  //   server   : pipes the cached `.gz` straight from blob storage (streaming).
  //   network  : browser auto-decompresses gzip in the network stack
  //              (overlapped with bytes-on-wire).
  //   $fetch   : Response.json() buffers and runs synchronous JSON.parse.
  //              THIS BLOCKS THE MAIN THREAD.
  //   our code : LyraBundle.load(parsed) walks the JS object — cheap.
  //
  // The v4 binary path skips JSON.parse entirely: response.arrayBuffer() hands
  // raw bytes to LyraBundle.loadBinary(). gzip Content-Encoding still applies.
  const parseOnly: number[] = [];
  for (let i = 0; i < COLD_RUNS; i++) {
    const t = performance.now();
    JSON.parse(wire.toString('utf-8'));
    parseOnly.push(performance.now() - t);
  }
  const parsed = JSON.parse(wire.toString('utf-8'));
  const v3PostNet: number[] = [];
  for (let i = 0; i < COLD_RUNS; i++) {
    const t = performance.now();
    const fresh = LyraBundle.load<WorkItem>(parsed);
    fresh.query(sampleQuery);
    v3PostNet.push(performance.now() - t);
  }
  const v4PostNet: number[] = [];
  for (let i = 0; i < COLD_RUNS; i++) {
    const t = performance.now();
    const fresh = LyraBundle.loadBinary<WorkItem>(bin);
    fresh.query(sampleQuery);
    v4PostNet.push(performance.now() - t);
  }

  const summary = (label: string, samples: number[]): void => {
    const meanMs = samples.reduce((acc, value) => acc + value, 0) / samples.length;
    const sorted = samples.slice().sort((firstSample, secondSample) => firstSample - secondSample);
    const median = sorted[Math.floor(sorted.length / 2)];
    // eslint-disable-next-line no-console
    console.log(`  ${label.padEnd(28)}: mean ${meanMs.toFixed(0).padStart(5)} ms · median ${median.toFixed(0).padStart(5)} ms · samples ${samples.length}`);
  };

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`Cold-start (raw wire → query) — ${COLD_RUNS} runs each`);
  summary('v3.1 JSON     (raw)', v3Times);
  summary('v4.1 binary   (raw)', v4Times);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`Cold-start (gzipped wire → gunzip → query) — ${COLD_RUNS} runs each`);
  summary('v3.1 JSON.gz', v3GzTimes);
  summary('v4.1 binary.gz', v4GzTimes);

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`Production critical path (gunzip is overlapped with network) — ${COLD_RUNS} runs each`);
  // eslint-disable-next-line no-console
  console.log('  v3.1: $fetch → JSON.parse (blocks main thread) → LyraBundle.load → query');
  summary('  ↳ JSON.parse alone', parseOnly);
  summary('  ↳ LyraBundle.load + query', v3PostNet);
  // eslint-disable-next-line no-console
  console.log('  v4.1: arrayBuffer() (no parse) → loadBinary → query');
  summary('  ↳ loadBinary + query', v4PostNet);

  const mean = (samples: number[]): number =>
    samples.reduce((acc, value) => acc + value, 0) / samples.length;

  const v3Critical = mean(parseOnly) + mean(v3PostNet);
  const v4Critical = mean(v4PostNet);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`Raw      speedup: ${(mean(v3Times) / mean(v4Times)).toFixed(2)}× faster (binary vs JSON)`);
  // eslint-disable-next-line no-console
  console.log(`Gzip     speedup: ${(mean(v3GzTimes) / mean(v4GzTimes)).toFixed(2)}× faster (binary.gz vs JSON.gz)`);
  // eslint-disable-next-line no-console
  console.log(`Critical speedup: ${(v3Critical / v4Critical).toFixed(2)}× faster (post-network main-thread time)`);
  // eslint-disable-next-line no-console
  console.log(`Raw  wire reduction:   ${((1 - bin.byteLength / wire.length) * 100).toFixed(1)}% smaller`);
  // eslint-disable-next-line no-console
  console.log(`Gzip wire reduction:   ${((1 - binGz.length / wireGz.length) * 100).toFixed(1)}% smaller`);
}

main().catch((err: Error) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
