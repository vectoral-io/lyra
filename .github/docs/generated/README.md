# @vectoral/lyra

## Classes

| Class | Description |
| ------ | ------ |
| [LyraBundle](classes/LyraBundle.md) | Immutable bundle of items plus a manifest that describes fields and capabilities. |

## Interfaces

| Interface | Description |
| ------ | ------ |
| [CreateBundleConfig](interfaces/CreateBundleConfig.md) | Bundle configuration for a given item type. |
| [LyraManifest](interfaces/LyraManifest.md) | Manifest describing an entire bundle and its capabilities. |
| [LyraQuery](interfaces/LyraQuery.md) | Query parameters for executing filters against a Lyra bundle. |
| [LyraResult](interfaces/LyraResult.md) | Structured result of executing a query against a bundle. |
| [LyraSnapshotInfo](interfaces/LyraSnapshotInfo.md) | Immutable snapshot metadata for a bundle at query time. |
| [OpenAiToolOptions](interfaces/OpenAiToolOptions.md) | - |
| [SimpleBundleConfig](interfaces/SimpleBundleConfig.md) | Simple, ergonomic bundle configuration that infers types automatically. |

## Type Aliases

| Type Alias | Description |
| ------ | ------ |
| [AnyBundleConfig](type-aliases/AnyBundleConfig.md) | Union type representing either explicit or simple bundle configuration. Used internally by `createBundle` to support both configuration styles. |
| [FieldDefinition](type-aliases/FieldDefinition.md) | Definition of a single field when creating a bundle. |
| [FieldKind](type-aliases/FieldKind.md) | - |
| [FieldType](type-aliases/FieldType.md) | - |
| [JsonSchema](type-aliases/JsonSchema.md) | JSON Schema type (minimal representation). |
| [LyraBundleJSON](type-aliases/LyraBundleJSON.md) | Serialized bundle format (v3). |

## Functions

| Function | Description |
| ------ | ------ |
| [buildOpenAiTool](functions/buildOpenAiTool.md) | Build an OpenAI tool definition from a Lyra manifest (v2). |
| [buildQuerySchema](functions/buildQuerySchema.md) | Build a JSON schema describing a `LyraQuery` for a given manifest. |
| [createBundle](functions/createBundle.md) | Create a bundle from items. |
