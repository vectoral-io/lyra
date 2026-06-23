[@vectoral/lyra](../README.md) / LyraQuery

# Interface: LyraQuery

Defined in: [types.ts:53](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L53)

Query parameters for executing filters against a Lyra bundle.

**Null Handling:**
- `equal: { field: null }` is normalized to `isNull: ['field']` during query processing
- `notEqual: { field: null }` is normalized to `isNotNull: ['field']`
- Arrays containing null (e.g., `equal: { field: ['A', null] }`) are split into value filters + null checks

**All filter operators are intersected (AND logic).**

## Example

```ts
// Simple equality
bundle.query({ equal: { status: 'open' } });

// IN semantics with array
bundle.query({ equal: { priority: ['high', 'urgent'] } });

// Null checks (inline or explicit)
bundle.query({ equal: { category: null } }); // Normalized to isNull
bundle.query({ isNull: ['category'] }); // Explicit

// Exclusion filters
bundle.query({ notEqual: { status: 'closed' } });

// Mixed operators
bundle.query({
  equal: { zone_name: 'Zone A' }, // Alias field
  isNotNull: ['wip_trade'],
  ranges: { createdAt: { min: Date.parse('2025-01-01') } },
});
```

## Properties

### enrichAliases?

```ts
optional enrichAliases?: boolean | string[];
```

Defined in: [types.ts:131](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L131)

Enrich result items with human-readable alias values.

Opt-in for performance — defaults to `false` even when the bundle declares aliases.
- `true`: add all declared alias fields to each item.
- `string[]`: add only the listed alias fields.
- `false` / omitted: return items unchanged.

When enabled, each item gains a `string[]` property per alias field (e.g.
`item.zone_name = ['Zone A']`). Items without a canonical ID for a given alias
are left untouched for that field.

***

### equal?

```ts
optional equal?: Record<string, Scalar | Scalar[]>;
```

Defined in: [types.ts:62](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L62)

Equality filters.
- Single scalar (non-null) => exact match
- Array => IN semantics
- null values are normalized to `isNull` during query processing

Works with both canonical fields and alias fields.

***

### includeFacetCounts?

```ts
optional includeFacetCounts?: boolean;
```

Defined in: [types.ts:117](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L117)

Whether to include facet counts in the result.
Facet counts are computed over the filtered result set.

***

### isNotNull?

```ts
optional isNotNull?: string[];
```

Defined in: [types.ts:87](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L87)

Fields that must NOT be NULL.
Implemented as `field IS NOT NULL` filter.

***

### isNull?

```ts
optional isNull?: string[];
```

Defined in: [types.ts:81](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L81)

Fields that must be NULL.
Implemented as `field IS NULL` filter.

***

### limit?

```ts
optional limit?: number;
```

Defined in: [types.ts:92](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L92)

Maximum number of items to return.

***

### notEqual?

```ts
optional notEqual?: Record<string, Scalar | Scalar[]>;
```

Defined in: [types.ts:70](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L70)

Inequality filters.
- Single scalar (non-null) => value != x (and NOT NULL)
- Array => value NOT IN [...]
- null values are normalized to `isNotNull` during query processing

***

### offset?

```ts
optional offset?: number;
```

Defined in: [types.ts:97](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L97)

Number of items to skip (for pagination).

***

### ranges?

```ts
optional ranges?: Record<string, RangeBound>;
```

Defined in: [types.ts:75](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L75)

Range filters for numeric or date fields.

***

### select?

```ts
optional select?: string[];
```

Defined in: [types.ts:111](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L111)

Restrict materialized result items to these fields (projection).

When set, each returned item contains only the listed fields that are
present on the row (missing / `undefined` values are omitted). This trims
per-result allocation and, on columnar (binary-loaded) bundles, avoids
decoding columns you never select. Filtering, `total`, and facet counts are
unaffected — projection only shapes the returned `items`.

Note: fields consumed by `enrichAliases` (the canonical ID fields) must be
included here, otherwise enrichment has nothing to resolve against.
