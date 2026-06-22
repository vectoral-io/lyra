[@vectoral/lyra](../README.md) / buildQuerySchema

# Function: buildQuerySchema()

```ts
function buildQuerySchema(manifest): JsonSchema;
```

Defined in: [schema.ts:25](https://github.com/vectoral-io/lyra/blob/main/src/schema.ts#L25)

Build a JSON schema describing a `LyraQuery` for a given manifest.

Driven entirely by `manifest.capabilities` — only declared facets, ranges, and
aliases appear, so the schema can't describe a field the bundle won't filter.
Mirrors the query operators: `equal`, `notEqual`, `ranges`, `isNull`, `isNotNull`,
`limit`, `offset`, `includeFacetCounts`, and `enrichAliases` (when aliases exist).

## Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `manifest` | [`LyraManifest`](../interfaces/LyraManifest.md) | The bundle manifest describing fields and capabilities |

## Returns

[`JsonSchema`](../type-aliases/JsonSchema.md)

A JSON schema object describing the query structure
