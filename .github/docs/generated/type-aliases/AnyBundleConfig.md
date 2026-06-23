[@vectoral/lyra](../README.md) / AnyBundleConfig

# Type Alias: AnyBundleConfig\<TItem\>

```ts
type AnyBundleConfig<TItem> = 
  | CreateBundleConfig<TItem>
| SimpleBundleConfig<TItem>;
```

Defined in: [types.ts:347](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L347)

Union type representing either explicit or simple bundle configuration.
Used internally by `createBundle` to support both configuration styles.

## Type Parameters

| Type Parameter |
| ------ |
| `TItem` *extends* `Record`\<`string`, `unknown`\> |
