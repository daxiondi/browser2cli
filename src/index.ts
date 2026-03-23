#!/usr/bin/env node

import { captureFetchInTarget, evaluateInTarget, listTargets, resolveTarget, type TargetInfo } from "./cdp.js";
import { parseCliArgs, type Args } from "./args.js";

type AdapterResult = Record<string, unknown>;

type Adapter = {
  name: string;
  description: string;
  run: (args: Args) => Promise<AdapterResult>;
};

function requireArg(args: Args, name: string): string {
  const value = args[name];
  if (!value) {
    throw new Error(`Missing required argument --${name}`);
  }
  return value;
}

async function pickTarget(args: Args): Promise<TargetInfo> {
  const endpoint = requireArg(args, "endpoint");
  const targets = await listTargets(endpoint);
  return resolveTarget(targets, {
    targetId: args["target-id"],
    urlContains: args["url-contains"],
    titleContains: args["title-contains"]
  });
}

const inspectPageAdapter: Adapter = {
  name: "inspect-page",
  description: "Attach to a page target and return basic page metadata.",
  async run(args) {
    const target = await pickTarget(args);
    const page = await evaluateInTarget(
      target,
      "(() => ({ title: document.title, url: location.href, readyState: document.readyState }))()"
    );
    return {
      ok: true,
      adapter: "inspect-page",
      target,
      page
    };
  }
};

const adapters = new Map<string, Adapter>([[inspectPageAdapter.name, inspectPageAdapter]]);

function printHelp(): void {
  console.log(`browser2cli

Usage:
  browser2cli list
  browser2cli tabs --endpoint <url>
  browser2cli eval --endpoint <url> [--target-id <id> | --url-contains <text> | --title-contains <text>] --expr <javascript>
  browser2cli capture-fetch --endpoint <url> [--target-id <id> | --url-contains <text> | --title-contains <text>] [--expr <javascript>] [--wait-ms <number>]
  browser2cli run <adapter> [--key value]

Examples:
  browser2cli list
  browser2cli tabs --endpoint http://127.0.0.1:9222
  browser2cli eval --endpoint http://127.0.0.1:9222 --url-contains adjust.com --expr "(() => document.title)()"
  browser2cli capture-fetch --endpoint http://127.0.0.1:9222 --url-contains adjust.com --expr "(() => window.fetch('/api'))()"
  browser2cli run inspect-page --endpoint http://127.0.0.1:9222 --url-contains adjust.com
`);
}

async function main(): Promise<void> {
  const { command, adapter, args } = parseCliArgs(process.argv.slice(2));

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "list") {
    const rows = Array.from(adapters.values()).map((item) => ({
      name: item.name,
      description: item.description
    }));
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (command === "tabs") {
    const endpoint = requireArg(args, "endpoint");
    console.log(JSON.stringify(await listTargets(endpoint), null, 2));
    return;
  }

  if (command === "eval") {
    const target = await pickTarget(args);
    const expr = requireArg(args, "expr");
    console.log(JSON.stringify({
      ok: true,
      target,
      result: await evaluateInTarget(target, expr)
    }, null, 2));
    return;
  }

  if (command === "capture-fetch") {
    const target = await pickTarget(args);
    const captured = await captureFetchInTarget(target, {
      triggerExpression: args.expr,
      waitMs: args["wait-ms"] ? Number(args["wait-ms"]) : undefined
    });
    console.log(JSON.stringify({
      ok: true,
      target,
      requests: captured
    }, null, 2));
    return;
  }

  if (command === "run") {
    if (!adapter) {
      throw new Error("Missing adapter name. Use `browser2cli list` to see available adapters.");
    }
    const item = adapters.get(adapter);
    if (!item) {
      throw new Error(`Unknown adapter: ${adapter}`);
    }
    console.log(JSON.stringify(await item.run(args), null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exitCode = 1;
});
