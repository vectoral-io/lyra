import type {
  CreateBundleConfig,
  FacetPostingLists,
  FieldKind,
  FieldType,
  LyraManifest,
} from '../types';


/**
 * Build a manifest from bundle configuration.
 * @internal
 */
export function buildManifest<TItem extends Record<string, unknown>>(
  config: CreateBundleConfig<TItem>,
): LyraManifest {
  const builtAt = new Date().toISOString();

  const VALID_KINDS: FieldKind[] = ['id', 'facet', 'range', 'meta'];
  const VALID_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date'];

  const fields = Object.entries(config.fields)
    .filter(([, cfg]) => cfg != null) // Filter out undefined entries
    .map(([name, cfg]) => {
      // cfg is guaranteed to be defined after filter
      if (!cfg) {
        throw new Error(`Field "${name}" has undefined configuration`);
      }

      // Validate kind
      if (!VALID_KINDS.includes(cfg.kind)) {
        throw new Error(
          `Invalid field kind "${cfg.kind}" for field "${name}". Must be one of: ${VALID_KINDS.join(', ')}`,
        );
      }

      // Validate type
      if (!VALID_TYPES.includes(cfg.type)) {
        throw new Error(
          `Invalid field type "${cfg.type}" for field "${name}". Must be one of: ${VALID_TYPES.join(', ')}`,
        );
      }

      return {
        name,
        kind: cfg.kind,
        type: cfg.type,
        ops: (
          cfg.kind === 'range'
            ? ['between', 'gte', 'lte']
            : ['eq', 'in']
        ) as Array<'eq' | 'in' | 'between' | 'gte' | 'lte'>,
      };
    });

  // Validate that at least one field is defined
  if (fields.length === 0) {
    throw new Error('Invalid bundle: fields array must not be empty');
  }

  return {
    version: '1.0.0',
    datasetId: config.datasetId,
    builtAt,
    fields,
    capabilities: {
      facets: fields
        .filter((field) => field.kind === 'facet')
        .map((field) => field.name),
      ranges: fields
        .filter((field) => field.kind === 'range')
        .map((field) => field.name),
    },
  };
}


/**
 * Build facet index from items and manifest.
 * @internal
 */
export function buildFacetIndex<T extends Record<string, unknown>>(
  items: T[],
  manifest: LyraManifest,
): FacetPostingLists {
  const facetFields = manifest.capabilities.facets;
  const facetIndex: FacetPostingLists = {};

  for (const field of facetFields) {
    facetIndex[field] = {};
  }

  items.forEach((item, idx) => {
    for (const field of facetFields) {
      const raw = (item as Record<string, unknown>)[field];
      if (raw === undefined || raw === null) continue;

      // For now treat non-array values as singletons
      const values = Array.isArray(raw) ? raw : [raw];

      for (const value of values) {
        const valueKey = String(value);
        const postingsForField = facetIndex[field];
        let postings = postingsForField[valueKey];
        if (!postings) {
          postings = [];
          postingsForField[valueKey] = postings;
        }
        postings.push(idx);
      }
    }
  });

  // Sort and deduplicate posting lists at build time
  for (const field of facetFields) {
    const postingsForField = facetIndex[field];
    for (const valueKey in postingsForField) {
      const postings = postingsForField[valueKey];
      // Sort ascending
      postings.sort((valueA, valueB) => valueA - valueB);
      // Deduplicate in-place (remove consecutive duplicates after sorting)
      let writeIndex = 0;
      for (let readIndex = 0; readIndex < postings.length; readIndex++) {
        if (readIndex === 0 || postings[readIndex] !== postings[readIndex - 1]) {
          postings[writeIndex] = postings[readIndex];
          writeIndex++;
        }
      }
      postings.length = writeIndex;
    }
  }

  return facetIndex;
}

