[@vectoral/lyra](../README.md) / LyraBundleJSON

# Type Alias: LyraBundleJSON\<T\>

```ts
type LyraBundleJSON<T> = {
  facetIndex: FacetPostingLists;
  facetIndexBin?: FacetPostingListsBin;
  items: T[];
  manifest: LyraManifest;
  nullIndex: NullPostingLists;
  nullIndexBin?: NullPostingListsBin;
  rangeColumns?: RangeColumnsJSON;
};
```

Defined in: [types.ts:422](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L422)

Serialized bundle format (v3).

v3.1 introduces optional `rangeColumns`, `facetIndexBin`, and `nullIndexBin`
fields that accelerate hydration. v3.0 readers ignore unknown fields and
continue to use the legacy `facetIndex` / `nullIndex`.

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `T` | `unknown` |

## Properties

### facetIndex

```ts
facetIndex: FacetPostingLists;
```

Defined in: [types.ts:425](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L425)

***

### facetIndexBin?

```ts
optional facetIndexBin?: FacetPostingListsBin;
```

Defined in: [types.ts:437](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L437)

v3.1 (optional): delta+varint base64 facet posting lists. Smaller wire size
and faster hydrate than `facetIndex`. When present, takes precedence.

***

### items

```ts
items: T[];
```

Defined in: [types.ts:424](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L424)

***

### manifest

```ts
manifest: LyraManifest;
```

Defined in: [types.ts:423](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L423)

***

### nullIndex

```ts
nullIndex: NullPostingLists;
```

Defined in: [types.ts:427](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L427)

Null posting lists, keyed by field name.

***

### nullIndexBin?

```ts
optional nullIndexBin?: NullPostingListsBin;
```

Defined in: [types.ts:442](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L442)

v3.1 (optional): delta+varint base64 null posting lists. When present,
takes precedence over `nullIndex`.

***

### rangeColumns?

```ts
optional rangeColumns?: RangeColumnsJSON;
```

Defined in: [types.ts:432](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L432)

v3.1 (optional): pre-encoded range columns. Avoids a per-load rescan of
items + Date.parse storm.
