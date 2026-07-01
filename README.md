# Steel Core
<img width="1408" height="768" alt="STEELCOREImage_kdmr4skdmr4skdmr" src="https://github.com/user-attachments/assets/5eba1b0f-02c6-4696-9e3f-b1cae2f4bda7" />


Generate production-ready SDKs in 7 languages from any OpenAPI spec — Python, TypeScript, Go, Ruby, Java, C#, and PHP. Includes retry/backoff, cursor + offset pagination, and typed models out of the box.

Self-hostable drop-in alternative to Stainless. MIT licensed, zero vendor lock-in.

Why I built this?
Commercial SDK generators do one thing well: they turn OpenAPI specs into idiomatic client libraries. But they're closed source, priced per seat, and lock you into their cloud. Steel Core is the answer to that.

Built in one session from zero to v1.0.0, it generates SDKs in eight languages, each with proper retry logic, pagination helpers, and async support. It runs anywhere Docker runs, includes an MCP server for LLM integration, and is MIT licensed.

No meetings. No sales calls. No vendor lock-in. Just steel generate -i spec.json -l python and you're shipping.

## Quick Start

```bash
# One-click install (Ubuntu/Debian)
curl -sSL https://raw.githubusercontent.com/TushaeBXN/steel-core/main/install.sh | bash

# Or Docker Compose
git clone https://github.com/TushaeBXN/steel-core.git
cd steel-core
cp .env.example .env
docker-compose up -d
```

## Generate an SDK

```bash
steel generate -i openapi.json -l python     -o ./sdk
steel generate -i openapi.json -l typescript -o ./sdk
steel generate -i openapi.json -l go         -o ./sdk
steel generate -i openapi.json -l ruby       -o ./sdk
steel generate -i openapi.json -l java       -o ./sdk
steel generate -i openapi.json -l csharp     -o ./sdk
steel generate -i openapi.json -l php        -o ./sdk
```

## Language Support

| Language   | Retry | Pagination      | Async              | Extra deps           |
|------------|-------|-----------------|--------------------|----------------------|
| Python     | ✅    | Cursor + Offset | ✅ AsyncClient     | httpx                |
| TypeScript | ✅    | Cursor + Offset | Native async/await | fetch (built-in)     |
| Go         | ✅    | Cursor + Offset | context.Context    | stdlib only          |
| Ruby       | ✅    | Cursor + Offset | Enumerable         | stdlib net/http only |
| Java       | ✅    | Cursor + Offset | Iterable\<T\>      | jackson-databind     |
| C#         | ✅    | IAsyncEnumerable| Task\<T?\>         | System.Text.Json     |
| PHP        | ✅    | IteratorAggregate| n/a               | ext-curl only        |

All generators emit:
- Exponential backoff with jitter and `Retry-After` header support
- Cursor-based and offset/limit pagination with lazy iteration
- Typed models from OpenAPI schemas (`$ref`, `allOf`, `oneOf`, `anyOf`)

## MCP Server

```bash
steel mcp
```

Exposes 4 tools to any MCP-compatible LLM client: `parse_openapi`, `generate_sdk`, `run_code`, `fetch_spec`. Sandboxed execution with SSRF protection and rate limiting.

## Deployment

| Method     | Command                          |
|------------|----------------------------------|
| Local      | `docker-compose up -d`           |
| Kubernetes | `kubectl apply -f k8s/`          |
| AWS        | `cd terraform && terraform apply`|

### CI/CD Deployment to Kubernetes

Automatic deployment triggers on every version tag when a cluster is configured:

1. Add `K8S_DEPLOY_ENABLED` as a **repository variable** with value `true`
2. Add `KUBECONFIG_PROD` as a **repository secret** containing your cluster kubeconfig
3. Tag a release: `git tag v1.x.0 && git push --tags`

The workflow will test → build → push to GHCR → deploy to your cluster. Without these set, tag pushes still build and push the Docker image — the `kubectl` step is simply skipped.

## Architecture

```
packages/
├── core/              # OpenAPI parser — $ref resolution, allOf merge, topo sort
├── cli/               # steel CLI entrypoint
├── generators/
│   ├── python/        # Python: @dataclass models, retry, async client
│   ├── typescript/    # TypeScript: interfaces, HttpClient, Page<T>
│   ├── go/            # Go: structs, generics pagination, functional options
│   ├── ruby/          # Ruby: Struct models, Enumerable pagination, zero deps
│   ├── java/          # Java: records, CursorPage<T>, pom.xml + build.gradle.kts
│   ├── csharp/        # C#: records, IAsyncEnumerable<T>, net8.0
│   └── php/           # PHP: readonly classes, backed enums, IteratorAggregate
└── mcp-server/        # MCP server with sandboxed execution
```

## Security

- Sandboxed code execution with timeout and memory limits
- SSRF protection on URL fetches
- Token-bucket rate limiting
- Non-root containers with dropped capabilities
- Input size validation

## License

MIT
