# browser2cli

`browser2cli` is a minimal CLI for turning an already-authenticated browser tab into a structured data extraction tool.

The core idea is simple:

- Keep the hard part inside a real browser session
- Reuse page cookies, CSRF tokens, and in-page state automatically
- Run extraction logic in the page context instead of clicking the UI repeatedly
- Return structured JSON that can be consumed by agents or scripts

This repository is an original implementation of that workflow. It does not copy adapter code from other projects.

## Why this exists

Many internal dashboards and growth tools are difficult to automate reliably because:

- sessions expire
- requests are signed in frontend code
- APIs depend on browser cookies or CSRF
- the UI is slow and brittle to click through

The practical workaround is to:

1. attach to a live browser tab
2. execute a small script inside the page context
3. read fetch/XHR responses or in-page state
4. output normalized JSON

## Initial scope

This initial version provides:

- a lightweight TypeScript CLI
- a runtime shape for page-context adapters
- a sample built-in adapter for generic page metadata
- a design document for site-specific adapters

## Commands

```bash
npm install
npm run build
node dist/index.js list
node dist/index.js run inspect-page --url "https://example.com"
```

## Planned adapter model

Each adapter should define:

- what page URL patterns it supports
- what script to execute in the page context
- what structured JSON it returns
- what sensitive fields must be redacted

Examples of future adapters:

- `adjust/report-yesterday`
- `shushu/project-row`
- `feishu/doc-export`

## Security stance

- Never dump cookies or auth headers into output
- Never echo raw secrets from page storage
- Prefer returning normalized business data over full HTML
- Keep adapter permissions narrow and explicit

## Repository status

This is a starter repository. It establishes the CLI contract and the page-context execution model first, then adapters can be added incrementally.

