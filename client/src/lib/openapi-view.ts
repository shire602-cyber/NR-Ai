/**
 * Turns the served OpenAPI 3.1 document into a plain view model for the docs
 * page: operations grouped by tag, flattened field tables, a curl example.
 * No rendering here, so it is unit tested without a DOM.
 */

type Json = Record<string, any>;

export interface FieldRow {
  path: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ParamRow {
  name: string;
  in: string;
  required: boolean;
  type: string;
  description: string;
}

export interface OperationView {
  id: string;
  method: string;
  path: string;
  summary: string;
  tag: string;
  scope: string | null;
  params: ParamRow[];
  bodyFields: FieldRow[];
  responseFields: FieldRow[];
  isList: boolean;
  needsIdempotencyKey: boolean;
  curl: string;
}

export interface TagGroup {
  tag: string;
  operations: OperationView[];
}

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"];
const MAX_DEPTH = 3;

/** "string", "string (uuid)", "array of object", "string | null" ... */
export function describeType(schema: Json | undefined): string {
  if (!schema || typeof schema !== "object") return "any";
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const union: Json[] | undefined = schema.anyOf ?? schema.oneOf;
  if (union) {
    const parts = union.map(describeType);
    return Array.from(new Set(parts)).join(" | ");
  }
  if (Array.isArray(schema.enum)) return schema.enum.map((v: unknown) => JSON.stringify(v)).join(" | ");
  const type = Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
  if (type === "array") return `array of ${describeType(schema.items)}`;
  if (type === "string" && schema.format) return `string (${schema.format})`;
  return type ?? (schema.properties ? "object" : "any");
}

function nonNull(schema: Json): Json {
  const union: Json[] | undefined = schema.anyOf ?? schema.oneOf;
  if (!union) return schema;
  return union.find((s) => s.type !== "null") ?? schema;
}

/** Flatten an object schema to rows like `lines[].unitPrice`. */
export function flattenSchema(schema: Json | undefined, prefix = "", depth = 0): FieldRow[] {
  if (!schema) return [];
  const s = nonNull(schema);
  const rows: FieldRow[] = [];
  const props: Json = s.properties ?? {};
  const required = new Set<string>(Array.isArray(s.required) ? s.required : []);
  for (const [name, raw] of Object.entries<Json>(props)) {
    const path = prefix ? `${prefix}.${name}` : name;
    rows.push({ path, type: describeType(raw), required: required.has(name), description: String(raw.description ?? "") });
    if (depth + 1 >= MAX_DEPTH) continue;
    const inner = nonNull(raw);
    if (inner.type === "array" && inner.items && nonNull(inner.items).properties) {
      rows.push(...flattenSchema(inner.items, `${path}[]`, depth + 1));
    } else if (inner.properties) {
      rows.push(...flattenSchema(inner, path, depth + 1));
    }
  }
  return rows;
}

function jsonSchemaOf(content: Json | undefined): Json | undefined {
  return content?.["application/json"]?.schema;
}

/** The `data` member of the success envelope (the array's items for a list). */
function responseData(op: Json): { schema: Json | undefined; isList: boolean } {
  const success = Object.entries<Json>(op.responses ?? {}).find(([code]) => code.startsWith("2"))?.[1];
  const envelope = jsonSchemaOf(success?.content);
  const data = envelope?.properties?.data as Json | undefined;
  if (!data) return { schema: undefined, isList: false };
  if (data.type === "array") return { schema: data.items, isList: true };
  return { schema: data, isList: false };
}

function exampleValue(schema: Json | undefined): unknown {
  if (!schema) return null;
  const s = nonNull(schema);
  if (s.example !== undefined) return s.example;
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.enum)) return s.enum[0];
  const type = Array.isArray(s.type) ? s.type.find((t: string) => t !== "null") : s.type;
  if (type === "object" || s.properties) {
    const out: Record<string, unknown> = {};
    const required = new Set<string>(Array.isArray(s.required) ? s.required : []);
    for (const [k, v] of Object.entries<Json>(s.properties ?? {})) if (required.has(k)) out[k] = exampleValue(v);
    return out;
  }
  if (type === "array") return [exampleValue(s.items)];
  if (type === "number" || type === "integer") return 1;
  if (type === "boolean") return true;
  if (s.format === "uuid") return "00000000-0000-4000-8000-000000000000";
  if (s.format === "date") return "2026-01-31";
  return "string";
}

export function buildCurl(baseUrl: string, method: string, path: string, params: ParamRow[], body: Json | undefined): string {
  const url = `${baseUrl.replace(/\/$/, "")}${path.replace(/\{(\w+)\}/g, "<$1>")}`;
  const lines = [`curl -X ${method.toUpperCase()} "${url}"`, `  -H "Authorization: Bearer $MUHASIB_API_KEY"`];
  if (params.some((p) => p.in === "header" && p.name === "Idempotency-Key")) lines.push(`  -H "Idempotency-Key: $(uuidgen)"`);
  if (body) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${JSON.stringify(exampleValue(body))}'`);
  }
  return lines.join(" \\\n");
}

export function buildOperations(spec: Json, baseUrl: string): OperationView[] {
  const out: OperationView[] = [];
  for (const [path, item] of Object.entries<Json>(spec.paths ?? {})) {
    for (const method of METHOD_ORDER) {
      const op: Json | undefined = item[method];
      if (!op) continue;
      const params: ParamRow[] = (op.parameters ?? []).map((p: Json) => ({
        name: p.name,
        in: p.in,
        required: p.required === true,
        type: describeType(p.schema),
        description: String(p.description ?? ""),
      }));
      const body = jsonSchemaOf(op.requestBody?.content);
      const { schema, isList } = responseData(op);
      out.push({
        id: op.operationId ?? `${method}:${path}`,
        method,
        path,
        summary: String(op.summary ?? ""),
        tag: String(op.tags?.[0] ?? "Other"),
        scope: typeof op["x-required-scope"] === "string" ? op["x-required-scope"] : null,
        params,
        bodyFields: flattenSchema(body),
        responseFields: flattenSchema(schema),
        isList,
        needsIdempotencyKey: params.some((p) => p.name === "Idempotency-Key"),
        curl: buildCurl(baseUrl, method, path, params, body),
      });
    }
  }
  return out;
}

/** Operations grouped in the order the spec lists its tags. */
export function groupByTag(spec: Json, operations: OperationView[]): TagGroup[] {
  const order: string[] = (spec.tags ?? []).map((t: Json) => t.name);
  const groups = new Map<string, OperationView[]>();
  for (const tag of order) groups.set(tag, []);
  for (const op of operations) {
    if (!groups.has(op.tag)) groups.set(op.tag, []);
    groups.get(op.tag)!.push(op);
  }
  return Array.from(groups, ([tag, ops]) => ({ tag, operations: ops })).filter((g) => g.operations.length > 0);
}

export function matchesFilter(op: OperationView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [op.path, op.summary, op.method, op.scope ?? "", op.tag].some((v) => v.toLowerCase().includes(q));
}
