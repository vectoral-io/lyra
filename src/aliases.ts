import type { LyraManifest } from './types';

/**
 * Look up alias values for a single canonical ID.
 *
 * @param manifest - Bundle manifest (must include alias lookups).
 * @param aliasField - The alias field name (e.g. `'zone_name'`).
 * @param canonicalId - The canonical ID value.
 * @returns Array of alias values, empty if none.
 */
export function getAliasValues(
  manifest: LyraManifest,
  aliasField: string,
  canonicalId: string | number,
): string[] {
  const lookup = manifest.lookups?.[aliasField];
  if (!lookup?.idToAliases) return [];
  return lookup.idToAliases[String(canonicalId)] ?? [];
}

/**
 * Enrich items in-place with alias fields by batch-looking up canonical IDs.
 *
 * Deduplicates IDs per field so a result of N items only triggers K lookups (K = unique IDs).
 * Handles array-valued canonical fields (many-to-many).
 *
 * Unknown alias fields are silently skipped; items without a canonical value are left as-is.
 *
 * @param items - Items from a query result.
 * @param aliasFields - Alias field names to enrich.
 * @param manifest - Bundle manifest (must include alias lookups).
 * @returns New item objects with alias fields populated.
 */
export function enrichItems<T extends Record<string, unknown>>(
  items: T[],
  aliasFields: string[],
  manifest: LyraManifest,
): Array<T & Record<string, string[]>> {
  // Resolve alias field → target field once.
  const targets = new Map<string, string>();
  for (const aliasField of aliasFields) {
    const def = manifest.fields.find((field) => field.name === aliasField);
    if (def?.kind === 'alias' && def.aliasTarget) {
      targets.set(aliasField, def.aliasTarget);
    }
  }

  if (targets.size === 0) {
    return items.map((item) => ({ ...item })) as Array<T & Record<string, string[]>>;
  }

  // Gather unique canonical IDs per alias field.
  const uniqueIds = new Map<string, Set<string | number>>();
  for (const [aliasField, target] of targets) {
    const ids = new Set<string | number>();
    for (const item of items) {
      const raw = (item as Record<string, unknown>)[target];
      if (raw == null) continue;
      if (Array.isArray(raw)) {
        for (const value of raw) {
          if (value != null) ids.add(value as string | number);
        }
      }
      else {
        ids.add(raw as string | number);
      }
    }
    uniqueIds.set(aliasField, ids);
  }

  // Batch look up aliases for each unique ID.
  const aliasMaps = new Map<string, Map<string, string[]>>();
  for (const [aliasField, ids] of uniqueIds) {
    const lookup = manifest.lookups?.[aliasField];
    const map = new Map<string, string[]>();
    if (lookup?.idToAliases) {
      for (const id of ids) {
        const aliases = lookup.idToAliases[String(id)];
        if (aliases) map.set(String(id), aliases);
      }
    }
    aliasMaps.set(aliasField, map);
  }

  // Enrich each item.
  return items.map((item) => {
    const enriched = { ...item } as Record<string, unknown>;
    for (const [aliasField, target] of targets) {
      const raw = (item as Record<string, unknown>)[target];
      if (raw == null) continue;
      const map = aliasMaps.get(aliasField)!;

      if (Array.isArray(raw)) {
        const collected = new Set<string>();
        for (const value of raw) {
          if (value == null) continue;
          const aliases = map.get(String(value));
          if (aliases) for (const alias of aliases) collected.add(alias);
        }
        if (collected.size > 0) enriched[aliasField] = Array.from(collected);
      }
      else {
        const aliases = map.get(String(raw));
        if (aliases) enriched[aliasField] = aliases;
      }
    }
    return enriched as T & Record<string, string[]>;
  });
}
