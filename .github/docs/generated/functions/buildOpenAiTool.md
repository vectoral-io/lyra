[@vectoral/lyra](../README.md) / buildOpenAiTool

# Function: buildOpenAiTool()

```ts
function buildOpenAiTool(manifest, options): OpenAiTool;
```

Defined in: [openai.ts:41](https://github.com/vectoral-io/lyra/blob/main/src/openai.ts#L41)

Build an OpenAI tool definition from a Lyra manifest (v2).

The tool schema is automatically derived from the manifest, ensuring
it matches the v2 `LyraQuery` contract with explicit operators (equal, notEqual, ranges, isNull, isNotNull).
Alias fields are included in the schema, allowing queries using human-readable names.

## Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `manifest` | [`LyraManifest`](../interfaces/LyraManifest.md) | The bundle manifest describing fields and capabilities |
| `options` | [`OpenAiToolOptions`](../interfaces/OpenAiToolOptions.md) | Options for tool generation (name and optional description) |

## Returns

`OpenAiTool`

An OpenAI tool definition object
