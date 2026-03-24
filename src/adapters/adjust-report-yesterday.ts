import { captureFetchInTarget, type CapturedRequest, type TargetInfo } from "../cdp.js";
import type { Args } from "../args.js";
import { Browser2CliError } from "../protocol.js";
import type { AdapterContext, LifecycleAdapter } from "../registry.js";

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (!match) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function getRowDate(row: Record<string, unknown>): string | null {
  for (const key of ["day", "date", "date_label", "dateLabel", "dimension_day"]) {
    const normalized = normalizeDate(row[key]);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

export function selectPivotReport(requests: CapturedRequest[]): CapturedRequest {
  const match = [...requests]
    .reverse()
    .find((item) => item.url.includes("reports-service/pivot_report") && !item.error && (item.status ?? 200) < 400);

  if (!match) {
    throw new Error("No successful pivot_report response was captured.");
  }
  return match;
}

export function extractRowsForDate(response: unknown, targetDate: string): Record<string, unknown>[] {
  if (!response || typeof response !== "object") {
    return [];
  }

  const rows = (response as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.filter((row): row is Record<string, unknown> => {
    if (!row || typeof row !== "object") {
      return false;
    }
    return getRowDate(row) === targetDate;
  });
}

export function resolveTargetDate(args: Args): string {
  if (args.date) {
    return args.date;
  }
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return now.toISOString().slice(0, 10);
}

type AdjustCollectResult = {
  targetDate: string;
  pivotRequest: CapturedRequest;
  rows: Record<string, unknown>[];
};

type AdjustContext = AdapterContext & {
  target: TargetInfo;
  targetDate: string;
};

export const adjustReportYesterdayAdapter: LifecycleAdapter = {
  name: "adjust-report-yesterday",
  site: "adjust",
  description: "从 Adjust 报表页抓取 pivot_report，并返回昨天或指定日期的数据行。",
  input: ["--endpoint", "--target-id | --url-contains | --title-contains", "--date?", "--trigger-expr?"],
  output: ["date", "rowCount", "rows", "request"],
  states: [
    "ok",
    "target_not_found",
    "multiple_targets",
    "capture_timeout",
    "page_not_ready",
    "network_error",
    "data_empty",
    "internal_error"
  ],
  prerequisites: ["Adjust 报表页已打开，且页面触发后会产生 pivot_report 请求。"],
  loginRequired: true,
  reusableSession: true,
  lifecycle: ["locate", "collect", "normalize"],
  async locate(args) {
    const target = args.__pickedTarget as unknown as TargetInfo | undefined;
    if (!target) {
      throw new Browser2CliError({
        code: "TARGET_NOT_FOUND",
        state: "target_not_found",
        message: "No selected target was provided for adjust-report-yesterday.",
        retryable: true,
        phase: "locate",
        nextSteps: ["请先通过 target 选择参数定位到 Adjust 报表页。"]
      });
    }
    return {
      args,
      target,
      targetDate: resolveTargetDate(args as Args)
    };
  },
  async collect(ctx) {
    const typedCtx = ctx as AdjustContext;
    const requests = await captureFetchInTarget(typedCtx.target, {
      triggerExpression: (typedCtx.args["trigger-expr"] as string | undefined) ?? (typedCtx.args.triggerExpr as string | undefined),
      waitMs: typedCtx.args["wait-ms"] ? Number(typedCtx.args["wait-ms"]) : undefined
    });
    const pivotRequest = selectPivotReport(requests);
    const rows = extractRowsForDate(pivotRequest.response, typedCtx.targetDate);
    return {
      targetDate: typedCtx.targetDate,
      pivotRequest,
      rows
    };
  },
  async normalize(raw) {
    const typedRaw = raw as AdjustCollectResult;
    if (typedRaw.rows.length === 0) {
      throw new Browser2CliError({
        code: "DATA_EMPTY",
        state: "data_empty",
        message: `No rows found for date ${typedRaw.targetDate}.`,
        retryable: true,
        phase: "normalize",
        details: {
          date: typedRaw.targetDate,
          requestUrl: typedRaw.pivotRequest.url
        },
        nextSteps: ["请确认报表接口返回了目标日期的数据，或显式指定 --date 后重试。"]
      });
    }

    return {
      date: typedRaw.targetDate,
      request: {
        url: typedRaw.pivotRequest.url,
        method: typedRaw.pivotRequest.method,
        status: typedRaw.pivotRequest.status ?? null
      },
      rowCount: typedRaw.rows.length,
      rows: typedRaw.rows
    };
  }
};

export async function runAdjustReportYesterday(target: TargetInfo, args: Args) {
  const targetDate = resolveTargetDate(args);
  const requests = await captureFetchInTarget(target, {
    triggerExpression: args["trigger-expr"] ?? args.triggerExpr,
    waitMs: args["wait-ms"] ? Number(args["wait-ms"]) : undefined
  });
  const pivotRequest = selectPivotReport(requests);
  const rows = extractRowsForDate(pivotRequest.response, targetDate);

  if (rows.length === 0) {
    throw new Browser2CliError({
      code: "DATA_EMPTY",
      state: "data_empty",
      message: `No rows found for date ${targetDate}.`,
      retryable: true,
      phase: "normalize",
      details: {
        date: targetDate,
        requestUrl: pivotRequest.url
      },
      nextSteps: ["请确认报表接口返回了目标日期的数据，或显式指定 --date 后重试。"]
    });
  }

  return {
    ok: true,
    code: "OK",
    state: "ok",
    data: {
      date: targetDate,
      request: {
        url: pivotRequest.url,
        method: pivotRequest.method,
        status: pivotRequest.status ?? null
      },
      rowCount: rows.length,
      rows
    },
    meta: {
      command: "run",
      adapter: "adjust-report-yesterday",
      phase: "normalize",
      durationMs: 0,
      target
    }
  };
}
