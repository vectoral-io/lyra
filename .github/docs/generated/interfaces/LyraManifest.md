[@vectoral/lyra](../README.md) / LyraManifest

# Interface: LyraManifest

Defined in: [types.ts:200](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L200)

Manifest describing an entire bundle and its capabilities.

## Properties

### builtAt

```ts
builtAt: string;
```

Defined in: [types.ts:203](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L203)

***

### capabilities

```ts
capabilities: {
  aliases?: string[];
  facets: string[];
  ranges: string[];
};
```

Defined in: [types.ts:205](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L205)

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

Defined in: [types.ts:202](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L202)

***

### fields

```ts
fields: LyraField[];
```

Defined in: [types.ts:204](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L204)

***

### lookups?

```ts
optional lookups?: Record<string, LookupTable>;
```

Defined in: [types.ts:218](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L218)

**`Internal`**

Lookup tables for alias resolution, keyed by alias field name.
Auto-generated during bundle creation. Not configurable by users.

***

### version

```ts
version: string;
```

Defined in: [types.ts:201](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L201)
