# Agent integration

Lyra bundles make good LLM tools: the manifest already describes exactly what's queryable, so the tool schema is generated, not hand-written. It can't drift from what the bundle supports.

```ts
import { LyraBundle, buildOpenAiTool, type LyraQuery, type LyraResult } from '@vectoral/lyra';

const tickets = LyraBundle.load<Ticket>(storedBundle);

// The tool the model calls: forward args to query().
async function queryTickets(args: LyraQuery): Promise<LyraResult<Ticket>> {
  return tickets.query(args);
}

// The schema the model sees, derived from the manifest.
const tool = buildOpenAiTool(tickets.describe(), {
  name: 'queryTickets',
  description: 'Query support tickets',
});

const response = await openai.chat.completions.create({ model: 'gpt-4', tools: [tool] });
```

## `buildOpenAiTool(manifest, { name, description? })`

Returns an OpenAI `{ type: 'function', function: { name, description, parameters } }` definition, with `parameters` built by `buildQuerySchema`. Omit `description` and Lyra writes one from the dataset ID (and notes any alias fields).

## `buildQuerySchema(manifest)`

The JSON Schema for a `LyraQuery`, if you want it directly (validation, a non-OpenAI framework, docs). Driven entirely by `manifest.capabilities`: only declared facets, ranges, and aliases appear, so the model can't invent a field that won't filter.

```ts
const schema = buildQuerySchema(bundle.describe());
```

The schema mirrors the [`LyraQuery`](./api.md#lyraquery) operators: `equal`, `notEqual`, `ranges`, `isNull`, `isNotNull`, `limit`, `offset`, `includeFacetCounts`, and `enrichAliases` when the bundle declares aliases. Facet fields accept a scalar or an array (IN), typed to the field. Range fields take `{ min, max }`. Roughly:

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "equal": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "status":   { "anyOf": [{ "type": "string" }, { "type": "null" },
                                { "type": "array", "items": { "anyOf": [{ "type": "string" }, { "type": "null" }] } }] },
        "priority": { "anyOf": [/* same shape */] }
      }
    },
    "ranges": {
      "type": "object",
      "properties": { "createdAt": { "type": "object",
        "properties": { "min": { "type": "number" }, "max": { "type": "number" } } } }
    },
    "isNull":    { "type": "array", "items": { "type": "string", "enum": ["status", "priority"] } },
    "isNotNull": { "type": "array", "items": { "type": "string", "enum": ["status", "priority"] } },
    "limit":  { "type": "number" },
    "offset": { "type": "number" },
    "includeFacetCounts": { "type": "boolean" }
  }
}
```

## Patterns

**Fail soft.** A bad query should hand the model an empty result, not an exception:

```ts
async function queryTickets(args: LyraQuery): Promise<LyraResult<Ticket>> {
  try {
    return bundle.query(args);
  } catch {
    return { items: [], total: 0, applied: {}, snapshot: bundle.snapshot() };
  }
}
```

(In practice `query` is already fail-closed: unknown fields return zero matches rather than throwing. See [errors & guarantees](./errors-and-guarantees.md).)

**Multiple datasets, multiple tools.** One `buildOpenAiTool` per bundle, distinct names; the model picks.

```ts
const tools = [
  buildOpenAiTool(ticketsBundle.describe(),  { name: 'queryTickets' }),
  buildOpenAiTool(projectsBundle.describe(), { name: 'queryProjects' }),
];
```

**Feed the result back to steer the model.** `result.total` tells it whether to broaden or narrow; `result.facets` (with `includeFacetCounts: true`) shows real filter options; `result.snapshot.builtAt` tells it how fresh the data is. A `total` of 0 usually means a typo or too-narrow filters, worth surfacing in the tool's reply.

## See also

- [API reference](./api.md)
- [Bundle spec](./bundle-json-spec.md)
- [Working example](../examples/agent-tool/)
