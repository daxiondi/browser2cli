import test from "node:test";
import assert from "node:assert/strict";

const protocol = await import(new URL("../dist/protocol.js", import.meta.url));

test("okResult returns a stable success envelope", () => {
  const result = protocol.okResult({
    command: "tabs",
    durationMs: 12,
    data: [{ id: "tab-1" }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, "OK");
  assert.equal(result.state, "ok");
  assert.equal(result.meta.command, "tabs");
  assert.equal(result.meta.durationMs, 12);
  assert.deepEqual(result.data, [{ id: "tab-1" }]);
});

test("errorResult returns structured error details", () => {
  const result = protocol.errorResult({
    command: "wait-page-ready",
    durationMs: 1500,
    code: "PAGE_NOT_READY",
    state: "page_not_ready",
    message: "Target page did not become ready before timeout",
    retryable: true,
    phase: "ensurePage",
    nextSteps: ["请先确认目标页面已经加载完成"]
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "PAGE_NOT_READY");
  assert.equal(result.state, "page_not_ready");
  assert.equal(result.error.retryable, true);
  assert.equal(result.meta.phase, "ensurePage");
  assert.deepEqual(result.hint.nextSteps, ["请先确认目标页面已经加载完成"]);
});
