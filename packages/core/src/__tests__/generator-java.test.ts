import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import JavaGenerator from '@steel-core/generator-java';
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
      Status: {
        type: 'string',
        enum: ['active', 'inactive', 'pending'],
      },
      Widget: {
        type: 'object',
        required: ['id', 'name'],
        description: 'A widget resource',
        properties: {
          id:     { type: 'string' },
          name:   { type: 'string' },
          count:  { type: 'integer' },
          active: { type: 'boolean' },
          tags:   { type: 'array', items: { type: 'string' } },
          status: { $ref: '#/components/schemas/Status' },
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

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'steelcore-java-')); }

function srcDir(out: string) {
  return path.join(out, 'src', 'main', 'java', 'com', 'example', 'widgetapi');
}

function read(out: string, file: string) {
  return fs.readFileSync(path.join(srcDir(out), file), 'utf-8');
}

describe('JavaGenerator', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = tmpDir();
    const gen = new JavaGenerator();
    const spec = new OpenAPIParser().parse(SPEC);
    await gen.generate(spec, outDir);
  });

  afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

  test('creates expected source files', () => {
    for (const f of [
      'Widget.java', 'Status.java', 'WidgetPage.java',
      'ApiException.java', 'RetryConfig.java', 'HttpTransport.java',
      'CursorPage.java', 'OffsetPage.java', 'WidgetAPIClient.java',
    ]) {
      expect(fs.existsSync(path.join(srcDir(outDir), f))).toBe(true);
    }
  });

  test('creates pom.xml and build.gradle.kts', () => {
    expect(fs.existsSync(path.join(outDir, 'pom.xml'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'build.gradle.kts'))).toBe(true);
  });

  test('Widget.java is a record with correct package', () => {
    const src = read(outDir, 'Widget.java');
    expect(src).toContain('package com.example.widgetapi;');
    expect(src).toContain('public record Widget(');
    expect(src).toContain('String id');
    expect(src).toContain('String name');
    expect(src).toContain('Long count');      // optional integer (no int32 format) → Long
    expect(src).toContain('List<String> tags');
    expect(src).toContain('@JsonIgnoreProperties(ignoreUnknown = true)');
  });

  test('Status.java is an enum with getValue()', () => {
    const src = read(outDir, 'Status.java');
    expect(src).toContain('public enum Status');
    expect(src).toContain('ACTIVE("active")');
    expect(src).toContain('INACTIVE("inactive")');
    expect(src).toContain('PENDING("pending")');
    expect(src).toContain('public String getValue()');
    expect(src).toContain('public static Status fromValue(');
  });

  test('ApiException has status, body, url and isRetryable()', () => {
    const src = read(outDir, 'ApiException.java');
    expect(src).toContain('public class ApiException extends RuntimeException');
    expect(src).toContain('private final int statusCode;');
    expect(src).toContain('public boolean isRetryable()');
    expect(src).toContain('statusCode == 429');
  });

  test('RetryConfig is a record with defaults() factory', () => {
    const src = read(outDir, 'RetryConfig.java');
    expect(src).toContain('public record RetryConfig(');
    expect(src).toContain('int maxRetries');
    expect(src).toContain('Duration baseDelay');
    expect(src).toContain('public static RetryConfig defaults()');
    expect(src).toContain('public static RetryConfig none()');
  });

  test('HttpTransport has retry loop and Retry-After handling', () => {
    const src = read(outDir, 'HttpTransport.java');
    expect(src).toContain('for (int attempt = 0; attempt <= retry.maxRetries(); attempt++)');
    expect(src).toContain('Retry-After');
    expect(src).toContain('private Duration backoff(int attempt)');
    expect(src).toContain('RETRYABLE_STATUS');
    expect(src).toContain('java.net.http.HttpClient');
  });

  test('CursorPage implements Iterable and has toList()', () => {
    const src = read(outDir, 'CursorPage.java');
    expect(src).toContain('public class CursorPage<T> implements Iterable<T>');
    expect(src).toContain('public List<T> toList()');
    expect(src).toContain('public Iterator<T> iterator()');
    expect(src).toContain('Function<String, CursorPage<T>> fetch');
  });

  test('OffsetPage implements Iterable and has toList()', () => {
    const src = read(outDir, 'OffsetPage.java');
    expect(src).toContain('public class OffsetPage<T> implements Iterable<T>');
    expect(src).toContain('public List<T> toList()');
    expect(src).toContain('BiFunction<Long, Long, OffsetPage<T>> fetch');
  });

  test('client has two constructors and HttpTransport field', () => {
    const src = read(outDir, 'WidgetAPIClient.java');
    expect(src).toContain('public WidgetAPIClient(String baseUrl, String apiKey)');
    expect(src).toContain('public WidgetAPIClient(String baseUrl, String apiKey, RetryConfig retry)');
    expect(src).toContain('private final HttpTransport http;');
  });

  test('listWidgets returns CursorPage<Widget>', () => {
    const src = read(outDir, 'WidgetAPIClient.java');
    expect(src).toContain('CursorPage<Widget>');
    expect(src).toContain('next_cursor');
    expect(src).toContain('listWidgets(');
  });

  test('getWidget returns Widget', () => {
    const src = read(outDir, 'WidgetAPIClient.java');
    expect(src).toContain('public Widget getWidget(');
    expect(src).toContain('Widget.class');
  });

  test('deleteWidget returns void', () => {
    const src = read(outDir, 'WidgetAPIClient.java');
    expect(src).toContain('public void deleteWidget(');
    expect(src).toContain('Void.class');
  });

  test('createWidget accepts Widget body', () => {
    const src = read(outDir, 'WidgetAPIClient.java');
    expect(src).toContain('createWidget(');
    expect(src).toContain('Widget body');
  });

  test('pom.xml targets Java 17 and includes Jackson', () => {
    const src = fs.readFileSync(path.join(outDir, 'pom.xml'), 'utf-8');
    expect(src).toContain('<java.version>17</java.version>');
    expect(src).toContain('jackson-databind');
    expect(src).toContain('junit-jupiter');
    expect(src).toContain('<groupId>com.example</groupId>');
  });

  test('build.gradle.kts targets Java 17 and includes Jackson', () => {
    const src = fs.readFileSync(path.join(outDir, 'build.gradle.kts'), 'utf-8');
    expect(src).toContain('JavaVersion.VERSION_17');
    expect(src).toContain('jackson-databind');
    expect(src).toContain('junit-jupiter');
  });
});
