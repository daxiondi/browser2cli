import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";

const root = new URL("../dist/", import.meta.url);
const { listTargets, resolveTarget, evaluateInTarget, captureFetchInTarget } = await import(
  new URL("./cdp.js", root)
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

  wsServer.on("connection", (socket) => {
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
      wsServer.close();
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
