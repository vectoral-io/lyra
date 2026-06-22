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

Defined in: [types.ts:416](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L416)

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

Defined in: [types.ts:419](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L419)

***

### facetIndexBin?

```ts
optional facetIndexBin?: FacetPostingListsBin;
```

Defined in: [types.ts:431](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L431)

v3.1 (optional): delta+varint base64 facet posting lists. Smaller wire size
and faster hydrate than `facetIndex`. When present, takes precedence.

***

### items

```ts
items: T[];
```

Defined in: [types.ts:418](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L418)

***

### manifest

```ts
manifest: LyraManifest;
```

Defined in: [types.ts:417](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L417)

***

### nullIndex

```ts
nullIndex: NullPostingLists;
```

Defined in: [types.ts:421](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L421)

Null posting lists, keyed by field name.

***

### nullIndexBin?

```ts
optional nullIndexBin?: NullPostingListsBin;
```

Defined in: [types.ts:436](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L436)

v3.1 (optional): delta+varint base64 null posting lists. When present,
takes precedence over `nullIndex`.

***

### rangeColumns?

```ts
optional rangeColumns?: RangeColumnsJSON;
```

Defined in: [types.ts:426](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L426)

v3.1 (optional): pre-encoded range columns. Avoids a per-load rescan of
items + Date.parse storm.
