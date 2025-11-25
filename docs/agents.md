# LLM Agent Integration

Complete guide for integrating Lyra bundles with LLM agents, including schema helpers and tool generation.

## Overview

Lyra bundles are designed to be wrapped as tools for LLM agents. The bundle manifest fully describes the query capabilities, making it easy to generate tool schemas that match exactly what Lyra supports.

## Quick Example

```ts
import {
  LyraBundle,
  buildOpenAiTool,
  type LyraQuery,
  type LyraResult,
} from '@vectoral/lyra';

// Load bundle at startup
const ticketsBundle = LyraBundle.load<Ticket>(storedBundle);

// Tool function that the agent will call
async function lyraTicketsTool(args: LyraQuery): Promise<LyraResult<Ticket>> {
  return ticketsBundle.query(args);
}

// Generate tool schema for OpenAI (or other frameworks)
const tool = buildOpenAiTool(ticketsBundle.describe(), {
  name: 'queryTickets',
  description: 'Query support tickets using facet and range filters',
});

// Pass to your agent framework
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  tools: [tool],
  // ...
});
```

## Schema Helpers

### `buildQuerySchema(manifest, options?)`

Builds a JSON schema that describes the structure of a `LyraQuery` for a given manifest. The generated schema matches the `LyraQuery` contract exactly, ensuring type compatibility.

The schema is driven by `manifest.capabilities.facets` and `manifest.capabilities.ranges` as the source of truth for queryable fields. Only fields listed in these capability arrays will appear in the generated schema, ensuring fidelity with what Lyra actually supports for queries.

**Signature:**

```ts
declare function buildQuerySchema(
  manifest: LyraManifest,
  options?: QuerySchemaOptions
): JsonSchema;
```

**Parameters:**

- `manifest`: The bundle manifest describing fields and capabilities
- `options`: Optional configuration for schema generation

**Returns:**

A JSON schema object describing the query structure.

**Example:**

```ts
const manifest = bundle.describe();
const schema = buildQuerySchema(manifest);

// Use schema for validation, documentation, or tool generation
```

**Generated Schema Structure:**

The generated schema includes:

- `facets`: Object with facet field names as keys (from `capabilities.facets`, with type-specific schemas)
- `ranges`: Object with range field names as keys (from `capabilities.ranges`, with min/max number properties)
- `limit`, `offset`: Optional number fields
- `includeFacetCounts`: Optional boolean field

**Example Generated Schema:**

```json
{
  "type": "object",
  "properties": {
    "facets": {
      "type": "object",
      "description": "Facet filters (equality matching)",
      "properties": {
        "status": {
          "anyOf": [
            { "type": "string" },
            { "type": "array", "items": { "type": "string" } }
          ]
        },
        "priority": {
          "anyOf": [
            { "type": "string" },
            { "type": "array", "items": { "type": "string" } }
          ]
        }
      },
      "additionalProperties": false
    },
    "ranges": {
      "type": "object",
      "description": "Range filters (min/max bounds per field)",
      "properties": {
        "createdAt": {
          "type": "object",
          "description": "min/max as Unix ms",
          "properties": {
            "min": {
              "type": "number",
              "description": "Minimum value (inclusive)"
            },
            "max": {
              "type": "number",
              "description": "Maximum value (inclusive)"
            }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of results to return"
    },
    "offset": {
      "type": "number",
      "description": "Number of results to skip (for pagination)"
    },
    "includeFacetCounts": {
      "type": "boolean",
      "description": "Include facet counts in the response"
    }
  },
  "additionalProperties": false
}
```

### `QuerySchemaOptions`

Options for building query schemas.

```ts
interface QuerySchemaOptions {
  /**
   * How to represent facet values in the schema.
   * - 'single': Facet values must be a single primitive
   * - 'single-or-array': Facet values can be either a single primitive or an array (default)
   */
  facetArrayMode?: 'single' | 'single-or-array';
}
```

**facetArrayMode Behavior:**

When `facetArrayMode` is `'single-or-array'` (default), facet fields use `anyOf` to allow both single values and arrays:

```json
{
  "anyOf": [
    { "type": "string" },
    { "type": "array", "items": { "type": "string" } }
  ]
}
```

When `facetArrayMode` is `'single'`, facet fields are restricted to single primitives:

```json
{
  "type": "string"
}
```

Use `'single'` mode if your agent framework doesn't handle `anyOf` well, or if you want to enforce single-value queries only.

## OpenAI Tool Adapter

### `buildOpenAiTool(manifest, options)`

Builds an OpenAI tool definition from a Lyra manifest. The tool schema is automatically derived from the manifest, ensuring it matches the `LyraQuery` contract exactly.

**Signature:**

```ts
declare function buildOpenAiTool(
  manifest: LyraManifest,
  options: OpenAiToolOptions
): {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};
```

**Parameters:**

- `manifest`: The bundle manifest describing fields and capabilities
- `options`: Options for tool generation

**Returns:**

An OpenAI tool definition object ready to pass to the OpenAI API.

**Example:**

```ts
const manifest = bundle.describe();
const tool = buildOpenAiTool(manifest, {
  name: 'lyraQuery',
  description: 'Query work items using facet and range filters',
});

// Pass tool to OpenAI API
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  tools: [tool],
  // ...
});
```

### `OpenAiToolOptions`

Options for building OpenAI tool definitions.

```ts
interface OpenAiToolOptions {
  /**
   * The name of the tool function (required).
   */
  name: string;
  /**
   * Optional description of what the tool does.
   * If omitted, a default description will be generated using the dataset ID.
   */
  description?: string;
}
```

**Default Description:**

If `description` is omitted, a default description is generated using the dataset ID from the manifest:

```ts
`Query dataset "${manifest.datasetId}" using facet and range filters`
```

## Integration Patterns

### Pattern 1: Direct Tool Function

Wrap the bundle query directly as a tool function:

```ts
const bundle = LyraBundle.load<Ticket>(storedBundle);

async function queryTickets(args: LyraQuery): Promise<LyraResult<Ticket>> {
  return bundle.query(args);
}

const tool = buildOpenAiTool(bundle.describe(), {
  name: 'queryTickets',
  description: 'Query support tickets',
});
```

### Pattern 2: Tool with Error Handling

Add error handling and logging:

```ts
async function queryTickets(args: LyraQuery): Promise<LyraResult<Ticket>> {
  try {
    const result = bundle.query(args);
    
    // Log for debugging
    console.log(`Query returned ${result.total} results`);
    
    return result;
  } catch (error) {
    // Return empty result on error (fail gracefully)
    return {
      items: [],
      total: 0,
      applied: { facets: args.facets, ranges: args.ranges },
      snapshot: bundle.snapshot(),
    };
  }
}
```

### Pattern 3: Multi-Bundle Tool

Expose multiple bundles as separate tools:

```ts
const ticketsBundle = LyraBundle.load<Ticket>(ticketsData);
const projectsBundle = LyraBundle.load<Project>(projectsData);

const tools = [
  buildOpenAiTool(ticketsBundle.describe(), {
    name: 'queryTickets',
    description: 'Query support tickets',
  }),
  buildOpenAiTool(projectsBundle.describe(), {
    name: 'queryProjects',
    description: 'Query project data',
  }),
];

// Tool functions
async function queryTickets(args: LyraQuery) {
  return ticketsBundle.query(args);
}

async function queryProjects(args: LyraQuery) {
  return projectsBundle.query(args);
}
```

### Pattern 4: Using Query Results

Help the agent understand and refine queries using result metadata:

```ts
async function queryTickets(args: LyraQuery): Promise<LyraResult<Ticket>> {
  const result = bundle.query(args);
  
  // The agent can use:
  // - result.total: to know if there are results
  // - result.facets: to see available filter options (if includeFacetCounts: true)
  // - result.snapshot: to understand data recency
  
  return result;
}
```

**Agent Guidance:**

When returning results to the agent, consider including guidance:

- If `total === 0`: Suggest broadening filters or checking field names
- If `total` is large: Suggest adding more specific filters
- Use `facets` counts to show available filter options
- Use `snapshot.builtAt` to indicate data freshness

## Key Points

- Use `buildOpenAiTool(bundle.describe(), options)` to auto-generate the tool schema from the manifest
- The generated schema is derived from `capabilities.facets` and `capabilities.ranges`, ensuring it matches what Lyra actually supports
- The agent can call the tool function with facet/range filters based on the manifest's capabilities
- Use `total` and `facets` in the result to help the agent refine or broaden queries
- The `snapshot` metadata helps the agent understand data recency and identity

## See Also

- [API Reference](./api.md) - Complete API documentation
- [Bundle JSON Specification](./bundle-json-spec.md) - Bundle format details
- [Examples](../examples/agent-tool/) - Complete working examples

