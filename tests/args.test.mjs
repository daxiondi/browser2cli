import test from "node:test";
import assert from "node:assert/strict";

const { parseCliArgs } = await import(new URL("../dist/args.js", import.meta.url));

test("parseCliArgs preserves flags for non-run commands", () => {
  const parsed = parseCliArgs(["tabs", "--endpoint", "http://127.0.0.1:9222"]);
  assert.equal(parsed.command, "tabs");
  assert.equal(parsed.adapter, undefined);
  assert.equal(parsed.args.endpoint, "http://127.0.0.1:9222");
});

test("parseCliArgs extracts adapter only for run command", () => {
  const parsed = parseCliArgs(["run", "inspect-page", "--endpoint", "http://127.0.0.1:9222"]);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.adapter, "inspect-page");
  assert.equal(parsed.args.endpoint, "http://127.0.0.1:9222");
});
