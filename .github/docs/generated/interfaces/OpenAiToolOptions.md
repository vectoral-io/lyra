[@vectoral/lyra](../README.md) / OpenAiToolOptions

# Interface: OpenAiToolOptions

Defined in: [openai.ts:8](https://github.com/vectoral-io/lyra/blob/main/src/openai.ts#L8)

## Properties

### description?

```ts
optional description?: string;
```

Defined in: [openai.ts:17](https://github.com/vectoral-io/lyra/blob/main/src/openai.ts#L17)

Optional description of what the tool does.
If omitted, a default description will be generated using the dataset ID.

***

### name

```ts
name: string;
```

Defined in: [openai.ts:12](https://github.com/vectoral-io/lyra/blob/main/src/openai.ts#L12)

The name of the tool function (required).
