// scripts/run-benchmarks.ts
import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { getScenarios } from './scenarios';

const SAMPLE_COUNT = 100;

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

  for (let i = 0; i < 100; i++) await run();

  const sampleCount = Math.min(SAMPLE_COUNT, iterations);
  const itersPerSample = Math.max(1, Math.floor(iterations / sampleCount));
  const sampleMeans = new Float64Array(sampleCount);

  const tStart = performance.now();
  for (let s = 0; s < sampleCount; s++) {
    const sStart = performance.now();
    for (let i = 0; i < itersPerSample; i++) await run();
    sampleMeans[s] = (performance.now() - sStart) / itersPerSample;
  }
  const totalMs = performance.now() - tStart;

  const totalIters = sampleCount * itersPerSample;
  const meanMs = totalMs / totalIters;

  const sorted = Array.from(sampleMeans).sort((a, b) => a - b);
  const p99Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];

  return { iterations: totalIters, meanMs, p99Ms };
}

async function main() {
  const scenarios = await getScenarios();
  const iterations = 5_000;

  const results: Record<string, ScenarioRecord> = {};

  for (const scenario of scenarios) {
    const result = await runScenario(scenario.setup, iterations);
    results[scenario.name] = result;
  }

  const out = { generatedAt: new Date().toISOString(), results };

  const outPath = resolve(__dirname, './latest.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log('Benchmark results:', JSON.stringify(out, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
