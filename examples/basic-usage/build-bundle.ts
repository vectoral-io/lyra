import { createBundle, type CreateBundleConfig } from '../../dist/index.js';
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

const config: CreateBundleConfig<Ticket> = {
  datasetId: 'tickets-example',
  fields: {
    id: { kind: 'id', type: 'string' },
    customer: { kind: 'facet', type: 'string' },
    priority: { kind: 'facet', type: 'string' },
    status: { kind: 'facet', type: 'string' },
    productArea: { kind: 'facet', type: 'string' },
    createdAt: { kind: 'range', type: 'date' },
    amount: { kind: 'range', type: 'number' },
  },
};

async function main() {
  // Read data from JSON file
  const dataPath = join(__dirname, 'data.json');
  const rawData = readFileSync(dataPath, 'utf-8');
  const tickets: Ticket[] = JSON.parse(rawData);

  console.log(`Building bundle from ${tickets.length} tickets...`);

  // Create bundle
  const bundle = await createBundle(tickets, config);

  // Serialize to JSON
  const bundleJson = bundle.toJSON();
  const outputPath = join(__dirname, 'bundle.json');
  writeFileSync(outputPath, JSON.stringify(bundleJson, null, 2));

  console.log(`Bundle written to ${outputPath}`);
  console.log(`Manifest:`, bundle.describe());
}

main().catch((error) => {
  console.error('Error building bundle:', error);
  process.exit(1);
});

