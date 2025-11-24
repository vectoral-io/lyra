# Lyra Bundle JSON Format Specification

**Version:** 1.0.0  
**Format Version:** 1.x

This document describes the JSON format for Lyra bundles, enabling non-TypeScript consumers to understand, validate, and integrate with Lyra bundle files.

## Overview

A Lyra bundle is a self-contained JSON document containing:
- A **manifest** describing the dataset schema and capabilities
- An **items** array containing the actual data records
- A **facetIndex** containing precomputed posting lists for fast facet queries

Bundles are designed to be:
- **Self-describing**: The manifest fully describes the schema and query capabilities
- **Portable**: Can be loaded and queried in any environment that can parse JSON
- **Deterministic**: The same inputs always produce the same bundle structure

## Top-Level Structure

The root object has three required properties:

```json
{
  "manifest": { ... },
  "items": [ ... ],
  "facetIndex": { ... }
}
```

### Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `manifest` | `LyraManifest` | Yes | Bundle manifest describing fields, types, and capabilities |
| `items` | `Array<Object>` | Yes | Array of data items (can be empty) |
| `facetIndex` | `FacetPostingLists` | Yes | Precomputed facet index for fast queries |

## Manifest Structure

The manifest (`LyraManifest`) describes the bundle schema and capabilities:

```json
{
  "version": "1.0.0",
  "datasetId": "tickets-2025-11-22",
  "builtAt": "2025-11-22T03:14:00Z",
  "fields": [ ... ],
  "capabilities": { ... }
}
```

### Manifest Properties

#### `version` (string, required)

The bundle format version. For v1 bundles, must start with `"1."` (e.g., `"1.0.0"`, `"1.1.0"`).

**Validation:** Must match pattern `^1\.`

#### `datasetId` (string, required)

Logical identifier for the dataset. Used for tracking and debugging.

#### `builtAt` (string, required)

ISO 8601 timestamp indicating when the bundle was created. Format: `YYYY-MM-DDTHH:mm:ss.sssZ`

Example: `"2025-11-22T03:14:00.000Z"`

#### `fields` (array, required)

Array of field definitions describing each field in the dataset.

Each field object has:

```json
{
  "name": "status",
  "kind": "facet",
  "type": "string",
  "ops": ["eq", "in"]
}
```

**Field Object Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | `string` | Yes | Field name (must be unique within fields array) |
| `kind` | `string` | Yes | Field kind: `"id"`, `"facet"`, `"range"`, or `"meta"` |
| `type` | `string` | Yes | Field type: `"string"`, `"number"`, `"boolean"`, or `"date"` |
| `ops` | `Array<string>` | Yes | Supported operations (descriptive metadata) |

**Field Kinds:**

- `"id"`: Identifier field; informational for manifest (not specially indexed in v1)
- `"facet"`: Indexed for equality and IN filters
- `"range"`: Used in numeric/date range filters
- `"meta"`: Schema awareness only, not indexed

**Field Types:**

- `"string"`: String values
- `"number"`: Numeric values
- `"boolean"`: Boolean values
- `"date"`: Date values.
  - If stored as numbers, they are interpreted as Unix timestamps in milliseconds.
  - If stored as strings, they are parsed with `Date.parse()` and compared as timestamps.
  - Items whose values cannot be parsed are effectively excluded from range results.

**Operations (`ops`):**

The `ops` array is descriptive metadata generated from the `kind`:
- Facet fields: `["eq", "in"]`
- Range fields: `["between", "gte", "lte"]`
- Other fields: `["eq"]`

Note: `ops` does not change query semantics in v1; it documents which operations are meaningful.

#### `capabilities` (object, required)

Describes which fields support which query types. **The `capabilities` object is the authoritative source of truth for queryable fields.** Only fields listed in `capabilities.facets` can be used in facet filters, and only fields listed in `capabilities.ranges` can be used in range filters.

```json
{
  "facets": ["status", "priority", "customer"],
  "ranges": ["createdAt", "amount"]
}
```

**Capabilities Properties:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `facets` | `Array<string>` | Yes | Field names that can be used in facet filters (source of truth) |
| `ranges` | `Array<string>` | Yes | Field names that can be used in range filters (source of truth) |

**Validation Rules:**

- All field names in `capabilities.facets` must exist in `fields` array
- All field names in `capabilities.ranges` must exist in `fields` array
- Facet fields must have `kind: "facet"` in their field definition
- Range fields must have `kind: "range"` in their field definition

**Query Behavior:**

- Runtime queries only accept facet/range field names that appear in `capabilities.facets` and `capabilities.ranges`
- Schema helpers (like `buildQuerySchema`) derive their schemas from `capabilities`, not from `fields` directly
- Unknown facet or range fields in queries are treated as "no matches" (returns empty results)

## Items Structure

The `items` array contains the actual data records:

```json
[
  { "id": "T-1001", "status": "open", "priority": "high", "createdAt": "2025-11-20T10:15:00Z" },
  { "id": "T-1002", "status": "closed", "priority": "low", "createdAt": "2025-11-19T08:30:00Z" }
]
```

### Items Array Properties

- **Type:** Array of objects
- **Can be empty:** Yes (empty array is valid)
- **Item structure:** Objects can have any structure, but should match fields declared in manifest
- **Storage:** Items are stored as-is with no transformation

### Multi-Valued Facets

Facet fields may contain arrays of values:

```json
{
  "id": "T-1001",
  "tags": ["bug", "p0", "crash"],
  "status": "open"
}
```

Array values are treated as "matches if any value matches" in queries. See the "Query and result" section in the [main README](../README.md#query-and-result) for detailed query semantics.

### Null and Undefined Values

- `null` and `undefined` values in facet fields are excluded from the facet index
- `null` and `undefined` values in range fields cause items to be excluded from range filter results

## FacetIndex Structure

The `facetIndex` (`FacetPostingLists`) contains precomputed posting lists for fast facet queries:

```json
{
  "status": {
    "open": [0, 2, 5],
    "closed": [1, 3, 4]
  },
  "priority": {
    "high": [0, 5],
    "medium": [2],
    "low": [1, 3, 4]
  }
}
```

### FacetIndex Structure

- **Type:** Object
- **Keys:** Field names (must match `capabilities.facets`)
- **Values:** Objects mapping value strings to arrays of item indices

### Posting List Semantics

Each posting list is an array of item indices (numbers) that:
- Are **sorted ascending** (e.g., `[0, 2, 5]`, not `[5, 0, 2]`)
- Are **deduplicated** (no repeated indices)
- Reference valid item positions (`0 <= index < items.length`)

**Note:** Runtime query behavior (how these indices are used) is defined in the main README. This document only describes the format structure.

### Value Keys

- Facet values are converted to strings for indexing
- `"true"`, `"false"`, `"null"`, `"undefined"` are stored as string literals
- Numbers are converted to strings (e.g., `42` → `"42"`)
- Arrays are indexed per-element (each value gets its own posting list entries)

### Empty FacetIndex Entries

Empty objects are valid for facet fields:

```json
{
  "status": {},
  "priority": { ... }
}
```

This indicates the field exists but has no indexed values (e.g., all items have `null`/`undefined` for that field).

## Validation Rules

### Version Validation

- `manifest.version` must start with `"1."`
- Invalid version format should be rejected

### Manifest Validation

- All required properties must be present
- `fields` array must not be empty (at least one field required)
- Field names must be unique within `fields` array
- `capabilities.facets` must only reference fields with `kind: "facet"`
- `capabilities.ranges` must only reference fields with `kind: "range"`

### FacetIndex Validation

- All keys in `facetIndex` must be present in `capabilities.facets`
- All indices in posting lists must be valid (`0 <= index < items.length`)
- Posting lists must be sorted ascending (producers must guarantee this)
- Posting lists must be deduplicated (producers must guarantee this)

**Note:** Loaders may skip re-validation of sorting and deduplication for performance reasons, but producers are required to emit sorted, deduplicated posting lists.

### Cross-Reference Validation

- Field names referenced in `capabilities` must exist in `fields`
- FacetIndex keys must match `capabilities.facets`
- Item structure should align with declared fields (warnings only, not errors)

**Note:** Item structure validation is primarily a producer-side guideline. The reference JS/TS implementation emits warnings at build time if configured fields do not appear in any item, but loaders do not revalidate item structure.

## Complete Example

```json
{
  "manifest": {
    "version": "1.0.0",
    "datasetId": "tickets-2025-11-22",
    "builtAt": "2025-11-22T03:14:00.000Z",
    "fields": [
      {
        "name": "id",
        "kind": "id",
        "type": "string",
        "ops": ["eq"]
      },
      {
        "name": "status",
        "kind": "facet",
        "type": "string",
        "ops": ["eq", "in"]
      },
      {
        "name": "priority",
        "kind": "facet",
        "type": "string",
        "ops": ["eq", "in"]
      },
      {
        "name": "tags",
        "kind": "facet",
        "type": "string",
        "ops": ["eq", "in"]
      },
      {
        "name": "createdAt",
        "kind": "range",
        "type": "date",
        "ops": ["between", "gte", "lte"]
      },
      {
        "name": "amount",
        "kind": "range",
        "type": "number",
        "ops": ["between", "gte", "lte"]
      }
    ],
    "capabilities": {
      "facets": ["status", "priority", "tags"],
      "ranges": ["createdAt", "amount"]
    }
  },
  "items": [
    {
      "id": "T-1001",
      "status": "open",
      "priority": "high",
      "tags": ["bug", "p0"],
      "createdAt": "2025-11-20T10:15:00Z",
      "amount": 1500
    },
    {
      "id": "T-1002",
      "status": "closed",
      "priority": "low",
      "tags": ["feature"],
      "createdAt": "2025-11-19T08:30:00Z",
      "amount": 500
    },
    {
      "id": "T-1003",
      "status": "open",
      "priority": "medium",
      "tags": ["bug", "p1"],
      "createdAt": "2025-11-21T14:20:00Z",
      "amount": 2000
    }
  ],
  "facetIndex": {
    "status": {
      "open": [0, 2],
      "closed": [1]
    },
    "priority": {
      "high": [0],
      "medium": [2],
      "low": [1]
    },
    "tags": {
      "bug": [0, 2],
      "p0": [0],
      "feature": [1],
      "p1": [2]
    }
  }
}
```

## Error Cases

### Invalid Version

```json
{
  "manifest": {
    "version": "2.0.0",  // ❌ Must start with "1."
    ...
  }
}
```

**Error:** `Invalid bundle version: "2.0.0". Expected version starting with "1."`

### Missing Required Properties

**Missing manifest or items:**

```json
{
  "manifest": { ... }
  // ❌ Missing "items"
}
```

**Error:** `Invalid bundle JSON: missing manifest or items`

**Note:** `facetIndex` is technically required but the reference implementation initializes it to `{}` if missing. Producers should always include `facetIndex`, even if empty.

### Invalid Capability Reference

```json
{
  "manifest": {
    "fields": [
      { "name": "status", "kind": "facet", "type": "string", "ops": ["eq", "in"] }
    ],
    "capabilities": {
      "facets": ["status", "nonexistent"]  // ❌ "nonexistent" not in fields
    }
  }
}
```

**Error:** `Invalid bundle: capability references non-existent facet field "nonexistent"`

### Invalid FacetIndex Key

```json
{
  "manifest": {
    "capabilities": {
      "facets": ["status"]
    }
  },
  "facetIndex": {
    "status": { ... },
    "invalidField": { ... }  // ❌ Not in capabilities.facets
  }
}
```

**Error:** `Invalid bundle: facetIndex contains field "invalidField" that is not in capabilities.facets`

### Invalid Posting List Index

```json
{
  "items": [
    { "status": "open" },
    { "status": "closed" }
  ],
  "facetIndex": {
    "status": {
      "open": [0, 5]  // ❌ Index 5 is out of bounds (only 2 items)
    }
  }
}
```

**Note:** All posting list indices must be within `[0, items.length)`. Loaders may choose to skip this check for performance reasons, but producers are required to emit in-bounds indices.

## Version Compatibility

### Version 1.x

- All bundles with `version` starting with `"1."` are compatible
- Format is stable within v1
- Future versions (2.x, etc.) may introduce breaking changes

### Migration Notes

- When v2 is introduced, v1 bundles will continue to be supported
- Loaders should validate version and reject unsupported formats
- Version format: `MAJOR.MINOR.PATCH` (semantic versioning)

## Implementation Notes

### Loading a Bundle

1. Parse JSON
2. Validate `manifest.version` starts with `"1."`
3. Validate all required properties exist (`manifest`, `items`; `facetIndex` may be missing and will be initialized to `{}`)
4. Validate `manifest.fields` is not empty
5. Validate `capabilities` references match `fields`
6. Validate `facetIndex` keys match `capabilities.facets`
7. Optionally validate posting list indices are in bounds (recommended but not required)
8. Loaders may skip re-validation of posting list sorting and deduplication for performance; producers must guarantee these invariants

### Query Semantics

The bundle format does not define query semantics; see the main README for query behavior. The format only describes the data structure.

### Performance Considerations

- Posting lists are pre-sorted and deduplicated for efficient intersection
- Large bundles may benefit from compression (gzip, etc.)
- Consider lazy-loading items if only querying (not returning full items)

## References

- [Main README](../README.md) - High-level overview and API documentation
- [TypeScript Types](../src/types.ts) - TypeScript type definitions (for reference)

