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
  /**
   * Whether to include support for array query format (facets/ranges as arrays).
   * When enabled, the schema allows both single objects and arrays of objects for facets and ranges,
   * and includes facetMode/rangeMode parameters.
   * Default: false (for backward compatibility)
   */
  includeArrayQueryFormat?: boolean;
}

/**
 * Build a JSON schema that describes the structure of a `LyraQuery` for a given manifest.
 *
 * The generated schema matches the `LyraQuery` contract and is driven by
 * `manifest.capabilities.facets` and `manifest.capabilities.ranges` as the
 * source of truth for queryable fields.
 *
 * - `facets`: Object with facet field names as keys (from capabilities.facets)
 * - `ranges`: Object with range field names as keys (from capabilities.ranges)
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
  const { facetArrayMode = 'single-or-array', includeArrayQueryFormat = false } = options;

  // Build a map of field names to field definitions for quick lookup
  const fieldMap = new Map<string, LyraManifest['fields'][0]>();
  for (const field of manifest.fields) {
    fieldMap.set(field.name, field);
  }

  const facetProperties: Record<string, unknown> = {};
  const rangeProperties: Record<string, unknown> = {};

  // Build facet properties from capabilities.facets (source of truth)
  for (const fieldName of manifest.capabilities.facets) {
    const field = fieldMap.get(fieldName);
    if (!field) {
      // Field not found in manifest.fields; skip (shouldn't happen in valid manifests)
      continue;
    }

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
      facetProperties[fieldName] = {
        type: baseType,
      };
    }
    else {
      // single-or-array (default)
      facetProperties[fieldName] = {
        anyOf: [
          { type: baseType },
          { type: 'array', items: { type: baseType } },
        ],
      };
    }
  }

  // Build range properties from capabilities.ranges (source of truth)
  for (const fieldName of manifest.capabilities.ranges) {
    const field = fieldMap.get(fieldName);
    if (!field) {
      // Field not found in manifest.fields; skip (shouldn't happen in valid manifests)
      continue;
    }

    // Build range property schema
    const description =
      field.type === 'date'
        ? 'min/max as Unix ms'
        : 'numeric range';
    rangeProperties[fieldName] = {
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

  // Build facets and ranges schema (single object or array support)
  const facetsObjectSchema = {
    type: 'object',
    description: 'Facet filters (equality matching)',
    properties: facetProperties,
    additionalProperties: false,
  };

  const rangesObjectSchema = {
    type: 'object',
    description: 'Range filters (min/max bounds per field)',
    properties: rangeProperties,
    additionalProperties: false,
  };

  const facetsSchema = includeArrayQueryFormat
    ? {
        anyOf: [
          facetsObjectSchema,
          {
            type: 'array',
            description: 'Array of facet filter objects (combined with facetMode)',
            items: facetsObjectSchema,
          },
        ],
      }
    : facetsObjectSchema;

  const rangesSchema = includeArrayQueryFormat
    ? {
        anyOf: [
          rangesObjectSchema,
          {
            type: 'array',
            description: 'Array of range filter objects (combined with rangeMode)',
            items: rangesObjectSchema,
          },
        ],
      }
    : rangesObjectSchema;

  // Build properties object
  const properties: Record<string, unknown> = {
    facets: facetsSchema,
    ranges: rangesSchema,
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
  };

  // Add facetMode and rangeMode if array query format is enabled
  if (includeArrayQueryFormat) {
    properties.facetMode = {
      type: 'string',
      enum: ['union', 'intersection'],
      description: 'How to combine multiple facet objects: union (OR) or intersection (AND). Default: union',
    };
    properties.rangeMode = {
      type: 'string',
      enum: ['union', 'intersection'],
      description: 'How to combine multiple range objects: union (OR) or intersection (AND). Default: union',
    };
  }

  // Build top-level schema matching LyraQuery contract
  return {
    type: 'object',
    properties,
    additionalProperties: false,
  };
}

