# Migration Guide: Lyra v3 → v4

Lyra v4 introduces a **binary container format** alongside the existing JSON format. The JSON format stays supported indefinitely as a portable, debuggable wire form. The binary format is for production hot paths where wire size and cold-start time matter.

This work shipped in three steps you can roll out independently:

| Version | Format | What's new |
|---|---|---|
| **3.1.0** | JSON (additive) | Optional `rangeColumns`, `facetIndexBin`, `nullIndexBin` fields. v3.0 readers ignore unknown fields. |
| **4.0.0** | Binary container (`LYRA4` magic) | New `serialize('binary')` / `loadBinary()`. Bumps `BUNDLE_VERSION` to `4.x`. v3 JSON loaders error on v4 bytes via magic mismatch. |
| **4.1.0** | Binary container, columnar items | Default. Items inside the binary container are dictionary-encoded strings + raw f64 + packed bools + per-row JSON fallback for arrays/objects. |

`validateManifest` accepts `version` starting with either `"3."` or `"4."`, so v3 JSON bundles continue to load against v4 code.

## TL;DR

```ts
// Producer:
const bundle = await createBundle(items, config);
const bytes = bundle.serialize('binary');     // Uint8Array
// gzip if you like — Content-Encoding gzip works as usual.

// Consumer:
const bundle = LyraBundle.loadBinary<Row>(bytes);
// or LyraBundle.load(bytes) — autodetects on the LYRA4 magic.

bundle.query({ equal: { status: 'open' } });
```

Query results are byte-for-byte identical across formats.

## Why move to binary

`LyraBundle.toJSON()` serializes items as plain row JSON. On the consumer side that means `JSON.parse` over the entire payload — buffered, synchronous, and on the main thread. At 300k items in production-shape data we measured `JSON.parse` alone at **~887 ms**. The follow-up `LyraBundle.load(parsed)` is cheap (~2 ms) because it just walks the already-parsed JS object.

The binary container avoids `JSON.parse` entirely. After `fetch().arrayBuffer()`, `loadBinary(bytes)` decodes header JSON (small), reconstructs `Uint32Array` posting lists from delta+varint blobs, and produces zero-copy `Float64Array` views over range columns when alignment permits. Items are kept columnar — strings dictionary-encoded, numbers/dates as raw `f64` bytes, booleans packed — and only materialized on demand at the result boundary.

**Measured on a 300k-item real-world fixture (deeply-nested record shape — strings, numbers, arrays, and a per-row `Record<string, …>` step map):**

| Path | Wire (gzipped) | Critical path (post-network main thread) |
|---|---|---|
| v3.1 JSON | 49.3 MB | **~887 ms** (`JSON.parse`) + 2 ms (`load`) |
| v4.1 binary | 43.6 MB | **~18 ms** (`loadBinary`) |
| Speedup / Δ | 12% smaller | **~49× faster** |

The wire-size win is modest (~12% gzipped) for shapes dominated by deeply-nested JSON-fallback fields like `Record<string, Object>`. Cardinality-friendly shapes — flat rows, low-distinct strings, lots of numbers/dates — see larger wire-size wins (we observed >2× on the synthetic ticket fixture).

## Step-by-step migration

### Stage 1 — adopt v3.1 JSON additions (optional, additive)

Bump to Lyra `3.1.0`. `bundle.toJSON()` now also emits:

- `rangeColumns: Record<string, { encoding: 'b64f64'; data: string }>` — base64 of little-endian Float64 bytes per range field. Loaders skip rebuilding range columns at first range query.
- `facetIndexBin` / `nullIndexBin: Record<string, ... string>` — delta+varint base64 posting lists. Loaders skip the `Uint32Array.from(number[])` iterator path.

These fields are optional and additive. v3.0 readers ignore them. v3.1 readers prefer them when present, fall back to the legacy `facetIndex` / `nullIndex` otherwise.

You don't need to do anything to consume the new fields — `LyraBundle.load(json)` picks the fastest path automatically.

### Stage 2 — switch hot paths to v4 binary

Bump to Lyra `4.0.0` (or higher). Producer:

```ts
const bundle = await createBundle(items, config);
- const json = JSON.stringify(bundle.toJSON());
- await writeFile('bundle.json.gz', gzipSync(json));
+ const bytes = bundle.serialize('binary');
+ await writeFile('bundle.bin.gz', gzipSync(bytes));
```

Consumer:

```ts
- const json = JSON.parse(await readFile('bundle.json'));
- const bundle = LyraBundle.load<Row>(json);
+ const bytes = await readFile('bundle.bin');     // already gunzipped by HTTP layer
+ const bundle = LyraBundle.loadBinary<Row>(bytes);
```

Or, if you can't tell ahead of time which form you'll receive, pass either through `LyraBundle.load(...)` — it autodetects v4 binary via the leading `LYRA4` magic bytes and dispatches to `loadBinary`.

### Stage 3 — adopt v4.1 columnar items (default)

No code change. Bump to `4.1.0`; new bundles emit columnar items by default. Existing v4.0 readers cannot consume v4.1 columnar items, but if you control both sides this is moot. v4.1 readers consume v4.0 row-form items and v3.x JSON without issue.

If you specifically need to emit v4 with row-form JSON items (e.g., for an older v4.0 reader you can't upgrade), call the lower-level encoder:

```ts
import { encodeV4 } from '@vectoral/lyra/utils/binary-bundle';
encodeV4({ ... }, { itemsFormat: 'json' });
```

## Server / client wiring (HTTP APIs)

For services that hand bundles to a client over HTTP:

**Server**

```ts
- const json = bundle.toJSON();
- return streaming.json(json);                              // application/json
+ const bytes = bundle.serialize('binary');
+ event.node.res.setHeader('Content-Type', 'application/octet-stream');
+ return bytes;                                             // gzip via HTTP layer
```

If you cache to GCS / S3, swap `.json.gz` for `.bin.gz` and bump your cache key / API version so old artifacts re-generate.

**Client (browser, Nuxt `$fetch`, anywhere with `Response`)**

```ts
- const data = await $fetch<LyraBundleJSON>(url);          // does JSON.parse internally
- const bundle = LyraBundle.load(data);
+ const res = await fetch(url);
+ const bytes = new Uint8Array(await res.arrayBuffer());
+ const bundle = LyraBundle.loadBinary(bytes);
```

The browser's network stack still decompresses gzip transparently. The work you save is `Response.json()`'s synchronous `JSON.parse`, which is the dominant cost on the post-network critical path.

## Format / API additions

### `LyraBundle.serialize(format?)`

```ts
bundle.serialize();              // LyraBundleJSON<T>  (alias of toJSON())
bundle.serialize('json');        // LyraBundleJSON<T>
bundle.serialize('binary');      // Uint8Array
```

### `LyraBundle.loadBinary(bytes)` and `LyraBundle.load(bytes | json)`

```ts
LyraBundle.loadBinary<Row>(bytes);   // expects v4 magic
LyraBundle.load<Row>(json);          // v3.x JSON
LyraBundle.load<Row>(bytes);         // autodetect on Uint8Array + LYRA4 magic
```

### `BUNDLE_VERSION = '4.1.0'`

Manifests on freshly created bundles carry `version: "4.1.0"`. `validateManifest` accepts `"3."` or `"4."` prefixes for back-compat reads.

### Optional v3.1 JSON fields (still emitted by v4 `toJSON()`)

```ts
type LyraBundleJSON<T> = {
  manifest: LyraManifest;
  items: T[];
  facetIndex: FacetPostingLists;       // legacy number[] form
  nullIndex: NullPostingLists;
  rangeColumns?: RangeColumnsJSON;     // v3.1, optional
  facetIndexBin?: FacetPostingListsBin; // v3.1, optional
  nullIndexBin?: NullPostingListsBin;  // v3.1, optional
};
```

## Compatibility matrix

| Reader \ Producer | v3.0 JSON | v3.1 JSON | v4.0 binary | v4.1 binary |
|---|---|---|---|---|
| **v3.0 reader** | ✅ | ✅ (ignores new fields) | ❌ (magic mismatch) | ❌ |
| **v3.1 reader** | ✅ | ✅ (uses fast paths) | ❌ (magic mismatch) | ❌ |
| **v4.0 reader** | ✅ | ✅ | ✅ | ❌ (unknown items.encoding) |
| **v4.1 reader** | ✅ | ✅ | ✅ | ✅ |

Bottom line: v4.1 readers consume everything; v3.x readers cannot consume binary.

## What's *not* changing in v4

- Query DSL — unchanged (`equal`, `notEqual`, `ranges`, `isNull`, `isNotNull`, `limit`, `offset`, `includeFacetCounts`, `enrichAliases`).
- `createBundle` signatures — unchanged.
- `buildQuerySchema` / `buildOpenAiTool` — unchanged.
- `getFacetSummary`, `describe`, `snapshot`, `toJSON`, `query`, `enrichItems`, `getAliasValues` — all unchanged.
- Items returned from `query()` — same shape; with v4.1 columnar bundles they are reconstructed objects (no identity preservation), but field-equal to the originals. No existing test in the wild relies on identity, but if you do, materialize at create-time.
- The v3.x JSON path stays supported indefinitely as the debug / interop format.

## Where to look in the code

- `src/utils/binary-bundle.ts` — encode/decode for the v4 container, header schema, columnar items.
- `src/utils/item-store.ts` — `RowItemStore` / `ColumnarItemStore` and the column encoding heuristic.
- `src/utils/codec.ts` — base64 + delta+varint codecs used by both v3.1 JSON and v4 binary.
- `docs/bundle-json-spec.md` — full on-the-wire format spec for both JSON and binary.
- `tests/bench/realworld-bench.ts` — runnable benchmark against an anonymized real-world fixture (`bun run tests/bench/realworld-bench.ts`).
