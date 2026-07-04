/**
 * Smoke-tests for the Python and TypeScript generators.
 * Verifies that generated files contain the expected patterns
 * without requiring a full language runtime.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import PythonGenerator from '@steel-core/generator-python';
import TypeScriptGenerator from '@steel-core/generator-typescript';
import { OpenAPIParser } from '../parser';

const PAGINATED_SPEC = {
  openapi: '3.0.0',
  info: { title: 'Widget API', version: '1.0.0' },
  paths: {
    '/widgets': {
      get: {
        operationId: 'listWidgets',
        summary: 'List widgets',
        parameters: [{ name: 'filter', in: 'query', schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WidgetPage' },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createWidget',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Widget' } } },
        },
        responses: {
          '201': {
            description: 'Created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Widget' } } },
          },
        },
      },
    },
    '/widgets/{id}': {
      get: {
        operationId: 'getWidget',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Widget' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Widget: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          count: { type: 'integer' },
        },
      },
      WidgetPage: {
        type: 'object',
        required: ['items'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/Widget' } },
          next_cursor: { type: 'string', nullable: true },
        },
      },
    },
  },
};

const XQUIK_SPEC = {
  openapi: '3.1.0',
  info: { title: 'Xquik API', version: '1.0.0' },
  paths: {
    '/api/v1/x/tweets/search': {
      get: {
        operationId: 'searchTweets',
        summary: 'Search X posts',
        parameters: [
          { name: 'query', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          '200': {
            description: 'Search results',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TweetSearchResponse' } } },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
      },
    },
    schemas: {
      TweetSearchResponse: {
        type: 'object',
        required: ['items'],
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/Tweet' } },
          next_cursor: { type: 'string', nullable: true },
        },
      },
      Tweet: {
        type: 'object',
        required: ['id', 'text'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
        },
      },
    },
  },
};

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'steelcore-test-'));
}

function read(dir: string, file: string): string {
  return fs.readFileSync(path.join(dir, file), 'utf-8');
}

describe('PythonGenerator', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = tmpDir();
    const gen = new PythonGenerator();
    const parser = new OpenAPIParser();
    const spec = parser.parse(PAGINATED_SPEC);
    await gen.generate(spec, outDir);
  });

  afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

  test('creates all expected files', () => {
    for (const f of ['models.py', '_http.py', '_pagination.py', 'client.py', 'async_client.py', '__init__.py', 'requirements.txt']) {
      expect(fs.existsSync(path.join(outDir, f))).toBe(true);
    }
  });

  test('models.py contains Widget dataclass', () => {
    const src = read(outDir, 'models.py');
    expect(src).toContain('@dataclass');
    expect(src).toContain('class Widget:');
    expect(src).toContain('id: str');
    expect(src).toContain('name: str');
    expect(src).toContain('count: Optional[int]');
  });

  test('_http.py contains RetryConfig and backoff', () => {
    const src = read(outDir, '_http.py');
    expect(src).toContain('class RetryConfig:');
    expect(src).toContain('max_retries');
    expect(src).toContain('base_delay');
    expect(src).toContain('RETRYABLE_STATUS');
    expect(src).toContain('class AsyncHttpTransport:');
  });

  test('_pagination.py contains Page and OffsetPage', () => {
    const src = read(outDir, '_pagination.py');
    expect(src).toContain('class Page(Generic[T]):');
    expect(src).toContain('class OffsetPage(Generic[T]):');
    expect(src).toContain('class AsyncPage(Generic[T]):');
    expect(src).toContain('next_cursor');
  });

  test('client.py uses RetryConfig and has typed methods', () => {
    const src = read(outDir, 'client.py');
    expect(src).toContain('RetryConfig');
    expect(src).toContain('def list_widgets');
    expect(src).toContain('def create_widget');
    expect(src).toContain('def get_widget');
  });

  test('list operation returns a cursor Page', () => {
    const src = read(outDir, 'client.py');
    expect(src).toContain('Page[Widget]');
    expect(src).toContain('next_cursor');
  });

  test('async_client.py is an async variant', () => {
    const src = read(outDir, 'async_client.py');
    expect(src).toContain('async def list_widgets');
    expect(src).toContain('AsyncPage');
    expect(src).toContain('__aenter__');
    expect(src).toContain('AsyncHttpTransport');
  });
});

describe('TypeScriptGenerator', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = tmpDir();
    const gen = new TypeScriptGenerator();
    const parser = new OpenAPIParser();
    const spec = parser.parse(PAGINATED_SPEC);
    await gen.generate(spec, outDir);
  });

  afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

  test('creates all expected files', () => {
    for (const f of ['models.ts', '_http.ts', '_pagination.ts', 'client.ts', 'index.ts', 'package.json']) {
      expect(fs.existsSync(path.join(outDir, f))).toBe(true);
    }
  });

  test('models.ts contains Widget interface', () => {
    const src = read(outDir, 'models.ts');
    expect(src).toContain('export interface Widget');
    expect(src).toContain('id: string;');
    expect(src).toContain('name: string;');
    expect(src).toContain('count?: number;');
  });

  test('_http.ts contains HttpClient with retry', () => {
    const src = read(outDir, '_http.ts');
    expect(src).toContain('export interface RetryConfig');
    expect(src).toContain('maxRetries');
    expect(src).toContain('RETRYABLE');
    expect(src).toContain('export class HttpClient');
    expect(src).toContain('retry-after');
    expect(src).toContain('export class HttpError');
  });

  test('_pagination.ts contains Page and OffsetPage', () => {
    const src = read(outDir, '_pagination.ts');
    expect(src).toContain('export class Page<T>');
    expect(src).toContain('export class OffsetPage<T>');
    expect(src).toContain('[Symbol.asyncIterator]');
    expect(src).toContain('toArray()');
  });

  test('client.ts imports pagination classes', () => {
    const src = read(outDir, 'client.ts');
    expect(src).toContain("import { Page, OffsetPage }");
    expect(src).toContain('HttpClient');
    expect(src).toContain('RetryConfig');
  });

  test('list operation returns a cursor Page', () => {
    const src = read(outDir, 'client.ts');
    expect(src).toContain('Promise<Page<');
    expect(src).toContain('next_cursor');
  });

  test('non-list operation has normal return type', () => {
    const src = read(outDir, 'client.ts');
    expect(src).toContain('getWidget');
    expect(src).toContain('Promise<Models.Widget>');
  });

  test('uses OpenAPI apiKey header names instead of forcing bearer auth', async () => {
    const xquikOutDir = tmpDir();
    try {
      const gen = new TypeScriptGenerator();
      const parser = new OpenAPIParser();
      const spec = parser.parse(XQUIK_SPEC);
      await gen.generate(spec, xquikOutDir);
      const src = read(xquikOutDir, 'client.ts');
      expect(src).toContain("headers['x-api-key'] = options.apiKey;");
      expect(src).not.toContain("headers['Authorization'] = `Bearer ${options.apiKey}`;");
    } finally {
      fs.rmSync(xquikOutDir, { recursive: true, force: true });
    }
  });
});
