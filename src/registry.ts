import type { Args } from "./args.js";
import type { Browser2CliState, ResultEnvelope } from "./protocol.js";

export type AdapterInfo = {
  name: string;
  site: string;
  description: string;
  input: string[];
  output: string[];
  states: Browser2CliState[];
  prerequisites: string[];
  loginRequired: boolean;
  reusableSession: boolean;
};

export type Adapter = AdapterInfo & {
  run: (args: Args) => Promise<ResultEnvelope<unknown>>;
};

const adapters = new Map<string, Adapter>();

export function registerAdapter(adapter: Adapter): void {
  adapters.set(adapter.name, adapter);
}

export function getAdapter(name: string): Adapter | undefined {
  return adapters.get(name);
}

export function listAdapters(): AdapterInfo[] {
  return [...adapters.values()].map((adapter) => ({
    name: adapter.name,
    site: adapter.site,
    description: adapter.description,
    input: adapter.input,
    output: adapter.output,
    states: adapter.states,
    prerequisites: adapter.prerequisites,
    loginRequired: adapter.loginRequired,
    reusableSession: adapter.reusableSession
  }));
}
