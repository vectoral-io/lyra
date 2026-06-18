# API Reference

Everything Lyra exports. Types are abbreviated for readability; the package ships full `.d.ts`.

- [`createBundle`](#createbundle): build a bundle
- [`LyraBundle`](#lyrabundle): query, serialize, load
- [Query](#query): `LyraQuery`, `LyraResult`
- [Config](#config): `SimpleBundleConfig`, `CreateBundleConfig`
- [Field types](#field-types): kinds, types, manifest

## `createBundle`

```ts
createBundle<T>(items: T[], config): Promise<LyraBundle<T>>
```

Build a bundle from an array of items. Pass a [simple config](#simplebundleconfig) (infers types, lists fields by purpose) or an [explicit one](#createbundleconfig) (full control). Usually run once in CI, then serialize the result.

```ts
const bundle = await createBundle(tickets, {
  datasetId: 'tickets-2025-11-22',
  equal: ['customer', 'priority', 'status'],
  ranges: ['createdAt'],
});
```

## `LyraBundle`

The runtime query object. Build one with `createBundle`, or load a serialized one with `LyraBundle.load`.

### `query(q?): LyraResult<T>`

Run a query. All operators AND together; each accepts a scalar or array (IN semantics). See [`LyraQuery`](#lyraquery) for the full shape.

```ts
const result = bundle.query({
  equal:  { status: 'open', priority: ['high', 'urgent'] },
  ranges: { createdAt: { min: oneWeekAgo, max: now } },
  limit:  50,
  includeFacetCounts: true,
});

result.items;   // matching tickets (paginated)
result.total;   // total matches, ignoring pagination
result.facets;  // counts per facet value (only with includeFacetCounts)
```

### `getFacetSummary(field, options?)`

Distinct values and counts for one facet field, handy for dashboard dropdowns. Pass `equal` / `ranges` filters to count under the current view. Values come back sorted (numbers ascending, `false` before `true`, strings lexicographic); `null`/`undefined` are excluded.

```ts
bundle.getFacetSummary('status');
// { field: 'status', values: [{ value: 'open', count: 12 }, ...] }

bundle.getFacetSummary('status', { equal: { customerId: 'C-ACME' } });
```

### `getAliasValues(aliasField, canonicalId): string[]`

The human-readable values for one canonical ID. Empty array if unknown. See [Aliases](../README.md#aliases).

```ts
bundle.getAliasValues('zone_name', 'Z-001'); // ['Zone A']
```

### `enrichItems(items, aliasFields): T[]`

Add alias fields to items after the fact, with batched dedup. Each named field becomes a `string[]` on every item.

```ts
const enriched = bundle.enrichItems(result.items, ['zone_name']);
enriched[0].zone_name; // ['Zone A']
```

(You can also enrich inline via `query({ enrichAliases: true })`.)

### `describe(): LyraManifest`

The [manifest](#lyramanifest): fields and capabilities. Feed it to `buildQuerySchema` / `buildOpenAiTool` (see [agents](./agents.md)).

### `snapshot(): LyraSnapshotInfo`

`{ datasetId, builtAt, indexVersion }`: what data this bundle is, and when it was built.

### `toJSON()` / `serialize(format?)`

```ts
bundle.toJSON();             // LyraBundleJSON, a plain JSON-safe object
bundle.serialize('json');    // same as toJSON()
bundle.serialize('binary');  // Uint8Array; v4 container, ~50× faster cold start
```

Use JSON for transport you want to read; binary for the production hot path. See the [migration guide](./migration-v4.md).

### `dispose()` / `isDisposed`

Release the index and item store. Idempotent; `describe`/`snapshot`/`isDisposed` keep working afterward, but any data op (`query`, `getFacetSummary`, `serialize`, `toJSON`) throws. Use it when you're done with a large bundle and want the memory back sooner than GC would give it.

### `LyraBundle.load(raw)` / `LyraBundle.loadBinary(bytes)`

```ts
LyraBundle.load<Ticket>(json);   // v3.x JSON object
LyraBundle.load<Ticket>(bytes);  // Uint8Array, autodetected via the LYRA4 magic
LyraBundle.loadBinary<Ticket>(bytes);
```

`load` accepts either form and dispatches accordingly. Reach for `loadBinary` only when you already know you have v4 bytes.

## Query

### `LyraQuery`

```ts
interface LyraQuery {
  equal?:     Record<string, Scalar | Scalar[]>;  // exact match / IN
  notEqual?:  Record<string, Scalar | Scalar[]>;  // != / NOT IN
  ranges?:    Record<string, { min?: number; max?: number }>;  // inclusive bounds
  isNull?:    string[];     // field IS NULL
  isNotNull?: string[];     // field IS NOT NULL
  limit?:     number;
  offset?:    number;
  select?:    string[];     // project result items to these fields
  includeFacetCounts?: boolean;       // populate result.facets
  enrichAliases?: boolean | string[]; // add alias values to items (opt-in)
}
```

A few behaviors worth knowing:

- `null` inside `equal`/`notEqual` is normalized to `isNull`/`isNotNull`. `[val, null]` matches `val` OR null.
- `ranges` bounds are inclusive. For dates, pass epoch ms (`Date.parse(iso)`).
- `select` only shapes the returned `items`; `total` and facet counts are unaffected. On binary-loaded bundles it skips decoding columns you don't ask for. If you use `enrichAliases`, include the canonical ID fields in `select` or there's nothing to resolve against.
- `enrichAliases: true` adds every declared alias; pass a `string[]` for specific ones.

```ts
bundle.query({ equal: { priority: ['high', 'urgent'] } });   // IN
bundle.query({ isNull: ['category'], isNotNull: ['status'] }); // null checks
bundle.query({ notEqual: { status: ['closed', 'cancelled'] } }); // exclusion
bundle.query({                                                // all AND together
  equal:     { customer: 'ACME' },
  notEqual:  { priority: 'low' },
  ranges:    { createdAt: { min: oneWeekAgo, max: now } },
});
```

### `LyraResult<Item>`

```ts
interface LyraResult<Item> {
  items: Item[];     // paginated matches (enriched in place if enrichAliases set)
  total: number;     // matches before pagination
  applied: { equal?; notEqual?; ranges?; isNull?; isNotNull? };  // normalized query
  facets?: FacetCounts;        // only when includeFacetCounts: true
  snapshot: LyraSnapshotInfo;  // dataset identity + build time
}
```

## Config

### `SimpleBundleConfig`

The ergonomic style: list fields by purpose, let Lyra infer types.

```ts
interface SimpleBundleConfig<T> {
  datasetId: string;
  id?:      keyof T;                  // defaults to auto-detected id/Id/ID
  equal?:   (keyof T)[];              // facet fields (equality filtering)
  ranges?:  (keyof T)[];              // numeric/date range fields
  meta?:    (keyof T)[];              // schema-visible, not indexed
  aliases?: Record<string, keyof T>;  // aliasName -> canonical field
  inferTypes?: 'none' | 'runtime';    // 'runtime' (default) inspects values
  autoMeta?: boolean;                 // default true (see below)
}
```

`autoMeta` (on by default) adds any leftover primitive fields as `meta` so they survive in results and the manifest; complex/nested fields are always skipped. Set `false` to keep only what you listed. (`facets` is accepted as a v1 alias for `equal`; prefer `equal`.)

```ts
await createBundle(tickets, {
  datasetId: 'tickets-2025-11-22',
  equal:  ['customer', 'priority', 'status'],
  ranges: ['createdAt'],
  aliases: { zone_name: 'zone_id' },
});
```

### `CreateBundleConfig`

The explicit style: declare every field's `kind` and `type` yourself.

```ts
interface CreateBundleConfig<T> {
  datasetId: string;
  fields: { [K in keyof T]?: { kind: FieldKind; type: FieldType } };
}
```

```ts
await createBundle(tickets, {
  datasetId: 'tickets',
  fields: {
    id:        { kind: 'id',    type: 'string' },
    status:    { kind: 'facet', type: 'string' },
    createdAt: { kind: 'range', type: 'date' },
  },
});
```

Fields that don't exist on any item warn once and are otherwise ignored.

## Field types

```ts
type FieldKind = 'id' | 'facet' | 'range' | 'meta' | 'alias';
type FieldType = 'string' | 'number' | 'boolean' | 'date';
```

- `id`: identifier; stored, not specially indexed.
- `facet`: indexed for `equal` / IN via posting lists.
- `range`: eligible for `ranges` filters.
- `meta`: in the manifest for schema awareness, not indexed.
- `alias`: resolves to a canonical facet/range field at query time.

`date` values are epoch ms, or strings parsed with `Date.parse()`. Unparseable values drop out of range results.

### `LyraManifest`

What `describe()` returns. `capabilities` is the source of truth for what's queryable: only fields listed there can be filtered.

```ts
interface LyraManifest {
  version: string;
  datasetId: string;
  builtAt: string;        // ISO 8601
  fields: LyraField[];
  capabilities: {
    facets: string[];
    ranges: string[];
    aliases?: string[];
  };
  lookups?: Record<string, unknown>;  // auto-generated alias tables
}
```

For the on-the-wire format (JSON and binary), see the [bundle spec](./bundle-json-spec.md).
