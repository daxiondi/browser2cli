import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";

const root = new URL("../dist/", import.meta.url);
const { listTargets, resolveTarget, evaluateInTarget, captureFetchInTarget } = await import(
  new URL("./cdp.js", root)
);
const { runAdjustReportYesterday, adjustReportYesterdayAdapter } = await import(
  new URL("./adapters/adjust-report-yesterday.js", root)
);
const { shushuProjectRowAdapter } = await import(
  new URL("./adapters/shushu-project-row.js", root)
);
const { executeAdapter } = await import(
  new URL("./registry.js", root)
);

async function createMockCdpServer(options = {}) {
  const config = {
    loginRequired: false,
    pageReady: true,
    reportSelected: true,
    rowResult: { project: "Demo", installs: 99 },
    ...options
  };
  const httpServer = createServer((req, res) => {
    if (req.url === "/json/list") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([
        {
          id: "tab-1",
          title: "Adjust Report",
          type: "page",
          url: "https://suite.adjust.com/datascape/report",
          webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}/devtools/page/tab-1`
        }
      ]));
      return;
    }
    res.writeHead(404).end();
  });

  const wsServer = new WebSocketServer({ noServer: true });
  const calls = [];
  const sockets = new Set();

  wsServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      calls.push(msg);
      const expression = msg.params?.expression ?? "";
      let value = null;

      if (msg.method === "Network.enable") {
        socket.send(JSON.stringify({
          id: msg.id,
          result: {}
        }));
        return;
      }

      if (msg.method === "Network.getResponseBody") {
        socket.send(JSON.stringify({
          id: msg.id,
          result: {
            body: JSON.stringify({ rows: [{ day: "2026-03-22", installs: 321 }] }),
            base64Encoded: false
          }
        }));
        return;
      }

      if (msg.method === "Page.addScriptToEvaluateOnNewDocument") {
        socket.send(JSON.stringify({
          id: msg.id,
          result: { identifier: "script-1" }
        }));
        return;
      }

      if (expression.includes("document.title")) {
        value = { title: "Adjust Report", url: "https://suite.adjust.com/datascape/report" };
      } else if (expression.includes("__LOGIN_REQUIRED__")) {
        value = config.loginRequired;
      } else if (expression.includes("__PAGE_READY__")) {
        value = config.pageReady;
      } else if (expression.includes("__REPORT_SELECTED__")) {
        value = config.reportSelected;
      } else if (expression.includes("__ROW_RESULT__")) {
        value = config.rowResult;
      } else if (expression.includes("__browser2cliCaptureInstalled")) {
        value = true;
      } else if (expression.includes("__browser2cliCapturedRequests")) {
        value = [];
      } else if (expression.includes("window.fetch")) {
        value = "triggered";
      }

      socket.send(JSON.stringify({
        id: msg.id,
        result: { result: { type: "object", value } }
      }));

      if (expression.includes("window.fetch") || expression.includes("location.reload")) {
        setTimeout(() => {
          socket.send(JSON.stringify({
            method: "Network.requestWillBeSent",
            params: {
              requestId: "req-1",
              request: {
                url: "https://suite.adjust.com/reports-service/pivot_report",
                method: "POST",
                postData: "{\"range\":\"yesterday\"}"
              }
            }
          }));
          socket.send(JSON.stringify({
            method: "Network.responseReceived",
            params: {
              requestId: "req-1",
              response: {
                url: "https://suite.adjust.com/reports-service/pivot_report",
                status: 200
              }
            }
          }));
          socket.send(JSON.stringify({
            method: "Network.loadingFinished",
            params: {
              requestId: "req-1"
            }
          }));
        }, 5);
      }
    });
  });

  httpServer.on("upgrade", (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      wsServer.emit("connection", ws, req);
    });
  });

  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const address = httpServer.address();

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    calls,
    async close() {
      for (const socket of sockets) {
        socket.close();
      }
      await new Promise((resolve) => wsServer.close(resolve));
      httpServer.close();
      await once(httpServer, "close");
    }
  };
}

test("listTargets returns page targets from CDP endpoint", async () => {
  const mock = await createMockCdpServer();
  try {
    const targets = await listTargets(mock.endpoint);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].id, "tab-1");
    assert.equal(targets[0].title, "Adjust Report");
  } finally {
    await mock.close();
  }
});

test("resolveTarget matches a target by URL substring", async () => {
  const targets = [
    {
      id: "tab-1",
      title: "Adjust Report",
      type: "page",
      url: "https://suite.adjust.com/datascape/report",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/tab-1"
    }
  ];
  const target = resolveTarget(targets, { urlContains: "adjust.com/datascape" });
  assert.equal(target.id, "tab-1");
});

test("resolveTarget does not fall back to the only page when an explicit selector does not match", () => {
  const targets = [
    {
      id: "tab-1",
      title: "Adjust Report",
      type: "page",
      url: "https://suite.adjust.com/datascape/report",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/tab-1"
    }
  ];
  assert.throws(
    () => resolveTarget(targets, { urlContains: "example.com/other" }),
    /Could not resolve a unique target/
  );
});

test("resolveTarget fails fast when an explicit target id does not exist", () => {
  const targets = [
    {
      id: "tab-1",
      title: "Adjust Report",
      type: "page",
      url: "https://suite.adjust.com/datascape/report",
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/tab-1"
    }
  ];
  assert.throws(
    () => resolveTarget(targets, { targetId: "missing-tab" }),
    /Target id not found/
  );
});

test("evaluateInTarget runs JS inside the selected page context", async () => {
  const mock = await createMockCdpServer();
  try {
    const targets = await listTargets(mock.endpoint);
    const result = await evaluateInTarget(targets[0], "(() => ({ title: document.title, url: location.href }))()");
    assert.deepEqual(result, {
      title: "Adjust Report",
      url: "https://suite.adjust.com/datascape/report"
    });
  } finally {
    await mock.close();
  }
});

test("captureFetchInTarget installs hooks, runs trigger script, and returns captured responses", async () => {
  const mock = await createMockCdpServer();
  try {
    const targets = await listTargets(mock.endpoint);
    const captured = await captureFetchInTarget(targets[0], {
      triggerExpression: "(() => window.fetch('/reports-service/pivot_report'))()",
      waitMs: 10
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].kind, "fetch");
    assert.equal(captured[0].response.rows[0].installs, 321);
    assert.ok(mock.calls.some((call) => call.method === "Network.enable"));
  } finally {
    await mock.close();
  }
});

test("captureFetchInTarget persists capture hooks across reloads", async () => {
  const mock = await createMockCdpServer();
  try {
    const targets = await listTargets(mock.endpoint);
    const captured = await captureFetchInTarget(targets[0], {
      triggerExpression: "(() => { location.reload(); return 'reloaded'; })()",
      waitMs: 30
    });
    assert.equal(captured.length, 1);
    assert.ok(
      mock.calls.some((call) => call.method === "Network.enable"),
      "expected network capture to be enabled before reload"
    );
  } finally {
    await mock.close();
  }
});

test("adjust-report-yesterday adapter returns filtered rows from pivot_report", async () => {
  const mock = await createMockCdpServer();
  try {
    const targets = await listTargets(mock.endpoint);
    const parsed = await runAdjustReportYesterday(targets[0], {
      endpoint: mock.endpoint,
      date: "2026-03-22",
      triggerExpr: "(() => window.fetch('/reports-service/pivot_report'))()"
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.code, "OK");
    assert.equal(parsed.state, "ok");
    assert.equal(parsed.meta.adapter, "adjust-report-yesterday");
    assert.equal(parsed.data.date, "2026-03-22");
    assert.equal(parsed.data.rows.length, 1);
    assert.equal(parsed.data.rows[0].installs, 321);
  } finally {
    await mock.close();
  }
});

test("adjust-report-yesterday adapter returns LOGIN_REQUIRED in ensureAuth", async () => {
  const mock = await createMockCdpServer({ loginRequired: true });
  try {
    const targets = await listTargets(mock.endpoint);
    const parsed = await executeAdapter(adjustReportYesterdayAdapter, {
      __pickedTarget: targets[0],
      date: "2026-03-22",
      "login-expr": "(() => window.__LOGIN_REQUIRED__ === true)()",
      "trigger-expr": "(() => window.fetch('/reports-service/pivot_report'))()"
    });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "LOGIN_REQUIRED");
    assert.equal(parsed.meta.phase, "ensureAuth");
  } finally {
    await mock.close();
  }
});

test("adjust-report-yesterday adapter returns REPORT_NOT_SELECTED in ensurePage", async () => {
  const mock = await createMockCdpServer({ reportSelected: false });
  try {
    const targets = await listTargets(mock.endpoint);
    const parsed = await executeAdapter(adjustReportYesterdayAdapter, {
      __pickedTarget: targets[0],
      date: "2026-03-22",
      "ready-expr": "(() => window.__PAGE_READY__ === true)()",
      "report-selected-expr": "(() => window.__REPORT_SELECTED__ === true)()",
      "trigger-expr": "(() => window.fetch('/reports-service/pivot_report'))()"
    });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.code, "REPORT_NOT_SELECTED");
    assert.equal(parsed.meta.phase, "ensurePage");
  } finally {
    await mock.close();
  }
});

test("shushu-project-row adapter returns normalized row data", async () => {
  const mock = await createMockCdpServer({ rowResult: { project: "Dog Dash", newUsers: 123 } });
  try {
    const targets = await listTargets(mock.endpoint);
    const parsed = await executeAdapter(shushuProjectRowAdapter, {
      __pickedTarget: targets[0],
      "ready-expr": "(() => window.__PAGE_READY__ === true)()",
      "row-expr": "(() => window.__ROW_RESULT__)()"
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.code, "OK");
    assert.equal(parsed.meta.adapter, "shushu-project-row");
    assert.deepEqual(parsed.data.row, { project: "Dog Dash", newUsers: 123 });
  } finally {
    await mock.close();
  }
});
