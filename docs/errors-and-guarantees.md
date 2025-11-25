# Error Behavior and Guarantees

Complete documentation of error handling, validation, and behavioral guarantees in Lyra.

## Overview

Lyra follows a principle of **fail-closed** behavior: invalid inputs and unknown fields result in empty results rather than errors, ensuring deterministic behavior. This document describes all error cases, validation rules, and behavioral guarantees.

## `createBundle` / `LyraBundle.create`

### Throws

**Throws** synchronously/asynchronously with `Error` in these cases:

#### Invalid Field Config

- `kind` not in `['id','facet','range','meta']`
- `type` not in `['string','number','boolean','date']`

**Error Message:**

```
Invalid field kind "foo" for field "status". Must be one of: id, facet, range, meta.
```

or

```
Invalid field type "foo" for field "status". Must be one of: string, number, boolean, date.
```

#### Invalid Range Type Inference (Simple Config Only)

When using `SimpleBundleConfig`, if a range field contains non-numeric, non-date string values, an error is thrown.

**Error Message:**

```
Cannot infer range type for field "createdAt". Encountered non-numeric, non-date string value: "invalid".
```

This occurs when:
- A field is specified in `ranges`
- The field contains string values that cannot be parsed as numbers or dates
- Type inference cannot determine a valid range type

### Soft Behavior

#### Missing Fields

If a configured field does not exist on any item:

- Does not throw
- Emits a `console.warn` exactly once per field:

```
Field "statusBucket" is configured but does not exist in any items. It will be ignored.
```

The field will be included in the manifest but will have no indexed values and will not appear in query results.

## `LyraBundle.load`

### Throws

**Throws** for clearly invalid bundle structures:

#### Missing Required Properties

**Error:**

```
Invalid bundle JSON: missing manifest or items
```

Occurs when:
- `manifest` property is missing or undefined
- `items` property is missing or undefined

**Note:** `facetIndex` is technically required but the reference implementation initializes it to `{}` if missing. Producers should always include `facetIndex`, even if empty.

#### Invalid Bundle Version

**Error:**

```
Invalid bundle version: "2.0.0". Expected version starting with "1."
```

Occurs when:
- `manifest.version` does not start with `"1."`
- Version format is invalid

#### Invalid Capability Reference

**Error:**

```
Invalid bundle: capability references non-existent facet field "status"
```

Occurs when:
- A field name in `capabilities.facets` does not exist in `manifest.fields`
- A field name in `capabilities.ranges` does not exist in `manifest.fields`

#### Invalid FacetIndex Key

**Error:**

```
Invalid bundle: facetIndex contains field "priority" that is not in capabilities.facets
```

Occurs when:
- A key in `facetIndex` is not present in `capabilities.facets`
- The facetIndex contains fields that are not declared as facet capabilities

### Does Not Throw

#### Missing Facet Field Entries

If a facet field declared in `capabilities.facets` has no entry in `facetIndex`:

- Does not throw
- Initializes to `{}` and continues
- Queries on that field will return empty results (no matches)

This is a valid state for fields where all items have `null`/`undefined` values.

## `LyraBundle.query`

### Query Normalization and Error Handling

`LyraBundle.query` follows a **fail-closed** principle: invalid inputs are normalized rather than throwing errors, ensuring deterministic behavior.

#### Unknown Facet Field

**Behavior:** Treated as "no matches"

- Returns `total = 0`, `items = []`
- Does not throw
- Applied query includes the unknown field

**Example:**

```ts
const result = bundle.query({
  facets: {
    status: 'open',
    unknownField: 'value', // Unknown field
  },
});

// result.total === 0
// result.items === []
// result.applied.facets === { status: 'open', unknownField: 'value' }
```

**Rationale:** A typo in a facet field name will fail closed (no matches) rather than silently ignore the filter.

#### Unknown Range Field

**Behavior:** Treated as "no matches"

- Returns `total = 0`, `items = []`
- Does not throw
- Applied query includes the unknown range

**Example:**

```ts
const result = bundle.query({
  ranges: {
    createdAt: { min: 0, max: Date.now() },
    unknownRange: { min: 0, max: 100 }, // Unknown field
  },
});

// result.total === 0
// result.items === []
```

**Rationale:** Consistent with facet behavior - unknown fields fail closed.

#### Negative Offset

**Behavior:** Clamped to `0`

- Negative values are normalized to `0`
- Does not throw
- Applied query shows normalized offset

**Example:**

```ts
const result = bundle.query({
  offset: -5, // Negative
  limit: 10,
});

// Offset is treated as 0
// result.applied.offset === 0 (if query tracking is enabled)
```

#### Negative Limit

**Behavior:** Treated as `0`

- Negative values are normalized to `0`
- No items returned, but `total` still reflects all matches
- Does not throw

**Example:**

```ts
const result = bundle.query({
  facets: { status: 'open' },
  limit: -10, // Negative
});

// result.items === []
// result.total === <actual match count>
```

#### Overly Large Limit

**Behavior:** Effectively clamped to `candidateIndices.length` via `.slice()`

- Limit larger than available results is silently clamped
- Does not throw
- Returns all available results

**Example:**

```ts
const result = bundle.query({
  facets: { status: 'open' },
  limit: 1000000, // Very large
});

// Returns all matching items (up to actual count)
```

### Type Safety

**Out of Scope for v1:**

Bad types in query parameters (e.g., passing objects where primitives are expected) are out of scope for v1. Callers are expected to pass structurally correct types according to the `LyraQuery` interface.

Runtime type checking may be added in future versions.

## Behavioral Guarantees

### Determinism

- **Same inputs produce same outputs:** Given the same bundle and query, results are always identical
- **No randomness:** Query execution is deterministic and reproducible
- **No side effects:** Querying a bundle does not modify the bundle or any external state

### Performance Characteristics

- **Sub-millisecond queries:** Facet queries over medium-sized datasets (tens to low hundreds of thousands of records) complete in sub-millisecond time
- **O(n) range filtering:** Range filters iterate over candidate items linearly
- **Optimized intersections:** Facet intersections use sorted posting lists for efficiency

### Data Integrity

- **Immutable bundles:** Bundles are immutable once created; querying does not modify the bundle
- **Snapshot consistency:** All queries against a bundle see the same snapshot of data
- **No data loss:** Querying never modifies or removes items from the bundle

### Query Semantics

- **Facet arrays:** Array values in facet fields match if **any** element matches
- **Range inclusivity:** Range filters use inclusive bounds (`>= min` and `<= max`)
- **Null/undefined handling:**
  - `null`/`undefined` values in facet fields are excluded from facet index
  - `null`/`undefined` values in range fields cause items to be excluded from range filter results
- **Date parsing:** Date strings are parsed using `Date.parse()`; unparseable dates are excluded from range results

## Error Handling Best Practices

### For Bundle Builders

1. **Validate field configs early:** Check `kind` and `type` values before calling `createBundle`
2. **Handle missing fields:** Check for `console.warn` messages about missing fields
3. **Validate bundle JSON:** Before loading, ensure bundle JSON matches the expected structure

### For Query Callers

1. **Validate field names:** Ensure facet/range field names match `capabilities.facets` and `capabilities.ranges`
2. **Handle empty results:** Check `total === 0` to detect unknown fields or no matches
3. **Normalize pagination:** Ensure `offset` and `limit` are non-negative numbers
4. **Type safety:** Use TypeScript types to ensure query structure matches `LyraQuery`

### For Tool Integrations

1. **Fail gracefully:** Return empty results rather than throwing errors
2. **Log warnings:** Log unknown fields or invalid queries for debugging
3. **Validate schemas:** Use `buildQuerySchema` to generate validation schemas for agent inputs

## Summary

| Operation | Invalid Input | Behavior |
|-----------|---------------|----------|
| `createBundle` | Invalid `kind`/`type` | Throws `Error` |
| `createBundle` | Missing field in items | Warns, continues |
| `createBundle` | Invalid range inference | Throws `Error` |
| `LyraBundle.load` | Missing manifest/items | Throws `Error` |
| `LyraBundle.load` | Invalid version | Throws `Error` |
| `LyraBundle.load` | Invalid capability ref | Throws `Error` |
| `LyraBundle.load` | Invalid facetIndex key | Throws `Error` |
| `LyraBundle.query` | Unknown facet field | Returns empty result |
| `LyraBundle.query` | Unknown range field | Returns empty result |
| `LyraBundle.query` | Negative offset | Clamped to 0 |
| `LyraBundle.query` | Negative limit | Treated as 0 |
| `LyraBundle.query` | Large limit | Clamped to available |

All of these behaviors are deterministic and documented. Bad types in query parameters are out of scope for v1; callers are expected to pass structurally correct types.

