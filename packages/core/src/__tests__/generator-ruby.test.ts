import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import RubyGenerator from '@steel-core/generator-ruby';
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
        enum: ['active', 'inactive'],
      },
      Widget: {
        type: 'object',
        required: ['id', 'name'],
        description: 'A widget',
        properties: {
          id:     { type: 'string' },
          name:   { type: 'string' },
          count:  { type: 'integer' },
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

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'steelcore-ruby-')); }
function read(dir: string, ...parts: string[]) { return fs.readFileSync(path.join(dir, ...parts), 'utf-8'); }

describe('RubyGenerator', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = tmpDir();
    const gen = new RubyGenerator();
    const spec = new OpenAPIParser().parse(SPEC);
    await gen.generate(spec, outDir);
  });

  afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

  test('creates all expected files', () => {
    const gem = 'widget_api';
    for (const f of [
      `lib/${gem}/version.rb`, `lib/${gem}/errors.rb`, `lib/${gem}/http.rb`,
      `lib/${gem}/pagination.rb`, `lib/${gem}/models.rb`, `lib/${gem}/client.rb`,
      `lib/${gem}.rb`, `${gem}.gemspec`, 'Gemfile',
    ]) {
      expect(fs.existsSync(path.join(outDir, f))).toBe(true);
    }
  });

  test('version.rb declares VERSION constant', () => {
    const src = read(outDir, 'lib/widget_api/version.rb');
    expect(src).toContain('module WidgetAPI');
    expect(src).toContain('VERSION = "1.0.0"');
  });

  test('errors.rb defines error hierarchy', () => {
    const src = read(outDir, 'lib/widget_api/errors.rb');
    expect(src).toContain('class Error < StandardError');
    expect(src).toContain('class APIError < Error');
    expect(src).toContain('class RateLimitError < APIError');
    expect(src).toContain('class TimeoutError < Error');
    expect(src).toContain('class AuthError < APIError');
  });

  test('http.rb has RetryConfig struct', () => {
    const src = read(outDir, 'lib/widget_api/http.rb');
    expect(src).toContain('RetryConfig = Struct.new');
    expect(src).toContain('max_retries:');
    expect(src).toContain('base_delay:');
    expect(src).toContain('RETRYABLE_STATUS');
    expect(src).toContain('Retry-After');
  });

  test('http.rb has HttpTransport with retry loop', () => {
    const src = read(outDir, 'lib/widget_api/http.rb');
    expect(src).toContain('class HttpTransport');
    expect(src).toContain('max_retries + 1).times do |attempt|');
    expect(src).toContain('def _backoff');
    expect(src).toContain('RateLimitError');
  });

  test('pagination.rb defines CursorPage with Enumerable', () => {
    const src = read(outDir, 'lib/widget_api/pagination.rb');
    expect(src).toContain('class CursorPage');
    expect(src).toContain('include Enumerable');
    expect(src).toContain('next_cursor');
    expect(src).toContain('def each');
  });

  test('pagination.rb defines OffsetPage with Enumerable', () => {
    const src = read(outDir, 'lib/widget_api/pagination.rb');
    expect(src).toContain('class OffsetPage');
    expect(src).toContain('include Enumerable');
    expect(src).toContain('has_next');
  });

  test('models.rb generates Widget Struct', () => {
    const src = read(outDir, 'lib/widget_api/models.rb');
    expect(src).toContain('Widget = ::Struct.new');
    expect(src).toContain(':id');
    expect(src).toContain(':name');
    expect(src).toContain('id is required');
    expect(src).toContain('name is required');
  });

  test('models.rb generates Status enum module', () => {
    const src = read(outDir, 'lib/widget_api/models.rb');
    expect(src).toContain('module Status');
    expect(src).toContain('ACTIVE = "active"');
    expect(src).toContain('INACTIVE = "inactive"');
  });

  test('client.rb defines Client class with constructor', () => {
    const src = read(outDir, 'lib/widget_api/client.rb');
    expect(src).toContain('class Client');
    expect(src).toContain('def initialize(base_url:');
    expect(src).toContain('api_key: nil');
    expect(src).toContain('RetryConfig.new');
    expect(src).toContain('HttpTransport.new');
  });

  test('list operation returns CursorPage', () => {
    const src = read(outDir, 'lib/widget_api/client.rb');
    expect(src).toContain('def list_widgets(');
    expect(src).toContain('CursorPage.new');
    expect(src).toContain('next_cursor');
    expect(src).toContain('cursor: nil');
  });

  test('create operation passes body', () => {
    const src = read(outDir, 'lib/widget_api/client.rb');
    expect(src).toContain('def create_widget(');
    expect(src).toContain('body: nil');
  });

  test('get uses interpolated path param', () => {
    const src = read(outDir, 'lib/widget_api/client.rb');
    expect(src).toContain('def get_widget(id');
    expect(src).toContain('#{id}');
  });

  test('delete uses interpolated path param', () => {
    const src = read(outDir, 'lib/widget_api/client.rb');
    expect(src).toContain('def delete_widget(id');
  });

  test('entrypoint requires all files', () => {
    const src = read(outDir, 'lib/widget_api.rb');
    expect(src).toContain('require_relative "widget_api/version"');
    expect(src).toContain('require_relative "widget_api/errors"');
    expect(src).toContain('require_relative "widget_api/http"');
    expect(src).toContain('require_relative "widget_api/pagination"');
    expect(src).toContain('require_relative "widget_api/models"');
    expect(src).toContain('require_relative "widget_api/client"');
    expect(src).toContain('def self.new(');
  });

  test('gemspec has correct metadata', () => {
    const src = read(outDir, 'widget_api.gemspec');
    expect(src).toContain('spec.name        = "widget_api"');
    expect(src).toContain('WidgetAPI::VERSION');
    expect(src).toContain('required_ruby_version = ">= 3.0.0"');
    expect(src).toContain('No runtime dependencies');
  });

  test('all files have frozen_string_literal magic comment', () => {
    const gem = 'widget_api';
    for (const f of [
      `lib/${gem}/version.rb`, `lib/${gem}/errors.rb`, `lib/${gem}/http.rb`,
      `lib/${gem}/pagination.rb`, `lib/${gem}/models.rb`, `lib/${gem}/client.rb`,
      `lib/${gem}.rb`,
    ]) {
      const src = read(outDir, f);
      expect(src.startsWith('# frozen_string_literal: true')).toBe(true);
    }
  });
});
