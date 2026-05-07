// scripts/diff-benchmarks.ts
//
// Compare latest.json against baseline.json and print per-scenario delta in mean
// and p99 (when present). Exits non-zero if any scenario regresses by >5% on
// either metric — the gating threshold for phase merges in the perf roadmap.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ScenarioRecord {
  iterations: number;
  meanMs: number;
  p99Ms?: number;
}

interface BenchFile {
  generatedAt: string;
  results: Record<string, ScenarioRecord>;
}

const REGRESSION_THRESHOLD = 0.05;

function loadBench(path: string): BenchFile {
  return JSON.parse(readFileSync(path, 'utf8')) as BenchFile;
}

function pct(current: number, base: number): number {
  return (current - base) / base;
}

function fmtPct(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function main() {
  const baseline = loadBench(resolve(__dirname, './baseline.json'));
  const latest = loadBench(resolve(__dirname, './latest.json'));

  let worstMean = 0;
  let worstP99 = 0;
  const missing: string[] = [];

  // eslint-disable-next-line no-console
  console.log('Scenario delta (latest vs baseline):');
  for (const [scenario, base] of Object.entries(baseline.results)) {
    const cur = latest.results[scenario];
    if (!cur) {
      missing.push(scenario);
      continue;
    }

    const meanDelta = pct(cur.meanMs, base.meanMs);
    worstMean = Math.max(worstMean, meanDelta);

    let p99Note = '';
    if (typeof cur.p99Ms === 'number' && typeof base.p99Ms === 'number') {
      const p99Delta = pct(cur.p99Ms, base.p99Ms);
      worstP99 = Math.max(worstP99, p99Delta);
      p99Note = ` | p99 ${base.p99Ms.toFixed(4)}→${cur.p99Ms.toFixed(4)}ms (${fmtPct(p99Delta)})`;
    }

    // eslint-disable-next-line no-console
    console.log(
      `  ${scenario}: mean ${base.meanMs.toFixed(4)}→${cur.meanMs.toFixed(4)}ms (${fmtPct(meanDelta)})${p99Note}`,
    );
  }

  for (const name of missing) {
    // eslint-disable-next-line no-console
    console.warn(`  ⚠️ Scenario missing in latest: "${name}"`);
  }

  // Show new scenarios that aren't in baseline (informational only).
  for (const scenario of Object.keys(latest.results)) {
    if (scenario in baseline.results) continue;
    const cur = latest.results[scenario];
    const p99 = typeof cur.p99Ms === 'number' ? `, p99=${cur.p99Ms.toFixed(4)}ms` : '';
    // eslint-disable-next-line no-console
    console.log(`  + new: ${scenario}: mean=${cur.meanMs.toFixed(4)}ms${p99}`);
  }

  const worst = Math.max(worstMean, worstP99);
  // eslint-disable-next-line no-console
  console.log(
    `\nWorst regression: mean ${fmtPct(worstMean)}, p99 ${fmtPct(worstP99)} (threshold: ${fmtPct(REGRESSION_THRESHOLD)}).`,
  );
  if (worst > REGRESSION_THRESHOLD) {
    // eslint-disable-next-line no-console
    console.error('❌ Regression exceeds threshold.');
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('✅ Within threshold.');
}

main();
