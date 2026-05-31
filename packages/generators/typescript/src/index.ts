import * as fs from 'fs';
import * as path from 'path';
import { OpenAPISpec, OpenAPIParser, SchemaObject, ResolvedModel } from '@steel-core/core';

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
    fs.writeFileSync(path.join(outputDir, 'client.ts'), this.renderClient(className, spec, operations));
    fs.writeFileSync(path.join(outputDir, 'index.ts'),
      `export { ${className} } from './client';\nexport * from './models';\n`);
    fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify({
      name: this.toPackageName(spec.info.title),
      version: spec.info.version,
      main: 'client.js',
      types: 'client.d.ts',
    }, null, 2) + '\n');

    console.log(`  Created: models.ts, client.ts, index.ts, package.json`);
  }

  // ── Model rendering ──────────────────────────────────────────────────────

  private renderModels(models: ResolvedModel[]): string {
    const lines = ['/** Auto-generated models — do not edit manually. */\n'];
    for (const model of models) {
      lines.push(this.renderModel(model.name, model.schema));
      lines.push('');
    }
    return lines.join('\n');
  }

  private renderModel(name: string, schema: SchemaObject): string {
    // Enum
    if (schema.enum) {
      const members = schema.enum
        .map((v) => `  ${String(v).toUpperCase().replace(/[^A-Z0-9]/g, '_')} = ${JSON.stringify(v)},`)
        .join('\n');
      return `export enum ${name} {\n${members}\n}`;
    }

    // oneOf / anyOf → union type alias
    if (schema.oneOf ?? schema.anyOf) {
      const variants = (schema.oneOf ?? schema.anyOf)!
        .map((s) => this.schemaToType(s))
        .join(' | ');
      return `export type ${name} = ${variants};`;
    }

    // Object → interface
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

  private schemaToType(schema: SchemaObject): string {
    if (schema.$ref) return schema.$ref.split('/').pop()!;
    if (schema['x-schema-name']) return schema['x-schema-name'];

    if (schema.oneOf ?? schema.anyOf) {
      return (schema.oneOf ?? schema.anyOf)!.map((s) => this.schemaToType(s)).join(' | ');
    }
    if (schema.allOf) {
      return schema.allOf.map((s) => this.schemaToType(s)).join(' & ');
    }

    const base = this.baseType(schema);
    return schema.nullable ? `${base} | null` : base;
  }

  private baseType(schema: SchemaObject): string {
    switch (schema.type) {
      case 'string':
        if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(' | ');
        return 'string';
      case 'integer':
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array':
        return `Array<${schema.items ? this.schemaToType(schema.items) : 'unknown'}>`;
      case 'object':
        if (schema.properties) {
          const inner = Object.entries(schema.properties)
            .map(([k, v]) => `${this.toSafeKey(k)}: ${this.schemaToType(v)}`)
            .join('; ');
          return `{ ${inner} }`;
        }
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          return `Record<string, ${this.schemaToType(schema.additionalProperties as SchemaObject)}>`;
        }
        return 'Record<string, unknown>';
      default:
        return 'unknown';
    }
  }

  // ── Client rendering ─────────────────────────────────────────────────────

  private renderClient(
    className: string,
    spec: OpenAPISpec,
    operations: ReturnType<OpenAPIParser['getOperations']>
  ): string {
    const methods = operations.map((op) => this.renderMethod(op)).join('\n\n');
    return `/**
 * ${spec.info.title} v${spec.info.version} — auto-generated by Steel Core
 */
import type * as Models from './models';

export class ${className} {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\\/$/, '');
    this.headers = { 'Content-Type': 'application/json' };
    if (apiKey) this.headers['Authorization'] = \`Bearer \${apiKey}\`;
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; params?: Record<string, string | undefined> } = {}
  ): Promise<T> {
    let url = \`\${this.baseUrl}\${path}\`;
    if (options.params) {
      const qs = new URLSearchParams(
        Object.entries(options.params).filter(([, v]) => v != null) as [string, string][]
      ).toString();
      if (qs) url += \`?\${qs}\`;
    }
    const res = await fetch(url, {
      method,
      headers: this.headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) throw new Error(\`HTTP \${res.status}: \${await res.text()}\`);
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

${methods}
}
`;
  }

  private renderMethod(op: { path: string; method: string; operation: import('@steel-core/core').Operation }): string {
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
      ? this.parser.getRequestBodySchema(op.operation)
      : null;
    const bodyType = bodySchema?.['x-schema-name']
      ? `Models.${bodySchema['x-schema-name']}`
      : bodySchema ? this.schemaToType(bodySchema) : null;
    const bodyParam = bodyType ? [`body?: ${bodyType}`] : [];

    const returnSchema = this.parser.getResponseSchema(op.operation);
    const returnType = returnSchema?.['x-schema-name']
      ? `Models.${returnSchema['x-schema-name']}`
      : returnSchema ? this.schemaToType(returnSchema) : 'void';

    const allParams = [...pathParams, ...queryParams, ...bodyParam].join(', ');
    const urlPath = op.path.replace(/{(\w+)}/g, '${$1}');
    const doc = op.operation.summary ? `  /** ${op.operation.summary} */\n` : '';

    const queryKeys = (op.operation.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name);
    const paramsArg = queryKeys.length
      ? `, params: { ${queryKeys.map((k) => `${JSON.stringify(k)}: ${this.toCamelCase(k)}`).join(', ')} }`
      : '';
    const bodyArg = bodyType ? ', body' : '';

    return `${doc}  async ${name}(${allParams}): Promise<${returnType}> {
    return this.request<${returnType}>('${op.method.toUpperCase()}', \`${urlPath}\`${paramsArg || bodyArg ? `, { ${bodyArg ? `body${bodyArg}` : ''}${paramsArg} }` : ''});
  }`;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

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
