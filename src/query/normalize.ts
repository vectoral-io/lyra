import type { LyraManifest, LyraQuery, RangeBound, Scalar } from '../types';

/**
 * Result of normalizing a LyraQuery into canonical filter form.
 * @internal
 */
export interface NormalizedQuery {
  equalFilters: Record<string, Scalar | Scalar[]>;
  notEqualFilters: Record<string, Scalar | Scalar[]>;
  rangeFilters: Record<string, RangeBound>;
  nullChecks: { isNull: string[]; isNotNull: string[] };
  /** Fields in `equal` that also require null matching (OR semantics from `[val, null]`). */
  equalWithNull: Set<string>;
}

/**
 * Normalize query operators for internal processing.
 *
 * - `equal: { field: null }` is lifted into `isNull`.
 * - `equal: { field: [val, null] }` keeps the values and adds the field to `equalWithNull`
 *   so the query pipeline unions in null-matching indices.
 * - `notEqual: { field: null }` is lifted into `isNotNull`.
 * - `equal`/`notEqual`/`ranges` are tolerant of `null`/`undefined` input (treated as empty).
 *
 * @internal
 */
// Shared sentinels for the common "nothing to do" case. Never mutated.
const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_OBJECT: Readonly<Record<string, never>> = Object.freeze({});

export function normalizeQuery(query: LyraQuery): NormalizedQuery {
  const needsIsNullCopy = (query.isNull?.length ?? 0) > 0;
  const needsIsNotNullCopy = (query.isNotNull?.length ?? 0) > 0;
  const nullChecks = {
    isNull: needsIsNullCopy ? [...query.isNull!] : [],
    isNotNull: needsIsNotNullCopy ? [...query.isNotNull!] : [],
  };
  let equalWithNull: Set<string> | null = null;
  const equalFilters: Record<string, Scalar | Scalar[]> = {};
  const notEqualFilters: Record<string, Scalar | Scalar[]> = {};

  if (query.equal) {
    for (const [field, value] of Object.entries(query.equal)) {
      if (value === null) {
        nullChecks.isNull.push(field);
        continue;
      }
      if (!Array.isArray(value)) {
        equalFilters[field] = value;
        continue;
      }

      if (value.length === 0) {
        // Empty IN clause — preserved so the pipeline can short-circuit to no matches.
        equalFilters[field] = [];
        continue;
      }

      const nonNull = value.filter((val) => val !== null);
      const hasNull = nonNull.length !== value.length;

      if (nonNull.length === 0) {
        // Array was all nulls.
        nullChecks.isNull.push(field);
        continue;
      }

      equalFilters[field] = nonNull.length === 1 ? nonNull[0] : nonNull;
      if (hasNull) (equalWithNull ??= new Set()).add(field);
    }
  }

  if (query.notEqual) {
    for (const [field, value] of Object.entries(query.notEqual)) {
      if (value === null) {
        nullChecks.isNotNull.push(field);
        continue;
      }
      if (!Array.isArray(value)) {
        notEqualFilters[field] = value;
        continue;
      }

      const nonNull = value.filter((val) => val !== null);
      if (nonNull.length !== value.length) {
        nullChecks.isNotNull.push(field);
      }
      if (nonNull.length > 0) {
        notEqualFilters[field] = nonNull.length === 1 ? nonNull[0] : nonNull;
      }
    }
  }

  return {
    equalFilters,
    notEqualFilters,
    rangeFilters: query.ranges ?? (EMPTY_OBJECT as Record<string, never>),
    nullChecks,
    equalWithNull: equalWithNull ?? (EMPTY_SET as Set<string>),
  };
}

/**
 * Resolve alias fields in a filter record to their canonical target fields.
 *
 * Policy: values that have no mapping are dropped with a single batched warning per field.
 * If every value for a field is unmapped, the field's constraint is dropped entirely.
 *
 * @internal
 */
export function resolveAliases(
  filters: Record<string, Scalar | Scalar[]>,
  manifest: LyraManifest,
  operatorName: 'equal' | 'notEqual',
): Record<string, Scalar | Scalar[]> {
  const resolved: Record<string, Scalar | Scalar[]> = {};

  for (const [field, value] of Object.entries(filters)) {
    const fieldDef = manifest.fields.find((fld) => fld.name === field);

    if (!fieldDef || fieldDef.kind !== 'alias') {
      resolved[field] = value;
      continue;
    }

    const lookup = manifest.lookups?.[field];
    if (!lookup) {
      // eslint-disable-next-line no-console
      console.warn(`Alias field '${field}' has no lookup table; ignoring ${operatorName} filter`);
      continue;
    }

    const values = Array.isArray(value) ? value : [value];
    const resolvedIds: string[] = [];
    const unmapped: string[] = [];

    for (const val of values) {
      const key = String(val);
      const ids = lookup.aliasToIds[key];
      if (!ids || ids.length === 0) {
        unmapped.push(key);
      }
      else {
        resolvedIds.push(...ids);
      }
    }

    if (unmapped.length > 0) {
      const WARN_PREVIEW_LIMIT = 5;
      const preview = unmapped.slice(0, WARN_PREVIEW_LIMIT).join(', ');
      const suffix = unmapped.length > WARN_PREVIEW_LIMIT ? `, +${unmapped.length - WARN_PREVIEW_LIMIT} more` : '';
      // eslint-disable-next-line no-console
      console.warn(
        `No mapping found for ${field}='${preview}'${suffix} in ${operatorName}; dropped`,
      );
    }

    if (resolvedIds.length > 0) {
      const target = fieldDef.aliasTarget!;
      const deduped = [...new Set(resolvedIds)];
      resolved[target] = deduped.length === 1 ? deduped[0] : deduped;
    }
  }

  return resolved;
}
