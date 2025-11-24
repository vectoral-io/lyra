# Basic Usage Example

This example demonstrates how to build a Lyra bundle from a JSON dataset and query it.

## Files

- `data.json` - Sample ticket dataset
- `build-bundle.ts` - Builds a bundle from `data.json` and writes `bundle.json`
- `query-bundle.ts` - Loads `bundle.json` and runs various queries

## Running the Example

1. Build the bundle:
   ```bash
   bun run examples/basic-usage/build-bundle.ts
   ```

2. Query the bundle:
   ```bash
   bun run examples/basic-usage/query-bundle.ts
   ```

Or run both:
```bash
bun run example:test
```

## What This Demonstrates

- Building a bundle from structured data
- Configuring fields (facets and ranges)
- Serializing a bundle to JSON
- Loading a bundle from JSON
- Facet queries (equality filters)
- Range queries (numeric and date ranges)
- Queries with facet counts
- Combined facet + range queries

