[@vectoral/lyra](../README.md) / createBundle

# Function: createBundle()

## Call Signature

```ts
function createBundle<T>(items, config): Promise<LyraBundle<T>>;
```

Defined in: [bundle.ts:57](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L57)

Create a bundle from items.

Overloads:
- Explicit config: full control over field kinds/types via `CreateBundleConfig`.
- Simple config: ergonomic `SimpleBundleConfig` that infers types from data.

### Type Parameters

| Type Parameter |
| ------ |
| `T` *extends* `Record`\<`string`, `unknown`\> |

### Parameters

| Parameter | Type |
| ------ | ------ |
| `items` | `T`[] |
| `config` | [`CreateBundleConfig`](../interfaces/CreateBundleConfig.md)\<`T`\> |

### Returns

`Promise`\<[`LyraBundle`](../classes/LyraBundle.md)\<`T`\>\>

## Call Signature

```ts
function createBundle<T>(items, config): Promise<LyraBundle<T>>;
```

Defined in: [bundle.ts:61](https://github.com/vectoral-io/lyra/blob/main/src/bundle.ts#L61)

Create a bundle from items.

Overloads:
- Explicit config: full control over field kinds/types via `CreateBundleConfig`.
- Simple config: ergonomic `SimpleBundleConfig` that infers types from data.

### Type Parameters

| Type Parameter |
| ------ |
| `T` *extends* `Record`\<`string`, `unknown`\> |

### Parameters

| Parameter | Type |
| ------ | ------ |
| `items` | `T`[] |
| `config` | [`SimpleBundleConfig`](../interfaces/SimpleBundleConfig.md)\<`T`\> |

### Returns

`Promise`\<[`LyraBundle`](../classes/LyraBundle.md)\<`T`\>\>
