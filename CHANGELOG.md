# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.0] - 2026-06-17

Package-version bump only — the bundle format is unchanged (`BUNDLE_VERSION` stays `4.1.0`, v3 JSON and v4 binary load exactly as before). The major bump is solely for removing a dead exported type.

### Removed

- **`QuerySchemaOptions`** and the second argument to `buildQuerySchema(manifest)`. The `facetArrayMode` / `includeArrayQueryFormat` options were a v1 leftover, ignored since v2. Call `buildQuerySchema(manifest)` with one argument; if you were passing an options object, drop it.

### Changed

- Docs rewritten for the current API surface (`docs/api.md`, `docs/agents.md`, `docs/errors-and-guarantees.md`) — the prior versions documented removed v1 methods and query syntax.

### Internal

- Removed stale committed `.d.ts` files from `src/` (the build emits declarations to `dist/`; these were never published) and gitignored the path so they don't return.

## [4.1.0] - 2026-05-07

### Added

- **Columnar items inside the v4 binary container** (default for new bundles).
  - String fields → dictionary-encoded UTF-8 string table + `Uint32Array` row → dict-id indices.
  - Number / date fields → raw little-endian `Float64Array` bytes (8-byte aligned, zero-copy view when alignment permits).
  - Boolean fields → packed bits (`(n + 7) / 8` bytes).
  - Arrays / objects / mixed-type fields → per-row JSON byte ranges (json-fallback).
  - Every column carries a 1-bit-per-row null bitmap so `null` survives round-trip distinct from `''` / `0` / `false`.
- **`ItemStore<T>` abstraction** (`src/utils/item-store.ts`).
  - `RowItemStore<T>` wraps `T[]` (used at `createBundle` time and after JSON / v4.0 binary loads).
  - `ColumnarItemStore<T>` reads from columns lazily (used after v4.1 binary loads). Items are never materialized eagerly — only at the result boundary or on demand.
- Hot-path query readers refactored to consume `ItemStore` via `getField` / `materializeRow` / `materializeMany`. No row-form mirror is kept in memory for columnar bundles.

### Changed

- `BUNDLE_VERSION` → `4.1.0`.
- `serialize('binary')` defaults to columnar items. To produce row-form items inside a v4 container, call the lower-level `encodeV4(payload, { itemsFormat: 'json' })`.
- `bundle.toJSON()` on a columnar-loaded bundle now materializes new row objects on demand. Reconstruction is field-equal to originals; object identity is not preserved (consistent with prior `enrichItems` behavior).

### Performance

Measured on a 300k-item anonymized `WorkItem` fixture with deeply-nested per-row `steps: Record<string, …>` payloads:

| Metric | v3.1 JSON | v4.1 binary |
|---|---|---|
| Wire size (gzipped) | 49.3 MB | **43.6 MB** (12% smaller) |
| Critical-path cold start | ~887 ms `JSON.parse` + 2 ms `load` | **~18 ms `loadBinary`** |
| Speedup | — | **~49× faster** |

Bench: `bun run tests/bench/realworld-bench.ts` (configurable via `REALWORLD_BENCH_ITEMS` / `REALWORLD_BENCH_SEED` / `REALWORLD_BENCH_RUNS`).

### Documentation

- New `docs/migration-v4.md` walking through v3 → v4 in three independent stages.
- `docs/bundle-json-spec.md` extended with the v4 binary container format and v4.1 columnar items section.
- README updated with binary serialization quick-start and headline measurements.

[4.1.0]: https://github.com/vectoral-io/lyra/releases/tag/v4.1.0

## [4.0.0] - 2026-05-07

### Added

- **Binary bundle container** (magic bytes `LYRA4`).
  - `bundle.serialize('binary')` → `Uint8Array`.
  - `LyraBundle.loadBinary<T>(bytes)` — explicit binary loader.
  - `LyraBundle.load<T>(rawOrBytes)` autodetects: `Uint8Array` with `LYRA4` magic dispatches to `loadBinary`; plain object stays on the JSON path.
  - Layout: 5-byte magic → `flags: u32 LE` → `header_len: u32 LE` → UTF-8 JSON header → 8-byte aligned body (items / facetIndex / nullIndex / rangeColumns).
  - Range columns produce zero-copy `Float64Array` views when buffer alignment permits.
  - Posting lists use delta + LEB128 varint encoding (raw bytes inside the binary container, base64 inside v3.1 JSON).
- `BinaryWriter` / `BinaryReader` utilities (`src/utils/binary.ts`) — cursor, alignment, varint, length-prefixed UTF-8.
- Negative-test coverage: wrong magic, truncated header, oversized `header_len`, unsupported `items.encoding`, unsupported `rangeColumns.dtype`.

### Changed

- `BUNDLE_VERSION` → `4.0.0`.
- `validateManifest` now accepts `version` starting with `"3."` or `"4."`. v3 JSON bundles continue to load against v4 code indefinitely.

### Compatibility

- v3.x JSON readers cannot consume v4 binary buffers — clean rejection via magic mismatch.
- v4 readers consume both v3 JSON and v4 binary.

[4.0.0]: https://github.com/vectoral-io/lyra/releases/tag/v4.0.0

## [3.1.0] - 2026-05-07

### Added

Optional, additive fields on `LyraBundleJSON` produced by `bundle.toJSON()`:

- `rangeColumns: Record<string, { encoding: 'b64f64'; data: string }>` — base64 of little-endian `Float64Array` bytes per range field. Loaders skip rebuilding range columns at first range query.
- `facetIndexBin: Record<string, Record<string, string>>` — delta + LEB128 varint base64 posting lists.
- `nullIndexBin: Record<string, string>` — delta + LEB128 varint base64 null posting lists.

When present, `LyraBundle.load` prefers these over the legacy `facetIndex` / `nullIndex` `number[]` form. v3.0 readers ignore the new fields and continue using the legacy form.

### Changed

- `BUNDLE_VERSION` → `3.1.0`.
- `LyraBundle.load` replaces `Uint32Array.from(numberArray)` calls with a pre-allocated loop. Single allocation, no iterator protocol.
- `LyraBundle.toJSON` emits both legacy and v3.1 binary fields by default.

### Performance

Cold-start (load + first range query) on a 100k-item fixture:

| Path | Before | After |
|---|---|---|
| v3.0 legacy (rebuild range columns at first query) | 13.3 ms | — |
| v3.1 (range columns hydrated from base64) | — | **2.0 ms** |

Wire size grows ~33% per posting list when both forms are emitted (legacy + binary side-by-side). Producers can drop the legacy fields once all consumers are on v3.1+.

### Documentation

- `docs/bundle-json-spec.md` aligned with the actual v3 format (was stuck on a stale v1 description).

[3.1.0]: https://github.com/vectoral-io/lyra/releases/tag/v3.1.0

## [1.0.0] - 2025-01-XX

### Added

- **Core bundle functionality**
  - Precomputed faceted index bundles from structured data
  - Manifest-driven bundle format with field definitions and capabilities
  - Deterministic query execution over bundles
  - Support for both explicit and simple configuration modes

- **Faceted filtering**
  - Fast equality filters on facet fields
  - Support for single values and arrays of values
  - Posting list indexes for efficient intersection operations

- **Range queries**
  - Numeric range filtering (`min`/`max`)
  - Date range filtering with Unix timestamp support
  - Runtime type checking and validation

- **Schema helpers**
  - `buildQuerySchema()` - Generate JSON schema from bundle manifest
  - Type-safe query schema generation driven by manifest capabilities

- **OpenAI tool adapter**
  - `buildOpenAiTool()` - Generate OpenAI function tool definitions
  - Automatic schema derivation from bundle manifest
  - Agent-friendly tool integration patterns

- **Dashboard helpers**
  - `getFacetSummary()` - Get distinct values and counts for facet fields
  - `includeFacetCounts` query option for drilldown UIs
  - Support for filtered facet summaries

- **Bundle format specification**
  - Normative JSON format specification documented in `docs/bundle-json-spec.md`
  - Version 1.x bundle format with stable manifest structure
  - Deterministic serialization and deserialization

- **Performance baseline**
  - Optimized for sub-millisecond facet queries
  - Efficient index structures for medium-sized datasets
  - Practical performance profile for single-machine/edge runtimes

### Documentation

- Comprehensive README with usage examples
- Bundle format specification documentation
- Versioning guide explaining npm package vs bundle format versions
- Example projects demonstrating basic usage and agent integration

[1.0.0]: https://github.com/vectoral-io/lyra/releases/tag/v1.0.0

```mermaid
flowchart TB

%% =====================
%% SOURCES (immutable)
%% =====================
subgraph GCS0["GCS: Source Parquet (immutable)"]
  P_MODEL["model_elements.parquet"]
  P_PROGRESS["progress_events.parquet"]
  P_SCHED["schedule_activities.parquet"]
  P_MAP_BASE["mapping_base.parquet"]
end

subgraph DB0["Postgres/Supabase: Dataset Registry + Version Graph"]
  DS[("parquet_datasets\n- dataset_id\n- kind\n- gcs_uri+generation\n- workflow provenance")]
  MV[("model_versions\n-> elements_dataset_id")]
  PV[("progress_versions\n-> progress_dataset_id\n(as_of_time watermark)")]
  SV[("schedule_versions\n-> activities_dataset_id")]
  MAPV[("mapping_versions\n-> mapping_dataset_id\n(model_version_id + schedule_version_id)")]
end

P_MODEL --> DS
P_PROGRESS --> DS
P_SCHED --> DS
P_MAP_BASE --> DS

DS --> MV
DS --> PV
DS --> SV
DS --> MAPV

%% =====================
%% EDITING (draft patches)
%% =====================
subgraph EDIT["In-app Mapping Edits (Draft)"]
  AE_PATCH[("activity_element_patches\nappend-only\n- draft_id\n- seq\n- location_id\n- ops: RFC6902\n- baseline: (model_version_id,schedule_version_id,mapping_version_id)")]
  SSE["SSE/Realtime stream\n(patches by location_id)"]
end

AE_PATCH <--> SSE

%% =====================
%% ARTIFACT SETS (published)
%% =====================
subgraph GCS1["GCS/CDN: Artifact Sets (immutable, versioned)"]
  A_ROOT["root manifest\nroot.json.gz"]
  A_ROLLUPS["Manifest Bundle (Lyra rollup rows)\nitems include row_index"]
  A_DIMS["Rollup Dims\ndates_ms[], dictionaries"]
  A_MEAS["LYRM measures.bin(.gz)\nqty/effort actual+planned\nflat arrays"]
  A_LOC_ELEM["Location bundles\nLyra Element Metadata\nlocations/{id}.json.gz"]
  A_ACT["Activities Bundle\nLyra Activities"]
  A_AE_MAP["Activity↔Element Map\npartitioned by location_id"]
end

subgraph WF["Workflows / Generators"]
  GEN_MAP["Mapping reconcile (LLM)\n(optional)\nproduces mapping parquet"]
  COMPACT["Publish Draft (compaction)\n- load BASE mapping bundle(s)\n- apply patches by seq\n- write new mapping version\n- trigger artifact generation"]
  GEN_ART["Artifact Set Generation\n(materialize)\n- build rollup rows + row_index\n- build measures arrays\n- emit artifacts to GCS"]
end

%% Optional LLM reconcile path
SV --> GEN_MAP
MV --> GEN_MAP
MAPV --> GEN_MAP
GEN_MAP --> P_MAP_BASE

%% Draft publish path
AE_PATCH --> COMPACT
COMPACT --> MAPV

%% Artifact generation inputs
MV --> GEN_ART
PV --> GEN_ART
SV --> GEN_ART
MAPV --> GEN_ART

%% Artifact generation outputs
GEN_ART --> A_ROOT
GEN_ART --> A_ROLLUPS
GEN_ART --> A_DIMS
GEN_ART --> A_MEAS
GEN_ART --> A_LOC_ELEM
GEN_ART --> A_ACT
GEN_ART --> A_AE_MAP

%% =====================
%% PUBLISHING (channels)
%% =====================
subgraph PUB["Publishing: Release Channels (Option B)"]
  REL[("publication_releases\nappend-only\n- project_id\n- channel\n- artifact_set_id\n- root_manifest_uri")]
  CUR["Current release resolver\n(latest per project+channel)"]
end

GEN_ART --> REL
REL --> CUR

%% =====================
%% CLIENT RUNTIME
%% =====================
subgraph CLIENT["Client Runtime"]
  UI["UI / Dashboard"]
  LOAD0["Resolve current release\n(project, channel)"]
  LOAD1["Fetch root manifest"]
  LOAD2["Fetch Manifest Bundle (Lyra rollup rows)"]
  LOAD3["Fetch rollup dims + measures (LYRM)"]
  Q1["Lyra query rollup rows (filters)\n-> row_index[]"]
  AGG["Aggregate planned vs actual\nrow_index × date_index lookup\n(sum across indices)"]
  DRILL["Drilldown\nload location element bundles\n+ activity-element maps\n+ activities"]
  EDITUI["Mapping edit UI\ncreates RFC6902 patches\n(per location_id)"]
end

UI --> LOAD0 --> CUR
CUR --> LOAD1 --> A_ROOT
LOAD1 --> LOAD2 --> A_ROLLUPS
LOAD1 --> LOAD3 --> A_DIMS
LOAD3 --> A_MEAS

LOAD2 --> Q1 --> AGG --> UI

UI --> DRILL
DRILL --> A_LOC_ELEM
DRILL --> A_ACT
DRILL --> A_AE_MAP

UI --> EDITUI --> AE_PATCH
SSE --> EDITUI
```