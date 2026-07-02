import type { LyraManifest } from './types';

// Types
// ==============================

/**
 * JSON Schema type (minimal representation).
 */
export type JsonSchema = { [key: string]: unknown };

/**
 * Schema fragment for a filter value that accepts a scalar of `baseType`, an
 * explicit `null` (normalized to isNull/isNotNull), or an array of either (IN
 * semantics). Shared by the facet and alias property builders.
 */
function scalarOrArraySchema(baseType: string): JsonSchema {
  return {
    anyOf: [
      { type: baseType },
      { type: 'null' },
      { type: 'array', items: { anyOf: [{ type: baseType }, { type: 'null' }] } },
    ],
  };
}

// Implementation
// ==============================

/**
 * Build a JSON schema describing a `LyraQuery` for a given manifest.
 *
 * Driven entirely by `manifest.capabilities` — only declared facets, ranges, and
 * aliases appear, so the schema can't describe a field the bundle won't filter.
 * Mirrors the query operators: `equal`, `notEqual`, `ranges`, `isNull`, `isNotNull`,
 * `limit`, `offset`, `includeFacetCounts`, and `enrichAliases` (when aliases exist).
 *
 * @param manifest - The bundle manifest describing fields and capabilities
 * @returns A JSON schema object describing the query structure
 */
export function buildQuerySchema(manifest: LyraManifest): JsonSchema {
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

    const baseType = field.type === 'number' || field.type === 'boolean' ? field.type : 'string';
    const schema = scalarOrArraySchema(baseType);
    equalProperties[fieldName] = schema;
    notEqualProperties[fieldName] = schema;
  }

  // Include alias fields (v2) — aliases are always strings (human-readable names)
  if (manifest.capabilities.aliases) {
    for (const aliasFieldName of manifest.capabilities.aliases) {
      const aliasField = fieldMap.get(aliasFieldName);
      if (!aliasField || aliasField.kind !== 'alias') continue;

      const schema = scalarOrArraySchema('string');
      equalProperties[aliasFieldName] = schema;
      notEqualProperties[aliasFieldName] = schema;
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

