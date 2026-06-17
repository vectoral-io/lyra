import type { LyraManifest } from './types';
/**
 * Look up alias values for a single canonical ID.
 *
 * @param manifest - Bundle manifest (must include alias lookups).
 * @param aliasField - The alias field name (e.g. `'zone_name'`).
 * @param canonicalId - The canonical ID value.
 * @returns Array of alias values, empty if none.
 */
export declare function getAliasValues(manifest: LyraManifest, aliasField: string, canonicalId: string | number): string[];
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
export declare function enrichItems<T extends Record<string, unknown>>(items: T[], aliasFields: string[], manifest: LyraManifest): Array<T & Record<string, string[]>>;
//# sourceMappingURL=aliases.d.ts.map