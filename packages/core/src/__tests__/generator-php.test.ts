import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import PhpGenerator from '@steel-core/generator-php';
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

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'steelcore-php-')); }
function readSrc(dir: string, file: string) { return fs.readFileSync(path.join(dir, 'src', file), 'utf-8'); }
function read(dir: string, file: string)    { return fs.readFileSync(path.join(dir, file), 'utf-8'); }

describe('PhpGenerator', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = tmpDir();
    const gen = new PhpGenerator();
    const spec = new OpenAPIParser().parse(SPEC);
    await gen.generate(spec, outDir);
  });

  afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

  // ── File existence ────────────────────────────────────────────────────────

  test('creates all expected files', () => {
    const srcFiles = [
      'Widget.php', 'Status.php', 'WidgetPage.php',
      'ApiException.php', 'RetryConfig.php', 'HttpTransport.php',
      'CursorPage.php', 'OffsetPage.php', 'WidgetAPIClient.php',
    ];
    for (const f of srcFiles) {
      expect(fs.existsSync(path.join(outDir, 'src', f))).toBe(true);
    }
    expect(fs.existsSync(path.join(outDir, 'composer.json'))).toBe(true);
  });

  // ── Models ────────────────────────────────────────────────────────────────

  test('all PHP files have declare(strict_types=1)', () => {
    const files = fs.readdirSync(path.join(outDir, 'src'));
    for (const f of files) {
      const src = readSrc(outDir, f);
      expect(src).toContain('declare(strict_types=1);');
    }
  });

  test('Widget.php is a readonly class with correct namespace', () => {
    const src = readSrc(outDir, 'Widget.php');
    expect(src).toContain('namespace WidgetAPI;');
    expect(src).toContain('readonly class Widget');
    expect(src).toContain('public readonly string $id');
    expect(src).toContain('public readonly string $name');
    expect(src).toContain('public readonly ?int $count');    // optional → nullable
    expect(src).toContain('public readonly ?bool $active');
    expect(src).toContain('public readonly ?array $tags');
  });

  test('Widget.php has fromArray() and toArray()', () => {
    const src = readSrc(outDir, 'Widget.php');
    expect(src).toContain('public static function fromArray(array $data): self');
    expect(src).toContain('public function toArray(): array');
    expect(src).toContain("array_filter([");
  });

  test('Status.php is a backed enum', () => {
    const src = readSrc(outDir, 'Status.php');
    expect(src).toContain("enum Status: string");
    expect(src).toContain("case Active = 'active'");
    expect(src).toContain("case Inactive = 'inactive'");
    expect(src).toContain("case Pending = 'pending'");
  });

  // ── Exceptions ────────────────────────────────────────────────────────────

  test('ApiException.php has typed properties and isRetryable()', () => {
    const src = readSrc(outDir, 'ApiException.php');
    expect(src).toContain('class ApiException extends \\RuntimeException');
    expect(src).toContain('public readonly int    $statusCode');
    expect(src).toContain('public function isRetryable(): bool');
    expect(src).toContain('$this->statusCode === 429');
    expect(src).toContain('class RateLimitException extends ApiException');
    expect(src).toContain('class AuthException extends ApiException');
  });

  // ── RetryConfig ───────────────────────────────────────────────────────────

  test('RetryConfig.php is readonly class with default() and none()', () => {
    const src = readSrc(outDir, 'RetryConfig.php');
    expect(src).toContain('readonly class RetryConfig');
    expect(src).toContain('public int   $maxRetries = 3');
    expect(src).toContain('public float $baseDelay  = 1.0');
    expect(src).toContain('public static function default(): self');
    expect(src).toContain('public static function none(): self');
  });

  // ── HttpTransport ─────────────────────────────────────────────────────────

  test('HttpTransport.php uses curl with retry loop', () => {
    const src = readSrc(outDir, 'HttpTransport.php');
    expect(src).toContain('class HttpTransport');
    expect(src).toContain('for ($attempt = 0; $attempt <= $this->retry->maxRetries; $attempt++)');
    expect(src).toContain('retry-after');
    expect(src).toContain('private function backoff(int $attempt): float');
    expect(src).toContain('RETRYABLE_STATUS');
    expect(src).toContain('curl_init()');
    expect(src).toContain('RateLimitException');
    expect(src).toContain('AuthException');
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  test('CursorPage.php implements IteratorAggregate with Generator', () => {
    const src = readSrc(outDir, 'CursorPage.php');
    expect(src).toContain('class CursorPage implements \\IteratorAggregate, \\Countable');
    expect(src).toContain('public function getIterator(): \\Generator');
    expect(src).toContain('public function toArray(): array');
    expect(src).toContain('yield from $page->items');
    expect(src).toContain('public readonly ?string  $nextCursor');
  });

  test('OffsetPage.php implements IteratorAggregate with has_next', () => {
    const src = readSrc(outDir, 'OffsetPage.php');
    expect(src).toContain('class OffsetPage implements \\IteratorAggregate, \\Countable');
    expect(src).toContain('public readonly bool $hasNext');
    expect(src).toContain('public function getIterator(): \\Generator');
    expect(src).toContain('yield from $page->items');
  });

  // ── Client ────────────────────────────────────────────────────────────────

  test('client constructor accepts baseUrl, apiKey, RetryConfig', () => {
    const src = readSrc(outDir, 'WidgetAPIClient.php');
    expect(src).toContain('class WidgetAPIClient');
    expect(src).toContain('$baseUrl');
    expect(src).toContain('$apiKey');
    expect(src).toContain('RetryConfig');
    expect(src).toContain('Authorization');
  });

  test('listWidgets returns CursorPage', () => {
    const src = readSrc(outDir, 'WidgetAPIClient.php');
    expect(src).toContain('function listWidgets(');
    expect(src).toContain('): CursorPage');
    expect(src).toContain('CursorPage(');
    expect(src).toContain('next_cursor');
  });

  test('getWidget returns ?Widget', () => {
    const src = readSrc(outDir, 'WidgetAPIClient.php');
    expect(src).toContain('function getWidget(');
    expect(src).toContain('): ?Widget');
    expect(src).toContain('Widget::fromArray(');
  });

  test('deleteWidget has no typed return (mixed)', () => {
    const src = readSrc(outDir, 'WidgetAPIClient.php');
    expect(src).toContain('function deleteWidget(');
    expect(src).toContain(': mixed');
  });

  test('createWidget accepts body parameter', () => {
    const src = readSrc(outDir, 'WidgetAPIClient.php');
    expect(src).toContain('function createWidget(');
    expect(src).toContain('$body');
  });

  // ── composer.json ─────────────────────────────────────────────────────────

  test('composer.json has correct structure', () => {
    const composer = JSON.parse(read(outDir, 'composer.json'));
    expect(composer.require.php).toBe('>=8.2');
    expect(composer.require['ext-curl']).toBe('*');
    expect(composer.autoload['psr-4']['WidgetAPI\\']).toBe('src/');
    expect(composer['require-dev']['phpunit/phpunit']).toContain('^11');
  });
});
