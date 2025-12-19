import {
  LyraBundle,
  type LyraQuery,
  type LyraResult,
  buildOpenAiTool,
} from '../../dist/index.js';
import { readFileSync } from 'fs';
import { join } from 'path';

type WorkItem = {
  id: string;
  type: string;
  title: string;
  customer?: string;
  priority: string;
  status: string;
  productArea: string;
  createdAt: string;
  dueDate?: string;
  eventDate?: string;
  amount?: number;
  attendees?: number;
  assignee?: string;
  organizer?: string;
  tags: string[];
};

// Load bundle
const bundlePath = join(__dirname, 'bundle.json');
const rawBundle = readFileSync(bundlePath, 'utf-8');
const bundleData = JSON.parse(rawBundle);
const bundle = LyraBundle.load<WorkItem>(bundleData);

// Tool function that an agent would call
function lyraQuery(args: LyraQuery): LyraResult<WorkItem> {
  return bundle.query(args);
}

async function main() {
  console.log('=== Agent Tool Integration Example ===\n');
  
  // 1. Show the manifest (tool schema)
  console.log('1. MANIFEST (Tool Schema)');
  console.log('==========================');
  const manifest = bundle.describe();
  console.log(JSON.stringify(manifest, null, 2));
  console.log('\n');
  
  // 2. Show generated tool schema (as you would pass to OpenAI)
  console.log('2. GENERATED TOOL SCHEMA (for OpenAI tools)');
  console.log('==========================================');
  const toolSchema = buildOpenAiTool(bundle.describe(), {
    name: 'lyraQuery',
    description: 'Query work items (tickets, tasks, events) using facet and range filters',
  });
  console.log(JSON.stringify(toolSchema, null, 2));
  console.log('\n');
  
  // 3. Sample queries and results
  console.log('3. SAMPLE QUERIES AND RESULTS');
  console.log('==============================\n');
  
  // Query 1: High priority open items
  console.log('Query 1: High priority open items');
  console.log('-----------------------------------');
  const query1: LyraQuery = {
    equal: {
      priority: 'high',
      status: 'open',
    },
    limit: 10,
  };
  const result1 = lyraQuery(query1);
  console.log('Input:', JSON.stringify(query1, null, 2));
  console.log(`Output: Found ${result1.total} items`);
  console.log('Items:', result1.items.map(item => ({
    id: item.id,
    type: item.type,
    title: item.title,
    priority: item.priority,
    status: item.status,
  })));
  console.log('\n');
  
  // Query 2: Items created in the last week
  console.log('Query 2: Items created in the last week');
  console.log('----------------------------------------');
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const query2: LyraQuery = {
    ranges: {
      createdAt: { min: oneWeekAgo, max: now },
    },
    limit: 5,
  };
  const result2 = lyraQuery(query2);
  console.log('Input:', JSON.stringify(query2, null, 2));
  console.log(`Output: Found ${result2.total} items`);
  console.log('Items:', result2.items.map(item => ({
    id: item.id,
    type: item.type,
    title: item.title,
    createdAt: item.createdAt,
  })));
  console.log('\n');
  
  // Query 3: With facet counts (for drilldown UI)
  console.log('Query 3: Items for Acme Corp with facet counts');
  console.log('-----------------------------------------------');
  const query3: LyraQuery = {
    equal: {
      customer: 'Acme Corp',
    },
    includeFacetCounts: true,
  };
  const result3 = lyraQuery(query3);
  console.log('Input:', JSON.stringify(query3, null, 2));
  console.log(`Output: Found ${result3.total} items`);
  if (result3.facets) {
    console.log('Facet counts (for drilldown UI):');
    for (const [field, counts] of Object.entries(result3.facets)) {
      console.log(`  ${field}:`, counts);
    }
  }
  console.log('\n');
  
  // Query 4: Combined equality + range
  console.log('Query 4: High priority tickets with amount >= 1000');
  console.log('---------------------------------------------------');
  const query4: LyraQuery = {
    equal: {
      type: 'ticket',
      priority: 'high',
    },
    ranges: {
      amount: { min: 1000 },
    },
    limit: 10,
  };
  const result4 = lyraQuery(query4);
  console.log('Input:', JSON.stringify(query4, null, 2));
  console.log(`Output: Found ${result4.total} items`);
  console.log('Items:', result4.items.map(item => ({
    id: item.id,
    title: item.title,
    priority: item.priority,
    amount: item.amount,
  })));
  console.log('\n');
  
  console.log('=== Integration Notes ===');
  console.log('- The manifest describes all queryable fields and their capabilities');
  console.log('- Tool schema can be auto-generated from the manifest');
  console.log('- Agents can use equality, inequality, null, and range filters to query the bundle');
  console.log('- Results include total count, items, and optional facet counts');
  console.log('- Snapshot metadata (datasetId, builtAt) is always included');
}

main().catch((error) => {
  console.error('Error running agent tool example:', error);
  process.exit(1);
});

