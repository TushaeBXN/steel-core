#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { OpenAPIParser } from '@steel-core/core';

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      const key = argv[i].replace(/^-+/, '');
      flags[key] = argv[i + 1] ?? 'true';
      i++;
    }
  }
  return flags;
}

async function loadGenerator(lang: string): Promise<{ default: new () => { generate: (spec: unknown, out: string) => Promise<void> } }> {
  // Resolve relative to this file so it works from any compiled output location
  const dir = path.dirname(__filename);
  const candidates = [
    path.join(dir, '..', 'generators', lang, 'src', 'index.js'),  // monorepo dist layout
    path.join(dir, '..', '..', 'generators', lang, 'src', 'index.js'),
    `@steel-core/generator-${lang}`,  // installed package fallback
  ];
  for (const c of candidates) {
    try {
      return await import(c);
    } catch {
      // try next
    }
  }
  throw new Error(`No generator found for language: ${lang}. Supported: python, typescript`);
}

async function generate(flags: Record<string, string>): Promise<void> {
  const input = flags['i'] ?? flags['input'];
  const lang = flags['l'] ?? flags['language'];
  const output = flags['o'] ?? flags['output'];

  if (!input || !lang || !output) {
    console.error('Usage: steel generate -i <openapi.json> -l <python|typescript> -o <output-dir>');
    process.exit(1);
  }

  const raw = fs.readFileSync(path.resolve(input), 'utf-8');
  const parser = new OpenAPIParser();
  const spec = parser.parse(raw);

  console.log(`Generating ${lang} SDK for "${spec.info.title}" v${spec.info.version}...`);

  const generatorModule = await loadGenerator(lang);
  const generator = new generatorModule.default();
  await generator.generate(spec, path.resolve(output));

  console.log(`SDK generated at: ${output}`);
}

async function main(): Promise<void> {
  const flags = parseFlags(args.slice(1));

  switch (command) {
    case 'generate':
      await generate(flags);
      break;
    case 'mcp': {
      console.log('Starting MCP server...');
      const dir = path.dirname(__filename);
      const mcpPath = path.join(dir, '..', 'mcp-server', 'src', 'index.js');
      await import(mcpPath);
      break;
    }
    case 'version': {
      // walk up to find package.json
      const pkgPath = path.resolve(__dirname, '../../package.json');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      console.log((require(pkgPath) as { version: string }).version);
      break;
    }
    default:
      console.log(`Steel Core — Open-source API SDK Generator

Commands:
  generate    Generate an SDK from an OpenAPI spec
  mcp         Start the MCP server
  version     Print version

Options (generate):
  -i, --input     Path to OpenAPI JSON/YAML spec
  -l, --language  Target language: python | typescript
  -o, --output    Output directory
`);
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
