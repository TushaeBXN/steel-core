import * as fs from 'fs';
import * as path from 'path';
import { OpenAPISpec, OpenAPIParser, SchemaObject, ResolvedModel, Operation } from '@steel-core/core';

export default class TypeScriptGenerator {
  private parser!: OpenAPIParser;

  async generate(spec: OpenAPISpec, outputDir: string): Promise<void> {
    fs.mkdirSync(outputDir, { recursive: true });
    this.parser = new OpenAPIParser();
    this.parser.parse(spec);

    const models = this.parser.getModels();
    const operations = this.parser.getOperations(spec);
    const className = this.toClassName(spec.info.title);

    fs.writeFileSync(path.join(outputDir, 'models.ts'), this.renderModels(models));
    fs.writeFileSync(path.join(outputDir, '_http.ts'), this.renderHttpLayer());
    fs.writeFileSync(path.join(outputDir, '_pagination.ts'), this.renderPagination());
    fs.writeFileSync(path.join(outputDir, 'client.ts'), this.renderClient(className, spec, operations));
    fs.writeFileSync(path.join(outputDir, 'index.ts'), [
      `export { ${className} } from './client';`,
      `export * from './models';`,
      `export type { RetryConfig, Page, OffsetPage } from './_http';`,
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify({
      name: this.toPackageName(spec.info.title),
      version: spec.info.version,
      main: 'client.js',
      types: 'client.d.ts',
    }, null, 2) + '\n');

    console.log(`  Created: models.ts, _http.ts, _pagination.ts, client.ts, index.ts`);
  }

  // ── HTTP layer ────────────────────────────────────────────────────────────

  private renderHttpLayer(): string {
    return `/** Shared HTTP transport with retry — do not edit manually. */

export interface RetryConfig {
  /** Maximum number of retry attempts after the first failure. Default: 3 */
  maxRetries?: number;
  /** Initial backoff delay in ms. Doubles each retry. Default: 1000 */
  baseDelayMs?: number;
  /** Maximum backoff delay in ms. Default: 60000 */
  maxDelayMs?: number;
  /** Add ±25% jitter to backoff delays. Default: true */
  jitter?: boolean;
}

export interface RequestOptions {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined | null>;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function isRetryableError(err: unknown): boolean {
  if (err instanceof HttpError) return RETRYABLE.has(err.status);
  // Network-level errors (fetch throws TypeError for connectivity issues)
  return err instanceof TypeError;
}

function backoff(attempt: number, cfg: Required<RetryConfig>): Promise<void> {
  let delay = Math.min(cfg.baseDelayMs * 2 ** attempt, cfg.maxDelayMs);
  if (cfg.jitter) delay *= 0.75 + Math.random() * 0.5;
  return new Promise((r) => setTimeout(r, delay));
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(\`HTTP \${status} \${url}: \${body.slice(0, 200)}\`);
    this.name = 'HttpError';
  }
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly retry: Required<RetryConfig>;

  constructor(
    baseUrl: string,
    headers: Record<string, string>,
    retry: RetryConfig = {},
  ) {
    this.baseUrl = baseUrl.replace(/\\/$/, '');
    this.headers = headers;
    this.retry = {
      maxRetries: retry.maxRetries ?? 3,
      baseDelayMs: retry.baseDelayMs ?? 1000,
      maxDelayMs: retry.maxDelayMs ?? 60000,
      jitter: retry.jitter ?? true,
    };
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    let url = \`\${this.baseUrl}\${path}\`;
    if (options.params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(options.params)) {
        if (v != null) qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += \`?\${s}\`;
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retry.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: this.headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
        if (RETRYABLE.has(res.status) && attempt < this.retry.maxRetries) {
          // Honour Retry-After header if present
          const retryAfter = res.headers.get('retry-after');
          const wait = retryAfter ? parseFloat(retryAfter) * 1000 : null;
          await (wait ? new Promise((r) => setTimeout(r, wait)) : backoff(attempt, this.retry));
          continue;
        }
        if (!res.ok) throw new HttpError(res.status, await res.text(), url);
        if (res.status === 204) return undefined as T;
        return res.json() as Promise<T>;
      } catch (err) {
        if (!isRetryableError(err) || attempt >= this.retry.maxRetries) throw err;
        lastErr = err;
        await backoff(attempt, this.retry);
      }
    }
    throw lastErr;
  }
}
`;
  }

  // ── Pagination ────────────────────────────────────────────────────────────

  private renderPagination(): string {
    return `/** Pagination helpers — do not edit manually. */

export interface PageResponse<T> {
  items: T[];
  next_cursor?: string | null;
  total?: number | null;
}

/** Cursor-based page. Use \`for await (const item of page)\` to auto-paginate. */
export class Page<T> implements AsyncIterable<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
  readonly hasNext: boolean;
  private readonly _fetch: (cursor: string) => Promise<Page<T>>;

  constructor(
    items: T[],
    nextCursor: string | null | undefined,
    fetch: (cursor: string) => Promise<Page<T>>,
  ) {
    this.items = items;
    this.nextCursor = nextCursor ?? null;
    this.hasNext = !!nextCursor;
    this._fetch = fetch;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let page: Page<T> | null = this;
    while (page) {
      yield* page.items;
      page = page.nextCursor ? await page._fetch(page.nextCursor) : null;
    }
  }

  /** Collect all items across all pages into a single array. */
  async toArray(): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this) out.push(item);
    return out;
  }
}

/** Offset/limit-based page. */
export class OffsetPage<T> implements AsyncIterable<T> {
  readonly items: T[];
  readonly total: number | null;
  readonly offset: number;
  readonly limit: number;
  readonly hasNext: boolean;
  private readonly _fetch: (offset: number, limit: number) => Promise<OffsetPage<T>>;

  constructor(
    items: T[],
    total: number | null | undefined,
    offset: number,
    limit: number,
    fetch: (offset: number, limit: number) => Promise<OffsetPage<T>>,
  ) {
    this.items = items;
    this.total = total ?? null;
    this.offset = offset;
    this.limit = limit;
    this.hasNext = total == null || offset + items.length < total;
    this._fetch = fetch;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let page: OffsetPage<T> | null = this;
    while (page) {
      yield* page.items;
      page = page.hasNext
        ? await page._fetch(page.offset + page.limit, page.limit)
        : null;
    }
  }

  async toArray(): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this) out.push(item);
    return out;
  }
}
`;
  }

  // ── Client ────────────────────────────────────────────────────────────────

  private renderClient(
    className: string,
    spec: OpenAPISpec,
    operations: ReturnType<OpenAPIParser['getOperations']>,
  ): string {
    const methods = operations.map((op) => this.renderMethod(op)).join('\n\n');
    const apiKeyHeader = this.getApiKeyHeader(spec);
    return `/**
 * ${spec.info.title} v${spec.info.version} — auto-generated by Steel Core
 */
import type * as Models from './models';
import { HttpClient, HttpError, RetryConfig } from './_http';
import { Page, OffsetPage } from './_pagination';

export { HttpError };

export interface ClientOptions {
  apiKey?: string;
  timeout?: number;
  retry?: RetryConfig;
}

export class ${className} {
  private readonly http: HttpClient;

  constructor(baseUrl: string, options: ClientOptions = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
${this.renderApiKeyHeaderAssignment(apiKeyHeader)}
    this.http = new HttpClient(baseUrl, headers, options.retry);
  }

${methods}
}
`;
  }

  private getApiKeyHeader(spec: OpenAPISpec): string | null {
    const schemes = spec.components?.securitySchemes ?? {};
    for (const scheme of Object.values(schemes)) {
      if (scheme.type === 'apiKey' && scheme.in === 'header' && scheme.name) {
        return scheme.name;
      }
    }
    return null;
  }

  private renderApiKeyHeaderAssignment(headerName: string | null): string {
    if (headerName) {
      const escapedHeaderName = headerName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `    if (options.apiKey) headers['${escapedHeaderName}'] = options.apiKey;`;
    }
    return "    if (options.apiKey) headers['Authorization'] = `Bearer ${options.apiKey}`;";
  }

  private renderMethod(op: { path: string; method: string; operation: Operation }): string {
    const name = op.operation.operationId
      ? this.toCamelCase(op.operation.operationId)
      : `${op.method}${this.toPascalCase(op.path.replace(/[{}]/g, '').replace(/\//g, '_'))}`;

    const pathParams = (op.operation.parameters ?? [])
      .filter((p) => p.in === 'path')
      .map((p) => `${this.toCamelCase(p.name)}: ${this.schemaToType(p.schema)}`);

    const queryParams = (op.operation.parameters ?? [])
      .filter((p) => p.in === 'query')
      .map((p) => `${this.toCamelCase(p.name)}?: ${this.schemaToType(p.schema)}`);

    const bodySchema = op.operation.requestBody
      ? this.parser.getRequestBodySchema(op.operation) : null;
    const bodyType = bodySchema?.['x-schema-name']
      ? `Models.${bodySchema['x-schema-name']}`
      : bodySchema ? this.schemaToType(bodySchema) : null;
    const bodyParam = bodyType ? [`body?: ${bodyType}`] : [];

    const returnSchema = this.parser.getResponseSchema(op.operation);
    const rawReturnType = returnSchema?.['x-schema-name']
      ? `Models.${returnSchema['x-schema-name']}`
      : returnSchema ? this.schemaToType(returnSchema) : 'void';

    const isPaginated = this.isPaginatedResponse(returnSchema);
    const itemType = isPaginated ? this.getPaginationItemType(returnSchema!) : null;
    const hasCursor = isPaginated && returnSchema?.properties?.['next_cursor'] != null;
    const pageClass = hasCursor ? 'Page' : 'OffsetPage';
    const returnType = isPaginated ? `Promise<${pageClass}<${itemType}>>` : `Promise<${rawReturnType}>`;

    const allParams = [...pathParams, ...queryParams, ...bodyParam].join(', ');
    const urlPath = op.path.replace(/{(\w+)}/g, '${$1}');
    const doc = op.operation.summary ? `  /** ${op.operation.summary} */\n` : '';

    const queryKeys = (op.operation.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name);
    const paramsObj = queryKeys.length
      ? `{ ${queryKeys.map((k) => `${JSON.stringify(k)}: ${this.toCamelCase(k)}`).join(', ')} }`
      : 'undefined';

    if (isPaginated) {
      return hasCursor
        ? this.renderCursorMethod(name, doc, allParams, urlPath, paramsObj, itemType!, pageClass, returnType)
        : this.renderOffsetMethod(name, doc, allParams, urlPath, paramsObj, itemType!, pageClass, returnType);
    }

    const opts = [bodyType ? `body` : '', paramsObj !== 'undefined' ? `params: ${paramsObj}` : '']
      .filter(Boolean).join(', ');

    return `${doc}  async ${name}(${allParams}): ${returnType} {
    return this.http.request<${rawReturnType}>('${op.method.toUpperCase()}', \`${urlPath}\`${opts ? `, { ${opts} }` : ''});
  }`;
  }

  private renderCursorMethod(
    name: string, doc: string, allParams: string, urlPath: string,
    paramsObj: string, itemType: string, pageClass: string, returnType: string,
  ): string {
    return `${doc}  async ${name}(${allParams}): ${returnType} {
    const fetch = async (cursor?: string): Promise<${pageClass}<${itemType}>> => {
      const params = { ...(${paramsObj} ?? {}), ...(cursor ? { cursor } : {}) };
      const raw = await this.http.request<{ items: ${itemType}[]; next_cursor?: string }>('GET', \`${urlPath}\`, { params });
      return new ${pageClass}(raw.items ?? [], raw.next_cursor, fetch);
    };
    return fetch();
  }`;
  }

  private renderOffsetMethod(
    name: string, doc: string, allParams: string, urlPath: string,
    paramsObj: string, itemType: string, pageClass: string, returnType: string,
  ): string {
    return `${doc}  async ${name}(${allParams}): ${returnType} {
    const fetch = async (offset = 0, limit = 50): Promise<${pageClass}<${itemType}>> => {
      const params = { ...(${paramsObj} ?? {}), offset, limit };
      const raw = await this.http.request<{ items: ${itemType}[]; total?: number }>('GET', \`${urlPath}\`, { params });
      return new ${pageClass}(raw.items ?? [], raw.total, offset, limit, fetch);
    };
    return fetch();
  }`;
  }

  // ── Model rendering ───────────────────────────────────────────────────────

  private renderModels(models: ResolvedModel[]): string {
    const lines = ['/** Auto-generated models — do not edit manually. */\n'];
    for (const model of models) {
      lines.push(this.renderModel(model.name, model.schema));
      lines.push('');
    }
    return lines.join('\n');
  }

  private renderModel(name: string, schema: SchemaObject): string {
    if (schema.enum) {
      const members = schema.enum
        .map((v) => `  ${String(v).toUpperCase().replace(/[^A-Z0-9]/g, '_')} = ${JSON.stringify(v)},`)
        .join('\n');
      return `export enum ${name} {\n${members}\n}`;
    }
    if (schema.oneOf ?? schema.anyOf) {
      const variants = (schema.oneOf ?? schema.anyOf)!.map((s) => this.schemaToType(s)).join(' | ');
      return `export type ${name} = ${variants};`;
    }
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const doc = schema.description ? `/** ${schema.description} */\n` : '';
    const fields = Object.entries(props).map(([propName, propSchema]) => {
      const tsType = this.schemaToType(propSchema);
      const optional = !required.has(propName) || propSchema.nullable ? '?' : '';
      const fieldDoc = propSchema.description ? `  /** ${propSchema.description} */\n` : '';
      return `${fieldDoc}  ${this.toSafeKey(propName)}${optional}: ${tsType};`;
    });
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      fields.push(`  [key: string]: ${this.schemaToType(schema.additionalProperties as SchemaObject)};`);
    } else if (schema.additionalProperties === true) {
      fields.push('  [key: string]: unknown;');
    }
    const body = fields.length ? fields.join('\n') : '  [key: string]: unknown;';
    return `${doc}export interface ${name} {\n${body}\n}`;
  }

  // ── Pagination detection ───────────────────────────────────────────────────

  private isPaginatedResponse(schema: SchemaObject | null): boolean {
    if (!schema?.properties) return false;
    return 'items' in schema.properties && schema.properties['items'].type === 'array';
  }

  private getPaginationItemType(schema: SchemaObject): string {
    const items = schema.properties!['items'];
    return items.items?.['x-schema-name']
      ? `Models.${items.items['x-schema-name']}`
      : this.schemaToType(items.items ?? {});
  }

  // ── Type helpers ──────────────────────────────────────────────────────────

  private schemaToType(schema: SchemaObject): string {
    if (schema.$ref) return schema.$ref.split('/').pop()!;
    if (schema['x-schema-name']) return schema['x-schema-name'];
    if (schema.oneOf ?? schema.anyOf) {
      return (schema.oneOf ?? schema.anyOf)!.map((s) => this.schemaToType(s)).join(' | ');
    }
    if (schema.allOf) return schema.allOf.map((s) => this.schemaToType(s)).join(' & ');
    const base = this.baseType(schema);
    return schema.nullable ? `${base} | null` : base;
  }

  private baseType(schema: SchemaObject): string {
    switch (schema.type) {
      case 'string':
        if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
        return 'string';
      case 'integer':
      case 'number':  return 'number';
      case 'boolean': return 'boolean';
      case 'array':   return `Array<${schema.items ? this.schemaToType(schema.items) : 'unknown'}>`;
      case 'object':
        if (schema.properties) {
          const inner = Object.entries(schema.properties)
            .map(([k, v]) => `${this.toSafeKey(k)}: ${this.schemaToType(v as SchemaObject)}`)
            .join('; ');
          return `{ ${inner} }`;
        }
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          return `Record<string, ${this.schemaToType(schema.additionalProperties as SchemaObject)}>`;
        }
        return 'Record<string, unknown>';
      default: return 'unknown';
    }
  }

  // ── String helpers ────────────────────────────────────────────────────────

  private toClassName(title: string): string {
    return title.replace(/[^a-zA-Z0-9]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s/g, '') + 'Client';
  }

  private toPackageName(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  }

  private toCamelCase(str: string): string {
    return str.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase()).replace(/^[A-Z]/, (c) => c.toLowerCase());
  }

  private toPascalCase(str: string): string {
    return str.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase()).replace(/^[a-z]/, (c) => c.toUpperCase());
  }

  private toSafeKey(key: string): string {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
  }
}
