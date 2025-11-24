# Basic Usage Example

This example demonstrates how to build a Lyra bundle from a JSON dataset and query it.

## Files

- `data.json` - Sample ticket dataset
- `build-bundle.ts` - Builds a bundle from `data.json` using explicit fields config and writes `bundle.json`
- `build-bundle.simple-config.ts` - Builds a bundle using simple config and writes `bundle.simple-config.json`
- `query-bundle.ts` - Loads `bundle.json` and runs various queries

## Running the Example

1. Build the bundle (explicit config):
   ```bash
   bun run examples/basic-usage/build-bundle.ts
   ```

   Or build with simple config:
   ```bash
   bun run examples/basic-usage/build-bundle.simple-config.ts
   ```

2. Query the bundle:
   ```bash
   bun run examples/basic-usage/query-bundle.ts
   ```

Or run both:
```bash
bun run example:test
```

## Configuration Modes

This example demonstrates two ways to configure a bundle:

### Explicit Fields Config (`build-bundle.ts`)

Use when you need **strict control** and **long-lived schemas**.

- Full control over field kinds (`id`, `facet`, `range`, `meta`) and types (`string`, `number`, `boolean`, `date`)
- Explicitly declare every field you want in the manifest
- Best for production systems where schema stability matters

```ts
const config: CreateBundleConfig<Ticket> = {
  datasetId: 'tickets-example',
  fields: {
    id: { kind: 'id', type: 'string' },
    customer: { kind: 'facet', type: 'string' },
    priority: { kind: 'facet', type: 'string' },
    // ... explicit field definitions
  },
};
```

### Simple Config (`build-bundle.simple-config.ts`)

Use when you want **quick value** with **minimal boilerplate**.

- Specify fields by purpose (`id`, `facets`, `ranges`, `meta`)
- Types are inferred automatically from the data
- `autoMeta: true` (default) automatically adds remaining simple fields as meta
- Best for prototyping, one-off scripts, or when you want schema discovery

```ts
const config: SimpleBundleConfig<Ticket> = {
  datasetId: 'tickets-example-simple',
  id: 'id', // optional; auto-detects if omitted
  facets: ['customer', 'priority', 'status', 'productArea'],
  ranges: ['createdAt', 'amount'],
  // autoMeta: true, // default: remaining simple fields become meta
};
```

**Auto-meta behavior:**
- All remaining simple fields (primitives / arrays of primitives) become meta by default
- Nested/complex fields are ignored unless explicitly declared
- This makes the full record shape visible to agents and tooling while keeping the index focused

## What This Demonstrates

- Building a bundle from structured data
- Configuring fields (facets and ranges)
- Serializing a bundle to JSON
- Loading a bundle from JSON
- Facet queries (equality filters)
- Range queries (numeric and date ranges)
- Queries with facet counts
- Combined facet + range queries

