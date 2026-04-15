# Migration Guide: Lyra v2 → v3

Lyra v3 is a focused cleanup: smaller API surface, faster pipeline, fixed bugs. No query-DSL changes.

## Summary

- **Bundle format bumped to `3.0.0`**. Existing v2 bundles must be rebuilt.
- **6 alias methods collapsed to 2**. Only `getAliasValues` and `enrichItems` remain.
- **`LyraResult.enrichedAliases` removed**. Items are enriched in place when `enrichAliases: true`.
- **`enrichAliases` default is `false`** (was previously documented as `true`, but already behaved as `false` in v2.x — now consistent).
- **Critical fix**: scratch-array aliasing bug that could silently return zero results for queries combining 3+ `equal` filters with `notEqual`.

## Breaking changes

### 1. Rebuild your bundles

```ts
// v2 bundles will fail to load.
// Re-run your build step to produce v3 bundles.
const bundle = await createBundle(items, config);
await writeFile('bundle.json', JSON.stringify(bundle.toJSON()));
```

`LyraBundle.load()` now only accepts `manifest.version` starting with `"3."`.

### 2. Alias API collapsed

| Removed | Replacement |
|---|---|
| `bundle.getAliasMap(field, ids)` | `bundle.enrichItems(items, [field])` (dedup + lookup) — or loop `getAliasValues` |
| `bundle.getAllAliases(field)` | `bundle.describe().lookups?.[field]?.idToAliases` |
| `bundle.getMultiAliasMap(fields, ids)` | `bundle.enrichItems(items, fields)` |
| `bundle.enrichResult(result, fields)` | `bundle.enrichItems(result.items, fields)` |

`enrichResult` was also subtly broken on array-valued canonical fields (many-to-many). `enrichItems` handles them correctly.

### 3. `enrichedAliases` removed from `LyraResult`

```ts
// v2
const result = bundle.query({ equal: { zone_id: 'Z-001' }, enrichAliases: true });
result.enrichedAliases?.[0].zone_name;   // ['Zone A']

// v3: items are enriched directly.
const result = bundle.query({ equal: { zone_id: 'Z-001' }, enrichAliases: true });
result.items[0].zone_name;               // ['Zone A']
```

If you relied on items *not* being mutated, either omit `enrichAliases` and use `bundle.enrichItems` on a copy, or map the result before enriching.

### 4. `enrichAliases` defaults to `false`

Already the runtime behavior in v2 (despite the docstring). If your code assumed enriched items arrived without opting in, add `enrichAliases: true` explicitly.

## New in v3

- **`nullIndex`** — null posting lists are precomputed at build time. `isNull` / `isNotNull` / `[val, null]` queries stay in the posting-list asymptotic model instead of scanning items.
- **Faster realistic queries** — multi-facet + ranges + pagination is ~40% faster; full-feature queries (facets + ranges + facet counts) ~45% faster.
- **Tighter `load()` validation** — duplicate field names, invalid kinds/types, dangling alias targets are rejected on load instead of surfacing at query time.
- **`parseFacetKey` handles `'date'`** — `getFacetSummary` on a date-typed facet now returns epoch ms instead of raw strings.

## No action required

- Query DSL is unchanged (`equal`, `notEqual`, `ranges`, `isNull`, `isNotNull`, `limit`, `offset`, `includeFacetCounts`, `enrichAliases`).
- `createBundle` signatures are unchanged.
- `buildQuerySchema` / `buildOpenAiTool` are unchanged.
- `getFacetSummary`, `describe`, `snapshot`, `toJSON`, `query` all unchanged.

## Bundle format diff

v3 `LyraBundleJSON` adds one required top-level field:

```ts
{
  manifest: LyraManifest,      // version now "3.0.0"
  items: T[],
  facetIndex: FacetPostingLists,
  nullIndex: Record<string, number[]>,   // NEW in v3
}
```
