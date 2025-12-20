import type {
  CreateBundleConfig,
  FacetPostingLists,
  FieldKind,
  FieldType,
  LookupTable,
  LyraManifest,
} from '../types';

// Implementation
// ==============================

/**
 * Build a manifest from bundle configuration.
 * @internal
 */
export function buildManifest<TItem extends Record<string, unknown>>(
  config: CreateBundleConfig<TItem>,
): LyraManifest {
  const builtAt = new Date().toISOString();

  const VALID_KINDS: FieldKind[] = ['id', 'facet', 'range', 'meta', 'alias'];
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

      // For alias fields, validate targetField is provided
      if (cfg.kind === 'alias' && !cfg.targetField) {
        throw new Error(`Alias field "${name}" must specify targetField`);
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
        aliasTarget: cfg.kind === 'alias' ? cfg.targetField : undefined,
      };
    });

  // Validate that at least one field is defined
  if (fields.length === 0) {
    throw new Error('Invalid bundle: fields array must not be empty');
  }

  // Separate canonical facets from aliases
  const canonicalFacets = fields
    .filter((field) => field.kind === 'facet')
    .map((field) => field.name);
  const aliasFields = fields
    .filter((field) => field.kind === 'alias')
    .map((field) => field.name);

  // Validate alias targets exist and are facets/ranges
  for (const field of fields) {
    if (field.kind === 'alias' && field.aliasTarget) {
      const targetField = fields.find(fieldDef => fieldDef.name === field.aliasTarget);
      if (!targetField) {
        throw new Error(
          `Alias field "${field.name}" targets non-existent field "${field.aliasTarget}"`,
        );
      }
      if (targetField.kind !== 'facet' && targetField.kind !== 'range') {
        throw new Error(
          `Alias field "${field.name}" must target a facet or range field, not "${targetField.kind}"`,
        );
      }
    }
  }

  return {
    version: '2.0.0',
    datasetId: config.datasetId,
    builtAt,
    fields,
    capabilities: {
      facets: canonicalFacets,
      ranges: fields
        .filter((field) => field.kind === 'range')
        .map((field) => field.name),
      aliases: aliasFields.length > 0 ? aliasFields : undefined,
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

/**
 * Auto-generate lookup tables from item data by scanning for alias/target field pairs.
 * Called during bundle creation when aliases are declared.
 * @internal
 */
export function buildLookupTablesFromData<T>(
  items: T[],
  aliases: Record<string, string>, // aliasField → targetField
  _manifest: LyraManifest,
): Record<string, LookupTable> {
  const lookups: Record<string, LookupTable> = {};
  
  for (const [aliasField, targetField] of Object.entries(aliases)) {
    const aliasToIds: Record<string, Set<string>> = {};
    const idToAliases: Record<string, Set<string>> = {};
    let foundPairs = 0;
    let missingAlias = 0;
    let missingTarget = 0;
    let arrayValuesSkipped = 0;
    
    // Scan all items for alias/target pairs
    for (const item of items) {
      const aliasValue = (item as any)[aliasField];
      const targetValue = (item as any)[targetField];
      
      // Validate: no array values allowed
      if (Array.isArray(aliasValue)) {
        arrayValuesSkipped++;
        // eslint-disable-next-line no-console
        console.warn(
          `Alias field '${aliasField}' has array value in item, skipping. ` +
          'Array values not supported for alias fields.',
        );
        continue;
      }
      if (Array.isArray(targetValue)) {
        arrayValuesSkipped++;
        // eslint-disable-next-line no-console
        console.warn(
          `Target field '${targetField}' has array value in item, skipping. ` +
          'Array values not supported for alias target fields.',
        );
        continue;
      }
      
      // Track missing fields for warning
      if (aliasValue == null) missingAlias++;
      if (targetValue == null) missingTarget++;
      
      // Skip if either is missing/null
      if (aliasValue == null || targetValue == null) continue;
      
      const aliasKey = String(aliasValue);
      const targetId = String(targetValue);
      
      // Build bidirectional mapping
      if (!aliasToIds[aliasKey]) {
        aliasToIds[aliasKey] = new Set();
      }
      aliasToIds[aliasKey].add(targetId);
      
      if (!idToAliases[targetId]) {
        idToAliases[targetId] = new Set();
      }
      idToAliases[targetId].add(aliasKey);
      
      foundPairs++;
    }
    
    // Warn if we couldn't build a complete lookup table
    if (foundPairs === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `Alias '${aliasField}' → '${targetField}': No valid pairs found. ` +
        'This alias will not work in queries. ' +
        `(${missingAlias} missing alias, ${missingTarget} missing target, ` +
        `${arrayValuesSkipped} array values skipped)`,
      );
    }
    else if (missingAlias > 0 || missingTarget > 0 || arrayValuesSkipped > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `Alias '${aliasField}' → '${targetField}': Found ${foundPairs} valid pairs, ` +
        `but ${missingAlias} missing alias, ${missingTarget} missing target, ` +
        `${arrayValuesSkipped} array values skipped.`,
      );
    }
    
    // Convert Sets to arrays
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

/**
 * Filter items to include/exclude specific fields.
 * Protected fields (id, facets, ranges) are always included.
 * Alias fields are always excluded.
 * @internal
 */
export function filterItemFields<T extends Record<string, unknown>>(
  items: T[],
  options: {
    includeFields?: string[];
    excludeFields?: string[];
    protectedFields: string[]; // id, facets, ranges
    aliasFields: string[];
  },
): T[] {
  const { includeFields, excludeFields, protectedFields, aliasFields } = options;
  
  // Always exclude alias fields
  const fieldsToExclude = new Set(aliasFields);
  if (excludeFields) {
    for (const field of excludeFields) {
      // Don't exclude protected fields even if they're in excludeFields
      if (!protectedFields.includes(field)) {
        fieldsToExclude.add(field);
      }
    }
  }
  
  // Determine which fields to keep
  const fieldsToKeep = new Set<string>();
  
  // Always include protected fields
  for (const field of protectedFields) {
    fieldsToKeep.add(field);
  }
  
  if (includeFields) {
    // Include mode: only includeFields + protected fields
    for (const field of includeFields) {
      // Only add if not excluded (excludeFields takes precedence)
      if (!fieldsToExclude.has(field)) {
        fieldsToKeep.add(field);
      }
    }
  }
  
  return items.map(item => {
    const filtered: Record<string, unknown> = {};
    
    if (includeFields) {
      // Include mode: only specified fields (protected fields already in set)
      for (const field of fieldsToKeep) {
        if (item[field] !== undefined) {
          filtered[field] = item[field];
        }
      }
    } else {
      // Default mode: include all except excluded
      for (const [key, value] of Object.entries(item)) {
        if (!fieldsToExclude.has(key)) {
          filtered[key] = value;
        }
      }
    }
    
    return filtered as T;
  });
}

