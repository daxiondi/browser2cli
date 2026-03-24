# browser2cli

[English](./README.md) · 中文

`browser2cli` 是一个最小可用的 CLI，用来把**已经登录的网站页面**变成可复用的数据抓取入口。

它的核心思路很简单：

- 把最难处理的登录态留在真实浏览器里
- 自动复用页面已有的 Cookie、CSRF 和前端状态
- 在页面上下文里执行取数逻辑，而不是反复点 UI
- 直接返回结构化 JSON，给 agent 或脚本继续处理

这是一个原创实现，保留“页面上下文即 API”的核心思想，但不复刻其他项目的 adapter 代码。

## 为什么要做这个

很多内部后台和增长平台都很难稳定自动化，因为：

- Cookie 会过期
- 请求签名在前端代码里
- API 依赖浏览器 Cookie 或 CSRF
- 纯点击页面又慢又脆

更务实的方式是：

1. 连接一个活着的浏览器标签页
2. 在页面上下文里执行一小段脚本
3. 读取 fetch/XHR 返回或页面内部状态
4. 输出标准化 JSON

## 当前能力

当前版本已经支持：

- 一个轻量的 TypeScript CLI
- 基于 direct-CDP 的标签页连接能力
- 等待、状态识别、动作 + 抓包的 runtime 原语
- 面向 agent / 脚本的统一结果协议
- 默认人类可读输出，以及 `--json` 原始结构输出
- 一个带 registry 的 adapter 基础结构

## 安装

### 从 npm 安装

```bash
npm install -g browser2cli
browser2cli tabs --endpoint http://127.0.0.1:9222
```

### 用 npx 直接运行

```bash
npx browser2cli tabs --endpoint http://127.0.0.1:9222
```

### npm 发布前，从 GitHub 安装

```bash
npm install -g github:daxiondi/browser2cli
browser2cli tabs --endpoint http://127.0.0.1:9222
```

## 命令示例

```bash
npm install
npm run build
node dist/index.js list
node dist/index.js info adjust-report-yesterday
```

### 列出标签页

```bash
browser2cli tabs --endpoint http://127.0.0.1:9222
```

### 在页面上下文执行 JS

```bash
browser2cli eval \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --expr "(() => ({ title: document.title, url: location.href }))()"
```

### 等待目标页面出现

```bash
browser2cli wait-target \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --timeout-ms 3000
```

### 确保页面已打开

```bash
browser2cli ensure-open \
  --endpoint http://127.0.0.1:9222 \
  --open-url "https://example.com/new-page" \
  --url-contains "example.com/new-page" \
  --timeout-ms 3000
```

### 等待页面 ready

```bash
browser2cli wait-page-ready \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --ready-expr "(() => document.readyState === 'complete')()" \
  --timeout-ms 3000
```

### 检测页面状态

```bash
browser2cli detect-state \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --login-expr "(() => location.pathname.includes('/login'))()" \
  --ready-expr "(() => document.readyState === 'complete')()"
```

### 执行页面动作

```bash
browser2cli invoke-action \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --expr "(() => window.fetch('/reports-service/pivot_report'))()" \
  --ready-expr "(() => document.readyState === 'complete')()" \
  --timeout-ms 3000
```

### 触发动作并捕获匹配请求

```bash
browser2cli capture-until \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --match-url "pivot_report" \
  --trigger-expr "(() => window.fetch('/reports-service/pivot_report'))()" \
  --timeout-ms 3000
```

## 输出协议

`browser2cli` 现在分为两层：

- **内层协议层**：统一返回 JSON envelope，包含 `ok`、`code`、`state`、`data`、`error`、`meta`
- **外层展示层**：CLI 默认渲染成人类友好文本

如果你要给脚本或 agent 稳定消费，请加 `--json`：

```bash
browser2cli run inspect-page \
  --endpoint http://127.0.0.1:9222 \
  --url-contains "adjust.com" \
  --json
```

每次成功或失败都带：
- 稳定的错误码和状态
- `meta.durationMs`
- phase 信息
- 可选的 `hint.nextSteps`

## adapter 模型

每个 adapter 都应该明确：

- 需要什么页面或会话前提
- 怎么定位可复用的页面 target
- 怎么判断登录和页面 ready
- 怎么收集原始数据
- 怎么规范化输出

当前 adapter contract 围绕这五步：

- `locate`
- `ensureAuth`
- `ensurePage`
- `collect`
- `normalize`

后续适合做成固定 adapter 的能力包括：

- `shushu/project-row`
- `feishu/doc-export`

## 第一条业务 adapter

### Adjust：取昨天报表

```bash
browser2cli run adjust-report-yesterday \
  --endpoint http://127.0.0.1:9222 \
  --url-contains "suite.adjust.com/datascape/report" \
  --date 2026-03-22 \
  --trigger-expr "(() => window.fetch('/reports-service/pivot_report'))()"
```

这个 adapter 假设你已经打开了 Adjust 报表页。它会在页面上下文里捕获 `pivot_report` 的响应，然后筛出目标日期的行。

## 安全边界

- 默认不输出 Cookie、认证头、CSRF token
- 默认不回显页面存储里的原始密钥
- 优先返回业务数据，而不是整页 HTML
- adapter 权限要尽量窄、尽量明确

## 当前状态

这个仓库现在已经不只是一个“能 eval 的 CDP 小工具”，而是在往：

- browser runtime
- adapter platform
- registry

这三个方向演进。后续会继续补：
- wait / state / action 原语
- 更完整的 adapter
- 更稳定的 registry 元信息

## 发布前检查

```bash
npm run test
npm run check
npm publish
```
