import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import CSharpGenerator from '@steel-core/generator-csharp';
import { OpenAPIParser } from '../parser';

const SPEC = {
  openapi: '3.0.0',
  info: { title: 'Widget API', version: '1.0.0', description: 'A widget service' },
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
      Status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
      Widget: {
        type: 'object',
        required: ['id', 'name'],
        description: 'A widget resource',
        properties: {
          id:        { type: 'string' },
          name:      { type: 'string' },
          count:     { type: 'integer' },
          isActive:  { type: 'boolean' },
          tags:      { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
          status:    { $ref: '#/components/schemas/Status' },
        },
      },
      WidgetPage: {
        type: 'object',
        required: ['items'],
        properties: {
          items:       { type: 'array', items: { $ref: '#/components/schemas/Widget' } },
          next_cursor: { type: 'string', nullable: true },
        },
      },
    },
  },
};

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'steelcore-cs-')); }
function read(dir: string, file: string) { return fs.readFileSync(path.join(dir, file), 'utf-8'); }

describe('CSharpGenerator', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = tmpDir();
    const gen = new CSharpGenerator();
    const spec = new OpenAPIParser().parse(SPEC);
    await gen.generate(spec, outDir);
  });

  afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

  test('creates all expected files', () => {
    for (const f of [
      'Models.cs', 'ApiException.cs', 'RetryConfig.cs',
      'HttpTransport.cs', 'Pagination.cs', 'WidgetAPIClient.cs', 'WidgetAPI.csproj',
    ]) {
      expect(fs.existsSync(path.join(outDir, f))).toBe(true);
    }
  });

  // ── Models ────────────────────────────────────────────────────────────────

  test('Models.cs has correct namespace', () => {
    const src = read(outDir, 'Models.cs');
    expect(src).toContain('namespace WidgetAPI;');
  });

  test('Widget is a record with required + optional properties', () => {
    const src = read(outDir, 'Models.cs');
    expect(src).toContain('public record Widget');
    expect(src).toContain('public required string Id');
    expect(src).toContain('public required string Name');
    expect(src).toContain('public long? Count');           // optional → nullable
    expect(src).toContain('public bool? IsActive');
    expect(src).toContain('public List<string>? Tags');
    expect(src).toContain('public DateTimeOffset? CreatedAt'); // date-time format
    expect(src).toContain('[JsonPropertyName("id")]');
    expect(src).toContain('[JsonPropertyName("name")]');
  });

  test('Status is a JsonStringEnumConverter enum', () => {
    const src = read(outDir, 'Models.cs');
    expect(src).toContain('[JsonConverter(typeof(JsonStringEnumConverter))]');
    expect(src).toContain('public enum Status');
    expect(src).toContain('Active');
    expect(src).toContain('Inactive');
    expect(src).toContain('Pending');
  });

  // ── Exceptions ────────────────────────────────────────────────────────────

  test('ApiException has StatusCode, Body, Url, IsRetryable', () => {
    const src = read(outDir, 'ApiException.cs');
    expect(src).toContain('public class ApiException : Exception');
    expect(src).toContain('public int    StatusCode');
    expect(src).toContain('public bool IsRetryable');
    expect(src).toContain('StatusCode == 429');
    expect(src).toContain('public class RateLimitException : ApiException');
    expect(src).toContain('public class AuthException : ApiException');
  });

  // ── RetryConfig ───────────────────────────────────────────────────────────

  test('RetryConfig is a record with Default and None singletons', () => {
    const src = read(outDir, 'RetryConfig.cs');
    expect(src).toContain('public record RetryConfig(');
    expect(src).toContain('int      MaxRetries');
    expect(src).toContain('TimeSpan BaseDelay');
    expect(src).toContain('public static readonly RetryConfig Default');
    expect(src).toContain('public static readonly RetryConfig None');
  });

  // ── HttpTransport ─────────────────────────────────────────────────────────

  test('HttpTransport is async with retry loop and Retry-After', () => {
    const src = read(outDir, 'HttpTransport.cs');
    expect(src).toContain('internal sealed class HttpTransport');
    expect(src).toContain('internal async Task<T?>');
    expect(src).toContain('for (int attempt = 0; attempt <= _retry.MaxRetries; attempt++)');
    expect(src).toContain('Retry-After');
    expect(src).toContain('private TimeSpan Backoff(');
    expect(src).toContain('RetryableStatus');
    expect(src).toContain('RateLimitException');
    expect(src).toContain('AuthException');
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  test('CursorPage implements IAsyncEnumerable with GetAsyncEnumerator and ToListAsync', () => {
    const src = read(outDir, 'Pagination.cs');
    expect(src).toContain('public sealed class CursorPage<T> : IAsyncEnumerable<T>');
    expect(src).toContain('public async IAsyncEnumerator<T> GetAsyncEnumerator(');
    expect(src).toContain('public async Task<IReadOnlyList<T>> ToListAsync(');
    expect(src).toContain('public string?          NextCursor');
    expect(src).toContain('public bool             HasNext');
  });

  test('OffsetPage implements IAsyncEnumerable with offset tracking', () => {
    const src = read(outDir, 'Pagination.cs');
    expect(src).toContain('public sealed class OffsetPage<T> : IAsyncEnumerable<T>');
    expect(src).toContain('public long             Offset');
    expect(src).toContain('public long             Limit');
    expect(src).toContain('public async Task<IReadOnlyList<T>> ToListAsync(');
  });

  // ── Client ────────────────────────────────────────────────────────────────

  test('client has two constructors and IDisposable', () => {
    const src = read(outDir, 'WidgetAPIClient.cs');
    expect(src).toContain('public sealed class WidgetAPIClient : IDisposable');
    expect(src).toContain('public WidgetAPIClient(string baseUrl, string? apiKey = null)');
    expect(src).toContain('public WidgetAPIClient(string baseUrl, string? apiKey, RetryConfig retry)');
    expect(src).toContain('public void Dispose()');
  });

  test('listWidgets returns Task<CursorPage<Widget>>', () => {
    const src = read(outDir, 'WidgetAPIClient.cs');
    expect(src).toContain('Task<CursorPage<Widget>>');
    expect(src).toContain('ListWidgetsAsync(');
    expect(src).toContain('next_cursor');
  });

  test('getWidget returns Task<Widget?>', () => {
    const src = read(outDir, 'WidgetAPIClient.cs');
    expect(src).toContain('Task<Widget?>');
    expect(src).toContain('GetWidgetAsync(');
  });

  test('deleteWidget returns Task', () => {
    const src = read(outDir, 'WidgetAPIClient.cs');
    expect(src).toContain('public async Task DeleteWidgetAsync(');
  });

  test('createWidget accepts Widget? body', () => {
    const src = read(outDir, 'WidgetAPIClient.cs');
    expect(src).toContain('CreateWidgetAsync(');
    expect(src).toContain('Widget? body');
  });

  test('all methods have CancellationToken parameter', () => {
    const src = read(outDir, 'WidgetAPIClient.cs');
    const asyncMethods = src.split('\n').filter((l) => l.includes('public') && l.includes('Async('));
    expect(asyncMethods.length).toBeGreaterThan(0);
    for (const line of asyncMethods) {
      expect(line).toContain('CancellationToken');
    }
  });

  // ── .csproj ───────────────────────────────────────────────────────────────

  test('csproj targets net8.0 with nullable enabled and no extra deps', () => {
    const src = read(outDir, 'WidgetAPI.csproj');
    expect(src).toContain('<TargetFramework>net8.0</TargetFramework>');
    expect(src).toContain('<Nullable>enable</Nullable>');
    expect(src).toContain('<LangVersion>12</LangVersion>');
    expect(src).toContain('No additional NuGet dependencies');
  });

  test('all .cs files have auto-generated header', () => {
    for (const f of ['Models.cs', 'ApiException.cs', 'RetryConfig.cs', 'HttpTransport.cs', 'Pagination.cs']) {
      const src = read(outDir, f);
      expect(src).toContain('<auto-generated>');
    }
  });
});
