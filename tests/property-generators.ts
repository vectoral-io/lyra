import * as fc from 'fast-check';
import type {
  CreateBundleConfig,
  FieldConfig,
  FieldKind,
  FieldType,
  LyraQuery,
} from '../src';

// Property Test Generators
// ==============================

type BundleItem = Record<string, unknown>;

/**
 * Generate a random field kind.
 */
const fieldKindArb: fc.Arbitrary<FieldKind> = fc.constantFrom(
  'id',
  'facet',
  'range',
  'meta',
);

/**
 * Generate a random field type.
 */
const fieldTypeArb: fc.Arbitrary<FieldType> = fc.constantFrom(
  'string',
  'number',
  'boolean',
  'date',
);

/**
 * Generate a random field configuration.
 * Ensures valid combinations: range fields must be number or date.
 */
const fieldConfigArb: fc.Arbitrary<FieldConfig> = fc.oneof(
  // Range fields can only be number or date
  fc.record({
    kind: fc.constant('range' as FieldKind),
    type: fc.constantFrom('number' as FieldType, 'date' as FieldType),
  }),
  // Other field kinds can have any type
  fc.record({
    kind: fc.constantFrom('id' as FieldKind, 'facet' as FieldKind, 'meta' as FieldKind),
    type: fieldTypeArb,
  }),
);

/**
 * Generate a random bundle configuration.
 * Ensures at least one id field and some facets/ranges.
 */
export const bundleConfigArb: fc.Arbitrary<CreateBundleConfig> = fc
  .record({
    datasetId: fc.string({ minLength: 1, maxLength: 50 }),
    fields: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 20 }),
      fieldConfigArb,
      { minKeys: 1, maxKeys: 10 },
    ),
  })
  .map((config) => {
    // Ensure at least one id field
    const fieldNames = Object.keys(config.fields);
    if (!fieldNames.some((name) => config.fields[name]?.kind === 'id')) {
      const firstField = fieldNames[0];
      if (firstField) {
        config.fields[firstField] = { kind: 'id', type: 'string' };
      }
    }

    return config;
  });

/**
 * Generate a random value based on field type.
 */
function generateValueForType(
  type: FieldType,
  fieldName: string,
): fc.Arbitrary<unknown> {
  switch (type) {
    case 'string':
      return fc.oneof(
        fc.string(),
        fc.constant(''),
        fc.constant('null'),
        fc.constant('undefined'),
      );
    case 'number':
      return fc.oneof(
        fc.integer({ min: -1000, max: 1000 }),
        fc.float({ min: -1000, max: 1000 }),
        fc.constant(0),
        fc.constant(-1),
      );
    case 'boolean':
      return fc.boolean();
    case 'date':
      // Generate ISO date strings or epoch milliseconds
      return fc.oneof(
        fc
          .date({ min: new Date('2000-01-01'), max: new Date('2030-12-31') })
          .filter((d) => !Number.isNaN(d.getTime()))
          .map((d) => d.toISOString()),
        fc.integer({ min: Date.parse('2000-01-01'), max: Date.parse('2030-12-31') }),
      );
    default:
      return fc.constant(null);
  }
}

/**
 * Generate a random item matching a bundle configuration.
 */
export function itemArb(config: CreateBundleConfig): fc.Arbitrary<BundleItem> {
  return fc.record(
    Object.fromEntries(
      Object.entries(config.fields).map(([fieldName, fieldConfig]) => [
        fieldName,
        generateValueForType(fieldConfig.type, fieldName),
      ]),
    ),
  ) as fc.Arbitrary<BundleItem>;
}

/**
 * Generate an array of items matching a bundle configuration.
 */
export function itemsArb(
  config: CreateBundleConfig,
  minItems: number = 0,
  maxItems: number = 100,
): fc.Arbitrary<BundleItem[]> {
  return fc.array(itemArb(config), { minLength: minItems, maxLength: maxItems });
}

/**
 * Generate a random facet filter value (single value or array).
 */
const facetValueArb: fc.Arbitrary<unknown | unknown[]> = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean()), {
    minLength: 1,
    maxLength: 5,
  }),
);

/**
 * Generate a random facet filter.
 */
function facetFilterArb(facetFields: string[]): fc.Arbitrary<Record<string, unknown | unknown[]>> {
  if (facetFields.length === 0) {
    return fc.constant({});
  }

  return fc
    .array(
      fc.record({
        field: fc.constantFrom(...facetFields),
        value: facetValueArb,
      }),
      { minLength: 0, maxLength: Math.min(facetFields.length, 5) },
    )
    .map((entries) => {
      const filter: Record<string, unknown | unknown[]> = {};
      for (const entry of entries) {
        filter[entry.field] = entry.value;
      }
      return filter;
    });
}

/**
 * Generate a random range filter.
 */
function rangeFilterArb(rangeFields: string[]): fc.Arbitrary<Record<string, { min?: number; max?: number }>> {
  if (rangeFields.length === 0) {
    return fc.constant({});
  }

  return fc
    .array(
      fc.record({
        field: fc.constantFrom(...rangeFields),
        min: fc.option(fc.integer({ min: -1000, max: 1000 })),
        max: fc.option(fc.integer({ min: -1000, max: 1000 })),
      }),
      { minLength: 0, maxLength: Math.min(rangeFields.length, 3) },
    )
    .map((entries) => {
      const filter: Record<string, { min?: number; max?: number }> = {};
      for (const entry of entries) {
        filter[entry.field] = {};
        if (entry.min !== null) filter[entry.field]!.min = entry.min;
        if (entry.max !== null) filter[entry.field]!.max = entry.max;
      }
      return filter;
    });
}

/**
 * Generate a random query.
 */
export function queryArb(config: CreateBundleConfig): fc.Arbitrary<LyraQuery> {
  const facetFields = Object.entries(config.fields)
    .filter(([, fieldConfig]) => fieldConfig.kind === 'facet')
    .map(([fieldName]) => fieldName);

  const rangeFields = Object.entries(config.fields)
    .filter(([, fieldConfig]) => fieldConfig.kind === 'range')
    .map(([fieldName]) => fieldName);

  return fc.record({
    facets: facetFilterArb(facetFields),
    ranges: rangeFilterArb(rangeFields),
    limit: fc.option(fc.integer({ min: 0, max: 1000 })),
    offset: fc.option(fc.integer({ min: 0, max: 1000 })),
    includeFacetCounts: fc.boolean(),
  });
}

/**
 * Generate a config with items and queries that match the config.
 */
export const configWithItemsAndQueryArb: fc.Arbitrary<{
  config: CreateBundleConfig;
  items: BundleItem[];
  query: LyraQuery;
}> = bundleConfigArb.chain((config) =>
  fc.record({
    config: fc.constant(config),
    items: itemsArb(config, 0, 50),
    query: queryArb(config),
  }),
);

/**
 * Generate a config with items (non-empty) and queries that match the config.
 */
export const configWithItemsAndQueryNonEmptyArb: fc.Arbitrary<{
  config: CreateBundleConfig;
  items: BundleItem[];
  query: LyraQuery;
}> = bundleConfigArb.chain((config) =>
  fc.record({
    config: fc.constant(config),
    items: itemsArb(config, 1, 50),
    query: queryArb(config),
  }),
);

