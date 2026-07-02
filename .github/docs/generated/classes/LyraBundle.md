[@vectoral/lyra](../README.md) / LyraBundle

# Class: LyraBundle\<T\>

Defined in: [bundle.ts:71](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L71)

Immutable bundle of items plus a manifest that describes fields and capabilities.

## Type Parameters

| Type Parameter |
| ------ |
| `T` *extends* `Record`\<`string`, `unknown`\> |

## Accessors

### isDisposed

#### Get Signature

```ts
get isDisposed(): boolean;
```

Defined in: [bundle.ts:436](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L436)

Whether this bundle has been disposed.

##### Returns

`boolean`

## Methods

### describe()

```ts
describe(): LyraManifest;
```

Defined in: [bundle.ts:418](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L418)

Return the bundle manifest describing fields and capabilities.

#### Returns

[`LyraManifest`](../interfaces/LyraManifest.md)

***

### dispose()

```ts
dispose(): void;
```

Defined in: [bundle.ts:450](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L450)

Release every heavy structure this bundle holds — item columns, facet and
null posting lists, range columns, and the query scratch buffers — so they
can be garbage-collected even if the bundle object itself is still
referenced (e.g. captured in a long-lived cache or component closure).

Idempotent. After disposal, metadata methods (`describe`, `snapshot`,
`isDisposed`) keep working, but any data operation (`query`,
`getFacetSummary`, `toJSON`, `serialize`) throws.

#### Returns

`void`

***

### enrichItems()

```ts
enrichItems(items, aliasFields): T & Record<string, string[]>[];
```

Defined in: [bundle.ts:408](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L408)

Enrich a list of items with alias fields by batch lookup.

Deduplicates canonical IDs so N items only trigger K lookups (K = unique IDs).
Returns new item objects; originals are not mutated.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `items` | `T`[] |
| `aliasFields` | `string`[] |

#### Returns

`T` & `Record`\<`string`, `string`[]\>[]

#### Example

```ts
const result = bundle.query({ equal: { zone_id: 'Z-001' } });
const enriched = bundle.enrichItems(result.items, ['zone_name', 'zone_label']);
// enriched[0].zone_name === ['Zone A']
```

***

### getAliasValues()

```ts
getAliasValues(aliasField, canonicalId): string[];
```

Defined in: [bundle.ts:391](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L391)

Look up alias values for a single canonical ID.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `aliasField` | `string` |
| `canonicalId` | `string` \| `number` |

#### Returns

`string`[]

#### Example

```ts
bundle.getAliasValues('zone_name', 'Z-001'); // ['Zone A']
```

***

### getFacetSummary()

```ts
getFacetSummary(field, options?): {
  field: string;
  values: {
     count: number;
     value: string | number | boolean;
  }[];
};
```

Defined in: [bundle.ts:343](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L343)

Get a summary of distinct values and counts for a facet field.

Returns distinct values and their counts, optionally filtered by other facets or ranges.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `field` | `string` |
| `options?` | \{ `equal?`: `Record`\<`string`, `Scalar` \| `Scalar`[]\>; `ranges?`: `Record`\<`string`, `RangeBound`\>; \} |
| `options.equal?` | `Record`\<`string`, `Scalar` \| `Scalar`[]\> |
| `options.ranges?` | `Record`\<`string`, `RangeBound`\> |

#### Returns

```ts
{
  field: string;
  values: {
     count: number;
     value: string | number | boolean;
  }[];
}
```

| Name | Type | Defined in |
| ------ | ------ | ------ |
| `field` | `string` | [bundle.ts:346](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L346) |
| `values` | \{ `count`: `number`; `value`: `string` \| `number` \| `boolean`; \}[] | [bundle.ts:346](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L346) |

***

### query()

```ts
query(query?): LyraResult<T>;
```

Defined in: [bundle.ts:198](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L198)

Execute a query against the bundle.

Query contract:
- Unknown fields: treated as "no matches" (returns total = 0).
- Negative offset: clamped to 0.
- Negative limit: treated as 0 (no results).
- All operators are intersected (AND logic).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `query` | [`LyraQuery`](../interfaces/LyraQuery.md) |

#### Returns

[`LyraResult`](../interfaces/LyraResult.md)\<`T`\>

***

### serialize()

#### Call Signature

```ts
serialize(): LyraBundleJSON<T>;
```

Defined in: [bundle.ts:487](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L487)

Serialize the bundle. By default produces a JSON-compatible value (same as
`toJSON()`); pass `'binary'` to produce a v4 binary container.

Binary bundles are typically 3–5× smaller on the wire and hydrate faster
(zero-copy range columns when alignment permits), at the cost of being
non-human-readable.

##### Returns

[`LyraBundleJSON`](../type-aliases/LyraBundleJSON.md)\<`T`\>

#### Call Signature

```ts
serialize(format): LyraBundleJSON<T>;
```

Defined in: [bundle.ts:488](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L488)

Serialize the bundle. By default produces a JSON-compatible value (same as
`toJSON()`); pass `'binary'` to produce a v4 binary container.

Binary bundles are typically 3–5× smaller on the wire and hydrate faster
(zero-copy range columns when alignment permits), at the cost of being
non-human-readable.

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `format` | `"json"` |

##### Returns

[`LyraBundleJSON`](../type-aliases/LyraBundleJSON.md)\<`T`\>

#### Call Signature

```ts
serialize(format): Uint8Array;
```

Defined in: [bundle.ts:489](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L489)

Serialize the bundle. By default produces a JSON-compatible value (same as
`toJSON()`); pass `'binary'` to produce a v4 binary container.

Binary bundles are typically 3–5× smaller on the wire and hydrate faster
(zero-copy range columns when alignment permits), at the cost of being
non-human-readable.

##### Parameters

| Parameter | Type |
| ------ | ------ |
| `format` | `"binary"` |

##### Returns

`Uint8Array`

***

### snapshot()

```ts
snapshot(): LyraSnapshotInfo;
```

Defined in: [bundle.ts:425](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L425)

Return the bundle snapshot metadata.

#### Returns

[`LyraSnapshotInfo`](../interfaces/LyraSnapshotInfo.md)

***

### toJSON()

```ts
toJSON(): LyraBundleJSON<T>;
```

Defined in: [bundle.ts:469](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L469)

Serialize the bundle to a plain JSON-compatible structure.

Emits the v3.0 legacy fields (`facetIndex`, `nullIndex` as `number[]`) for
back-compat, plus the v3.1 binary fields (`rangeColumns`, `facetIndexBin`,
`nullIndexBin`) which loaders prefer for faster, smaller hydration.

Format encode/decode lives in `utils/json-bundle.ts`; this just supplies the
in-memory structures (materializing range columns so they ride on the wire).

#### Returns

[`LyraBundleJSON`](../type-aliases/LyraBundleJSON.md)\<`T`\>

***

### create()

```ts
static create<TItem>(items, config): Promise<LyraBundle<TItem>>;
```

Defined in: [bundle.ts:144](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L144)

Build a new bundle from raw items and bundle configuration.

#### Type Parameters

| Type Parameter |
| ------ |
| `TItem` *extends* `Record`\<`string`, `unknown`\> |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `items` | `TItem`[] |
| `config` | [`CreateBundleConfig`](../interfaces/CreateBundleConfig.md)\<`TItem`\> |

#### Returns

`Promise`\<`LyraBundle`\<`TItem`\>\>

***

### load()

```ts
static load<TItem>(raw): LyraBundle<TItem>;
```

Defined in: [bundle.ts:515](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L515)

Load a bundle from a previously serialized JSON value or v4 binary buffer.

For JSON input: prefers v3.1 binary-encoded fields (`facetIndexBin`,
`nullIndexBin`, `rangeColumns`) when present; falls back to legacy
`facetIndex` / `nullIndex` and rebuilds range columns from items.

For `Uint8Array` input: autodetects v4 by magic bytes and dispatches to
`loadBinary`.

! NOTE: Any structural change here must be reflected in docs/bundle-json-spec.md

#### Type Parameters

| Type Parameter |
| ------ |
| `TItem` *extends* `Record`\<`string`, `unknown`\> |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `raw` | \| `Uint8Array`\<`ArrayBufferLike`\> \| [`LyraBundleJSON`](../type-aliases/LyraBundleJSON.md)\<`TItem`\> |

#### Returns

`LyraBundle`\<`TItem`\>

***

### loadBinary()

```ts
static loadBinary<TItem>(bytes): LyraBundle<TItem>;
```

Defined in: [bundle.ts:549](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L549)

Load a bundle from a v4 binary buffer. Autodetected by `load(...)` when
passed a `Uint8Array`; expose explicitly for callers that prefer the
direct path.

Validation (manifest consistency, facet allow-list, and posting bounds
against the item count) runs through the shared `validateDecodedBundle`, so
the JSON and binary paths reject hostile input by the same rules.

#### Type Parameters

| Type Parameter |
| ------ |
| `TItem` *extends* `Record`\<`string`, `unknown`\> |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `bytes` | `Uint8Array` |

#### Returns

`LyraBundle`\<`TItem`\>
