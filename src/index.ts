#!/usr/bin/env node

type AdapterResult = Record<string, unknown>;

type Adapter = {
  name: string;
  description: string;
  run: (args: Record<string, string>) => Promise<AdapterResult>;
};

const inspectPageAdapter: Adapter = {
  name: "inspect-page",
  description: "Return a minimal stub result for a target page URL.",
  async run(args) {
    return {
      ok: true,
      adapter: "inspect-page",
      url: args.url ?? null,
      note: "CDP attachment and in-page extraction are the next implementation step."
    };
  }
};

const adapters = new Map<string, Adapter>([[inspectPageAdapter.name, inspectPageAdapter]]);

function printHelp(): void {
  console.log(`browser2cli

Usage:
  browser2cli list
  browser2cli run <adapter> [--key value]

Examples:
  browser2cli list
  browser2cli run inspect-page --url https://example.com
`);
}

function parseArgs(argv: string[]): { command?: string; adapter?: string; args: Record<string, string> } {
  const [command, adapter, ...rest] = argv;
  const args: Record<string, string> = {};

  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      continue;
    }
    args[key.slice(2)] = value;
  }

  return { command, adapter, args };
}

async function main(): Promise<void> {
  const { command, adapter, args } = parseArgs(process.argv.slice(2));

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

  if (command === "run") {
    if (!adapter) {
      throw new Error("Missing adapter name. Use `browser2cli list` to see available adapters.");
    }
    const item = adapters.get(adapter);
    if (!item) {
      throw new Error(`Unknown adapter: ${adapter}`);
    }
    const result = await item.run(args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exitCode = 1;
});
