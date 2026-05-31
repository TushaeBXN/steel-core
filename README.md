# Steel Core

Open-source API SDK generator and MCP server. MIT licensed.

## Quick Start

```bash
# One-click install
curl -sSL https://raw.githubusercontent.com/TushaeBXN/steel-core/main/install.sh | bash

# Or Docker Compose
git clone https://github.com/TushaeBXN/steel-core.git
cd steel-core
cp .env.example .env
docker-compose up -d
```

## Usage

```bash
# Generate an SDK
steel generate -i openapi.json -l python -o my-sdk
steel generate -i openapi.json -l typescript -o my-sdk

# Run MCP server
steel mcp
```

## Deployment

| Method | Command |
|--------|---------|
| Local | `docker-compose up -d` |
| Kubernetes | `kubectl apply -f k8s/` |
| AWS | `cd terraform && terraform apply` |

## Architecture

```
packages/
├── core/          # OpenAPI parser & shared types
├── cli/           # steel CLI entrypoint
├── generators/
│   ├── python/    # Python SDK generator
│   └── typescript/# TypeScript SDK generator
└── mcp-server/    # MCP server with sandboxed execution
```

## Security

- Sandboxed code execution with timeout + memory limits
- SSRF protection on URL fetches
- Token-bucket rate limiting
- Non-root containers with dropped capabilities
- Input size validation

## License

MIT
