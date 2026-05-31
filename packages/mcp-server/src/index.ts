import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { OpenAPIParser } from '@steel-core/core';
import { runInSandbox } from './security/sandbox.js';
import { RateLimiter } from './security/rate-limiter.js';
import { assertSafeUrl } from './security/ssrf-filter.js';
import { validateSpecInput, validateLanguage, sanitizeOutputPath } from './security/input-validator.js';

const rateLimiter = new RateLimiter(10, 1);

const server = new Server(
  { name: 'steel-core', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'parse_openapi',
      description: 'Parse and validate an OpenAPI spec, returning a summary of endpoints',
      inputSchema: {
        type: 'object',
        properties: {
          spec: { type: ['string', 'object'], description: 'OpenAPI spec as JSON string or object' },
        },
        required: ['spec'],
      },
    },
    {
      name: 'generate_sdk',
      description: 'Generate a client SDK from an OpenAPI spec',
      inputSchema: {
        type: 'object',
        properties: {
          spec: { type: ['string', 'object'], description: 'OpenAPI spec as JSON string or object' },
          language: { type: 'string', enum: ['python', 'typescript'], description: 'Target language' },
          outputPath: { type: 'string', description: 'Relative output directory' },
        },
        required: ['spec', 'language', 'outputPath'],
      },
    },
    {
      name: 'run_code',
      description: 'Run a small code snippet in a sandboxed environment',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Code to execute' },
          language: { type: 'string', enum: ['python', 'node'], description: 'Runtime' },
        },
        required: ['code', 'language'],
      },
    },
    {
      name: 'fetch_spec',
      description: 'Fetch an OpenAPI spec from a URL',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL of the OpenAPI spec' },
        },
        required: ['url'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const clientId = 'mcp-client';
  if (!rateLimiter.allow(clientId)) {
    return { content: [{ type: 'text', text: 'Rate limit exceeded. Please slow down.' }], isError: true };
  }

  const { name, arguments: args = {} } = req.params;

  try {
    switch (name) {
      case 'parse_openapi': {
        const raw = validateSpecInput(args['spec']);
        const parser = new OpenAPIParser();
        const spec = parser.parse(raw);
        const ops = parser.getOperations(spec);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              title: spec.info.title,
              version: spec.info.version,
              operationCount: ops.length,
              operations: ops.map((o) => ({
                method: o.method.toUpperCase(),
                path: o.path,
                operationId: o.operation.operationId,
                summary: o.operation.summary,
              })),
            }, null, 2),
          }],
        };
      }

      case 'generate_sdk': {
        const raw = validateSpecInput(args['spec']);
        const lang = validateLanguage(args['language']);
        const outPath = sanitizeOutputPath(args['outputPath']);
        const parser = new OpenAPIParser();
        const spec = parser.parse(raw);

        const generatorModule = await import(`@steel-core/generator-${lang}`);
        const generator = new generatorModule.default();
        await generator.generate(spec, outPath);

        return { content: [{ type: 'text', text: `SDK generated at: ${outPath}` }] };
      }

      case 'run_code': {
        const { code, language } = args as { code: string; language: 'python' | 'node' };
        if (typeof code !== 'string') throw new Error('code must be a string');
        const result = await runInSandbox(code, language);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
          isError: result.exitCode !== 0,
        };
      }

      case 'fetch_spec': {
        const url = String(args['url'] ?? '');
        assertSafeUrl(url);
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        return { content: [{ type: 'text', text }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err: unknown) {
    return {
      content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
