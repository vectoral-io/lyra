# Lyra Bundle Format Specifications

**JSON spec version:** 3.1.0 (format major: 3.x)
**Binary spec version:** 4.0.0 (format major: 4.x)

Lyra bundles ship in two interoperable formats:

- **JSON** (sections below) — portable, human-readable, debuggable. Stable indefinitely.
- **Binary container** (see [Binary Bundle Format (v4)](#binary-bundle-format-v4)) — compact, zero-copy hydrate for typed data.

A bundle in memory can be serialized to either format via `serialize()` / `serialize('binary')`. Loaders accept either via `LyraBundle.load(...)`, which autodetects on input type (`Uint8Array` → binary, plain object → JSON). The formats are functionally equivalent.

---

# JSON Format (v3.x)

This section describes the JSON format for Lyra bundles, enabling non-TypeScript consumers to understand, validate, and integrate with Lyra bundle files.

## Overview

A Lyra bundle is a self-contained JSON document containing:
- A **manifest** describing the dataset schema and capabilities
- An **items** array containing the data records
- A **facetIndex** with precomputed posting lists for facet queries
- A **nullIndex** with posting lists tracking null/undefined indexable fields
- v3.1 additions (optional, additive): **rangeColumns**, **facetIndexBin**, **nullIndexBin**

Bundles are designed to be:
- **Self-describing**: The manifest fully describes the schema and query capabilities
- **Portable**: Can be loaded and queried in any environment that can parse JSON
- **Deterministic**: The same inputs always produce the same bundle structure

## Top-Level Structure

```json
{
  "manifest": { ... },
  "items": [ ... ],
  "facetIndex": { ... },
  "nullIndex": { ... },
  "rangeColumns": { ... },
  "facetIndexBin": { ... },
  "nullIndexBin": { ... }
}
```

### Properties

| Property | Type | Required | Since | Description |
|----------|------|----------|-------|-------------|
| `manifest` | `LyraManifest` | Yes | 3.0 | Bundle manifest |
| `items` | `Array<Object>` | Yes | 3.0 | Data records |
| `facetIndex` | `FacetPostingLists` | Yes | 3.0 | Posting lists, `number[]` form |
| `nullIndex` | `NullPostingLists` | Yes | 3.0 | Per-indexable-field null posting lists |
| `rangeColumns` | `RangeColumnsJSON` | No | 3.1 | Pre-encoded range columns for fast hydrate |
| `facetIndexBin` | `FacetPostingListsBin` | No | 3.1 | Compact delta+varint posting lists |
| `nullIndexBin` | `NullPostingListsBin` | No | 3.1 | Compact delta+varint null posting lists |

When the v3.1 `*Bin` blocks or `rangeColumns` are present, conformant loaders SHOULD prefer them over the legacy `number[]` forms. Producers are encouraged to emit both forms during the v3.0 → v3.1 transition.

## Manifest Structure

The manifest (`LyraManifest`) describes the bundle schema and capabilities:

```json
{
  "version": "3.1.0",
  "datasetId": "tickets-2025-11-22",
  "builtAt": "2025-11-22T03:14:00Z",
  "fields": [ ... ],
  "capabilities": { ... },
  "lookups": { ... }
}
```

### Manifest Properties

#### `version` (string, required)

The bundle format version. Must start with `"3."` (e.g., `"3.0.0"`, `"3.1.0"`).

**Validation:** Must match pattern `^3\.`

#### `datasetId` (string, required)

Logical identifier for the dataset.

#### `builtAt` (string, required)

ISO 8601 timestamp marking bundle creation. Format: `YYYY-MM-DDTHH:mm:ss.sssZ`

#### `fields` (array, required)

Each field object:

```json
{
  "name": "status",
  "kind": "facet",
  "type": "string",
  "ops": ["eq", "in"]
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | `string` | Yes | Unique field name |
| `kind` | `string` | Yes | `"id"`, `"facet"`, `"range"`, `"meta"`, or `"alias"` |
| `type` | `string` | Yes | `"string"`, `"number"`, `"boolean"`, or `"date"` |
| `ops` | `Array<string>` | Yes | Supported ops (descriptive metadata) |
| `aliasTarget` | `string` | When `kind="alias"` | The canonical facet/range field this alias resolves to |

**Field Kinds:**

- `"id"`: Identifier field; informational only.
- `"facet"`: Indexed for equality and IN filters.
- `"range"`: Used in numeric/date range filters.
- `"meta"`: Schema-only, not indexed.
- `"alias"`: Resolves to a canonical facet/range field at query time.

**Field Types:**

- `"string"`, `"number"`, `"boolean"`, `"date"` (epoch ms or ISO 8601 string parsed via `Date.parse()`).

**Operations (`ops`):**

- Facet: `["eq", "in"]`
- Range: `["between", "gte", "lte"]`
- Other (id, meta, alias): `["eq", "in"]` or `["eq"]`

#### `capabilities` (object, required)

Authoritative source of truth for queryable fields:

```json
{
  "facets": ["status", "priority", "customer"],
  "ranges": ["createdAt", "amount"],
  "aliases": ["customerName"]
}
```

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `facets` | `Array<string>` | Yes | Equal-filterable field names |
| `ranges` | `Array<string>` | Yes | Range-filterable field names |
| `aliases` | `Array<string>` | No | Alias field names |

**Validation Rules:**

- All names in `capabilities.*` must exist in `fields`.
- Facet/range fields must have matching `kind`.

#### `lookups` (object, optional)

Auto-generated alias lookup tables, keyed by alias field name. Each entry has `aliasToIds` and `idToAliases` maps. Not user-configured. Producers may omit when no aliases are declared.

## Items Structure

```json
[
  { "id": "T-1001", "status": "open", "priority": "high", "createdAt": "2025-11-20T10:15:00Z" },
  { "id": "T-1002", "status": "closed", "priority": "low", "createdAt": "2025-11-19T08:30:00Z" }
]
```

- Array of objects (may be empty).
- Stored as-is; consumers should align item shape with declared fields.

### Multi-Valued Facets

Facet fields may contain arrays (`tags: ["bug", "p0"]`). Each array element gets its own posting list entry.

### Null and Undefined Values

- Excluded from `facetIndex` and `facetIndexBin`.
- Tracked in `nullIndex` and `nullIndexBin` so `isNull` / `equal: { f: [v, null] }` queries are O(posting-list).

## FacetIndex Structure (legacy, v3.0)

```json
{
  "status": {
    "open": [0, 2, 5],
    "closed": [1, 3, 4]
  }
}
```

- Keys at top level: facet field names (must match `capabilities.facets`).
- Inner keys: stringified facet values.
- Inner values: `number[]`, sorted ascending and deduplicated.

## NullIndex Structure (legacy, v3.0)

```json
{
  "status": [12, 45, 78],
  "priority": [3]
}
```

- Keys: every indexable field (facet, range, or alias).
- Values: `number[]` of indices where the field is `null` or `undefined`. Sorted ascending.

## v3.1 Additive Fields

### `rangeColumns` (optional)

Pre-encoded range columns. Allows zero-rebuild hydration:

```json
{
  "createdAt": { "encoding": "b64f64", "data": "AAAAAAAAAAA..." },
  "amount":    { "encoding": "b64f64", "data": "..." }
}
```

| Property | Description |
|----------|-------------|
| `encoding` | `"b64f64"` — base64 of little-endian Float64 bytes |
| `data`     | Base64 string. Length in floats = `items.length`. NaN encodes null/unparsable. |

**Loaders:** decode each block to a `Float64Array` of length `items.length`. If absent, fall back to rebuilding from items at first range query.

### `facetIndexBin` (optional)

Same shape as `facetIndex`, but each posting list is encoded as a base64 string of LEB128 varints over delta-coded ascending integers:

```json
{
  "status": {
    "open":   "AgEC...",
    "closed": "AwQF..."
  }
}
```

**Encoding:** for a sorted ascending `Uint32Array` `arr`:
1. Compute `delta[i] = arr[i] - arr[i-1]` (with `delta[0] = arr[0]`).
2. Encode each delta as unsigned LEB128.
3. Concatenate bytes; base64 the result.

**Decoding:** reverse: base64 → bytes → varint stream → cumulative sum.

When both `facetIndex` and `facetIndexBin` are present, `facetIndexBin` takes precedence.

### `nullIndexBin` (optional)

Same encoding as `facetIndexBin` but flat (one posting list per field):

```json
{
  "status": "AgQE...",
  "priority": "Aw=="
}
```

When present, takes precedence over `nullIndex`.

## Validation Rules

### Version Validation

- `manifest.version` must start with `"3."`.
- Invalid version format must be rejected.

### Manifest Validation

- All required properties present.
- `fields` array must not be empty.
- Field names unique.
- `capabilities.*` reference only existing fields with matching kinds.
- `kind: "alias"` fields must declare a valid `aliasTarget` of kind `"facet"` or `"range"`.

### Index Validation

- All keys in `facetIndex` / `facetIndexBin` must appear in `capabilities.facets`. Loaders MUST reject unknown keys in either form.
- All indices in posting lists must satisfy `0 <= i < items.length`.
- Posting lists MUST be sorted ascending and deduplicated. Loaders MAY skip re-validation for performance.

### Cross-Reference Validation

- Field names in `capabilities` exist in `fields`.
- Item structure SHOULD align with declared fields (warning at producer side, not enforced at load).

## Error Cases

### Invalid Version

```json
{ "manifest": { "version": "2.0.0", ... } }
```

**Error:** `Invalid bundle version: "2.0.0". Expected version starting with "3."`

### Missing Required Properties

```json
{ "manifest": { ... } }
```

**Error:** `Invalid bundle JSON: missing manifest or items`

### Invalid Capability Reference

```json
{
  "manifest": {
    "fields": [{ "name": "status", "kind": "facet", "type": "string", "ops": ["eq", "in"] }],
    "capabilities": { "facets": ["status", "nonexistent"] }
  }
}
```

**Error:** `Invalid bundle: capability references non-existent facet field "nonexistent"`

### Invalid FacetIndex Key

```json
{
  "manifest": { "capabilities": { "facets": ["status"] } },
  "facetIndex": { "status": { ... }, "invalidField": { ... } }
}
```

**Error:** `Invalid bundle: facetIndex contains field "invalidField" that is not in capabilities.facets`

### Unsupported rangeColumns Encoding

```json
{ "rangeColumns": { "amount": { "encoding": "raw", "data": "..." } } }
```

**Error:** `Invalid bundle: rangeColumns["amount"] has unsupported encoding "raw"`

## Version Compatibility

### v3.0 → v3.1

- v3.1 is a strict superset: only optional additive fields. v3.0 readers parse v3.1 bundles without error (unknown fields ignored).
- v3.1 readers may receive v3.0 bundles; the `*Bin` and `rangeColumns` blocks are absent and the legacy paths are used.

### Forward Compatibility

- Future v3.x minors may add additional optional fields under the same compatibility contract.
- v4.x is reserved for breaking changes (see roadmap: binary container format).

## Implementation Notes

### Loading a Bundle

1. Parse JSON.
2. Validate `manifest.version` starts with `"3."`.
3. Validate required properties (`manifest`, `items`).
4. Validate `manifest.fields` non-empty.
5. Validate `capabilities` cross-references.
6. Collect facet keys from `facetIndex` and `facetIndexBin` (if present); reject unknown keys.
7. Decode `facetIndexBin` / `nullIndexBin` into `Uint32Array` if present; else convert legacy `number[]`.
8. Decode `rangeColumns` into `Float64Array` per field if present; else defer to lazy rebuild.

### Performance Considerations

- v3.1 binary fields shrink wire size and speed up hydrate. Producers SHOULD emit them.
- Posting lists are pre-sorted and deduplicated for efficient intersection at query time.
- Bundles benefit from gzip / brotli compression on top of the JSON wire form.

---

# Binary Bundle Format (v4)

The v4 binary container is an alternative to the JSON format. It is meaningfully smaller on the wire and faster to hydrate, but is not human-readable. Both formats are produced from the same in-memory bundle state and accepted by the same `LyraBundle.load()` entry point.

`BUNDLE_VERSION` for newly produced bundles is `"4.1.0"`. The loader continues to accept any manifest with `version` starting with `"3."` or `"4."`, so v3.x JSON bundles remain readable indefinitely.

**Items encodings:** v4.0 stored items as a single UTF-8 JSON block (`encoding: "json"`). v4.1 added a columnar encoding (`encoding: "columnar"`) that dictionary-encodes string fields, packs booleans as bits, stores numbers as raw `Float64Array` bytes, and uses per-row JSON for arrays/objects. New v4.x bundles default to the columnar encoding; v4.0 readers cannot consume v4.1 columnar bundles, but v4.1 readers consume both.

## Overview

A v4 binary bundle is a single `Uint8Array` consisting of a fixed prefix, a UTF-8 JSON header that declares manifest + block layout, and an aligned body containing items, posting lists, and range columns.

```
+-----------------------------------------------+
| magic       : 5 bytes  "LYRA4"                |
| flags       : u32 LE   (reserved; 0 in v4.0)  |
| header_len  : u32 LE                          |
| header JSON : header_len bytes UTF-8          |
| (pad to 8-byte boundary)                      |
| body                                          |
|   - items block        (UTF-8 JSON)           |
|   - facetIndex block   (varint posting lists) |
|   - nullIndex block    (varint posting lists) |
|   - rangeColumns block (raw f64, 8B aligned)  |
+-----------------------------------------------+
```

All multi-byte integers are little-endian. The format assumes a little-endian host; all current Lyra runtimes (x86, ARM, browsers) qualify.

## Magic + Flags + Header Length

| Offset | Size | Field        | Notes                                       |
|--------|------|--------------|---------------------------------------------|
| 0      | 5    | `magic`      | ASCII bytes for `"LYRA4"`                   |
| 5      | 4    | `flags`      | `u32` LE; reserved, MUST be 0 in v4.0       |
| 9      | 4    | `header_len` | `u32` LE; byte length of header JSON        |
| 13     | `header_len` | `header`     | UTF-8 JSON; see header schema below |

After the header, the writer pads with zero bytes to the next 8-byte boundary. Body block offsets in the header are body-relative; the reader resolves them against `bodyStart = align8(13 + header_len)`.

## Header Schema

```jsonc
{
  "manifest": { /* LyraManifest, identical to v3 */ },
  "blocks": {
    "items":        { /* see "items encodings" below */ },
    "facetIndex":   { "<field>": { "<value>": { "off": 0, "len": 0 } } },
    "nullIndex":    { "<field>": { "off": 0, "len": 0 } },
    "rangeColumns": { "<field>": { "off": 0, "len": 0, "dtype": "f64" } }
  }
}
```

| Slot type        | Required keys                  |
|------------------|--------------------------------|
| facet posting    | `off`, `len`                   |
| null posting     | `off`, `len`                   |
| range column     | `off`, `len`, `dtype="f64"`    |

`off` is body-relative byte offset; `len` is byte length of the block.

### Items encodings

**`encoding: "json"` (v4.0)**

```jsonc
{ "encoding": "json", "off": 0, "len": 4096 }
```

The body block is UTF-8 encoded JSON of `T[]`. Reader: `JSON.parse(TextDecoder.decode(bytes))`.

**`encoding: "columnar"` (v4.1, default)**

```jsonc
{
  "encoding": "columnar",
  "length": 100000,
  "fieldNames": ["id", "status", "createdAt", ...],
  "fields": {
    "id":       { "encoding": "utf8-dict",     "nullBitmap": {off,len}, "dict": {off,len,count,offsets:{off,len}}, "indices": {off,len} },
    "status":   { "encoding": "utf8-dict",     "nullBitmap": {off,len}, "dict": {off,len,count,offsets:{off,len}}, "indices": {off,len} },
    "active":   { "encoding": "u8-bool",       "nullBitmap": {off,len}, "data": {off,len} },
    "createdAt":{ "encoding": "f64",           "nullBitmap": {off,len}, "data": {off,len} },
    "tags":     { "encoding": "json-fallback", "nullBitmap": {off,len}, "jsonOffsets": {off,len}, "jsonBytes": {off,len} }
  }
}
```

Per-field encodings:

| `encoding`        | Used for                                  | Body shape                                                                 |
|-------------------|-------------------------------------------|----------------------------------------------------------------------------|
| `utf8-dict`       | strings                                    | UTF-8 string table (length-prefixed by an `offsets` Uint32 table) + `Uint32` row→dict-id `indices` array |
| `f64`             | numbers / dates                            | Raw little-endian `Float64Array` bytes; 8-byte aligned in body              |
| `u8-bool`         | booleans                                   | Packed bits (1 bit per row, ceil(n/8) bytes)                                |
| `json-fallback`   | arrays, objects, mixed types               | Per-row JSON byte ranges: `Uint32` offset table (length n+1) + concatenated UTF-8 JSON bytes |

Every column carries a `nullBitmap` (1 bit per row, packed; bit set = null/undefined). This distinguishes a stored `null`/`undefined` from a falsy value (`""`, `0`, `false`).

The encoder picks per-field encoding via a heuristic: a field with mixed types or any complex (`Array`/`Object`) values goes to `json-fallback`; otherwise the most specific primitive encoding wins.

## Body Blocks

### items
Either UTF-8 encoded JSON of `T[]` (`encoding: "json"`) or a columnar layout (`encoding: "columnar"`) — see the header schema above. JSON has no alignment requirement; columnar has its own internal alignment for `f64` columns (each f64 column is preceded by zero padding to an 8-byte body boundary).

### facetIndex
Concatenation of delta+varint posting lists. Each entry's bytes are addressed via `(off, len)` in the header. Encoding is identical to the v3.1 `facetIndexBin` payload but stored as raw bytes (no base64).

### nullIndex
Same encoding as facet posting lists, one block per field.

### rangeColumns
Raw little-endian Float64 bytes per column. Each column's start is aligned to 8 bytes by inserting zero padding before it during encoding. Length is `items.length * 8`.

When the body start (`align8(13 + header_len)`) plus the column's `off` is itself 8-byte aligned within the file, loaders can produce a zero-copy `Float64Array` view via `new Float64Array(buffer, byteOffset, len/8)`. Otherwise they MUST copy bytes into a fresh `Float64Array`.

## Validation Rules

- `magic` MUST equal `"LYRA4"`.
- `flags` MUST be `0` for v4.0 readers.
- `header_len` MUST not exceed `bytes.length - 13`.
- Header MUST parse as valid JSON with `manifest` and `blocks` keys.
- `manifest.version` MUST start with `"3."` or `"4."`.
- All facet/null/range field names in `blocks` MUST appear in `manifest.capabilities`.
- `items.encoding` MUST be `"json"` for v4.0.
- `rangeColumns[*].dtype` MUST be `"f64"` for v4.0.
- Block `off + len` MUST be within the buffer.

## Error Cases

```
Invalid bundle: expected v4 binary buffer (magic "LYRA4")
Invalid v4 bundle: header_len <N> exceeds buffer length
Invalid v4 bundle: header missing manifest or blocks
Invalid v4 bundle: unsupported items encoding "<x>"
Invalid v4 bundle: rangeColumns["<field>"] has unsupported dtype "<x>"
Invalid bundle version: "<v>". Expected version starting with "3." or "4."
```

## Compatibility

- v3.x JSON readers cannot consume v4 binary buffers — the magic byte mismatch causes a clean rejection.
- v4 readers accept v3 JSON via `LyraBundle.load(jsonValue)`. The legacy `toJSON()` continues to emit v3.1.
- Future v4.x minors may flip reserved bits in `flags` to enable additive features (e.g. columnar items in v4.1) under the same compatibility contract.

## Implementation Notes

### Encoding

1. Compose body chunks: items JSON, then per-(field,value) facet posting lists (delta+varint), then per-field null posting lists, then range columns (each preceded by zero-padding to 8 bytes). Record `(off, len)` per block.
2. Build header JSON containing the manifest and the block index.
3. Encode header to UTF-8 bytes. Compute `header_len`.
4. Emit `magic | flags | header_len | header_bytes`, pad to 8 bytes, then append the body.

### Decoding

1. Verify magic, read `flags`, read `header_len`.
2. Parse header JSON.
3. Compute `bodyStart = align8(13 + header_len)`.
4. For each block in the header, slice `[bodyStart + off, bodyStart + off + len)` from the buffer:
   - `items` → `JSON.parse(TextDecoder.decode(slice))`.
   - facet/null posting lists → `deltaVarintDecodeBytes(slice)`.
   - range column → zero-copy `Float64Array` view if alignment permits, else copy.
5. Validate manifest, then validate field names against `capabilities`.

## References

- [Main README](../README.md)
- [TypeScript Types](../src/types.ts)
- [`src/utils/binary-bundle.ts`](../src/utils/binary-bundle.ts) — reference encoder/decoder.
