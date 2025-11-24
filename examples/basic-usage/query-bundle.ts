import { LyraBundle, type LyraQuery, type LyraResult } from '../../dist/index.js';
import { readFileSync } from 'fs';
import { join } from 'path';

type Ticket = {
  id: string;
  customer: string;
  priority: string;
  status: string;
  productArea: string;
  createdAt: string;
  amount: number;
};

async function main() {
  // Load bundle from JSON file
  const bundlePath = join(__dirname, 'bundle.json');
  const rawBundle = readFileSync(bundlePath, 'utf-8');
  const bundleData = JSON.parse(rawBundle);

  console.log('Loading bundle...');
  const bundle = LyraBundle.load<Ticket>(bundleData);

  console.log(`Loaded bundle with ${bundle.describe().fields.length} fields\n`);

  // Example 1: Simple facet query
  console.log('=== Example 1: Facet Query ===');
  const facetQuery: LyraQuery = {
    facets: {
      status: 'open',
      priority: 'high',
    },
    limit: 10,
  };

  const facetResult: LyraResult<Ticket> = bundle.query(facetQuery);
  console.log(`Found ${facetResult.total} tickets matching status=open AND priority=high`);
  console.log('Items:', facetResult.items.map((t) => t.id));
  console.log();

  // Example 2: Range query
  console.log('=== Example 2: Range Query ===');
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const rangeQuery: LyraQuery = {
    ranges: {
      createdAt: { min: oneWeekAgo, max: now },
      amount: { min: 1000 },
    },
  };

  const rangeResult = bundle.query(rangeQuery);
  console.log(`Found ${rangeResult.total} tickets created in last week with amount >= 1000`);
  console.log('Items:', rangeResult.items.map((t) => `${t.id} (${t.amount})`));
  console.log();

  // Example 3: Query with facet counts
  console.log('=== Example 3: Query with Facet Counts ===');
  const countsQuery: LyraQuery = {
    facets: {
      customer: 'Acme Corp',
    },
    includeFacetCounts: true,
  };

  const countsResult = bundle.query(countsQuery);
  console.log(`Found ${countsResult.total} tickets for Acme Corp`);
  console.log('Facet counts:');
  if (countsResult.facets) {
    for (const [field, counts] of Object.entries(countsResult.facets)) {
      console.log(`  ${field}:`, counts);
    }
  }
  console.log();

  // Example 4: Combined query
  console.log('=== Example 4: Combined Facet + Range Query ===');
  const combinedQuery: LyraQuery = {
    facets: {
      status: 'open',
    },
    ranges: {
      amount: { min: 1500 },
    },
    limit: 5,
  };

  const combinedResult = bundle.query(combinedQuery);
  console.log(`Found ${combinedResult.total} open tickets with amount >= 1500`);
  console.log('Items:', combinedResult.items.map((t) => `${t.id} - ${t.customer} - $${t.amount}`));
}

main().catch((error) => {
  console.error('Error querying bundle:', error);
  process.exit(1);
});

