[@vectoral/lyra](../README.md) / FieldDefinition

# Type Alias: FieldDefinition

```ts
type FieldDefinition = 
  | {
  kind: "id";
  type: FieldType;
}
  | {
  kind: "facet";
  type: FieldType;
}
  | {
  kind: "range";
  type: Extract<FieldType, "number" | "date">;
}
  | {
  kind: "meta";
  type: FieldType;
}
  | {
  kind: "alias";
  targetField: string;
  type: FieldType;
};
```

Defined in: [types.ts:240](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L240)

Definition of a single field when creating a bundle.

A discriminated union on `kind` so invalid combinations can't be expressed:
only `alias` carries (and requires) a `targetField`, and a `range` field must
be numeric or date. `{ kind: 'range', type: 'string' }` and an alias without a
target no longer compile.

## Union Members

### Type Literal

```ts
{
  kind: "id";
  type: FieldType;
}
```

***

### Type Literal

```ts
{
  kind: "facet";
  type: FieldType;
}
```

***

### Type Literal

```ts
{
  kind: "range";
  type: Extract<FieldType, "number" | "date">;
}
```

***

### Type Literal

```ts
{
  kind: "meta";
  type: FieldType;
}
```

***

### Type Literal

```ts
{
  kind: "alias";
  targetField: string;
  type: FieldType;
}
```

| Name | Type | Description | Defined in |
| ------ | ------ | ------ | ------ |
| `kind` | `"alias"` | - | [types.ts:246](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L246) |
| `targetField` | `string` | The canonical field this alias resolves to. Example: if `zone_name` is an alias for `zone_id`, then `targetField = 'zone_id'`. | [types.ts:252](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L252) |
| `type` | [`FieldType`](FieldType.md) | - | [types.ts:247](https://github.com/vectoral-io/lyra/blob/main/src/types.ts#L247) |
