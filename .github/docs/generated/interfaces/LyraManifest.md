[@vectoral/lyra](../README.md) / LyraManifest

# Interface: LyraManifest

Defined in: [types.ts:194](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L194)

Manifest describing an entire bundle and its capabilities.

## Properties

### builtAt

```ts
builtAt: string;
```

Defined in: [types.ts:197](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L197)

***

### capabilities

```ts
capabilities: {
  aliases?: string[];
  facets: string[];
  ranges: string[];
};
```

Defined in: [types.ts:199](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L199)

#### aliases?

```ts
optional aliases?: string[];
```

Alias field names (resolve to canonical facets via lookups)

#### facets

```ts
facets: string[];
```

Canonical facet field names (indexed for filtering)

#### ranges

```ts
ranges: string[];
```

Range field names (indexed for numeric/date filtering)

***

### datasetId

```ts
datasetId: string;
```

Defined in: [types.ts:196](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L196)

***

### fields

```ts
fields: LyraField[];
```

Defined in: [types.ts:198](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L198)

***

### lookups?

```ts
optional lookups?: Record<string, LookupTable>;
```

Defined in: [types.ts:212](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L212)

**`Internal`**

Lookup tables for alias resolution, keyed by alias field name.
Auto-generated during bundle creation. Not configurable by users.

***

### version

```ts
version: string;
```

Defined in: [types.ts:195](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L195)
