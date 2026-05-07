# Versioning

Lyra uses two distinct version numbers:

## NPM Package Version

The **NPM package version** (in `package.json`) tracks the library code version. SemVer (MAJOR.MINOR.PATCH):

- **MAJOR**: Breaking changes to the public API.
- **MINOR**: New features, backward compatible.
- **PATCH**: Bug fixes, backward compatible.

**Current version:** `4.1.0`.

## Bundle Format Version

The **bundle format version** (in `manifest.version`) tracks the on-the-wire bundle format and is independent of the NPM package version.

### Format families

- **v3.x — JSON.** Portable, human-readable, debuggable. v3.1 added optional binary-encoded payload fields (`rangeColumns`, `facetIndexBin`, `nullIndexBin`); v3.0 readers ignore them.
- **v4.x — Binary container.** New in Lyra 4.0. Magic bytes `LYRA4`, header JSON, then aligned blocks. v4.1 introduced columnar items inside the container (default).

Both families coexist: a Lyra 4.x reader accepts both v3 JSON and v4 binary inputs through `LyraBundle.load(...)` (autodetects on `Uint8Array` + magic). The v3 JSON path is supported indefinitely.

### Validation

`LyraBundle.load` validates `manifest.version` starts with `"3."` or `"4."`. Anything else is rejected at load with a clear error.

### Compatibility matrix

| Lyra Package Version | Supports JSON v3.x | Supports binary v4.x | Default `BUNDLE_VERSION` emitted |
|---|---|---|---|
| 3.0.x | ✅ | ❌ | `3.0.0` |
| 3.1.x | ✅ (with v3.1 fast paths) | ❌ | `3.1.0` |
| 4.0.x | ✅ | ✅ (row-form items only) | `4.0.0` |
| 4.1.x | ✅ | ✅ (row + columnar items) | `4.1.0` |

| Reader \ Producer | v3.0 | v3.1 | v4.0 | v4.1 |
|---|---|---|---|---|
| v3.0 reader | ✅ | ✅ (ignores new fields) | ❌ (magic mismatch) | ❌ |
| v3.1 reader | ✅ | ✅ | ❌ (magic mismatch) | ❌ |
| v4.0 reader | ✅ | ✅ | ✅ | ❌ (unknown items.encoding) |
| v4.1 reader | ✅ | ✅ | ✅ | ✅ |

## Migration notes

- **Upgrading Lyra package within the same major** is generally safe (additive only).
- **Cross-major upgrades** for bundle format require both producer and consumer to be on a compatible version. v4 readers consume v3 JSON, but v3 readers cannot consume v4 binary.
- See `docs/migration-v4.md` for the v3 → v4 walkthrough and `docs/migration-v3.md` for v2 → v3.
