import { createBundle, type SimpleBundleConfig } from '../../dist/index.js';
import { readFileSync, writeFileSync } from 'fs';
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

// Simple config: minimal boilerplate, perfect for agent tool integration
const config: SimpleBundleConfig<WorkItem> = {
  datasetId: 'work-items-agent-tool',
  id: 'id',
  facets: ['type', 'priority', 'status', 'productArea', 'customer', 'assignee'],
  ranges: ['createdAt', 'dueDate', 'eventDate', 'amount', 'attendees'],
  // autoMeta: true, // default: remaining simple fields (title, tags, organizer) become meta
};

async function main() {
  // Read data from JSON file
  const dataPath = join(__dirname, 'data.json');
  const rawData = readFileSync(dataPath, 'utf-8');
  const items: WorkItem[] = JSON.parse(rawData);

  console.log(`Building bundle from ${items.length} work items using simple config...`);

  // Create bundle with simple config
  const bundle = await createBundle(items, config);

  // Serialize to JSON
  const bundleJson = bundle.toJSON();
  const outputPath = join(__dirname, 'bundle.json');
  writeFileSync(outputPath, JSON.stringify(bundleJson, null, 2));

  console.log(`Bundle written to ${outputPath}`);
  console.log('\n=== Manifest (ready for agent tool schema generation) ===');
  const manifest = bundle.describe();
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error('Error building bundle:', error);
  process.exit(1);
});

