import type { LyraManifest } from './types';
/**
 * JSON Schema type (minimal representation).
 */
export type JsonSchema = {
    [key: string]: unknown;
};
/**
 * Options for building query schemas (v2).
 * @deprecated No longer used in v2 - kept for backward compatibility
 */
export interface QuerySchemaOptions {
    /**
     * @deprecated No longer used in v2
     */
    facetArrayMode?: 'single' | 'single-or-array';
    /**
     * @deprecated No longer used in v2
     */
    includeArrayQueryFormat?: boolean;
}
/**
 * Build a JSON schema that describes the structure of a `LyraQuery` (v2) for a given manifest.
 *
 * The generated schema matches the v2 `LyraQuery` contract with explicit operators:
 * - `equal`: Object with canonical facet and alias field names as keys
 * - `notEqual`: Object with canonical facet and alias field names as keys
 * - `ranges`: Object with range field names as keys
 * - `isNull`, `isNotNull`: Arrays of field names
 * - `enrichAliases`: Boolean or array of alias field names
 * - `limit`, `offset`, `includeFacetCounts`: Standard pagination/extras
 *
 * @param manifest - The bundle manifest describing fields and capabilities
 * @param options - Options for schema generation (deprecated, kept for compatibility)
 * @returns A JSON schema object describing the v2 query structure
 */
export declare function buildQuerySchema(manifest: LyraManifest, _options?: QuerySchemaOptions): JsonSchema;
//# sourceMappingURL=schema.d.ts.map