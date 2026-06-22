[@vectoral/lyra](../README.md) / LyraResult

# Interface: LyraResult\<Item\>

Defined in: [types.ts:218](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L218)

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

Defined in: [types.ts:221](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L221)

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

Defined in: [types.ts:228](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L228)

***

### items

```ts
items: Item[];
```

Defined in: [types.ts:219](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L219)

***

### snapshot

```ts
snapshot: LyraSnapshotInfo;
```

Defined in: [types.ts:229](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L229)

***

### total

```ts
total: number;
```

Defined in: [types.ts:220](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L220)
