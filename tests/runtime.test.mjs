import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";

const root = new URL("../dist/", import.meta.url);
const runtime = await import(new URL("./runtime.js", root));
const cdp = await import(new URL("./cdp.js", root));

async function createRuntimeMockServer() {
  let listCallCount = 0;
  const sockets = new Set();
  const calls = [];

  const httpServer = createServer((req, res) => {
    if (req.url === "/json/list") {
      listCallCount += 1;
      const targets = listCallCount < 2
        ? []
        : [{
            id: "tab-1",
            title: "Adjust Report",
            type: "page",
            url: "https://suite.adjust.com/datascape/report",
            webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}/devtools/page/tab-1`
          }];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(targets));
      return;
    }
    res.writeHead(404).end();
  });

  const wsServer = new WebSocketServer({ noServer: true });
  wsServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      calls.push(msg);

      if (msg.method === "Network.enable") {
        socket.send(JSON.stringify({ id: msg.id, result: {} }));
        return;
      }

      if (msg.method === "Network.getResponseBody") {
        socket.send(JSON.stringify({
          id: msg.id,
          result: {
            body: JSON.stringify({ rows: [{ day: "2026-03-23", installs: 222 }] }),
            base64Encoded: false
          }
        }));
        return;
      }

      const expression = msg.params?.expression ?? "";
      let value = null;
      if (expression.includes("window.__PAGE_READY__")) {
        value = true;
      } else if (expression.includes("window.__LOGIN_REQUIRED__")) {
        value = false;
      } else if (expression.includes("document.readyState")) {
        value = "complete";
      } else if (expression.includes("window.fetch('/reports-service/pivot_report')")) {
        value = "triggered";
      }

      socket.send(JSON.stringify({
        id: msg.id,
        result: { result: { type: "object", value } }
      }));

      if (expression.includes("window.fetch('/reports-service/pivot_report')")) {
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
            params: { requestId: "req-1" }
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
      for (const socket of sockets) socket.close();
      await new Promise((resolve) => wsServer.close(resolve));
      httpServer.close();
      await once(httpServer, "close");
    }
  };
}

test("waitForTarget resolves a late-appearing target", async () => {
  const mock = await createRuntimeMockServer();
  try {
    const result = await runtime.waitForTarget({
      endpoint: mock.endpoint,
      selector: { urlContains: "adjust.com/datascape" },
      timeoutMs: 500,
      pollMs: 10
    });
    assert.equal(result.id, "tab-1");
  } finally {
    await mock.close();
  }
});

test("waitForPageReady resolves when ready expression becomes truthy", async () => {
  const mock = await createRuntimeMockServer();
  try {
    const target = await runtime.waitForTarget({
      endpoint: mock.endpoint,
      selector: { urlContains: "adjust.com/datascape" },
      timeoutMs: 500,
      pollMs: 10
    });
    const ready = await runtime.waitForPageReady({
      target,
      readyExpression: "(() => window.__PAGE_READY__ === true)()",
      timeoutMs: 100,
      pollMs: 10
    });
    assert.equal(ready.ok, true);
    assert.equal(ready.state, "ok");
  } finally {
    await mock.close();
  }
});

test("detectState reports ok when page is ready and login is not required", async () => {
  const mock = await createRuntimeMockServer();
  try {
    const target = await runtime.waitForTarget({
      endpoint: mock.endpoint,
      selector: { urlContains: "adjust.com/datascape" },
      timeoutMs: 500,
      pollMs: 10
    });
    const state = await runtime.detectState({
      target,
      loginExpression: "(() => window.__LOGIN_REQUIRED__ === true)()",
      readyExpression: "(() => window.__PAGE_READY__ === true)()"
    });
    assert.equal(state.ok, true);
    assert.equal(state.state, "ok");
  } finally {
    await mock.close();
  }
});

test("captureUntil returns the first matching request", async () => {
  const mock = await createRuntimeMockServer();
  try {
    const target = await runtime.waitForTarget({
      endpoint: mock.endpoint,
      selector: { urlContains: "adjust.com/datascape" },
      timeoutMs: 500,
      pollMs: 10
    });
    const result = await runtime.captureUntil({
      target,
      triggerExpression: "(() => window.fetch('/reports-service/pivot_report'))()",
      matchUrlContains: "pivot_report",
      timeoutMs: 200
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.request.url.includes("pivot_report"), true);
    assert.equal(result.data.request.response.rows[0].installs, 222);
  } finally {
    await mock.close();
  }
});
