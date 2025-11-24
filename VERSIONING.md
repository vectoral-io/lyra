# Versioning

Lyra uses two distinct version numbers:

## NPM Package Version

The **NPM package version** (in `package.json`) tracks the library code version. This follows semantic versioning (MAJOR.MINOR.PATCH) and indicates:

- **MAJOR**: Breaking changes to the public API
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, backward compatible

## Bundle Format Version

The **bundle format version** (in `manifest.version`) tracks the bundle JSON format version. This is independent of the NPM package version.

### Version 1.x

- All bundle JSONs with `manifest.version` starting with `"1."` are supported by Lyra 1.x
- The format is stable within v1 (e.g., `1.0.0`, `1.1.0`, `1.2.3` are all compatible)
- Format changes within v1 are additive only (new optional fields, etc.)

### Future Versions

- Breaking changes to the bundle format will bump `manifest.version` to `"2.0.0"`
- Lyra 1.x will not parse bundles with `manifest.version` starting with `"2."`
- When v2 is introduced, v1 bundles will continue to be supported by Lyra 2.x (backward compatibility)

## Compatibility Matrix

| Lyra Package Version | Supported Bundle Versions |
|---------------------|---------------------------|
| 1.x                  | 1.x                       |
| 2.x                  | 1.x, 2.x                  |

## Migration Notes

- **Upgrading Lyra package**: Generally safe within the same major version
- **Bundle format changes**: Breaking format changes require updating both the producer (bundle builder) and consumer (bundle loader) to compatible versions
- **Version format**: Bundle `manifest.version` uses semantic versioning (`MAJOR.MINOR.PATCH`)

