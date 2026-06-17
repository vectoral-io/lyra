// scripts/run-benchmarks.ts
import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { getScenarios } from './scenarios';

// Benchmark sizing is configurable via env so the suite can run in a fast
// "smoke" mode during development and a full, statistically-robust mode for
// baselining. Per-iteration means stay comparable across iteration counts —
// fewer iterations just trade precision for wall-clock time.
//   BENCH_ITERATIONS  per-scenario iterations            (default 5000)
//   BENCH_WARMUP      warmup iterations before sampling  (default 100)
//   BENCH_SAMPLES     number of timing samples           (default 100)
//   BENCH_FILTER      case-insensitive regex on names    (default: all)
//   BENCH_OUT         output path relative to this dir   (default ./latest.json)
const ITERATIONS = Number(process.env.BENCH_ITERATIONS ?? 5_000);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 100);
const SAMPLE_COUNT = Number(process.env.BENCH_SAMPLES ?? 100);
const FILTER = process.env.BENCH_FILTER ? new RegExp(process.env.BENCH_FILTER, 'i') : null;
const OUT_FILE = process.env.BENCH_OUT ?? './latest.json';
// Per-scenario wall-time budget for the sampling loop. Bounds expensive
// scenarios (e.g. serialize/load on 100k rows at ~80ms/op) regardless of the
// iteration cap. Defaults to Infinity so full/baseline runs stay reproducible.
const MAX_MS = Number(process.env.BENCH_MAX_MS ?? Infinity);

interface ScenarioRecord {
  iterations: number;
  meanMs: number;
  p99Ms: number;
}

async function runScenario(
  setup: () => Promise<{ run: () => void | Promise<void> }>,
  iterations: number,
): Promise<ScenarioRecord> {
  const { run } = await setup();

  for (let i = 0; i < WARMUP; i++) await run();

  const sampleCount = Math.min(SAMPLE_COUNT, iterations);
  const itersPerSample = Math.max(1, Math.floor(iterations / sampleCount));
  const sampleMeans = new Float64Array(sampleCount);

  const tStart = performance.now();
  let taken = 0;
  for (let s = 0; s < sampleCount; s++) {
    const sStart = performance.now();
    for (let i = 0; i < itersPerSample; i++) await run();
    sampleMeans[s] = (performance.now() - sStart) / itersPerSample;
    taken++;
    if (performance.now() - tStart > MAX_MS) break;
  }
  const totalMs = performance.now() - tStart;

  const totalIters = taken * itersPerSample;
  const meanMs = totalMs / totalIters;

  const sorted = Array.from(sampleMeans.subarray(0, taken)).sort((a, b) => a - b);
  const p99Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];

  return { iterations: totalIters, meanMs, p99Ms };
}

async function main() {
  const allScenarios = await getScenarios();
  const scenarios = FILTER ? allScenarios.filter((scenario) => FILTER.test(scenario.name)) : allScenarios;

  // Progress + config go to stderr so stdout stays clean for the result JSON.
  // eslint-disable-next-line no-console
  console.error(
    `Running ${scenarios.length}/${allScenarios.length} scenarios `
    + `(iterations=${ITERATIONS}, warmup=${WARMUP}, samples=${SAMPLE_COUNT})`,
  );

  const results: Record<string, ScenarioRecord> = {};

  let index = 0;
  for (const scenario of scenarios) {
    const tStart = performance.now();
    const result = await runScenario(scenario.setup, ITERATIONS);
    results[scenario.name] = result;
    // eslint-disable-next-line no-console
    console.error(
      `  [${++index}/${scenarios.length}] ${scenario.name} — `
      + `${(performance.now() - tStart).toFixed(0)}ms wall, mean ${result.meanMs.toFixed(4)}ms`,
    );
  }

  const out = { generatedAt: new Date().toISOString(), results };

  const outPath = resolve(__dirname, OUT_FILE);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.error(`Wrote ${Object.keys(results).length} results to ${outPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
