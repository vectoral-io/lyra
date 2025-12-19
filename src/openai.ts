import type { LyraManifest } from './types';
import type { JsonSchema } from './schema';
import { buildQuerySchema } from './schema';


// Types
// ==============================
export interface OpenAiToolOptions {
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

interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}


/**
 * Build an OpenAI tool definition from a Lyra manifest (v2).
 *
 * The tool schema is automatically derived from the manifest, ensuring
 * it matches the v2 `LyraQuery` contract with explicit operators (equal, notEqual, ranges, isNull, isNotNull).
 * Alias fields are included in the schema, allowing queries using human-readable names.
 *
 * @param manifest - The bundle manifest describing fields and capabilities
 * @param options - Options for tool generation (name and optional description)
 * @returns An OpenAI tool definition object
 */
export function buildOpenAiTool(manifest: LyraManifest, options: OpenAiToolOptions): OpenAiTool {
  const parameters = buildQuerySchema(manifest);

  // Build description mentioning aliases if present
  let description = options.description;
  if (!description) {
    const aliasNote = manifest.capabilities.aliases && manifest.capabilities.aliases.length > 0
      ? ` Supports both canonical IDs and human-readable alias fields (${manifest.capabilities.aliases.join(', ')}).`
      : '';
    description = `Query dataset "${manifest.datasetId}" using explicit filter operators (equal, notEqual, ranges, isNull, isNotNull).${aliasNote}`;
  }

  return {
    type: 'function',
    function: {
      name: options.name,
      description,
      parameters,
    },
  };
}
