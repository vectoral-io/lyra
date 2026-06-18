<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./.github/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="./.github/logo-light.png">
    <img alt="Lyra" src="./.github/logo-light.png" height="70" style="max-width: 100%;">
  </picture>
</p>

<p align="center">
  Precomputed query indexes for structured data. Built once, queried anywhere.
</p>

---

Build an index from your data offline, ship it as JSON, and run fast deterministic queries anywhere: browser, server, edge, or as a tool for an LLM agent.

Not a vector DB. Not a warehouse. A **portable, manifest-driven query layer** between raw data and whoever needs to filter it.

## Install

```bash
npm install @vectoral/lyra
```

## Quick start

```ts
import { createBundle, LyraBundle } from '@vectoral/lyra';

// 1. Build a bundle (typically in CI / a build step)
const bundle = await createBundle(tickets, {
  datasetId: 'tickets-2025-11-22',
  equal: ['customer', 'priority', 'status'],
  ranges: ['createdAt'],
});

// 2. Persist as JSON (portable, debuggable), or as a binary container.
const json = JSON.stringify(bundle.toJSON());
const bytes = bundle.serialize('binary');     // Uint8Array, ~50× faster cold-start

// 3. Load and query anywhere
const loaded = LyraBundle.load<Ticket>(JSON.parse(json));
//                  ↑ also accepts a Uint8Array (autodetected v4 binary)

const result = loaded.query({
  equal: { customer: 'Acme Corp', priority: 'high' },
  ranges: { createdAt: { min: Date.now() - 7 * 86400_000 } },
  limit: 50,
});

result.items;  // matching tickets
result.total;  // total matches (ignores pagination)
```

## Serialization

Lyra ships two interoperable formats. Both round-trip identical query results.

| Format | Producer | Consumer | When to use |
|--------|----------|----------|-------------|
| **JSON** (v3.x) | `bundle.toJSON()` / `bundle.serialize()` | `LyraBundle.load(json)` | Debugging, portability, transport over plain HTTP/JSON pipelines |
| **Binary** (v4.x) | `bundle.serialize('binary')` → `Uint8Array` | `LyraBundle.loadBinary(bytes)` or `LyraBundle.load(bytes)` (autodetect) | Production hot path: smaller wire size + drastically faster cold-start |

The binary container (v4.1) is a JSON header followed by aligned data blocks: items stored columnar (dictionary-encoded strings, raw `f64` numbers, packed booleans), facet and null posting lists (delta + varint), and range columns. Range columns read back as zero-copy `Float64Array` views when alignment permits. No copy, no parse.

**Measured on a 300k-item real-world fixture** (deeply-nested record shape: strings, numbers, arrays, and a per-row `Record<string, …>` step map):

| | v3.1 JSON | v4.1 binary |
|---|---|---|
| Wire size (gzipped) | 49.3 MB | **43.6 MB** (12% smaller) |
| Critical-path cold start (post-network main thread) | **~887 ms** (`JSON.parse`) + 2 ms (`load`) | **~18 ms** (`loadBinary`) |
| Speedup | — | **~49× faster** |

`JSON.parse` dominates the v3.1 cold start because `fetch().json()` is buffered + synchronous. The v4.1 path skips it entirely via `arrayBuffer()` → `loadBinary`. Range columns are zero-copy when buffer alignment permits.

```ts
// Browser hot path (assumes API responds with the binary container):
const res = await fetch('/api/bundle');
const bytes = new Uint8Array(await res.arrayBuffer());
const bundle = LyraBundle.loadBinary<Ticket>(bytes);
bundle.query({ equal: { status: 'open' } });
```

v3.1 JSON readers stay supported indefinitely. See [`docs/migration-v4.md`](./docs/migration-v4.md) for the full migration guide and [`docs/bundle-json-spec.md`](./docs/bundle-json-spec.md) for the on-the-wire format spec.

## Query

All operators AND together. All accept a scalar or array (IN semantics).

```ts
bundle.query({
  equal:     { status: 'open', priority: ['high', 'urgent'] },
  notEqual:  { region: 'EU' },
  isNull:    ['archivedAt'],
  isNotNull: ['owner'],
  ranges:    { createdAt: { min: oneWeekAgo, max: now } },
  limit:     50,
  offset:    0,
  includeFacetCounts: true,   // populate result.facets
});
```

`null` in `equal`/`notEqual` is normalized to `isNull`/`isNotNull`. `[val, null]` matches `val` OR null.

## Aliases

Declare human-readable fields that resolve to canonical IDs. Lookup tables are auto-generated from your data.

```ts
const bundle = await createBundle(items, {
  datasetId: 'zones',
  equal: ['zone_id'],
  aliases: { zone_name: 'zone_id' },     // zone_name → zone_id
});

// Query by alias
bundle.query({ equal: { zone_name: 'Zone A' } });

// Enrich results with alias values (opt-in)
const result = bundle.query({
  equal: { zone_id: 'Z-001' },
  enrichAliases: true,                    // or ['zone_name']
});
result.items[0].zone_name;                // ['Zone A']

// Or enrich on demand with batch dedup
const enriched = bundle.enrichItems(result.items, ['zone_name']);
```

## LLM agent tool

Hand a bundle to an agent as a tool. The schema generates itself from the manifest, so it can't drift from what the bundle actually supports.

```ts
import { buildOpenAiTool } from '@vectoral/lyra';

const tool = buildOpenAiTool(bundle.describe(), {
  name: 'queryTickets',
  description: 'Query support tickets',
});

// `tool` is a ready-to-use OpenAI function definition.
```

Pass `tool` to your agent framework and run the model's calls through `bundle.query(args)`. See [`examples/agent-tool/`](./examples/agent-tool/) for a full loop.

## Facet summaries (for dashboards)

Distinct values and counts for one field, under whatever filters you pass. The data behind a dropdown or a drilldown.

```ts
bundle.getFacetSummary('status', { equal: { customer: 'ACME' } });
// { field: 'status', values: [{ value: 'open', count: 12 }, ...] }
```

## Configuration styles

**Simple** (type inference, auto-meta):

```ts
createBundle(items, {
  datasetId: 'tickets',
  equal: ['status', 'priority'],
  ranges: ['createdAt'],
  aliases: { zone_name: 'zone_id' },
});
```

**Explicit** (full control):

```ts
createBundle(items, {
  datasetId: 'tickets',
  fields: {
    id:        { kind: 'id',    type: 'string' },
    status:    { kind: 'facet', type: 'string' },
    createdAt: { kind: 'range', type: 'date' },
  },
});
```

Simple config auto-adds remaining primitive fields as `meta`. Disable with `autoMeta: false`.

## Behavior

- Queries are deterministic: same bundle + same query = same result.
- Unknown fields → no matches (fail-closed, never throws).
- Bad pagination clamped (negative offset → 0, negative limit → 0 items).
- `null` / `undefined` values are excluded from the facet index and from range results.

## Docs

- [API reference](./docs/api.md)
- [Bundle JSON + binary spec](./docs/bundle-json-spec.md)
- [Agent integration guide](./docs/agents.md)
- [Error behavior & guarantees](./docs/errors-and-guarantees.md)
- [Migration from v3 → v4](./docs/migration-v4.md)
- [Migration from v2 → v3](./docs/migration-v3.md)

## When to use Lyra

**Good fit:** structured records with a known schema, sub-millisecond filter queries in the browser / edge / agent, medium datasets (thousands to low hundreds of thousands of rows).

**Not a fit:** full-text search, semantic similarity, transactional writes, datasets that need live updates.

## License

MIT
