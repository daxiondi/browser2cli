# browser2cli

[中文](./README.zh-CN.md) · English

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

## Current scope

This version now provides:

- a lightweight TypeScript CLI
- a direct-CDP execution core for existing browser tabs
- runtime primitives for waiting, state detection, and action + capture
- a structured result envelope for agents and scripts
- human-friendly CLI rendering by default, with `--json` for raw output
- a registry-backed adapter model with built-in examples

## Install

### From npm

```bash
npm install -g browser2cli
browser2cli tabs --endpoint http://127.0.0.1:9222
```

### With npx

```bash
npx browser2cli tabs --endpoint http://127.0.0.1:9222
```

### From GitHub before npm publish

```bash
npm install -g github:daxiondi/browser2cli
browser2cli tabs --endpoint http://127.0.0.1:9222
```

## Commands

```bash
npm install
npm run build
node dist/index.js list
node dist/index.js info adjust-report-yesterday
node dist/index.js tabs --endpoint "http://127.0.0.1:9222"
node dist/index.js eval --endpoint "http://127.0.0.1:9222" --url-contains "adjust.com" --expr "(() => document.title)()"
node dist/index.js wait-target --endpoint "http://127.0.0.1:9222" --url-contains "adjust.com"
node dist/index.js ensure-open --endpoint "http://127.0.0.1:9222" --open-url "https://example.com" --url-contains "example.com"
node dist/index.js wait-page-ready --endpoint "http://127.0.0.1:9222" --url-contains "adjust.com" --ready-expr "(() => document.readyState === 'complete')()"
node dist/index.js detect-state --endpoint "http://127.0.0.1:9222" --url-contains "adjust.com" --login-expr "(() => location.pathname.includes('/login'))()"
node dist/index.js invoke-action --endpoint "http://127.0.0.1:9222" --url-contains "adjust.com" --expr "(() => window.fetch('/api'))()"
node dist/index.js capture-until --endpoint "http://127.0.0.1:9222" --url-contains "adjust.com" --match-url "pivot_report" --trigger-expr "(() => window.fetch('/api'))()"
node dist/index.js run inspect-page --endpoint "http://127.0.0.1:9222" --url-contains "adjust.com"
```

## Output model

`browser2cli` now uses two layers:

- **Internal protocol**: every command returns a stable JSON envelope with `ok`, `code`, `state`, `data`, `error`, and `meta`
- **External rendering**: CLI renders a concise human-readable view by default

Use `--json` to get the raw envelope:

```bash
browser2cli run inspect-page \
  --endpoint http://127.0.0.1:9222 \
  --url-contains "adjust.com" \
  --json
```

Success and failure always carry:

- stable error/state semantics
- `meta.durationMs`
- phase information for adapters and runtime commands
- optional `hint.nextSteps` for recovery guidance

## Adapter model

Each adapter should define:

- what page/session prerequisites it needs
- how it locates a reusable page target
- how it detects auth/page state
- how it collects raw data
- how it normalizes final output

The current contract is shaped around these lifecycle steps:

- `locate`
- `ensureAuth`
- `ensurePage`
- `collect`
- `normalize`

Examples of future adapters:

- `shushu/project-row`
- `feishu/doc-export`

## First business adapter

### Adjust: report yesterday

```bash
browser2cli run adjust-report-yesterday \
  --endpoint http://127.0.0.1:9222 \
  --url-contains "suite.adjust.com/datascape/report" \
  --date 2026-03-22 \
  --trigger-expr "(() => window.fetch('/reports-service/pivot_report'))()"
```

This adapter is intended for an already-open Adjust report page. It captures the `pivot_report` response from the page context and filters rows for the target date.

## Runtime primitives

### List adapters

```bash
browser2cli list
browser2cli info adjust-report-yesterday
```

### List tabs

```bash
browser2cli tabs --endpoint http://127.0.0.1:9222
```

### Evaluate inside a page

```bash
browser2cli eval \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --expr "(() => ({ title: document.title, url: location.href }))()"
```

### Wait for a target

```bash
browser2cli wait-target \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --timeout-ms 3000
```

### Wait until a page is ready

```bash
browser2cli wait-page-ready \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --ready-expr "(() => document.readyState === 'complete')()" \
  --timeout-ms 3000
```

### Ensure a page is open

```bash
browser2cli ensure-open \
  --endpoint http://127.0.0.1:9222 \
  --open-url "https://example.com/new-page" \
  --url-contains "example.com/new-page" \
  --timeout-ms 3000
```

### Detect page state

```bash
browser2cli detect-state \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --login-expr "(() => location.pathname.includes('/login'))()" \
  --ready-expr "(() => document.readyState === 'complete')()"
```

### Invoke a page action

```bash
browser2cli invoke-action \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --expr "(() => window.fetch('/reports-service/pivot_report'))()" \
  --ready-expr "(() => document.readyState === 'complete')()" \
  --timeout-ms 3000
```

### Trigger an action and capture the matching request

```bash
browser2cli capture-until \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --match-url "pivot_report" \
  --trigger-expr "(() => window.fetch('/reports-service/pivot_report'))()" \
  --timeout-ms 3000
```

## Security stance

- Never dump cookies or auth headers into output
- Never echo raw secrets from page storage
- Prefer returning normalized business data over full HTML
- Keep adapter permissions narrow and explicit

## Repository status

This repository now has:

- a working direct-CDP core
- runtime primitives extracted from real browser tasks
- a structured result protocol for agents/scripts
- a registry-backed adapter surface

The next step is to keep adding runtime capabilities and adapters without tying them to any single user session or one-off script.

## Publish checklist

```bash
npm run test
npm run check
npm publish
```
