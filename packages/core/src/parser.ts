// ─── Types ───────────────────────────────────────────────────────────────────

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    securitySchemes?: Record<string, SecurityScheme>;
  };
}

export interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  patch?: Operation;
  delete?: Operation;
  options?: Operation;
  head?: Operation;
  trace?: Operation;
  parameters?: Parameter[];
}

export interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses: Record<string, Response>;
  tags?: string[];
  security?: SecurityRequirement[];
}

export interface Parameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required?: boolean;
  schema: SchemaObject;
  description?: string;
}

export interface RequestBody {
  required?: boolean;
  content: Record<string, { schema: SchemaObject }>;
}

export interface Response {
  description: string;
  content?: Record<string, { schema: SchemaObject }>;
}

export interface SchemaObject {
  type?: string;
  format?: string;
  properties?: Record<string, SchemaObject>;
  additionalProperties?: boolean | SchemaObject;
  items?: SchemaObject;
  required?: string[];
  enum?: unknown[];
  $ref?: string;
  description?: string;
  nullable?: boolean;
  default?: unknown;
  // composition
  allOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  // resolved metadata (set by parser, not present in raw spec)
  'x-schema-name'?: string;
}

export interface SecurityScheme {
  type: string;
  scheme?: string;
  bearerFormat?: string;
  flows?: OAuthFlows;
  in?: string;
  name?: string;
}

export interface OAuthFlows {
  implicit?: OAuthFlow;
  password?: OAuthFlow;
  clientCredentials?: OAuthFlow;
  authorizationCode?: OAuthFlow;
}

export interface OAuthFlow {
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes: Record<string, string>;
}

export type SecurityRequirement = Record<string, string[]>;

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;

export type HTTPMethod = typeof HTTP_METHODS[number];

// ─── Resolved model (output of schema resolution) ────────────────────────────

export interface ResolvedModel {
  name: string;
  schema: SchemaObject;
  /** Names of other models this one references */
  deps: string[];
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export class OpenAPIParser {
  private spec!: OpenAPISpec;

  parse(input: string | object): OpenAPISpec {
    const raw = typeof input === 'string' ? JSON.parse(input) : input;
    this.validate(raw);
    this.spec = raw as OpenAPISpec;
    return this.spec;
  }

  private validate(spec: unknown): void {
    if (!spec || typeof spec !== 'object') {
      throw new Error('Invalid OpenAPI spec: must be an object');
    }
    const s = spec as Record<string, unknown>;
    if (!s['openapi'] || !s['info'] || !s['paths']) {
      throw new Error('Invalid OpenAPI spec: missing required fields (openapi, info, paths)');
    }
  }

  // ── $ref resolution ────────────────────────────────────────────────────────

  /**
   * Resolve a JSON Pointer $ref within the spec document.
   * Only internal refs (#/...) are supported; external file refs are ignored.
   */
  resolveRef(ref: string): SchemaObject {
    if (!ref.startsWith('#/')) {
      throw new Error(`External $ref not supported: ${ref}`);
    }
    const parts = ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    let node: unknown = this.spec;
    for (const part of parts) {
      if (node == null || typeof node !== 'object') {
        throw new Error(`$ref path not found: ${ref} (failed at "${part}")`);
      }
      node = (node as Record<string, unknown>)[part];
    }
    if (node == null) throw new Error(`$ref resolved to null: ${ref}`);
    return node as SchemaObject;
  }

  /**
   * Fully resolve a schema, following $ref and merging allOf/oneOf/anyOf.
   * Returns a new schema object — does not mutate the spec.
   * Tracks visited refs to prevent infinite recursion.
   */
  resolveSchema(schema: SchemaObject, visited = new Set<string>()): SchemaObject {
    if (schema.$ref) {
      if (visited.has(schema.$ref)) {
        // Circular ref — return a placeholder to break the cycle
        return { type: 'object', description: `(circular ref: ${schema.$ref})` };
      }
      visited = new Set(visited).add(schema.$ref);
      const name = schema.$ref.split('/').pop()!;
      const resolved = this.resolveSchema(this.resolveRef(schema.$ref), visited);
      return { ...resolved, 'x-schema-name': resolved['x-schema-name'] ?? name };
    }

    // Merge allOf into a single object schema
    if (schema.allOf?.length) {
      const merged = this.mergeSchemas(schema.allOf.map((s) => this.resolveSchema(s, visited)));
      return this.resolveSchema({ ...merged, ...omit(schema, 'allOf') }, visited);
    }

    // oneOf / anyOf — keep the variants resolved but don't flatten
    if (schema.oneOf?.length) {
      return { ...schema, oneOf: schema.oneOf.map((s) => this.resolveSchema(s, visited)) };
    }
    if (schema.anyOf?.length) {
      return { ...schema, anyOf: schema.anyOf.map((s) => this.resolveSchema(s, visited)) };
    }

    // Recurse into properties and items
    const result: SchemaObject = { ...schema };
    if (result.properties) {
      result.properties = Object.fromEntries(
        Object.entries(result.properties).map(([k, v]) => [k, this.resolveSchema(v, visited)])
      );
    }
    if (result.items) {
      result.items = this.resolveSchema(result.items, visited);
    }
    if (result.additionalProperties && typeof result.additionalProperties === 'object') {
      result.additionalProperties = this.resolveSchema(result.additionalProperties, visited);
    }
    return result;
  }

  private mergeSchemas(schemas: SchemaObject[]): SchemaObject {
    const merged: SchemaObject = { type: 'object', properties: {}, required: [] };
    for (const s of schemas) {
      if (s.properties) Object.assign(merged.properties!, s.properties);
      if (s.required) merged.required!.push(...s.required);
      if (s.description && !merged.description) merged.description = s.description;
    }
    if (!merged.required!.length) delete merged.required;
    return merged;
  }

  // ── Model extraction ───────────────────────────────────────────────────────

  /**
   * Return all named schemas from components/schemas as resolved models,
   * topologically sorted so dependencies come before dependents.
   */
  getModels(): ResolvedModel[] {
    const schemas = this.spec.components?.schemas ?? {};
    const models: ResolvedModel[] = Object.entries(schemas).map(([name, raw]) => {
      const schema = this.resolveSchema(raw);
      return { name, schema, deps: this.collectRefNames(raw) };
    });
    return topoSort(models);
  }

  /** Collect all named $ref targets within a schema (non-recursive into resolved). */
  private collectRefNames(schema: SchemaObject): string[] {
    const names = new Set<string>();
    const walk = (s: SchemaObject) => {
      if (s.$ref) {
        const name = s.$ref.split('/').pop();
        if (name) names.add(name);
        return;
      }
      for (const sub of [
        ...(s.allOf ?? []),
        ...(s.oneOf ?? []),
        ...(s.anyOf ?? []),
        ...(s.properties ? Object.values(s.properties) : []),
        ...(s.items ? [s.items] : []),
      ]) {
        walk(sub);
      }
    };
    walk(schema);
    return [...names];
  }

  // ── Operations ─────────────────────────────────────────────────────────────

  getOperations(spec: OpenAPISpec): Array<{ path: string; method: string; operation: Operation }> {
    const ops: Array<{ path: string; method: string; operation: Operation }> = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (op) ops.push({ path, method, operation: op });
      }
    }
    return ops;
  }

  /** Resolve the response schema for the first 2xx response of an operation. */
  getResponseSchema(op: Operation): SchemaObject | null {
    for (const status of ['200', '201', '202', '204']) {
      const resp = op.responses[status];
      if (!resp?.content) continue;
      const json = resp.content['application/json'];
      if (json?.schema) return this.resolveSchema(json.schema);
    }
    return null;
  }

  /** Resolve the request body schema for an operation. */
  getRequestBodySchema(op: Operation): SchemaObject | null {
    const json = op.requestBody?.content['application/json'];
    if (json?.schema) return this.resolveSchema(json.schema);
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const result = { ...obj };
  for (const k of keys) delete result[k];
  return result;
}

function topoSort(models: ResolvedModel[]): ResolvedModel[] {
  const byName = new Map(models.map((m) => [m.name, m]));
  const visited = new Set<string>();
  const result: ResolvedModel[] = [];

  const visit = (name: string) => {
    if (visited.has(name)) return;
    visited.add(name);
    const model = byName.get(name);
    if (!model) return;
    for (const dep of model.deps) visit(dep);
    result.push(model);
  };

  for (const m of models) visit(m.name);
  return result;
}
