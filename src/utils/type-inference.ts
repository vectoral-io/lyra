import type {
  CreateBundleConfig,
  FieldName,
  FieldType,
  SimpleBundleConfig,
} from '../types';


/**
 * Check if a value is a simple primitive or array of primitives.
 * Used to determine if a field should be auto-added as meta.
 */
export function isSimpleValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    // Allow arrays of primitives; bail if any non-primitive
    return value.every(
      (item) =>
        item === null ||
        item === undefined ||
        ['string', 'number', 'boolean'].includes(typeof item),
    );
  }

  return false; // objects, functions, etc.
}

/**
 * Infer the field type from actual values in the items array.
 * @internal
 */
export function inferFieldType<T extends Record<string, unknown>>(
  items: T[],
  field: FieldName<T>,
  mode: 'none' | 'runtime',
): FieldType {
  if (mode === 'none') return 'string';

  for (const item of items) {
    const value = item[field];
    if (value === null || value === undefined) continue;

    const valueType = typeof value;
    if (valueType === 'number') return 'number';
    if (valueType === 'boolean') return 'boolean';
    if (valueType === 'string') return 'string';

    // Anything else (object, array, etc.): default to string
    return 'string';
  }

  // No values found; default to string
  return 'string';
}

/**
 * Infer the range type (number or date) from actual values in the items array.
 * Validates that values are numeric or parseable dates.
 * @internal
 */
export function inferRangeType<T extends Record<string, unknown>>(
  items: T[],
  field: FieldName<T>,
  mode: 'none' | 'runtime',
): Extract<FieldType, 'number' | 'date'> {
  if (mode === 'none') return 'number';

  for (const item of items) {
    const value = item[field];
    if (value === null || value === undefined) continue;

    if (typeof value === 'number') {
      return 'number'; // plain numeric or timestamp; both ok
    }

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return 'date';
      }

      throw new Error(
        `Cannot infer range type for field "${String(
          field,
        )}". Encountered non-numeric, non-date string value: "${value}".`,
      );
    }

    throw new Error(
      `Cannot infer range type for field "${String(
        field,
      )}": unsupported value type "${typeof value}".`,
    );
  }

  // No non-null values; fallback to number
  return 'number';
}

/**
 * Convert a simple bundle config to an explicit bundle config.
 * Handles type inference, auto-detection of ID fields, and auto-meta behavior.
 * @internal
 */
export function fromSimpleConfig<T extends Record<string, unknown>>(
  items: T[],
  cfg: SimpleBundleConfig<T>,
): CreateBundleConfig<T> {
  const fields: CreateBundleConfig<T>['fields'] = {};
  const first = items[0] as Record<string, unknown> | undefined;
  const allKeys = new Set<string>(first ? Object.keys(first) : []);
  const inferMode = cfg.inferTypes ?? 'runtime';

  // 1. id (explicit or implicit)
  const idField =
    cfg.id ??
    (['id', 'Id', 'ID'].find((k) => allKeys.has(k)) as FieldName<T> | undefined);

  if (idField) {
    fields[idField] = {
      kind: 'id',
      type: inferFieldType(items, idField, inferMode),
    };
  }

  // 2. facets/equal (v2 uses 'equal', but support both for backward compatibility)
  const facetFields = cfg.equal ?? cfg.facets ?? [];
  for (const key of facetFields) {
    fields[key] = {
      kind: 'facet',
      type: inferFieldType(items, key, inferMode),
    };
  }

  // 3. ranges
  for (const key of cfg.ranges ?? []) {
    fields[key] = {
      kind: 'range',
      type: inferRangeType(items, key, inferMode),
    };
  }

  // 4. meta (do not override explicit ones)
  for (const key of cfg.meta ?? []) {
    if (fields[key]) continue;

    fields[key] = {
      kind: 'meta',
      type: inferFieldType(items, key, inferMode),
    };
  }

  // 5. Optional: auto-meta for all remaining simple fields
  if (cfg.autoMeta !== false) {
    for (const key of allKeys) {
      const typedKey = key as FieldName<T>;
      // Do not override explicit id/facet/range/meta/alias from earlier steps
      if (fields[typedKey]) continue;

      // Inspect items to decide if this is "simple enough"
      const isSimple = items.every((item) => isSimpleValue(item[typedKey]));
      if (!isSimple) continue;

      fields[typedKey] = {
        kind: 'meta',
        type: inferFieldType(items, typedKey, inferMode),
      };
    }
  }

  // 6. Handle aliases (v2)
  if (cfg.aliases) {
    for (const [aliasField, targetField] of Object.entries(cfg.aliases)) {
      const typedAliasField = aliasField as FieldName<T>;
      const typedTargetField = targetField as FieldName<T>;
      
      // Validate target field exists
      if (!fields[typedTargetField]) {
        throw new Error(
          `Alias field "${aliasField}" targets non-existent field "${targetField}"`,
        );
      }
      
      // Validate target is a facet or range (not meta/id)
      const targetFieldDef = fields[typedTargetField];
      if (targetFieldDef.kind !== 'facet' && targetFieldDef.kind !== 'range') {
        throw new Error(
          `Alias field "${aliasField}" must target a facet or range field, not "${targetFieldDef.kind}"`,
        );
      }
      
      // Infer alias field type from target field
      fields[typedAliasField] = {
        kind: 'alias',
        type: inferFieldType(items, typedAliasField, inferMode),
        targetField: typedTargetField,
      };
    }
  }

  return {
    datasetId: cfg.datasetId,
    fields,
  };
}

