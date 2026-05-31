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
  items?: SchemaObject;
  required?: string[];
  enum?: unknown[];
  $ref?: string;
  description?: string;
}

export interface SecurityScheme {
  type: string;
  scheme?: string;
  bearerFormat?: string;
  in?: string;
  name?: string;
}

export type SecurityRequirement = Record<string, string[]>;

export class OpenAPIParser {
  parse(input: string | object): OpenAPISpec {
    const raw = typeof input === 'string' ? JSON.parse(input) : input;
    this.validate(raw);
    return raw as OpenAPISpec;
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

  getOperations(spec: OpenAPISpec): Array<{ path: string; method: string; operation: Operation }> {
    const ops: Array<{ path: string; method: string; operation: Operation }> = [];
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of methods) {
        const op = item[method];
        if (op) ops.push({ path, method, operation: op });
      }
    }
    return ops;
  }
}
