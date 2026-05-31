import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import GoGenerator from '@steel-core/generator-go';
import { OpenAPIParser } from '../parser';

const SPEC = {
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
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WidgetPage' } } },
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
      delete: {
        operationId: 'deleteWidget',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Deleted' } },
      },
    },
  },
  components: {
    schemas: {
      Status: {
        type: 'string',
        enum: ['active', 'inactive', 'pending'],
      },
      Widget: {
        type: 'object',
        required: ['id', 'name'],
        description: 'A widget resource',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          count: { type: 'integer' },
          status: { $ref: '#/components/schemas/Status' },
          tags: { type: 'array', items: { type: 'string' } },
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

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'steelcore-go-test-'));
}

function read(dir: string, file: string): string {
  return fs.readFileSync(path.join(dir, file), 'utf-8');
}

describe('GoGenerator', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = tmpDir();
    const gen = new GoGenerator();
    const parser = new OpenAPIParser();
    const spec = parser.parse(SPEC);
    await gen.generate(spec, outDir);
  });

  afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

  test('creates all expected files', () => {
    for (const f of ['models.go', 'http.go', 'pagination.go', 'client.go', 'go.mod']) {
      expect(fs.existsSync(path.join(outDir, f))).toBe(true);
    }
  });

  test('go.mod has correct module path and go version', () => {
    const src = read(outDir, 'go.mod');
    expect(src).toContain('module github.com/example/widgetapi');
    expect(src).toContain('go 1.21');
  });

  test('models.go has correct package declaration', () => {
    const src = read(outDir, 'models.go');
    expect(src).toContain('package widgetapi');
  });

  test('models.go generates Widget struct with correct fields', () => {
    const src = read(outDir, 'models.go');
    expect(src).toContain('type Widget struct');
    expect(src).toContain('Id string');
    expect(src).toContain('Name string');
    expect(src).toContain('Count *int64');       // optional → pointer
    expect(src).toContain('Tags []string');
    expect(src).toContain('json:"id"');
    expect(src).toContain('json:"name"');
    expect(src).toContain('json:"count,omitempty"');
  });

  test('models.go generates Status enum as typed constants', () => {
    const src = read(outDir, 'models.go');
    expect(src).toContain('type Status string');
    expect(src).toContain('StatusActive Status = "active"');
    expect(src).toContain('StatusInactive Status = "inactive"');
    expect(src).toContain('StatusPending Status = "pending"');
  });

  test('http.go contains RetryConfig and backoff', () => {
    const src = read(outDir, 'http.go');
    expect(src).toContain('type RetryConfig struct');
    expect(src).toContain('MaxRetries int');
    expect(src).toContain('BaseDelay time.Duration');
    expect(src).toContain('func backoff(');
    expect(src).toContain('Retry-After');
    expect(src).toContain('type APIError struct');
  });

  test('pagination.go contains generic CursorPage and OffsetPage', () => {
    const src = read(outDir, 'pagination.go');
    expect(src).toContain('type CursorPage[T any] struct');
    expect(src).toContain('type OffsetPage[T any] struct');
    expect(src).toContain('func (p *CursorPage[T]) Iter(');
    expect(src).toContain('func (p *OffsetPage[T]) Collect(');
  });

  test('client.go generates constructor with options pattern', () => {
    const src = read(outDir, 'client.go');
    expect(src).toContain('type WidgetAPIClient struct');
    expect(src).toContain('func NewWidgetAPIClient(');
    expect(src).toContain('type ClientOption func(');
    expect(src).toContain('func WithRetry(');
  });

  test('list operation returns CursorPage', () => {
    const src = read(outDir, 'client.go');
    expect(src).toContain('func (c *WidgetAPIClient) ListWidgets(');
    expect(src).toContain('*CursorPage[Widget]');
    expect(src).toContain('next_cursor');
  });

  test('get operation returns a typed pointer result', () => {
    const src = read(outDir, 'client.go');
    expect(src).toContain('func (c *WidgetAPIClient) GetWidget(');
    expect(src).toContain('(*Widget, error)');
    expect(src).toContain('json.Unmarshal');
  });

  test('delete operation returns only error', () => {
    const src = read(outDir, 'client.go');
    expect(src).toContain('func (c *WidgetAPIClient) DeleteWidget(');
    expect(src).toContain(') error {');
  });

  test('query params are added to url.Values', () => {
    const src = read(outDir, 'client.go');
    expect(src).toContain('params := url.Values{}');
    expect(src).toContain('"filter"');
  });

  test('context.Context is first param on every method', () => {
    const src = read(outDir, 'client.go');
    const methodLines = src.split('\n').filter((l) => l.startsWith('func (c *WidgetAPIClient)'));
    expect(methodLines.length).toBeGreaterThan(0);
    for (const line of methodLines) {
      expect(line).toContain('ctx context.Context');
    }
  });
});
