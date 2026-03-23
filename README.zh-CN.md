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
- 基于 CDP 的标签页连接能力
- `tabs`、`eval`、`capture-fetch` 三个基础命令
- adapter 的运行时结构
- 一个内置示例 adapter：`inspect-page`

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

### 捕获认证态下的 fetch / XHR

```bash
browser2cli capture-fetch \
  --endpoint http://127.0.0.1:9222 \
  --url-contains adjust.com \
  --expr "(() => window.fetch('/reports-service/pivot_report'))()" \
  --wait-ms 1500
```

这个命令会在页面里安装一个轻量 hook，触发脚本，短暂等待，然后把捕获到的请求/响应结果以 JSON 输出。

## 未来 adapter 方向

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

## 发布前检查

```bash
npm run test
npm run check
npm publish
```
