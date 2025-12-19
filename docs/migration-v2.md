# Migration Guide: Lyra v1 to v2

This guide helps you migrate from Lyra v1 to v2. Lyra v2 introduces breaking changes to the query API and adds new features for dimension-aware aliases and explicit null handling.

## Breaking Changes Summary

### 1. Query API Changes

**v1 (deprecated):**
```ts
bundle.query({
  facets: { status: 'open', priority: 'high' },
  ranges: { createdAt: { min: from, max: to } },
  facetMode: 'union',
  rangeMode: 'intersection',
});
```

**v2 (new):**
```ts
bundle.query({
  equal: { status: 'open', priority: 'high' },
  ranges: { createdAt: { min: from, max: to } },
  // facetMode/rangeMode removed - all operators are intersected (AND)
});
```

### 2. Removed Features

- **`facets` field**: Replaced with `equal`
- **`facetMode`**: Removed - all operators use AND logic
- **`rangeMode`**: Removed - all operators use AND logic
- **Array queries**: Removed - use `equal` with array values for IN semantics

### 3. New Features

- **`equal`**: Explicit equality operator (replaces `facets`)
- **`notEqual`**: Explicit inequality operator
- **`isNull`**: Explicit null check operator
- **`isNotNull`**: Explicit not-null check operator
- **Aliases**: Human-readable fields that resolve to canonical IDs
- **`enrichAliases`**: Enrich results with alias values

## Step-by-Step Migration

### Step 1: Update Query Syntax

Replace all `facets:` with `equal:`:

```ts
// Before (v1)
bundle.query({
  facets: { status: 'open' }
});

// After (v2)
bundle.query({
  equal: { status: 'open' }
});
```

### Step 2: Remove Array Query Syntax

If you were using array queries with `facetMode`/`rangeMode`, convert to single queries or multiple queries:

```ts
// Before (v1) - Union mode
bundle.query({
  facets: [
    { status: 'open', priority: 'high' },
    { status: 'in_progress', priority: 'urgent' }
  ],
  facetMode: 'union'
});

// After (v2) - Use IN semantics
bundle.query({
  equal: {
    status: ['open', 'in_progress'],
    priority: ['high', 'urgent']
  }
});

// Or run multiple queries and combine results
```

### Step 3: Update Null Handling

If you were post-filtering for nulls in JavaScript, use explicit operators:

```ts
// Before (v1) - Manual JS filtering
const result = bundle.query({ facets: { zone_id: 'Z-001' } })
  .items.filter(item => item.category === null);

// After (v2) - First-class null support
const result = bundle.query({
  equal: { zone_id: 'Z-001' },
  isNull: ['category']
});
```

### Step 4: Update Result Type Expectations

The `applied` field in results now uses v2 operators:

```ts
// Before (v1)
result.applied.facets
result.applied.ranges

// After (v2)
result.applied.equal
result.applied.notEqual
result.applied.ranges
result.applied.isNull
result.applied.isNotNull
```

### Step 5: Update Bundle Version

All v2 bundles use `manifest.version = "2.0.0"`. Existing v1 bundles will continue to work, but new bundles created with v2 will use version 2.0.0.

## New Features in v2

### Aliases

v2 introduces dimension-aware aliases that allow querying with human-readable names:

```ts
// Create bundle with aliases
const bundle = await createBundle(items, {
  datasetId: 'work-items',
  facets: ['zone_id', 'activity_id'],
  aliases: {
    zone_name: 'zone_id',      // Short name
    zone_label: 'zone_id',      // Descriptive label
    activity_name: 'activity_id',
  },
});

// Query using aliases
const result = bundle.query({
  equal: { zone_name: 'Zone A' }, // Auto-resolves to zone_id IN ['Z-001', 'Z-007']
});

// Enrich results with alias values (defaults to true if aliases are available)
const enriched = bundle.query({
  equal: { zone_id: 'Z-001' },
  // enrichAliases defaults to true, so this is optional
});
// enriched.enrichedAliases[0] = { zone_name: ['Zone A'], zone_label: ['First Floor'] }

// To disable enrichment, explicitly set to false
const noEnrich = bundle.query({
  equal: { zone_id: 'Z-001' },
  enrichAliases: false,
});
```

### Explicit Null Handling

v2 provides first-class null handling:

```ts
// Inline null normalization
bundle.query({
  equal: { category: null }  // Normalized to isNull internally
});

// Explicit null checks
bundle.query({
  isNull: ['category', 'system_id'],
  isNotNull: ['wip_trade'],
});
```

### Exclusion Filters

v2 adds explicit exclusion filters:

```ts
bundle.query({
  equal: { status: 'open' },
  notEqual: { priority: ['low', 'cancelled'] },
});
```

## Code Transformation Examples

### Example 1: Simple Facet Query

```ts
// v1
bundle.query({
  facets: { status: 'open', priority: 'high' }
});

// v2
bundle.query({
  equal: { status: 'open', priority: 'high' }
});
```

### Example 2: Array Values (IN semantics)

```ts
// v1
bundle.query({
  facets: { priority: ['high', 'urgent'] }
});

// v2 (same syntax, different field name)
bundle.query({
  equal: { priority: ['high', 'urgent'] }
});
```

### Example 3: Null Filtering

```ts
// v1 - Manual filtering
const result = bundle.query({ facets: { zone_id: 'Z-001' } });
const filtered = result.items.filter(item => item.category === null);

// v2 - First-class support
const result = bundle.query({
  equal: { zone_id: 'Z-001' },
  isNull: ['category']
});
```

### Example 4: getFacetSummary

```ts
// v1
bundle.getFacetSummary('status', {
  facets: { customerId: 'C-ACME' }
});

// v2
bundle.getFacetSummary('status', {
  equal: { customerId: 'C-ACME' }
});
```

## Testing Your Migration

1. **Update all query calls**: Replace `facets:` with `equal:`
2. **Remove mode parameters**: Remove `facetMode` and `rangeMode`
3. **Update result expectations**: Check `result.applied.equal` instead of `result.applied.facets`
4. **Test null handling**: Replace manual JS filtering with `isNull`/`isNotNull`
5. **Run your test suite**: Ensure all tests pass with v2 syntax

## Backward Compatibility

- **v1 bundles**: Can still be loaded and queried (with v1 syntax)
- **v2 bundles**: Use `manifest.version = "2.0.0"` and require v2 query syntax
- **Mixed environments**: You can have both v1 and v2 bundles in the same codebase

## Questions?

If you encounter issues during migration, please:
1. Check this guide for common patterns
2. Review the [API documentation](./api.md) for v2 types
3. Check [examples](../examples/) for working v2 code

