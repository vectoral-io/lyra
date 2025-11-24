# Agent Tool Integration Example

This example demonstrates how to use Lyra bundles as tools for LLM agents, showing the integration pattern without requiring a real LLM.

## Files

- `data.json` - Synthetic dataset with tickets, tasks, and events
- `build-bundle.ts` - Builds a bundle using simple config and writes `bundle.json`
- `agent-tool.ts` - Demonstrates the agent tool integration pattern

## Running the Example

**Option 1: Using npm scripts (recommended)**
```bash
# Build the bundle and run the demo
bun run example:agent

# Or run steps individually:
bun run example:agent:build  # Build the bundle
bun run example:agent:run     # Run the demo
```

**Option 2: Direct execution**
```bash
# Build the bundle
bun run examples/agent-tool/build-bundle.ts

# Run the agent tool demo
bun run examples/agent-tool/agent-tool.ts
```

## What This Demonstrates

- Building a bundle with simple config (minimal boilerplate)
- Loading a bundle at runtime
- Generating tool schemas from the bundle manifest
- Exposing a query function that agents can call
- Sample queries showing facet filters, range filters, and facet counts
- How the manifest describes queryable fields and capabilities

## Agent Tool Integration Pattern

The example shows how you would integrate a Lyra bundle as a tool for LLM agents:

1. **Build the bundle** (offline, in CI, or during deployment)
   - Use simple config for quick setup
   - Bundle includes manifest describing all fields and capabilities

2. **Load the bundle** at runtime
   - Load from JSON (filesystem, CDN, object storage, etc.)
   - Bundle is immutable and ready for queries

3. **Expose a tool function**
   - Function accepts `LyraQuery` arguments
   - Returns `LyraResult` with items, total count, and optional facet counts

4. **Generate tool schema** (for OpenAI tools or similar)
   - Use `buildOpenAiTool(bundle.describe(), options)` to auto-generate the tool schema
   - The schema is automatically derived from the manifest, guaranteeing fidelity with the `LyraQuery` contract
   - Pass the generated schema to your agent framework

5. **Agent queries the bundle**
   - Agent calls the tool function with facet/range filters
   - Results include matching items, total count, and snapshot metadata
   - Facet counts enable drilldown UI patterns

## Key Concepts

- **Manifest-driven**: The bundle manifest describes all queryable fields
- **Self-describing**: Tool schemas are auto-generated from the manifest using `buildOpenAiTool`
- **Type-safe**: Schema generation guarantees compatibility with the `LyraQuery` contract
- **Deterministic**: Same query always returns same results
- **Snapshot metadata**: Every result includes dataset ID and build timestamp

