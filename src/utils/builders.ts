import type {
  CreateBundleConfig,
  FieldKind,
  FieldType,
  InMemoryFacetIndex,
  InMemoryNullIndex,
  LookupTable,
  LyraManifest,
  RangeColumns,
} from '../types';

/** Current bundle format major version. */
export const BUNDLE_VERSION = '3.0.0';

const VALID_KINDS: readonly FieldKind[] = ['id', 'facet', 'range', 'meta', 'alias'];
const VALID_TYPES: readonly FieldType[] = ['string', 'number', 'boolean', 'date'];

/**
 * Build a manifest from bundle configuration.
 * @internal
 */
export function buildManifest<TItem extends Record<string, unknown>>(
  config: CreateBundleConfig<TItem>,
): LyraManifest {
  const builtAt = new Date().toISOString();

  const fields = Object.entries(config.fields)
    .filter(([, cfg]) => cfg != null)
    .map(([name, cfg]) => {
      if (!cfg) throw new Error(`Field "${name}" has undefined configuration`);

      if (!VALID_KINDS.includes(cfg.kind)) {
        throw new Error(
          `Invalid field kind "${cfg.kind}" for field "${name}". Must be one of: ${VALID_KINDS.join(', ')}`,
        );
      }
      if (!VALID_TYPES.includes(cfg.type)) {
        throw new Error(
          `Invalid field type "${cfg.type}" for field "${name}". Must be one of: ${VALID_TYPES.join(', ')}`,
        );
      }
      if (cfg.kind === 'alias' && !cfg.targetField) {
        throw new Error(`Alias field "${name}" must specify targetField`);
      }

      return {
        name,
        kind: cfg.kind,
        type: cfg.type,
        ops: (cfg.kind === 'range' ? ['between', 'gte', 'lte'] : ['eq', 'in']) as Array<
          'eq' | 'in' | 'between' | 'gte' | 'lte'
        >,
        aliasTarget: cfg.kind === 'alias' ? cfg.targetField : undefined,
      };
    });

  if (fields.length === 0) {
    throw new Error('Invalid bundle: fields array must not be empty');
  }

  // Validate alias targets.
  for (const field of fields) {
    if (field.kind !== 'alias' || !field.aliasTarget) continue;
    const target = fields.find((fld) => fld.name === field.aliasTarget);
    if (!target) {
      throw new Error(
        `Alias field "${field.name}" targets non-existent field "${field.aliasTarget}"`,
      );
    }
    if (target.kind !== 'facet' && target.kind !== 'range') {
      throw new Error(
        `Alias field "${field.name}" must target a facet or range field, not "${target.kind}"`,
      );
    }
  }

  const aliasFields = fields.filter((fld) => fld.kind === 'alias').map((fld) => fld.name);

  const manifest: LyraManifest = {
    version: BUNDLE_VERSION,
    datasetId: config.datasetId,
    builtAt,
    fields,
    capabilities: {
      facets: fields.filter((fld) => fld.kind === 'facet').map((fld) => fld.name),
      ranges: fields.filter((fld) => fld.kind === 'range').map((fld) => fld.name),
      aliases: aliasFields.length > 0 ? aliasFields : undefined,
    },
  };

  validateManifest(manifest);
  return manifest;
}

/**
 * Validate a manifest's internal consistency. Shared between build and load paths.
 *
 * Callers that construct manifests with invariants already guaranteed (e.g.
 * `buildManifest`) can skip this, but `load()` must call it on untrusted input.
 *
 * @internal
 */
export function validateManifest(manifest: LyraManifest): void {
  if (!manifest.version) throw new Error('Invalid bundle: missing version');
  const major = manifest.version.split('.')[0];
  if (major !== '3') {
    throw new Error(
      `Invalid bundle version: "${manifest.version}". Expected version starting with "3."`,
    );
  }

  if (!manifest.fields || manifest.fields.length === 0) {
    throw new Error('Invalid bundle: fields array must not be empty');
  }

  const seen = new Set<string>();
  for (const field of manifest.fields) {
    if (!field.name) throw new Error('Invalid bundle: field is missing name');
    if (seen.has(field.name)) {
      throw new Error(`Invalid bundle: duplicate field name "${field.name}"`);
    }
    seen.add(field.name);
    if (!VALID_KINDS.includes(field.kind)) {
      throw new Error(`Invalid bundle: field "${field.name}" has invalid kind "${field.kind}"`);
    }
    if (!VALID_TYPES.includes(field.type)) {
      throw new Error(`Invalid bundle: field "${field.name}" has invalid type "${field.type}"`);
    }
    if (field.kind === 'alias') {
      if (!field.aliasTarget) {
        throw new Error(`Invalid bundle: alias field "${field.name}" missing aliasTarget`);
      }
      const target = manifest.fields.find((fld) => fld.name === field.aliasTarget);
      if (!target) {
        throw new Error(
          `Invalid bundle: alias field "${field.name}" targets non-existent field "${field.aliasTarget}"`,
        );
      }
      if (target.kind !== 'facet' && target.kind !== 'range') {
        throw new Error(
          `Invalid bundle: alias field "${field.name}" must target a facet or range, not "${target.kind}"`,
        );
      }
    }
  }

  for (const facet of manifest.capabilities.facets) {
    if (!seen.has(facet)) {
      throw new Error(`Invalid bundle: capability references non-existent facet field "${facet}"`);
    }
  }
  for (const range of manifest.capabilities.ranges) {
    if (!seen.has(range)) {
      throw new Error(`Invalid bundle: capability references non-existent range field "${range}"`);
    }
  }
  for (const alias of manifest.capabilities.aliases ?? []) {
    if (!seen.has(alias)) {
      throw new Error(`Invalid bundle: capability references non-existent alias field "${alias}"`);
    }
  }
}

/**
 * Build the in-memory facet index from items and manifest.
 *
 * Single-pass push with a tail-of-list dedup guard so each posting list comes
 * out strictly ascending without an explicit sort. Items are visited in
 * ascending index order; the only way a duplicate can appear in a bucket is
 * when one item lists the same value twice in an array-valued facet (e.g.
 * `tags: ['a','a']`), which the tail check filters in O(1) per push.
 * @internal
 */
export function buildFacetIndex<T extends Record<string, unknown>>(
  items: T[],
  manifest: LyraManifest,
): InMemoryFacetIndex {
  const facetFields = manifest.capabilities.facets;
  const transient: Record<string, Record<string, number[]>> = {};
  for (const field of facetFields) transient[field] = {};

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx] as Record<string, unknown>;
    for (const field of facetFields) {
      const raw = item[field];
      if (raw === undefined || raw === null) continue;

      const byValue = transient[field];
      if (Array.isArray(raw)) {
        for (const value of raw) {
          const valueKey = String(value);
          let postings = byValue[valueKey];
          if (!postings) {
            postings = [];
            byValue[valueKey] = postings;
          }
          if (postings[postings.length - 1] !== idx) postings.push(idx);
        }
      }
      else {
        const valueKey = String(raw);
        let postings = byValue[valueKey];
        if (!postings) {
          postings = [];
          byValue[valueKey] = postings;
        }
        // Non-array path: idx strictly increases over items, so no dedup needed.
        postings.push(idx);
      }
    }
  }

  const facetIndex: InMemoryFacetIndex = {};
  for (const field of facetFields) {
    const byValue = transient[field];
    const out: Record<string, Uint32Array> = {};
    for (const valueKey in byValue) {
      out[valueKey] = new Uint32Array(byValue[valueKey]);
    }
    facetIndex[field] = out;
  }

  return facetIndex;
}

/**
 * Build a sorted posting list of indices where each indexable field is null/undefined.
 *
 * Covers facet, range, and alias fields — any field a user might reference in
 * `isNull`/`isNotNull` or in `equal: { field: [val, null] }`. Single-pass push
 * into `number[]`, converted to Uint32Array at the end. Already ascending
 * since items are visited in order.
 *
 * @internal
 */
export function buildNullIndex<T extends Record<string, unknown>>(
  items: T[],
  manifest: LyraManifest,
): InMemoryNullIndex {
  const indexable = manifest.fields.filter(
    (fld) => fld.kind === 'facet' || fld.kind === 'range' || fld.kind === 'alias',
  );

  const transient: Record<string, number[]> = {};
  for (const field of indexable) transient[field.name] = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx] as Record<string, unknown>;
    for (const field of indexable) {
      const value = item[field.name];
      if (value === null || value === undefined) transient[field.name].push(idx);
    }
  }

  const nullIndex: InMemoryNullIndex = {};
  for (const field of indexable) {
    nullIndex[field.name] = new Uint32Array(transient[field.name]);
  }

  return nullIndex;
}

/**
 * Build columnar Float64Array storage for range fields. One column per range
 * field, length = items.length. Entries are coerced once: numbers passthrough,
 * date strings via `Date.parse`, anything else → NaN. Range filtering then
 * reads numeric columns directly, no per-query property access or parsing.
 * @internal
 */
export function buildRangeColumns<T extends Record<string, unknown>>(
  items: T[],
  manifest: LyraManifest,
): RangeColumns {
  const rangeFields = manifest.fields.filter((fld) => fld.kind === 'range');
  const columns: RangeColumns = {};

  for (const field of rangeFields) {
    const col = new Float64Array(items.length);
    const fieldName = field.name;
    const fieldType = field.type;

    for (let idx = 0; idx < items.length; idx++) {
      const raw = items[idx][fieldName];
      if (raw == null) {
        col[idx] = Number.NaN;
        continue;
      }
      if (typeof raw === 'number') {
        col[idx] = raw;
        continue;
      }
      if (fieldType === 'date') {
        const parsed = Date.parse(String(raw));
        col[idx] = Number.isNaN(parsed) ? Number.NaN : parsed;
        continue;
      }
      if (fieldType === 'number') {
        const parsed = Number(raw);
        col[idx] = Number.isNaN(parsed) ? Number.NaN : parsed;
        continue;
      }
      col[idx] = Number.NaN;
    }

    columns[fieldName] = col;
  }

  return columns;
}

/**
 * Auto-generate alias lookup tables by scanning items for alias/target pairs.
 * @internal
 */
export function buildLookupTablesFromData<T>(
  items: T[],
  aliases: Record<string, string>,
): Record<string, LookupTable> {
  const lookups: Record<string, LookupTable> = {};

  for (const [aliasField, targetField] of Object.entries(aliases)) {
    const aliasToIds: Record<string, Set<string>> = {};
    const idToAliases: Record<string, Set<string>> = {};
    let foundPairs = 0;
    let missingAlias = 0;
    let missingTarget = 0;
    let arrayValuesSkipped = 0;

    for (const item of items) {
      const aliasValue = (item as Record<string, unknown>)[aliasField];
      const targetValue = (item as Record<string, unknown>)[targetField];

      if (Array.isArray(aliasValue)) {
        arrayValuesSkipped++;
        // eslint-disable-next-line no-console
        console.warn(
          `Alias field '${aliasField}' has array value in item, skipping. Array values not supported for alias fields.`,
        );
        continue;
      }
      if (Array.isArray(targetValue)) {
        arrayValuesSkipped++;
        // eslint-disable-next-line no-console
        console.warn(
          `Target field '${targetField}' has array value in item, skipping. Array values not supported for alias target fields.`,
        );
        continue;
      }

      if (aliasValue == null) missingAlias++;
      if (targetValue == null) missingTarget++;
      if (aliasValue == null || targetValue == null) continue;

      const aliasKey = String(aliasValue);
      const targetId = String(targetValue);

      (aliasToIds[aliasKey] ??= new Set()).add(targetId);
      (idToAliases[targetId] ??= new Set()).add(aliasKey);
      foundPairs++;
    }

    if (foundPairs === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `Alias '${aliasField}' → '${targetField}': No valid pairs found. This alias will not work in queries. (${missingAlias} missing alias, ${missingTarget} missing target, ${arrayValuesSkipped} array values skipped)`,
      );
    }
    else if (missingAlias > 0 || missingTarget > 0 || arrayValuesSkipped > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `Alias '${aliasField}' → '${targetField}': Found ${foundPairs} valid pairs, but ${missingAlias} missing alias, ${missingTarget} missing target, ${arrayValuesSkipped} array values skipped.`,
      );
    }

    lookups[aliasField] = {
      aliasToIds: Object.fromEntries(
        Object.entries(aliasToIds).map(([key, valueSet]) => [key, Array.from(valueSet)]),
      ),
      idToAliases: Object.fromEntries(
        Object.entries(idToAliases).map(([key, valueSet]) => [key, Array.from(valueSet)]),
      ),
    };
  }

  return lookups;
}
