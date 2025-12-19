import { createBundle, type SimpleBundleConfig } from '../../dist/index.js';
import { readFileSync, writeFileSync } from 'fs';
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

// Simple config: minimal boilerplate, types inferred automatically
const config: SimpleBundleConfig<Ticket> = {
  datasetId: 'tickets-example-simple',
  id: 'id', // optional; will auto-detect 'id'/'Id'/'ID' if omitted
  facets: ['customer', 'priority', 'status', 'productArea'],
  ranges: ['createdAt', 'amount'],
  // autoMeta: true, // default: auto-add remaining simple fields as meta
};

async function main() {
  // Read data from JSON file
  const dataPath = join(__dirname, 'data.json');
  const rawData = readFileSync(dataPath, 'utf-8');
  const tickets: Ticket[] = JSON.parse(rawData);

  console.log(`Building bundle from ${tickets.length} tickets using simple config...`);

  // Create bundle with simple config
  const bundle = await createBundle(tickets, config);

  // Serialize to JSON
  const bundleJson = bundle.toJSON();
  const outputPath = join(__dirname, 'bundle.simple-config.json');
  writeFileSync(outputPath, JSON.stringify(bundleJson, null, 2));

  console.log(`Bundle written to ${outputPath}`);
  console.log('\n=== Manifest (showing all fields, including auto-meta) ===');
  const manifest = bundle.describe();
  console.log(JSON.stringify(manifest, null, 2));
  
  console.log('\n=== Field breakdown ===');
  console.log('ID fields:', manifest.fields.filter(f => f.kind === 'id').map(f => f.name));
  console.log('Facet fields:', manifest.capabilities.facets);
  console.log('Range fields:', manifest.capabilities.ranges);
  console.log('Meta fields:', manifest.fields.filter(f => f.kind === 'meta').map(f => f.name));
  console.log('\nNote: "amount" is included as meta even though it was not explicitly configured.');
  console.log('This demonstrates autoMeta behavior: remaining simple fields become meta by default.');
}

main().catch((error) => {
  console.error('Error building bundle:', error);
  process.exit(1);
});











