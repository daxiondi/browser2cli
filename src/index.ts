#!/usr/bin/env node

import { evaluateInTarget, listTargets, resolveTarget, type TargetInfo, type TargetSelector } from "./cdp.js";
import { parseCliArgs, type Args } from "./args.js";
import { adjustReportYesterdayAdapter } from "./adapters/adjust-report-yesterday.js";
import { Browser2CliError, normalizeThrownError, okResult, type ResultEnvelope } from "./protocol.js";
import { renderEnvelope } from "./render.js";
import { executeAdapter, getAdapter, listAdapters, registerAdapter, type AdapterArgs, type AdapterInfo, type CommandAdapter } from "./registry.js";
import { captureUntil, detectState, ensureOpen, invokeAction, waitForPageReady, waitForTarget } from "./runtime.js";

function isJsonMode(args: Args): boolean {
  return args.json === "true";
}

function printOutput(envelope: ResultEnvelope<unknown>, args: Args): void {
  if (isJsonMode(args)) {
    console.log(JSON.stringify(envelope, null, 2));
    return;
  }
  console.log(renderEnvelope(envelope));
}

function requireArg(args: Args, name: string): string {
  const value = args[name];
  if (!value) {
    throw new Browser2CliError({
      code: "INVALID_ARGUMENT",
      state: "invalid_argument",
      message: `Missing required argument --${name}`,
      phase: "collect",
      details: { argument: name },
      nextSteps: [`请补充参数 --${name} 后重试。`]
    });
  }
  return value;
}

function selectorFromArgs(args: Args): TargetSelector {
  return {
    targetId: args["target-id"],
    urlContains: args["url-contains"],
    titleContains: args["title-contains"]
  };
}

async function pickTarget(args: Args): Promise<TargetInfo> {
  const endpoint = requireArg(args, "endpoint");
  const targets = await listTargets(endpoint);
  try {
    return resolveTarget(targets, selectorFromArgs(args));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Could not resolve a unique target")) {
      throw new Browser2CliError({
        code: "MULTIPLE_TARGETS",
        state: "multiple_targets",
        message,
        retryable: true,
        phase: "locate",
        details: { selector: selectorFromArgs(args) },
        nextSteps: ["请补充更精确的 --target-id、--url-contains 或 --title-contains。"]
      });
    }
    throw error;
  }
}

const inspectPageAdapter: CommandAdapter = {
  name: "inspect-page",
  site: "generic",
  description: "附着到页面目标并返回基础页面信息。",
  input: ["--endpoint", "--target-id | --url-contains | --title-contains"],
  output: ["title", "url", "readyState"],
  states: ["ok", "target_not_found", "multiple_targets", "eval_error", "internal_error"],
  prerequisites: ["目标页面已打开，且可通过 CDP 访问。"],
  loginRequired: false,
  reusableSession: true,
  async run(args) {
    const startedAt = Date.now();
    try {
      const target = await pickTarget(args);
      const page = await evaluateInTarget(
        target,
        "(() => ({ title: document.title, url: location.href, readyState: document.readyState }))()"
      );
      return okResult({
        command: "run",
        adapter: "inspect-page",
        durationMs: Date.now() - startedAt,
        phase: "collect",
        target,
        data: page
      });
    } catch (error) {
      return normalizeThrownError(error, {
        command: "run",
        adapter: "inspect-page",
        durationMs: Date.now() - startedAt,
        phase: "collect",
        nextSteps: ["请确认目标页面已经打开，并且 endpoint 可连通。"]
      });
    }
  }
};

registerAdapter(inspectPageAdapter);
registerAdapter(adjustReportYesterdayAdapter);

function printHelp(): void {
  console.log(`browser2cli

Usage:
  browser2cli list [--json]
  browser2cli info <adapter> [--json]
  browser2cli tabs --endpoint <url> [--json]
  browser2cli eval --endpoint <url> [--target-id <id> | --url-contains <text> | --title-contains <text>] --expr <javascript> [--json]
  browser2cli wait-target --endpoint <url> [--target-id <id> | --url-contains <text> | --title-contains <text>] [--timeout-ms <number>] [--json]
  browser2cli ensure-open --endpoint <url> --open-url <url> [--target-id <id> | --url-contains <text> | --title-contains <text>] [--timeout-ms <number>] [--json]
  browser2cli wait-page-ready --endpoint <url> [--target-id <id> | --url-contains <text> | --title-contains <text>] --ready-expr <javascript> [--timeout-ms <number>] [--json]
  browser2cli detect-state --endpoint <url> [--target-id <id> | --url-contains <text> | --title-contains <text>] [--login-expr <javascript>] [--ready-expr <javascript>] [--json]
  browser2cli invoke-action --endpoint <url> [--target-id <id> | --url-contains <text> | --title-contains <text>] --expr <javascript> [--ready-expr <javascript>] [--timeout-ms <number>] [--json]
  browser2cli capture-until --endpoint <url> [--target-id <id> | --url-contains <text> | --title-contains <text>] --match-url <text> [--trigger-expr <javascript>] [--timeout-ms <number>] [--json]
  browser2cli run <adapter> [--key value] [--json]
`);
}

function renderAdapterInfo(adapter: AdapterInfo): string {
  return [
    `${adapter.name} (${adapter.site})`,
    adapter.description,
    "",
    `输入参数: ${adapter.input.join(", ")}`,
    `输出字段: ${adapter.output.join(", ")}`,
    `常见状态: ${adapter.states.join(", ")}`,
    `页面前提: ${adapter.prerequisites.join("；")}`,
    `生命周期: ${adapter.lifecycle?.join(" -> ") ?? "run"}`,
    `需要登录: ${adapter.loginRequired ? "是" : "否"}`,
    `可复用现有会话: ${adapter.reusableSession ? "是" : "否"}`
  ].join("\n");
}

async function main(): Promise<void> {
  const { command, adapter, args } = parseCliArgs(process.argv.slice(2));

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "list") {
    const entries = listAdapters();
    if (isJsonMode(args)) {
      console.log(JSON.stringify(okResult({
        command: "list",
        durationMs: 0,
        data: entries
      }), null, 2));
      return;
    }
    const lines = entries.flatMap((item) => [
      `${item.name} (${item.site})`,
      `  ${item.description}`,
      `  前提: ${item.prerequisites.join("；")}`
    ]);
    console.log(lines.join("\n"));
    return;
  }

  if (command === "info") {
    if (!adapter) {
      throw new Browser2CliError({
        code: "INVALID_ARGUMENT",
        state: "invalid_argument",
        message: "Missing adapter name. Use `browser2cli list` to see available adapters.",
        phase: "collect",
        nextSteps: ["请执行 browser2cli list 查看可用 adapter。"]
      });
    }
    const item = getAdapter(adapter);
    if (!item) {
      throw new Browser2CliError({
        code: "INVALID_ARGUMENT",
        state: "invalid_argument",
        message: `Unknown adapter: ${adapter}`,
        phase: "collect",
        nextSteps: ["请执行 browser2cli list 查看可用 adapter。"]
      });
    }
    const envelope = okResult({
      command: "info",
      adapter: item.name,
      durationMs: 0,
      data: {
        name: item.name,
        site: item.site,
        description: item.description,
        input: item.input,
        output: item.output,
        states: item.states,
        prerequisites: item.prerequisites,
        lifecycle: item.lifecycle,
        loginRequired: item.loginRequired,
        reusableSession: item.reusableSession
      }
    });
    if (isJsonMode(args)) {
      console.log(JSON.stringify(envelope, null, 2));
      return;
    }
    console.log(renderAdapterInfo(item));
    return;
  }

  if (command === "tabs") {
    const startedAt = Date.now();
    try {
      const endpoint = requireArg(args, "endpoint");
      const envelope = okResult({
        command: "tabs",
        durationMs: Date.now() - startedAt,
        data: await listTargets(endpoint)
      });
      printOutput(envelope, args);
      return;
    } catch (error) {
      printOutput(normalizeThrownError(error, {
        command: "tabs",
        durationMs: Date.now() - startedAt,
        phase: "locate",
        nextSteps: ["请确认 CDP endpoint 可访问，例如 http://127.0.0.1:9222。"]
      }), args);
      process.exitCode = 1;
      return;
    }
  }

  if (command === "eval") {
    const startedAt = Date.now();
    try {
      const target = await pickTarget(args);
      const expr = requireArg(args, "expr");
      const envelope = okResult({
        command: "eval",
        durationMs: Date.now() - startedAt,
        phase: "collect",
        target,
        data: { result: await evaluateInTarget(target, expr) }
      });
      printOutput(envelope, args);
      return;
    } catch (error) {
      printOutput(normalizeThrownError(error, {
        command: "eval",
        durationMs: Date.now() - startedAt,
        phase: "collect"
      }), args);
      process.exitCode = 1;
      return;
    }
  }

  if (command === "wait-target") {
    const startedAt = Date.now();
    try {
      const endpoint = requireArg(args, "endpoint");
      const timeoutMs = args["timeout-ms"] ? Number(args["timeout-ms"]) : 5_000;
      const target = await waitForTarget({
        endpoint,
        selector: selectorFromArgs(args),
        timeoutMs
      });
      printOutput(okResult({
        command: "wait-target",
        durationMs: Date.now() - startedAt,
        phase: "locate",
        target,
        data: target
      }), args);
      return;
    } catch (error) {
      printOutput(normalizeThrownError(error, {
        command: "wait-target",
        durationMs: Date.now() - startedAt,
        phase: "locate"
      }), args);
      process.exitCode = 1;
      return;
    }
  }

  if (command === "ensure-open") {
    const startedAt = Date.now();
    try {
      const endpoint = requireArg(args, "endpoint");
      const url = requireArg(args, "open-url");
      const timeoutMs = args["timeout-ms"] ? Number(args["timeout-ms"]) : 5_000;
      const target = await ensureOpen({
        endpoint,
        url,
        selector: selectorFromArgs(args),
        timeoutMs
      });
      printOutput(okResult({
        command: "ensure-open",
        durationMs: Date.now() - startedAt,
        phase: "locate",
        target,
        data: target
      }), args);
      return;
    } catch (error) {
      printOutput(normalizeThrownError(error, {
        command: "ensure-open",
        durationMs: Date.now() - startedAt,
        phase: "locate"
      }), args);
      process.exitCode = 1;
      return;
    }
  }

  if (command === "wait-page-ready") {
    const startedAt = Date.now();
    try {
      const target = await pickTarget(args);
      const readyExpression = requireArg(args, "ready-expr");
      const timeoutMs = args["timeout-ms"] ? Number(args["timeout-ms"]) : 5_000;
      printOutput(await waitForPageReady({
        target,
        readyExpression,
        timeoutMs
      }), args);
      return;
    } catch (error) {
      printOutput(normalizeThrownError(error, {
        command: "wait-page-ready",
        durationMs: Date.now() - startedAt,
        phase: "ensurePage"
      }), args);
      process.exitCode = 1;
      return;
    }
  }

  if (command === "invoke-action") {
    const startedAt = Date.now();
    try {
      const target = await pickTarget(args);
      const expression = requireArg(args, "expr");
      const timeoutMs = args["timeout-ms"] ? Number(args["timeout-ms"]) : 5_000;
      printOutput(await invokeAction({
        target,
        expression,
        readyExpression: args["ready-expr"],
        timeoutMs
      }), args);
      return;
    } catch (error) {
      printOutput(normalizeThrownError(error, {
        command: "invoke-action",
        durationMs: Date.now() - startedAt,
        phase: "collect"
      }), args);
      process.exitCode = 1;
      return;
    }
  }

  if (command === "detect-state") {
    const startedAt = Date.now();
    try {
      const target = await pickTarget(args);
      printOutput(await detectState({
        target,
        loginExpression: args["login-expr"],
        readyExpression: args["ready-expr"]
      }), args);
      return;
    } catch (error) {
      printOutput(normalizeThrownError(error, {
        command: "detect-state",
        durationMs: Date.now() - startedAt,
        phase: "ensureAuth"
      }), args);
      process.exitCode = 1;
      return;
    }
  }

  if (command === "capture-until") {
    const startedAt = Date.now();
    try {
      const target = await pickTarget(args);
      const matchUrlContains = requireArg(args, "match-url");
      const timeoutMs = args["timeout-ms"] ? Number(args["timeout-ms"]) : 5_000;
      printOutput(await captureUntil({
        target,
        triggerExpression: args["trigger-expr"] ?? args.triggerExpr,
        matchUrlContains,
        timeoutMs
      }), args);
      return;
    } catch (error) {
      printOutput(normalizeThrownError(error, {
        command: "capture-until",
        durationMs: Date.now() - startedAt,
        phase: "collect"
      }), args);
      process.exitCode = 1;
      return;
    }
  }

  if (command === "run") {
    const startedAt = Date.now();
    try {
      if (!adapter) {
        throw new Browser2CliError({
          code: "INVALID_ARGUMENT",
          state: "invalid_argument",
          message: "Missing adapter name. Use `browser2cli list` to see available adapters.",
          phase: "collect",
          nextSteps: ["请执行 browser2cli list 查看可用 adapter。"]
        });
      }
      const item = getAdapter(adapter);
      if (!item) {
        throw new Browser2CliError({
          code: "INVALID_ARGUMENT",
          state: "invalid_argument",
          message: `Unknown adapter: ${adapter}`,
          phase: "collect",
          nextSteps: ["请执行 browser2cli list 查看可用 adapter。"]
        });
      }
      const adapterArgs: AdapterArgs = item.name === "adjust-report-yesterday"
        ? { ...args, __pickedTarget: await pickTarget(args) }
        : args;
      const envelope = await executeAdapter(item, adapterArgs);
      if (!envelope.meta.durationMs) {
        envelope.meta.durationMs = Date.now() - startedAt;
      }
      printOutput(envelope, args);
      if (!envelope.ok) {
        process.exitCode = 1;
      }
      return;
    } catch (error) {
      printOutput(normalizeThrownError(error, {
        command: "run",
        adapter,
        durationMs: Date.now() - startedAt,
        phase: "collect"
      }), args);
      process.exitCode = 1;
      return;
    }
  }

  throw new Browser2CliError({
    code: "INVALID_ARGUMENT",
    state: "invalid_argument",
    message: `Unknown command: ${command}`,
    phase: "collect",
    nextSteps: ["请执行 browser2cli help 查看可用命令。"]
  });
}

main().catch((error: unknown) => {
  const envelope = normalizeThrownError(error, {
    command: "main",
    durationMs: 0,
    phase: "collect"
  });
  console.error(renderEnvelope(envelope));
  process.exitCode = 1;
});
