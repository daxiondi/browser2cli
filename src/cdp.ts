import { Browser2CliError } from "./protocol.js";

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
    exceptionDetails?: {
      text?: string;
      exception?: {
        description?: string;
        value?: unknown;
      };
      stackTrace?: unknown;
    };
  };
  error?: {
    message?: string;
  };
};

type NetworkBodyResult = {
  body?: string;
  base64Encoded?: boolean;
};

type PendingRequest = {
  resolve: (value: CdpResponse) => void;
  reject: (error: Error) => void;
  method: string;
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

export async function openTarget(endpoint: string, url: string): Promise<TargetInfo> {
  return cdpJson<TargetInfo>(endpoint, `/json/new?${encodeURIComponent(url)}`);
}

export function resolveTarget(targets: TargetInfo[], selector: TargetSelector): TargetInfo {
  const pages = targets.filter((item) => item.type === "page");
  const hasExplicitSelector = Boolean(selector.targetId || selector.urlContains || selector.titleContains);

  if (selector.targetId) {
    const direct = pages.find((item) => item.id === selector.targetId);
    if (direct) {
      return direct;
    }
    // When target id is explicitly provided, do not silently fall back to other selectors.
    throw new Error("Target id not found.");
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

  if (!hasExplicitSelector && pages.length === 1) {
    return pages[0];
  }

  throw new Error("Could not resolve a unique target. Provide --target-id, --url-contains, or --title-contains.");
}

class CdpSession {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly eventHandlers = new Map<string, Set<(params: unknown) => void>>();

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.addEventListener("message", (event) => {
      const parsed = JSON.parse(String((event as MessageEvent<string>).data)) as CdpResponse;
      if (typeof parsed.id === "number") {
        const pending = this.pending.get(parsed.id);
        if (!pending) {
          return;
        }
        this.pending.delete(parsed.id);
        pending.resolve(parsed);
        return;
      }
      if (parsed.method) {
        const handlers = this.eventHandlers.get(parsed.method);
        if (!handlers) {
          return;
        }
        for (const handler of handlers) {
          handler(parsed.params);
        }
      }
    });
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
      const onError = () => {
        this.pending.delete(id);
        reject(new Error("CDP websocket error while waiting for response."));
      };

      this.pending.set(id, { resolve, reject, method });
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
      exceptionDetails?: {
        text?: string;
        exception?: {
          description?: string;
          value?: unknown;
        };
        stackTrace?: unknown;
      };
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });

    if (result?.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description ?? "";
      const text = result.exceptionDetails.text ?? "";
      const message = (description || text || "JavaScript evaluation failed.").slice(0, 800);
      throw new Browser2CliError({
        code: "EVAL_ERROR",
        state: "eval_error",
        message,
        retryable: false,
        phase: "collect",
        details: {
          text: text ? text.slice(0, 300) : undefined,
          description: description ? description.slice(0, 300) : undefined
        },
        nextSteps: ["请检查表达式是否有语法错误，或先用更小的 DOM 查询确认页面结构。"]
      });
    }

    return result?.result?.value;
  }

  on(method: string, handler: (params: unknown) => void): () => void {
    const handlers = this.eventHandlers.get(method) ?? new Set();
    handlers.add(handler);
    this.eventHandlers.set(method, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(method);
      }
    };
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

type PreparedFieldResult = {
  ok?: boolean;
  value?: string;
};

async function prepareFieldForTyping(session: CdpSession, selector: string): Promise<PreparedFieldResult> {
  return await session.evaluate(`(() => {
    const selector = ${JSON.stringify(selector)};
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      return { ok: false };
    }
    const proto = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) {
      descriptor.set.call(element, '');
    } else {
      element.value = '';
    }
    element.focus();
    if (typeof element.setSelectionRange === 'function') {
      element.setSelectionRange(0, element.value.length);
    } else if (typeof element.select === 'function') {
      element.select();
    }
    window.__browser2cliFocusedSelector = selector;
    return { ok: true, value: element.value };
  })()`) as PreparedFieldResult;
}

export async function typeTextInTarget(target: TargetInfo, selector: string, text: string): Promise<{ ok: boolean; value?: string }> {
  const session = await CdpSession.connect(target);
  try {
    const prepared = await prepareFieldForTyping(session, selector);
    if (!prepared?.ok) {
      return { ok: false };
    }
    await session.send("Input.insertText", { text });
    const result = await session.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        return { ok: false };
      }
      return { ok: true, value: element.value };
    })()`) as { ok?: boolean; value?: string };
    return {
      ok: Boolean(result?.ok),
      value: result?.value
    };
  } finally {
    await session.close();
  }
}

function parseResponseBody(body: NetworkBodyResult): unknown {
  const raw = body.base64Encoded && body.body ? Buffer.from(body.body, "base64").toString("utf8") : (body.body ?? "");
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
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
    const requests = new Map<string, CapturedRequest>();
    const finishedIds: string[] = [];
    const stopRequest = session.on("Network.requestWillBeSent", (params) => {
      const p = params as {
        requestId?: string;
        request?: { url?: string; method?: string; postData?: string };
      };
      if (!p.requestId || !p.request?.url) {
        return;
      }
      requests.set(p.requestId, {
        kind: "fetch",
        url: p.request.url,
        method: p.request.method ?? "GET",
        requestBody: p.request.postData ?? null
      });
    });
    const stopResponse = session.on("Network.responseReceived", (params) => {
      const p = params as {
        requestId?: string;
        response?: { url?: string; status?: number };
      };
      if (!p.requestId || !p.response) {
        return;
      }
      const existing = requests.get(p.requestId) ?? {
        kind: "fetch" as const,
        url: p.response.url ?? "",
        method: "GET"
      };
      existing.url = p.response.url ?? existing.url;
      existing.status = p.response.status;
      requests.set(p.requestId, existing);
    });
    const stopFinished = session.on("Network.loadingFinished", (params) => {
      const p = params as { requestId?: string };
      if (p.requestId) {
        finishedIds.push(p.requestId);
      }
    });
    const stopFailed = session.on("Network.loadingFailed", (params) => {
      const p = params as { requestId?: string; errorText?: string };
      if (!p.requestId) {
        return;
      }
      const existing = requests.get(p.requestId);
      if (existing) {
        existing.error = p.errorText ?? "Network loading failed";
      }
    });

    await session.send("Network.enable");
    if (options.triggerExpression) {
      await session.evaluate(wrapExpression(options.triggerExpression));
    }
    const waitMs = options.waitMs ?? 1500;
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    for (const requestId of finishedIds) {
      const existing = requests.get(requestId);
      if (!existing || existing.status === undefined) {
        continue;
      }
      try {
        const body = await session.send<NetworkBodyResult>("Network.getResponseBody", { requestId });
        existing.response = parseResponseBody(body);
      } catch (error) {
        existing.error = error instanceof Error ? error.message : String(error);
      }
    }

    stopRequest();
    stopResponse();
    stopFinished();
    stopFailed();

    return [...requests.values()];
  } finally {
    await session.close();
  }
}
