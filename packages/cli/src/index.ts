#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { OpenAPIParser } from '@steel-core/core';

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('-')) {
      const key = args[i].replace(/^-+/, '');
      flags[key] = args[i + 1] ?? 'true';
      i++;
    }
  }
  return flags;
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

  // Dynamic import to keep CLI lean
  const generatorModule = await import(`@steel-core/generator-${lang}`);
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
    case 'mcp':
      console.log('Starting MCP server...');
      await import('../../mcp-server/src/index');
      break;
    case 'version':
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      console.log(require('../../package.json').version);
      break;
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

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
