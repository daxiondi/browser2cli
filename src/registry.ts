import type { Args } from "./args.js";
import { normalizeThrownError, okResult, type Browser2CliState, type Phase, type ResultEnvelope } from "./protocol.js";

export type AdapterArgs = Record<string, unknown>;

export type AdapterContext = {
  args: AdapterArgs;
  target?: {
    id?: string;
    title?: string;
    url?: string;
  };
  [key: string]: unknown;
};

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
  lifecycle?: Phase[];
};

export type LifecycleAdapter = AdapterInfo & {
  locate: (args: AdapterArgs) => Promise<AdapterContext>;
  ensureAuth?: (ctx: AdapterContext) => Promise<AdapterContext>;
  ensurePage?: (ctx: AdapterContext) => Promise<AdapterContext>;
  collect: (ctx: AdapterContext) => Promise<unknown>;
  normalize: (raw: unknown, ctx: AdapterContext) => Promise<unknown> | unknown;
};

export type CommandAdapter = AdapterInfo & {
  run: (args: Args) => Promise<ResultEnvelope<unknown>>;
};

export type Adapter = CommandAdapter | LifecycleAdapter;

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
    reusableSession: adapter.reusableSession,
    lifecycle: adapter.lifecycle
  }));
}

function isCommandAdapter(adapter: Adapter): adapter is CommandAdapter {
  return "run" in adapter;
}

export async function executeAdapter(adapter: Adapter, args: AdapterArgs): Promise<ResultEnvelope<unknown>> {
  if (isCommandAdapter(adapter)) {
    return adapter.run(args as Args);
  }

  const startedAt = Date.now();
  try {
    let ctx = await adapter.locate(args);
    if (adapter.ensureAuth) {
      ctx = await adapter.ensureAuth(ctx);
    }
    if (adapter.ensurePage) {
      ctx = await adapter.ensurePage(ctx);
    }
    const raw = await adapter.collect(ctx);
    const data = await adapter.normalize(raw, ctx);
    return okResult({
      command: "run",
      adapter: adapter.name,
      durationMs: Date.now() - startedAt,
      phase: "normalize",
      target: ctx.target,
      data
    });
  } catch (error) {
    return normalizeThrownError(error, {
      command: "run",
      adapter: adapter.name,
      durationMs: Date.now() - startedAt,
      phase: "collect"
    });
  }
}
