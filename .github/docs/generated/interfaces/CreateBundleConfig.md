[@vectoral/lyra](../README.md) / CreateBundleConfig

# Interface: CreateBundleConfig\<TItem\>

Defined in: [types.ts:268](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L268)

Bundle configuration for a given item type.

TItem is your row shape, e.g. Ticket, User, etc.

## Type Parameters

| Type Parameter |
| ------ |
| `TItem` *extends* `Record`\<`string`, `unknown`\> |

## Properties

### datasetId

```ts
datasetId: string;
```

Defined in: [types.ts:269](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L269)

***

### fields

```ts
fields: { [K in string]?: FieldDefinition };
```

Defined in: [types.ts:276](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L276)

Fields to be indexed or tracked in the manifest.

Keys must be string keys of TItem; the config is optional-per-field.
At runtime, fields that do not exist in any item will only emit a warning.
