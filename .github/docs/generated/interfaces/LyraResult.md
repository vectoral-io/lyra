[@vectoral/lyra](../README.md) / LyraResult

# Interface: LyraResult\<Item\>

Defined in: [types.ts:224](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L224)

Structured result of executing a query against a bundle.

## Type Parameters

| Type Parameter | Default type |
| ------ | ------ |
| `Item` | `unknown` |

## Properties

### applied

```ts
applied: {
  equal?: Record<string, Scalar | Scalar[]>;
  isNotNull?: string[];
  isNull?: string[];
  notEqual?: Record<string, Scalar | Scalar[]>;
  ranges?: Record<string, RangeBound>;
};
```

Defined in: [types.ts:227](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L227)

#### equal?

```ts
optional equal?: Record<string, Scalar | Scalar[]>;
```

#### isNotNull?

```ts
optional isNotNull?: string[];
```

#### isNull?

```ts
optional isNull?: string[];
```

#### notEqual?

```ts
optional notEqual?: Record<string, Scalar | Scalar[]>;
```

#### ranges?

```ts
optional ranges?: Record<string, RangeBound>;
```

***

### facets?

```ts
optional facets?: FacetCounts;
```

Defined in: [types.ts:234](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L234)

***

### items

```ts
items: Item[];
```

Defined in: [types.ts:225](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L225)

***

### snapshot

```ts
snapshot: LyraSnapshotInfo;
```

Defined in: [types.ts:235](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L235)

***

### total

```ts
total: number;
```

Defined in: [types.ts:226](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L226)
