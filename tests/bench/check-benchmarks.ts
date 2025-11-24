// scripts/check-benchmarks.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type BenchFile = {
  generatedAt: string;
  results: Record<string, { iterations: number; meanMs: number }>;
};

function loadBench(path: string): BenchFile {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as BenchFile;
}

function main() {
  const baselinePath = resolve(__dirname, './baseline.json');
  const latestPath = resolve(__dirname, './latest.json');

  const baseline = loadBench(baselinePath);
  const latest = loadBench(latestPath);

  const WARN_FACTOR = 2;   // warn if >2x slower
  const FAIL_FACTOR = 10;  // optionally fail if >10x slower

  let shouldFail = false;

  // eslint-disable-next-line no-console
  console.log('Comparing benchmarks:');
  for (const [scenario, base] of Object.entries(baseline.results)) {
    const current = latest.results[scenario];
    if (!current) {
      // eslint-disable-next-line no-console
      console.warn(`  ⚠️ Scenario missing in latest: "${scenario}"`);
      continue;
    }

    const ratio = current.meanMs / base.meanMs;

    // eslint-disable-next-line no-console
    console.log(
      `  ${scenario}: baseline=${base.meanMs.toFixed(
        4,
      )}ms, current=${current.meanMs.toFixed(4)}ms, ratio=${ratio.toFixed(2)}x`,
    );

    if (ratio > WARN_FACTOR) {
      // eslint-disable-next-line no-console
      console.warn(
        `    ⚠️ Regression detected (> ${WARN_FACTOR}x slower than baseline)`,
      );
    }
    if (ratio > FAIL_FACTOR) {
      // eslint-disable-next-line no-console
      console.error(
        `    ❌ Severe regression (> ${FAIL_FACTOR}x slower than baseline)`,
      );
      shouldFail = true;
    }
  }

  if (shouldFail) {
    process.exit(1);
  }
}

main();