# Errors & guarantees

Lyra is **fail-closed**: at query time, bad input means empty results, never an exception. Build and load validate up front and throw on structurally broken bundles. The split is deliberate — you find config mistakes when you build, and a typo in a live query degrades to "no matches" instead of crashing a request.

## What throws

### `createBundle`

| Cause | Message |
|---|---|
| `kind` not `id`/`facet`/`range`/`meta`/`alias` | `Invalid field kind "foo" for field "status". …` |
| `type` not `string`/`number`/`boolean`/`date` | `Invalid field type "foo" for field "status". …` |
| Range field (simple config) holds a value that's neither number nor parseable date | `Cannot infer range type for field "createdAt". …` |

A configured field that exists on no item doesn't throw — it warns once and is otherwise ignored (present in the manifest, no indexed values).

### `LyraBundle.load` / `loadBinary`

Throws on a bundle that can't be trusted:

- Missing `manifest` or `items` → `Invalid bundle JSON: missing manifest or items`
- Version not starting `"3."` or `"4."` → `Invalid bundle version: "2.0.0". Expected version starting with "3." or "4."`
- `capabilities` names a field that isn't in `fields` → `… capability references non-existent facet field "status"`
- `facetIndex` keys a field that isn't in `capabilities.facets` → `… facetIndex contains field "priority" that is not in capabilities.facets`
- Binary buffer with a bad `LYRA4` magic, oversized header, or out-of-bounds block offsets

A facet declared in `capabilities` but absent from `facetIndex` is fine — it initializes empty, and queries on it return nothing. That's the valid state for a field where every value is null. The [bundle spec](./bundle-json-spec.md#error-cases) lists every binary-format error.

## What fails closed (query)

`query` normalizes instead of throwing:

| Input | Result |
|---|---|
| Unknown `equal` / `ranges` field | `total: 0`, `items: []` — the unknown field stays in `applied` |
| Negative `offset` | clamped to `0` |
| Negative `limit` | `0` items returned; `total` still counts all matches |
| `limit` larger than the match count | clamped to what's available |

Unknown fields failing closed is the point: a mistyped facet name returns nothing rather than silently dropping the filter and over-returning. Check `total === 0` to catch it.

Bad *types* in a query (an object where a scalar belongs) are out of scope — pass structurally valid `LyraQuery` shapes; TypeScript covers this.

## Guarantees

- **Deterministic.** Same bundle + same query → same result. No randomness, no time-dependence.
- **Immutable.** Querying never mutates the bundle or anything else. Every query against a bundle sees one consistent snapshot.
- **Inclusive ranges.** `min`/`max` bounds include the endpoints. Dates are epoch ms (or strings via `Date.parse()`); unparseable values drop out.
- **Null handling.** `null`/`undefined` are excluded from the facet index and from range results. They're tracked separately so `isNull` and `equal: { f: [v, null] }` stay fast.
- **Multi-valued facets.** An array facet value matches if *any* element matches.
