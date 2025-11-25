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
 * Build an OpenAI tool definition from a Lyra manifest.
 *
 * The tool schema is automatically derived from the manifest, ensuring
 * it matches the `LyraQuery` contract exactly.
 *
 * @param manifest - The bundle manifest describing fields and capabilities
 * @param options - Options for tool generation (name and optional description)
 * @returns An OpenAI tool definition object
 */
export function buildOpenAiTool(manifest: LyraManifest, options: OpenAiToolOptions): OpenAiTool {
  const parameters = buildQuerySchema(manifest, {
    facetArrayMode: 'single-or-array',
  });

  return {
    type: 'function',
    function: {
      name: options.name,
      description: options.description ?? `Query dataset "${manifest.datasetId}" using facet and range filters`,
      parameters,
    },
  };
}
