// scripts/run-benchmarks.ts
import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { getScenarios } from './scenarios';


async function runScenario(
  name: string,
  setup: () => Promise<{ run: () => void | Promise<void> }>,
  iterations: number,
): Promise<{ name: string; iterations: number; meanMs: number }> {
  const { run } = await setup();

  // Warmup
  for (let i = 0; i < 100; i++) {
    await run();
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await run();
  }
  const end = performance.now();

  const totalMs = end - start;
  const meanMs = totalMs / iterations;

  return { name, iterations, meanMs };
}

async function main() {
  const scenarios = await getScenarios();
  const iterations = 5_000; // tune as needed

  const results: Record<string, { iterations: number; meanMs: number }> = {};

  for (const scenario of scenarios) {
    const result = await runScenario(scenario.name, scenario.setup, iterations);
    results[scenario.name] = {
      iterations: result.iterations,
      meanMs: result.meanMs,
    };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    results,
  };

  const outPath = resolve(__dirname, './latest.json');
  // Ensure directory exists
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  // Also log to stdout for CI logs
  // eslint-disable-next-line no-console
  console.log('Benchmark results:', JSON.stringify(out, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});