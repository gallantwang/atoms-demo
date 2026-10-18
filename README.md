# Atoms Demo

模仿 [Atoms](https://atoms.dev) 的 AI 应用生成器 Demo：用自然语言描述需求，模型生成完整 HTML 应用，并在页面内实时预览。

## 1. 项目简介

用户登录后，在对话中描述想要的 Web 应用（如计算器、时钟等），后端 Worker 将请求代理到智谱 **GLM-5.3-Flash**。模型被约束输出可独立运行的完整 HTML；前端解析代码块后，用 `iframe` 的 `srcdoc` 即时渲染。

账号、项目与消息通过 Supabase（Auth + Postgres）持久化，换设备登录后可继续编辑。

## 2. 在线访问

| | |
| --- | --- |
| 演示 | https://atoms-demo.783147448.workers.dev |
| 源码 | https://github.com/gallantwang/atoms-demo |

## 3. 核心功能

- **邮箱注册 / 登录**：基于 Supabase Auth，会话自动持久化与刷新，同一账号可跨设备访问。
- **对话式代码生成**：用自然语言描述应用，模型返回完整单页 HTML（内联 CSS / JS）。
- **流式输出**：`fetch` + `ReadableStream` 解析 SSE，按 `delta.content` 追加到气泡，形成打字机效果。
- **iframe 实时预览**：从回复中提取 HTML（完整文档优先，其次代码围栏，再降级未闭合内容），写入 `srcdoc`。沙箱仅放行 `allow-scripts`，不授予同源权限。
- **多项目管理**：侧边栏新建、切换、删除项目；每个项目独立消息列表，项目名由首条提问自动生成。
- **云端持久化**：项目与消息存入 Supabase `projects` 表（`messages` 为 jsonb 数组），列表按 `updated_at` 倒序。
- **深色工作台界面**：侧边栏 + 对话区 + 预览舞台 + 输入区四段布局，窄屏自动折叠为单列。

## 4. 技术架构

```
┌──────────────┐   POST /api/chat    ┌────────────────────┐   HTTPS    ┌───────────────────┐
│              │ ──────────────────► │  Cloudflare Worker │ ─────────► │   智谱 GLM API     │
│   浏览器      │ ◄────── SSE ─────── │   src/worker.js    │ ◄──stream─ │  glm-5.3-flash    │
│  Vue 3 SPA   │                     │                    │            └───────────────────┘
│              │   /supabase/* 代理   │  env.ZHIPU_API_KEY │
│  iframe 预览  │ ──────────────────► │  ASSETS → dist/    │  ────────► ┌───────────────────┐
│              │ ◄── REST / Auth ─── │                    │            │     Supabase      │
└──────────────┘                     └────────────────────┘            │ Auth + Postgres   │
                                                                       └───────────────────┘
```

Worker 承担三件事：

1. `POST /api/chat` — 注入 system prompt，转发到智谱并原样回传 SSE 流。
2. `/supabase/*` — 反向代理到 Supabase 域名（绕开部分网络环境下的访问限制）。
3. 其余请求 — 交给 `ASSETS` 托管 SPA，404 回退到 `index.html`。

前端由 Vite 构建到 `dist/`。

**技术栈：** Vue 3（`<script setup>` + JavaScript）· Vite · Cloudflare Workers · 智谱 GLM-5.3-Flash · Supabase（Auth + Postgres）

## 5. 本地运行

需要 Node.js（建议 22+）、智谱 API Key，以及一个 Supabase 项目。

```bash
git clone https://github.com/gallantwang/atoms-demo.git
cd atoms-demo
npm install
```

在项目根目录创建 `.dev.vars`：

```
ZHIPU_API_KEY=你的智谱密钥
```

若使用自己的 Supabase 项目，还需：

1. **建表**：创建 `projects` 表，包含 `id`、`user_id`、`name`、`messages`（jsonb）、`updated_at` 字段。
2. **开 RLS**：为 `projects` 启用行级安全策略，限制用户只能读写 `user_id = auth.uid()` 的行。数据隔离完全依赖此策略，务必配置。
3. **改地址**：把 `src/worker.js` 中的 `SUPABASE_URL` 换成你的项目 URL，并同步更新 `wrangler.toml`、`.env.production` 里的 `VITE_SUPABASE_ANON_KEY`。

先构建静态资源（Worker 的 `ASSETS` 指向 `dist/`），再启动：

```bash
npm run build
npm run dev
# 等价于
npx wrangler dev
```

仅调试前端界面、不走 Worker 时可用 `npm run dev:vite`（此时 `/api/chat` 与 `/supabase` 代理均不可用）。

部署：

```bash
npx wrangler secret put ZHIPU_API_KEY
npm run deploy
```

## 6. 已知限制

- 模型偶发输出不完整或有语法错误的 HTML，预览可能空白或控制台报错。
- 项目与消息以整段 jsonb 写入 `projects` 表，每次更新都会重写整行；对话很长时写入体积和耗时都会明显上升。
- 前端拉取项目列表时未按 `user_id` 过滤，完全依赖 Supabase RLS 兜底（见上）。
- 未做并发编辑冲突处理，多标签页同时修改同一项目会后写覆盖先写。
- 生成的 HTML 会在浏览器中执行脚本，虽已通过 iframe sandbox 隔离，但仍建议只用来运行自己信任的生成内容。

## 7. 备注

1. **LLM 依赖**：Demo 调用智谱 GLM-5.3-Flash，当前使用免费额度，可正常交互。
2. **密钥边界**：`VITE_SUPABASE_ANON_KEY` 是可公开的 publishable key，直接写在 `wrangler.toml` 与 `.env.production` 中。
3. **开发工具**：本项目使用 Cursor（Agent 模式）+ Claude 4.5 完成开发。
4. **联系方式**：如 Demo 出现 401 或异常，请联系更新 API Key。
