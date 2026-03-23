import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";

const root = new URL("../dist/", import.meta.url);
const { listTargets, resolveTarget, evaluateInTarget, captureFetchInTarget } = await import(
  new URL("./cdp.js", root)
);
const { runAdjustReportYesterday } = await import(
  new URL("./adapters/adjust-report-yesterday.js", root)
);

async function createMockCdpServer() {
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

      if (expression.includes("document.title")) {
        value = { title: "Adjust Report", url: "https://suite.adjust.com/datascape/report" };
      } else if (expression.includes("__browser2cliCaptureInstalled")) {
        value = true;
      } else if (expression.includes("__browser2cliCapturedRequests")) {
        value = [
          {
            kind: "fetch",
            url: "https://suite.adjust.com/reports-service/pivot_report",
            method: "POST",
            status: 200,
            response: { rows: [{ day: "2026-03-22", installs: 321 }] }
          }
        ];
      } else if (expression.includes("window.fetch")) {
        value = "triggered";
      }

      socket.send(JSON.stringify({
        id: msg.id,
        result: { result: { type: "object", value } }
      }));
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
    assert.ok(mock.calls.some((call) => String(call.params?.expression).includes("__browser2cliCaptureInstalled")));
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
      waitMs: 10
    });
    assert.equal(captured.length, 1);
    assert.ok(
      mock.calls.some((call) => call.method === "Page.addScriptToEvaluateOnNewDocument"),
      "expected capture hook to be registered for future documents"
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
    assert.equal(parsed.adapter, "adjust-report-yesterday");
    assert.equal(parsed.date, "2026-03-22");
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].installs, 321);
  } finally {
    await mock.close();
  }
});
