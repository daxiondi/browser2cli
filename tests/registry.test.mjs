import test from "node:test";
import assert from "node:assert/strict";

const registry = await import(new URL("../dist/registry.js", import.meta.url));
const protocol = await import(new URL("../dist/protocol.js", import.meta.url));

test("executeAdapter runs lifecycle hooks in order and returns normalized output", async () => {
  const steps = [];
  const adapter = {
    name: "demo-adapter",
    site: "demo",
    description: "demo",
    input: ["--endpoint"],
    output: ["value"],
    states: ["ok", "internal_error"],
    prerequisites: ["demo page"],
    loginRequired: false,
    reusableSession: true,
    lifecycle: ["locate", "ensureAuth", "ensurePage", "collect", "normalize"],
    async locate(args) {
      steps.push("locate");
      return { args, target: { id: "tab-1", title: "Demo", url: "https://example.com" } };
    },
    async ensureAuth(ctx) {
      steps.push("ensureAuth");
      return ctx;
    },
    async ensurePage(ctx) {
      steps.push("ensurePage");
      return ctx;
    },
    async collect(ctx) {
      steps.push("collect");
      return { rawValue: "hello", target: ctx.target };
    },
    async normalize(raw) {
      steps.push("normalize");
      return { value: raw.rawValue.toUpperCase() };
    }
  };

  const result = await registry.executeAdapter(adapter, { endpoint: "http://127.0.0.1:9222" });
  assert.equal(result.ok, true);
  assert.equal(result.code, "OK");
  assert.deepEqual(result.data, { value: "HELLO" });
  assert.deepEqual(steps, ["locate", "ensureAuth", "ensurePage", "collect", "normalize"]);
  assert.equal(result.meta.phase, "normalize");
});

test("executeAdapter keeps Browser2CliError semantics and phase", async () => {
  const adapter = {
    name: "broken-adapter",
    site: "demo",
    description: "broken",
    input: [],
    output: [],
    states: ["action_failed"],
    prerequisites: [],
    loginRequired: false,
    reusableSession: true,
    lifecycle: ["locate", "collect"],
    async locate() {
      return {};
    },
    async collect() {
      throw new protocol.Browser2CliError({
        code: "ACTION_FAILED",
        state: "action_failed",
        message: "collection failed",
        phase: "collect",
        retryable: true,
        nextSteps: ["retry"]
      });
    },
    async normalize(value) {
      return value;
    }
  };

  const result = await registry.executeAdapter(adapter, {});
  assert.equal(result.ok, false);
  assert.equal(result.code, "ACTION_FAILED");
  assert.equal(result.state, "action_failed");
  assert.equal(result.meta.phase, "collect");
  assert.deepEqual(result.hint.nextSteps, ["retry"]);
});
