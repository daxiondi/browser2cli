export type Args = Record<string, string>;

export function parseCliArgs(argv: string[]): { command?: string; adapter?: string; args: Args } {
  const [command, ...rest0] = argv;
  const rest = [...rest0];
  const args: Args = {};
  let adapter: string | undefined;

  if (command === "run") {
    adapter = rest.shift();
  }

  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!key?.startsWith("--")) {
      continue;
    }
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) {
      args[key.slice(2)] = "true";
      continue;
    }
    args[key.slice(2)] = next;
    i += 1;
  }

  return { command, adapter, args };
}
