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
import { encodeFacetKey } from '../query/facet-key';
import type { ItemStore } from './item-store';

/**
 * Current bundle format version. v4.1 introduces columnar items inside the v4
 * binary container (dictionary-encoded strings, raw f64 numbers, packed bits
 * for booleans, JSON fallback for arrays/objects). v3.x JSON remains readable
 * indefinitely for portability and debugging.
 */
export const BUNDLE_VERSION = '4.1.0';

/**
 * Bundle major versions this build can load. The current major is derived from
 * `BUNDLE_VERSION`; `'3'` is the legacy JSON major we still read. Co-located
 * with `BUNDLE_VERSION` so bumping the format only touches one place.
 */
const SUPPORTED_MAJORS: ReadonlySet<string> = new Set(['3', BUNDLE_VERSION.split('.')[0]]);

const VALID_KINDS: readonly FieldKind[] = ['id', 'facet', 'range', 'meta', 'alias'];
const VALID_TYPES: readonly FieldType[] = ['string', 'number', 'boolean', 'date'];

type FieldOps = Array<'eq' | 'in' | 'between' | 'gte' | 'lte'>;

/**
 * The query operators a field kind supports. Derived from `kind` (the single
 * owner of "what is queryable"): id/meta fields are not queryable and get no
 * ops. Kept as one function so the manifest can't disagree with itself.
 * @internal
 */
function opsForKind(kind: FieldKind): FieldOps {
  switch (kind) {
    case 'range':
      return ['between', 'gte', 'lte'];
    case 'facet':
    case 'alias':
      return ['eq', 'in'];
    default:
      return []; // id, meta: not queryable
  }
}

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

      return {
        name,
        kind: cfg.kind,
        type: cfg.type,
        ops: opsForKind(cfg.kind),
        aliasTarget: cfg.kind === 'alias' ? cfg.targetField : undefined,
      };
    });

  if (fields.length === 0) {
    throw new Error('Invalid bundle: fields array must not be empty');
  }

  // Alias targets, capability cross-references, and the kind<->capability
  // bijection are all validated by validateManifest below (single owner).
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
  if (!SUPPORTED_MAJORS.has(major)) {
    throw new Error(
      `Invalid bundle version: "${manifest.version}". Supported majors: ${[...SUPPORTED_MAJORS].join(', ')}`,
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

  // The reverse direction: capabilities must be the exact projection of field
  // kinds. A facet/range/alias field omitted from capabilities would validate
  // yet be silently unqueryable, so assert the bijection and keep `kind` the
  // single owner of "what is queryable".
  assertCapabilityCovers(manifest, 'facet', manifest.capabilities.facets, 'facets');
  assertCapabilityCovers(manifest, 'range', manifest.capabilities.ranges, 'ranges');
  assertCapabilityCovers(manifest, 'alias', manifest.capabilities.aliases ?? [], 'aliases');
}

/**
 * Validate a fully-decoded bundle's index structures against its manifest and
 * item count. Shared by both the JSON and binary load paths so the rules live
 * in one place: manifest consistency, the facet-field allow-list, and — the
 * part that matters for untrusted input — every posting index is in
 * `[0, itemCount)`. An out-of-range posting would otherwise index past the item
 * store at query time and throw deep in the pipeline; reject it at the door.
 *
 * @internal
 */
export function validateDecodedBundle(
  manifest: LyraManifest,
  itemCount: number,
  facetIndex: InMemoryFacetIndex,
  nullIndex: InMemoryNullIndex,
): void {
  validateManifest(manifest);

  const declaredFacets = new Set(manifest.capabilities.facets);
  for (const field of Object.keys(facetIndex)) {
    if (!declaredFacets.has(field)) {
      throw new Error(
        `Invalid bundle: facetIndex contains field "${field}" that is not in capabilities.facets`,
      );
    }
    const byValue = facetIndex[field];
    for (const valueKey of Object.keys(byValue)) {
      assertPostingsInRange(byValue[valueKey], itemCount, `facetIndex["${field}"]["${valueKey}"]`);
    }
  }

  for (const field of Object.keys(nullIndex)) {
    assertPostingsInRange(nullIndex[field], itemCount, `nullIndex["${field}"]`);
  }
}

function assertPostingsInRange(postings: Uint32Array, itemCount: number, context: string): void {
  for (let i = 0; i < postings.length; i++) {
    if (postings[i] >= itemCount) {
      throw new Error(
        `Invalid bundle: ${context} posting index ${postings[i]} out of range [0, ${itemCount})`,
      );
    }
  }
}

function assertCapabilityCovers(
  manifest: LyraManifest,
  kind: FieldKind,
  capability: string[],
  label: string,
): void {
  const declared = new Set(capability);
  for (const field of manifest.fields) {
    if (field.kind === kind && !declared.has(field.name)) {
      throw new Error(
        `Invalid bundle: field "${field.name}" has kind "${kind}" but is missing from capabilities.${label}`,
      );
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
  // Null-prototype maps throughout: a facet value (or field name) that stringifies
  // to "__proto__" / "constructor" / "toString" must be an own data key, not a
  // collision with an inherited method (which would make `byValue[key]` return a
  // function and corrupt indexing). Mirrors the load path's hardening.
  const transient: Record<string, Record<string, number[]>> = Object.create(null);
  for (const field of facetFields) transient[field] = Object.create(null);

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx] as Record<string, unknown>;
    for (const field of facetFields) {
      const raw = item[field];
      if (raw === undefined || raw === null) continue;

      const byValue = transient[field];
      if (Array.isArray(raw)) {
        for (const value of raw) {
          const valueKey = encodeFacetKey(value);
          let postings = byValue[valueKey];
          if (!postings) {
            postings = [];
            byValue[valueKey] = postings;
          }
          if (postings[postings.length - 1] !== idx) postings.push(idx);
        }
      }
      else {
        const valueKey = encodeFacetKey(raw);
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

  const facetIndex: InMemoryFacetIndex = Object.create(null);
  for (const field of facetFields) {
    const byValue = transient[field];
    const out: Record<string, Uint32Array> = Object.create(null);
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

  const transient: Record<string, number[]> = Object.create(null);
  for (const field of indexable) transient[field.name] = [];

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx] as Record<string, unknown>;
    for (const field of indexable) {
      const value = item[field.name];
      if (value === null || value === undefined) transient[field.name].push(idx);
    }
  }

  const nullIndex: InMemoryNullIndex = Object.create(null);
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
  source: ItemStore<T>,
  manifest: LyraManifest,
): RangeColumns {
  const rangeFields = manifest.fields.filter((fld) => fld.kind === 'range');
  const columns: RangeColumns = {};

  const length = source.length;

  for (const field of rangeFields) {
    const col = new Float64Array(length);
    const fieldName = field.name;
    const fieldType = field.type;

    for (let idx = 0; idx < length; idx++) {
      const raw = source.getField(idx, fieldName);
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
    // Null-prototype maps: alias/target values are item data and may stringify to
    // "__proto__" / "constructor" / "toString"; keep them own data keys.
    const aliasToIds: Record<string, Set<string>> = Object.create(null);
    const idToAliases: Record<string, Set<string>> = Object.create(null);
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
      aliasToIds: setMapToArrayMap(aliasToIds),
      idToAliases: setMapToArrayMap(idToAliases),
    };
  }

  return lookups;
}

/** Freeze a `Record<string, Set>` into a null-prototype `Record<string, string[]>`. */
function setMapToArrayMap(source: Record<string, Set<string>>): Record<string, string[]> {
  const out: Record<string, string[]> = Object.create(null);
  for (const key in source) out[key] = Array.from(source[key]);
  return out;
}
