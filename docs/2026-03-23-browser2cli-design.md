# browser2cli design

## Goal

Build a CLI-first tool that can reuse a real browser session for authenticated data extraction without depending on brittle UI clicking.

## Principles

1. Browser handles identity and session continuity.
2. CLI handles extraction orchestration and normalized output.
3. Adapters are site-specific, explicit, and auditable.
4. The default output is structured JSON, not raw HTML.
5. Sensitive data must be redacted before leaving the page context.

## Architecture

### Core layers

- **CLI layer**
  - parses commands
  - selects adapter
  - validates inputs
  - prints structured JSON

- **Browser session layer**
  - attaches to an existing CDP endpoint or browser target
  - finds a matching tab by URL or title
  - runs adapter scripts through page evaluation

- **Adapter layer**
  - defines supported URL patterns
  - provides extraction function
  - normalizes results
  - strips sensitive fields

### Execution flow

1. User invokes `browser2cli run <adapter>`.
2. CLI resolves target page.
3. Adapter script runs in the live page context.
4. Script reads DOM, fetch results, XHR cache, or in-page stores.
5. Output is normalized and printed as JSON.

## Error handling

- If no matching tab exists, return a clear attach error.
- If login has expired, return a session-expired error instead of clicking login by default.
- If the adapter sees unexpected schema drift, return partial results with diagnostics.

## Security

- Redact cookies, auth headers, CSRF tokens, and storage secrets.
- Prefer returning business rows and metrics only.
- Avoid generic “run arbitrary JS” in production-facing flows.
- Gate arbitrary evaluation behind an explicit debug mode in the future.

## Recommended roadmap

1. Implement CDP attachment.
2. Add adapter registry.
3. Add `inspect-page` and `capture-fetch` utilities.
4. Add first business adapters for internal dashboards.
5. Add agent-friendly exit codes and stable JSON schema.

