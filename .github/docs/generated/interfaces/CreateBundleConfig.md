[@vectoral/lyra](../README.md) / CreateBundleConfig

# Interface: CreateBundleConfig\<TItem\>

Defined in: [types.ts:262](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L262)

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

Defined in: [types.ts:263](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L263)

***

### fields

```ts
fields: { [K in string]?: FieldDefinition };
```

Defined in: [types.ts:270](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L270)

Fields to be indexed or tracked in the manifest.

Keys must be string keys of TItem; the config is optional-per-field.
At runtime, fields that do not exist in any item will only emit a warning.
