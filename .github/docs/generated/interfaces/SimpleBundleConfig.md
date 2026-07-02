[@vectoral/lyra](../README.md) / SimpleBundleConfig

# Interface: SimpleBundleConfig\<TItem\>

Defined in: [types.ts:303](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L303)

Simple, ergonomic bundle configuration that infers types automatically.

This config style allows you to specify fields by purpose (id, facets, ranges, meta)
rather than requiring full field definitions. Types are inferred from the data at runtime.

## Example

```ts
const bundle = await createBundle(tickets, {
  datasetId: 'tickets-2025-11-22',
  id: 'id', // optional; will auto-detect 'id'/'Id'/'ID' if omitted
  facets: ['customer', 'priority', 'status'],
  ranges: ['createdAt'],
  autoMeta: true, // default: auto-add remaining simple fields as meta
});
```

## Type Parameters

| Type Parameter |
| ------ |
| `TItem` *extends* `Record`\<`string`, `unknown`\> |

## Properties

### aliases?

```ts
optional aliases?: Record<string, Extract<keyof TItem, string>>;
```

Defined in: [types.ts:333](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L333)

Alias fields: aliasField → canonicalField.
Lookups are auto-generated from item data during bundle creation.
Multiple aliases can target the same canonical field.

***

### autoMeta?

```ts
optional autoMeta?: boolean;
```

Defined in: [types.ts:346](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L346)

Whether to automatically add remaining simple fields as meta.
Defaults to `true`. When enabled, any primitive fields not explicitly
configured as id/facet/range/meta will be added to the manifest as meta fields.
Complex/nested fields are always skipped.

***

### datasetId

```ts
datasetId: string;
```

Defined in: [types.ts:304](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L304)

***

### equal?

```ts
optional equal?: Extract<keyof TItem, string>[];
```

Defined in: [types.ts:318](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L318)

Fields to index as facets (for equality filtering).

***

### ~~facets?~~

```ts
optional facets?: Extract<keyof TItem, string>[];
```

Defined in: [types.ts:314](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L314)

Fields to index as facets (for equality filtering).

#### Deprecated

Use `equal` instead.

***

### id?

```ts
optional id?: Extract<keyof TItem, string>;
```

Defined in: [types.ts:309](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L309)

Explicit ID field name. If omitted, will auto-detect from common patterns:
'id', 'Id', or 'ID'.

***

### inferTypes?

```ts
optional inferTypes?: "none" | "runtime";
```

Defined in: [types.ts:339](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L339)

How aggressively to infer field types.
- 'runtime': Inspect actual values in the data (default)
- 'none': Default all fields to 'string' type

***

### meta?

```ts
optional meta?: Extract<keyof TItem, string>[];
```

Defined in: [types.ts:327](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L327)

Fields to include in manifest as meta (non-indexed, schema-visible).

***

### ranges?

```ts
optional ranges?: Extract<keyof TItem, string>[];
```

Defined in: [types.ts:323](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L323)

Fields to index as ranges (for numeric/date range filtering).
Must be numeric or date values.
