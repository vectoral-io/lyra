# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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