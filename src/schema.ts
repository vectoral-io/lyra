import type { LyraManifest } from './types';

// Types
// ==============================

/**
 * JSON Schema type (minimal representation).
 */
export type JsonSchema = { [key: string]: unknown };

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

// Implementation
// ==============================

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
export function buildQuerySchema(
  manifest: LyraManifest,
  _options: QuerySchemaOptions = {},
): JsonSchema {
  // Options parameter kept for backward compatibility but unused in v2

  // Build a map of field names to field definitions for quick lookup
  const fieldMap = new Map<string, LyraManifest['fields'][0]>();
  for (const field of manifest.fields) {
    fieldMap.set(field.name, field);
  }

  // Build equal/notEqual properties from canonical facets + aliases
  const equalProperties: Record<string, unknown> = {};
  const notEqualProperties: Record<string, unknown> = {};
  const rangeProperties: Record<string, unknown> = {};
  
  // Include canonical facets
  for (const fieldName of manifest.capabilities.facets) {
    const field = fieldMap.get(fieldName);
    if (!field) continue;

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

    // Support scalar or array (IN semantics)
    const scalarOrArraySchema = {
      anyOf: [
        { type: baseType },
        { type: 'null' }, // null normalized to isNull
        { type: 'array', items: { anyOf: [{ type: baseType }, { type: 'null' }] } },
      ],
    };

    equalProperties[fieldName] = scalarOrArraySchema;
    notEqualProperties[fieldName] = scalarOrArraySchema;
  }

  // Include alias fields (v2)
  if (manifest.capabilities.aliases) {
    for (const aliasFieldName of manifest.capabilities.aliases) {
      const aliasField = fieldMap.get(aliasFieldName);
      if (!aliasField || aliasField.kind !== 'alias') continue;

      // Aliases are always strings (human-readable names)
      const scalarOrArraySchema = {
        anyOf: [
          { type: 'string' },
          { type: 'null' }, // null normalized to isNull/isNotNull
          { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
        ],
      };

      equalProperties[aliasFieldName] = scalarOrArraySchema;
      notEqualProperties[aliasFieldName] = scalarOrArraySchema;
    }
  }

  // Build range properties from capabilities.ranges
  for (const fieldName of manifest.capabilities.ranges) {
    const field = fieldMap.get(fieldName);
    if (!field) continue;

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

  // Build all field names for isNull/isNotNull (canonical + aliases)
  const allQueryableFields = [
    ...manifest.capabilities.facets,
    ...(manifest.capabilities.aliases || []),
  ];

  // Build properties object for v2 query schema
  const properties: Record<string, unknown> = {
    equal: {
      type: 'object',
      description: 'Equality filters (exact match or IN semantics)',
      properties: equalProperties,
      additionalProperties: false,
    },
    notEqual: {
      type: 'object',
      description: 'Inequality filters (NOT equal or NOT IN)',
      properties: notEqualProperties,
      additionalProperties: false,
    },
    ranges: {
      type: 'object',
      description: 'Range filters (min/max bounds per field)',
      properties: rangeProperties,
      additionalProperties: false,
    },
    isNull: {
      type: 'array',
      description: 'Fields that must be NULL',
      items: {
        type: 'string',
        enum: allQueryableFields,
      },
    },
    isNotNull: {
      type: 'array',
      description: 'Fields that must NOT be NULL',
      items: {
        type: 'string',
        enum: allQueryableFields,
      },
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
  };

  // Add enrichAliases if aliases are present
  if (manifest.capabilities.aliases && manifest.capabilities.aliases.length > 0) {
    properties.enrichAliases = {
      anyOf: [
        { type: 'boolean' },
        {
          type: 'array',
          items: {
            type: 'string',
            enum: manifest.capabilities.aliases,
          },
        },
      ],
      description: 'Enrich results with alias values (true for all, or array of specific alias fields)',
    };
  }

  // Build top-level schema matching v2 LyraQuery contract
  return {
    type: 'object',
    properties,
    additionalProperties: false,
  };
}

