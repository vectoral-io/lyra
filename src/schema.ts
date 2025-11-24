// Schema Helpers
// ==============================

import type { LyraManifest } from './types';

/**
 * JSON Schema type (minimal representation).
 */
export type JsonSchema = { [key: string]: unknown };

/**
 * Options for building query schemas.
 */
export interface QuerySchemaOptions {
  /**
   * How to represent facet values in the schema.
   * - `'single'`: Facet values must be a single primitive (string, number, or boolean)
   * - `'single-or-array'`: Facet values can be either a single primitive or an array of primitives (default)
   */
  facetArrayMode?: 'single' | 'single-or-array';
}

/**
 * Build a JSON schema that describes the structure of a `LyraQuery` for a given manifest.
 *
 * The generated schema matches the `LyraQuery` contract:
 * - `facets`: Object with facet field names as keys
 * - `ranges`: Object with range field names as keys
 * - `limit`, `offset`: Optional number fields
 * - `includeFacetCounts`: Optional boolean field
 *
 * @param manifest - The bundle manifest describing fields and capabilities
 * @param options - Options for schema generation
 * @returns A JSON schema object describing the query structure
 */
export function buildQuerySchema(
  manifest: LyraManifest,
  options: QuerySchemaOptions = {},
): JsonSchema {
  const { facetArrayMode = 'single-or-array' } = options;

  const facetProperties: Record<string, unknown> = {};
  const rangeProperties: Record<string, unknown> = {};

  // Build facet properties
  for (const field of manifest.fields) {
    if (field.kind === 'facet') {
      // Determine base type from field.type
      let baseType: string;
      if (field.type === 'number') {
        baseType = 'number';
      }
      else if (field.type === 'boolean') {
        baseType = 'boolean';
      }
      else {
        baseType = 'string';
      }

      // Build schema based on facetArrayMode
      if (facetArrayMode === 'single') {
        facetProperties[field.name] = {
          type: baseType,
        };
      }
      else {
        // single-or-array (default)
        facetProperties[field.name] = {
          anyOf: [
            { type: baseType },
            { type: 'array', items: { type: baseType } },
          ],
        };
      }
    }
    else if (field.kind === 'range') {
      // Build range property schema
      const description =
        field.type === 'date'
          ? 'min/max as Unix ms'
          : 'numeric range';
      rangeProperties[field.name] = {
        type: 'object',
        description,
        properties: {
          min: {
            type: 'number',
            description: 'Minimum value (inclusive)',
          },
          max: {
            type: 'number',
            description: 'Maximum value (inclusive)',
          },
        },
        additionalProperties: false,
      };
    }
  }

  // Build top-level schema matching LyraQuery contract
  return {
    type: 'object',
    properties: {
      facets: {
        type: 'object',
        description: 'Facet filters (equality matching)',
        properties: facetProperties,
        additionalProperties: false,
      },
      ranges: {
        type: 'object',
        description: 'Range filters (min/max bounds per field)',
        properties: rangeProperties,
        additionalProperties: false,
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return',
      },
      offset: {
        type: 'number',
        description: 'Number of results to skip (for pagination)',
      },
      includeFacetCounts: {
        type: 'boolean',
        description: 'Include facet counts in the response',
      },
    },
    additionalProperties: false,
  };
}

