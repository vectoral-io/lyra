import type { LyraManifest } from './types';
import type { JsonSchema } from './schema';
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
export declare function buildOpenAiTool(manifest: LyraManifest, options: OpenAiToolOptions): OpenAiTool;
export {};
//# sourceMappingURL=openai.d.ts.map