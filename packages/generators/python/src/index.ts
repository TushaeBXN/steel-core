import * as fs from 'fs';
import * as path from 'path';
import { OpenAPISpec, OpenAPIParser, SchemaObject, ResolvedModel, Operation } from '@steel-core/core';

export default class PythonGenerator {
  private parser!: OpenAPIParser;

  async generate(spec: OpenAPISpec, outputDir: string): Promise<void> {
    fs.mkdirSync(outputDir, { recursive: true });
    this.parser = new OpenAPIParser();
    this.parser.parse(spec);

    const models = this.parser.getModels();
    const operations = this.parser.getOperations(spec);
    const className = this.toClassName(spec.info.title);

    fs.writeFileSync(path.join(outputDir, 'models.py'), this.renderModels(models));
    fs.writeFileSync(path.join(outputDir, '_http.py'), this.renderHttpLayer());
    fs.writeFileSync(path.join(outputDir, '_pagination.py'), this.renderPagination());
    fs.writeFileSync(path.join(outputDir, 'client.py'), this.renderClient(className, spec, operations, false));
    fs.writeFileSync(path.join(outputDir, 'async_client.py'), this.renderClient(className, spec, operations, true));
    fs.writeFileSync(path.join(outputDir, '__init__.py'), [
      `from .client import ${className}`,
      `from .async_client import Async${className}`,
      'from .models import *',
      '',
      `__all__ = ["${className}", "Async${className}"]`,
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(outputDir, 'requirements.txt'), 'httpx>=0.27.0\n');

    console.log(`  Created: models.py, _http.py, _pagination.py, client.py, async_client.py`);
  }

  // ── HTTP layer (retry + shared request logic) ────────────────────────────

  private renderHttpLayer(): string {
    return `"""Shared HTTP transport with retry logic — do not edit manually."""
from __future__ import annotations
import time
import random
from typing import Any, Optional
import httpx


RETRYABLE_STATUS = {429, 500, 502, 503, 504}
RETRYABLE_EXCEPTIONS = (httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadTimeout)


class RetryConfig:
    def __init__(
        self,
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 60.0,
        jitter: bool = True,
    ) -> None:
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.jitter = jitter


def _backoff(attempt: int, config: RetryConfig) -> float:
    delay = min(config.base_delay * (2 ** attempt), config.max_delay)
    if config.jitter:
        delay *= (0.5 + random.random() * 0.5)
    return delay


class HttpTransport:
    def __init__(
        self,
        base_url: str,
        headers: dict[str, str],
        timeout: float,
        retry: RetryConfig,
    ) -> None:
        self._client = httpx.Client(base_url=base_url, headers=headers, timeout=timeout)
        self._retry = retry

    def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: Optional[dict[str, Any]] = None,
    ) -> Any:
        last_exc: Optional[Exception] = None
        for attempt in range(self._retry.max_retries + 1):
            try:
                resp = self._client.request(method, path, json=json, params=params)
                if resp.status_code in RETRYABLE_STATUS and attempt < self._retry.max_retries:
                    time.sleep(_backoff(attempt, self._retry))
                    continue
                resp.raise_for_status()
                if resp.status_code == 204:
                    return None
                return resp.json()
            except RETRYABLE_EXCEPTIONS as exc:
                last_exc = exc
                if attempt < self._retry.max_retries:
                    time.sleep(_backoff(attempt, self._retry))
        raise last_exc or RuntimeError("Request failed after retries")

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "HttpTransport":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


class AsyncHttpTransport:
    def __init__(
        self,
        base_url: str,
        headers: dict[str, str],
        timeout: float,
        retry: RetryConfig,
    ) -> None:
        self._client = httpx.AsyncClient(base_url=base_url, headers=headers, timeout=timeout)
        self._retry = retry

    async def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: Optional[dict[str, Any]] = None,
    ) -> Any:
        import asyncio
        last_exc: Optional[Exception] = None
        for attempt in range(self._retry.max_retries + 1):
            try:
                resp = await self._client.request(method, path, json=json, params=params)
                if resp.status_code in RETRYABLE_STATUS and attempt < self._retry.max_retries:
                    await asyncio.sleep(_backoff(attempt, self._retry))
                    continue
                resp.raise_for_status()
                if resp.status_code == 204:
                    return None
                return resp.json()
            except RETRYABLE_EXCEPTIONS as exc:
                last_exc = exc
                if attempt < self._retry.max_retries:
                    import asyncio as _aio
                    await _aio.sleep(_backoff(attempt, self._retry))
        raise last_exc or RuntimeError("Request failed after retries")

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "AsyncHttpTransport":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.aclose()
`;
  }

  // ── Pagination ──────────────────────────────────��─────────────────────────

  private renderPagination(): string {
    return `"""Pagination helpers — do not edit manually."""
from __future__ import annotations
from typing import Any, Generic, Iterator, AsyncIterator, Optional, TypeVar

T = TypeVar("T")


class Page(Generic[T]):
    """Cursor-based page. Iterate with a plain for-loop; pages are fetched lazily."""

    def __init__(
        self,
        items: list[T],
        next_cursor: Optional[str],
        _fetch: Any,  # callable(cursor) -> Page[T]
    ) -> None:
        self.items = items
        self.next_cursor = next_cursor
        self._fetch = _fetch
        self.has_next = next_cursor is not None

    def __iter__(self) -> Iterator[T]:
        page: Optional[Page[T]] = self
        while page is not None:
            yield from page.items
            if page.next_cursor:
                page = page._fetch(page.next_cursor)
            else:
                page = None

    def auto_paging(self) -> Iterator[T]:
        """Alias for __iter__ — explicit name for readability."""
        return iter(self)


class AsyncPage(Generic[T]):
    """Async cursor-based page."""

    def __init__(
        self,
        items: list[T],
        next_cursor: Optional[str],
        _fetch: Any,  # async callable(cursor) -> AsyncPage[T]
    ) -> None:
        self.items = items
        self.next_cursor = next_cursor
        self._fetch = _fetch
        self.has_next = next_cursor is not None

    async def __aiter__(self) -> AsyncIterator[T]:
        page: Optional[AsyncPage[T]] = self
        while page is not None:
            for item in page.items:
                yield item
            if page.next_cursor:
                page = await page._fetch(page.next_cursor)
            else:
                page = None


class OffsetPage(Generic[T]):
    """Offset/limit-based page."""

    def __init__(
        self,
        items: list[T],
        total: Optional[int],
        offset: int,
        limit: int,
        _fetch: Any,  # callable(offset, limit) -> OffsetPage[T]
    ) -> None:
        self.items = items
        self.total = total
        self.offset = offset
        self.limit = limit
        self._fetch = _fetch
        self.has_next = total is None or (offset + len(items)) < total

    def __iter__(self) -> Iterator[T]:
        page: Optional[OffsetPage[T]] = self
        while page is not None:
            yield from page.items
            if page.has_next:
                next_offset = page.offset + page.limit
                page = page._fetch(next_offset, page.limit)
            else:
                page = None
`;
  }

  // ── Client rendering ─────────────────────────────────────────────────────

  private renderClient(
    className: string,
    spec: OpenAPISpec,
    operations: ReturnType<OpenAPIParser['getOperations']>,
    async_: boolean,
  ): string {
    const prefix = async_ ? 'Async' : '';
    const transport = async_ ? 'AsyncHttpTransport' : 'HttpTransport';
    const methods = operations.map((op) => this.renderMethod(op, async_)).join('\n\n');
    const awaitKw = async_ ? 'await ' : '';
    const asyncDef = async_ ? 'async ' : '';
    const ctxBase = async_ ? 'AsyncHttpTransport' : 'HttpTransport';
    const enterExit = async_
      ? `    async def __aenter__(self) -> "${prefix}${className}":
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self._http.aclose()`
      : `    def __enter__(self) -> "${prefix}${className}":
        return self

    def __exit__(self, *_: Any) -> None:
        self._http.close()`;

    return `"""
${spec.info.title} v${spec.info.version} — auto-generated by Steel Core
${async_ ? 'Async client — use with async/await.' : 'Sync client.'}
"""
from __future__ import annotations
from typing import Any, Optional
from ._http import ${ctxBase}, RetryConfig
from ._pagination import Page${async_ ? ', AsyncPage' : ''}, OffsetPage
from .models import *


class ${prefix}${className}:
    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        timeout: float = 30.0,
        retry: Optional[RetryConfig] = None,
    ) -> None:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._http = ${transport}(base_url, headers, timeout, retry or RetryConfig())

${enterExit}

${methods}
`;
  }

  private renderMethod(
    op: { path: string; method: string; operation: Operation },
    async_: boolean,
  ): string {
    const name = op.operation.operationId
      ? this.toSnakeCase(op.operation.operationId)
      : `${op.method}_${this.toSnakeCase(op.path.replace(/[{}]/g, '').replace(/\//g, '_'))}`;

    const pathParams = (op.operation.parameters ?? [])
      .filter((p) => p.in === 'path')
      .map((p) => `${this.toSnakeCase(p.name)}: ${this.schemaToType(p.schema)}`);

    const queryParams = (op.operation.parameters ?? [])
      .filter((p) => p.in === 'query')
      .map((p) => `${this.toSnakeCase(p.name)}: Optional[${this.schemaToType(p.schema)}] = None`);

    const bodySchema = op.operation.requestBody
      ? this.parser.getRequestBodySchema(op.operation) : null;
    const bodyType = bodySchema?.['x-schema-name'] ?? (bodySchema ? 'dict[str, Any]' : null);
    const bodyParam = bodyType ? [`body: Optional[${bodyType}] = None`] : [];

    const returnSchema = this.parser.getResponseSchema(op.operation);
    const rawReturnType = returnSchema?.['x-schema-name']
      ?? (returnSchema ? this.schemaToType(returnSchema) : 'Any');

    // Detect paginated list responses: object with array `items` and optional `next_cursor`/`total`
    const isPaginated = this.isPaginatedResponse(returnSchema);
    const itemType = isPaginated ? this.getPaginationItemType(returnSchema!) : null;
    const hasCursor = isPaginated && returnSchema?.properties?.['next_cursor'] != null;
    const hasOffset = isPaginated && returnSchema?.properties?.['total'] != null;
    const pageClass = async_
      ? (hasCursor ? 'AsyncPage' : 'OffsetPage')
      : (hasCursor ? 'Page' : 'OffsetPage');
    const returnType = isPaginated ? `${pageClass}[${itemType}]` : rawReturnType;

    const allParams = ['self', ...pathParams, ...queryParams, ...bodyParam].join(', ');
    const urlPath = op.path.replace(/{(\w+)}/g, '{$1}');
    const doc = op.operation.summary ?? op.operation.description ?? '';
    const asyncDef = async_ ? 'async ' : '';
    const awaitKw = async_ ? 'await ' : '';

    const queryArgs = (op.operation.parameters ?? [])
      .filter((p) => p.in === 'query')
      .map((p) => `"${p.name}": ${this.toSnakeCase(p.name)}`);
    const paramsExpr = queryArgs.length
      ? `params={k: v for k, v in {${queryArgs.join(', ')}}.items() if v is not None}`
      : 'params=None';

    if (isPaginated) {
      const fetchBody = hasCursor
        ? this.renderCursorFetchBody(urlPath, bodyType, paramsExpr, awaitKw, async_, itemType!, pageClass)
        : this.renderOffsetFetchBody(urlPath, bodyType, paramsExpr, awaitKw, async_, itemType!, pageClass);
      return `    ${asyncDef}def ${name}(${allParams}) -> ${returnType}:
        """${doc}"""
${fetchBody}`;
    }

    return `    ${asyncDef}def ${name}(${allParams}) -> ${returnType}:
        """${doc}"""
        return ${awaitKw}self._http.request(
            "${op.method.toUpperCase()}", f"${urlPath}",
            json=body${bodyType ? '' : ' if False else None'},
            ${paramsExpr},
        )`;
  }

  private renderCursorFetchBody(
    urlPath: string, bodyType: string | null, paramsExpr: string,
    awaitKw: string, async_: boolean, itemType: string, pageClass: string,
  ): string {
    const asyncDef = async_ ? 'async ' : '';
    const awaitCall = awaitKw;
    return `        ${asyncDef}def _fetch(cursor: Optional[str] = None) -> ${pageClass}[${itemType}]:
            p = {**{k: v for k, v in ({${paramsExpr.slice(7, -1)}}).items() if v is not None}}
            if cursor:
                p["cursor"] = cursor
            raw = ${awaitCall}self._http.request("GET", f"${urlPath}", params=p or None)
            return ${pageClass}(raw.get("items", []), raw.get("next_cursor"), _fetch)
        return ${awaitCall}_fetch()`;
  }

  private renderOffsetFetchBody(
    urlPath: string, bodyType: string | null, paramsExpr: string,
    awaitKw: string, async_: boolean, itemType: string, pageClass: string,
  ): string {
    const asyncDef = async_ ? 'async ' : '';
    return `        ${asyncDef}def _fetch(offset: int = 0, limit: int = 50) -> ${pageClass}[${itemType}]:
            p = {**{k: v for k, v in ({${paramsExpr.slice(7, -1)}}).items() if v is not None},
                 "offset": offset, "limit": limit}
            raw = ${awaitKw}self._http.request("GET", f"${urlPath}", params=p)
            return ${pageClass}(raw.get("items", []), raw.get("total"), offset, limit, _fetch)
        return ${awaitKw}_fetch()`;
  }

  // ── Pagination detection ──────��───────────────────────────────────────────

  private isPaginatedResponse(schema: SchemaObject | null): boolean {
    if (!schema?.properties) return false;
    return 'items' in schema.properties && schema.properties['items'].type === 'array';
  }

  private getPaginationItemType(schema: SchemaObject): string {
    const items = schema.properties!['items'];
    return items.items?.['x-schema-name'] ?? this.schemaToType(items.items ?? {});
  }

  // ── Type helpers ──────────────────────────────────────────────────────────

  private schemaToType(schema: SchemaObject): string {
    if (schema.$ref) return schema.$ref.split('/').pop()!;
    if (schema['x-schema-name']) return schema['x-schema-name'];
    if (schema.oneOf ?? schema.anyOf) {
      const variants = (schema.oneOf ?? schema.anyOf)!.map((s) => this.schemaToType(s));
      return `Union[${variants.join(', ')}]`;
    }
    if (schema.nullable) return `Optional[${this.schemaToType({ ...schema, nullable: false })}]`;
    switch (schema.type) {
      case 'string':  return 'str';
      case 'integer': return 'int';
      case 'number':  return 'float';
      case 'boolean': return 'bool';
      case 'array':   return `List[${schema.items ? this.schemaToType(schema.items) : 'Any'}]`;
      case 'object':  return 'dict[str, Any]';
      default:        return 'Any';
    }
  }

  private renderModel(name: string, schema: SchemaObject): string[] {
    if (schema.enum) {
      return [
        `class ${name}:`,
        ...schema.enum.map((v) => `    ${String(v).toUpperCase().replace(/[^A-Z0-9]/g, '_')} = ${JSON.stringify(v)}`),
      ];
    }
    if (schema.oneOf ?? schema.anyOf) {
      const variants = (schema.oneOf ?? schema.anyOf)!.map((s) => this.schemaToType(s)).join(', ');
      return [`${name} = Union[${variants}]`];
    }
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const sortedProps = [
      ...Object.entries(props).filter(([k]) => required.has(k)),
      ...Object.entries(props).filter(([k]) => !required.has(k)),
    ];
    const fields: string[] = [];
    for (const [propName, propSchema] of sortedProps) {
      const pyType = this.schemaToType(propSchema);
      const safeName = this.toSnakeCase(propName);
      if (required.has(propName)) {
        fields.push(`    ${safeName}: ${pyType}`);
      } else {
        const defaultVal = propSchema.type === 'array' ? 'field(default_factory=list)' : 'None';
        const optType = propSchema.type === 'array' ? pyType : `Optional[${pyType}]`;
        fields.push(`    ${safeName}: ${optType} = ${defaultVal}`);
      }
    }
    if (!fields.length) fields.push('    pass');
    const lines = ['@dataclass', `class ${name}:`];
    if (schema.description) lines.push(`    """${schema.description}"""`);
    lines.push(...fields);
    return lines;
  }

  private renderModels(models: ResolvedModel[]): string {
    const lines: string[] = [
      '"""Auto-generated models — do not edit manually."""',
      'from __future__ import annotations',
      'from dataclasses import dataclass, field',
      'from typing import Any, List, Optional, Union',
      '',
    ];
    for (const model of models) {
      lines.push(...this.renderModel(model.name, model.schema));
      lines.push('');
    }
    return lines.join('\n');
  }

  private toClassName(title: string): string {
    return title.replace(/[^a-zA-Z0-9]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s/g, '') + 'Client';
  }

  private toSnakeCase(str: string): string {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '').replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
  }
}
