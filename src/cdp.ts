export type TargetInfo = {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

export type TargetSelector = {
  targetId?: string;
  urlContains?: string;
  titleContains?: string;
};

export type CapturedRequest = {
  kind: "fetch" | "xhr";
  url: string;
  method: string;
  status?: number;
  requestBody?: unknown;
  response?: unknown;
  error?: string;
};

type CdpResponse = {
  id: number;
  method?: string;
  params?: unknown;
  result?: {
    result?: {
      value?: unknown;
      description?: string;
    };
  };
  error?: {
    message?: string;
  };
};

async function cdpJson<T>(endpoint: string, path: string): Promise<T> {
  const res = await fetch(new URL(path, endpoint));
  if (!res.ok) {
    throw new Error(`CDP endpoint request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function listTargets(endpoint: string): Promise<TargetInfo[]> {
  return cdpJson<TargetInfo[]>(endpoint, "/json/list");
}

export function resolveTarget(targets: TargetInfo[], selector: TargetSelector): TargetInfo {
  const pages = targets.filter((item) => item.type === "page");

  if (selector.targetId) {
    const direct = pages.find((item) => item.id === selector.targetId);
    if (direct) {
      return direct;
    }
  }

  if (selector.urlContains) {
    const byUrl = pages.find((item) => item.url.includes(selector.urlContains!));
    if (byUrl) {
      return byUrl;
    }
  }

  if (selector.titleContains) {
    const byTitle = pages.find((item) => item.title.includes(selector.titleContains!));
    if (byTitle) {
      return byTitle;
    }
  }

  if (pages.length === 1) {
    return pages[0];
  }

  throw new Error("Could not resolve a unique target. Provide --target-id, --url-contains, or --title-contains.");
}

class CdpSession {
  private readonly socket: WebSocket;
  private nextId = 1;

  constructor(socket: WebSocket) {
    this.socket = socket;
  }

  static async connect(target: TargetInfo): Promise<CdpSession> {
    if (!target.webSocketDebuggerUrl) {
      throw new Error(`Target ${target.id} does not expose webSocketDebuggerUrl.`);
    }
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", (event) => reject(new Error(`CDP websocket open failed: ${String(event.type)}`)), { once: true });
    });
    return new CdpSession(socket);
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    const payload = {
      id,
      method,
      params
    };

    const result = await new Promise<CdpResponse>((resolve, reject) => {
      const onMessage = (event: MessageEvent<string>) => {
        const parsed = JSON.parse(event.data) as CdpResponse;
        if (parsed.id === id) {
          this.socket.removeEventListener("message", onMessage as EventListener);
          resolve(parsed);
        }
      };

      const onError = () => {
        this.socket.removeEventListener("message", onMessage as EventListener);
        reject(new Error("CDP websocket error while waiting for response."));
      };

      this.socket.addEventListener("message", onMessage as EventListener);
      this.socket.addEventListener("error", onError as EventListener, { once: true });
      this.socket.send(JSON.stringify(payload));
    });

    if (result.error?.message) {
      throw new Error(`CDP ${method} failed: ${result.error.message}`);
    }

    return result.result as T;
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = await this.send<{
      result?: {
        value?: unknown;
      };
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });

    return result?.result?.value;
  }

  async close(): Promise<void> {
    if (this.socket.readyState === this.socket.CLOSED) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.socket.addEventListener("close", () => resolve(), { once: true });
      this.socket.close();
    });
  }
}

function wrapExpression(expression: string): string {
  return `(${expression})`;
}

export async function evaluateInTarget(target: TargetInfo, expression: string): Promise<unknown> {
  const session = await CdpSession.connect(target);
  try {
    return await session.evaluate(wrapExpression(expression));
  } finally {
    await session.close();
  }
}

const installCaptureScript = `
(() => {
  if (window.__browser2cliCaptureInstalled) {
    return true;
  }
  window.__browser2cliCapturedRequests = [];

  const pushRecord = (record) => {
    window.__browser2cliCapturedRequests.push(record);
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input?.url;
    const method = init?.method || 'GET';
    const requestBody = init?.body || null;
    try {
      const response = await originalFetch(...args);
      let data = null;
      try {
        data = await response.clone().json();
      } catch {
        try {
          data = await response.clone().text();
        } catch {
          data = null;
        }
      }
      pushRecord({ kind: 'fetch', url, method, status: response.status, requestBody, response: data });
      return response;
    } catch (error) {
      pushRecord({ kind: 'fetch', url, method, requestBody, error: String(error) });
      throw error;
    }
  };

  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function Browser2CliXHR() {
    const xhr = new OriginalXHR();
    let method = 'GET';
    let url = '';
    let requestBody = null;

    const originalOpen = xhr.open;
    xhr.open = function patchedOpen(nextMethod, nextUrl, ...rest) {
      method = nextMethod;
      url = nextUrl;
      return originalOpen.call(this, nextMethod, nextUrl, ...rest);
    };

    const originalSend = xhr.send;
    xhr.send = function patchedSend(body) {
      requestBody = body ?? null;
      xhr.addEventListener('loadend', () => {
        let response = xhr.responseText;
        try {
          response = JSON.parse(xhr.responseText);
        } catch {}
        pushRecord({ kind: 'xhr', url, method, status: xhr.status, requestBody, response });
      }, { once: true });
      return originalSend.call(this, body);
    };

    return xhr;
  };

  window.__browser2cliCaptureInstalled = true;
  return true;
})()
`;

export async function captureFetchInTarget(
  target: TargetInfo,
  options: { triggerExpression?: string; waitMs?: number }
): Promise<CapturedRequest[]> {
  const session = await CdpSession.connect(target);
  try {
    await session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: installCaptureScript
    });
    await session.evaluate(installCaptureScript);
    if (options.triggerExpression) {
      await session.evaluate(wrapExpression(options.triggerExpression));
    }
    const waitMs = options.waitMs ?? 1500;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const result = await session.evaluate("(() => window.__browser2cliCapturedRequests || [])()");
    return Array.isArray(result) ? (result as CapturedRequest[]) : [];
  } finally {
    await session.close();
  }
}
