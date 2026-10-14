# Atoms Demo

模仿 [Atoms](https://atoms.dev) 的 AI 应用生成器 Demo，用自然语言描述需求，模型生成完整 HTML 应用，并在页面内实时预览。

## 1. 项目简介

用户在对话中描述想要的 Web 应用（如计算器、时钟等），后端 Worker 将请求代理到智谱 **GLM-5.3-Flash**。模型被约束输出可独立运行的完整 HTML；前端解析代码块后，用 `iframe` 的 `srcdoc` 即时渲染。

会话与项目列表保存在浏览器 `localStorage` 中，刷新后可继续编辑。

## 2. 在线访问

| | |
| --- | --- |
| 演示 | https://atoms-demo.783147448.workers.dev |
| 源码 | https://github.com/gallantwang/atoms-demo |

## 3. 核心功能

- **对话式代码生成**：用自然语言描述应用，模型返回完整单页 HTML（内联 CSS / JS）。
- **流式输出**：`fetch` + `ReadableStream` 解析 SSE，按 `delta.content` 追加到气泡，形成打字机效果。
- **iframe 实时预览**：从回复中提取 HTML（完整文档优先，其次代码围栏，再降级未闭合内容），写入 `srcdoc`。
- **多项目管理**：侧边栏新建、切换、删除项目；每个项目独立消息列表。
- **localStorage 持久化**：项目数组写入 `atoms_demo_projects`，首次访问自动创建空项目。

## 4. 技术架构

```
┌─────────────┐     POST /api/chat      ┌──────────────────────┐     HTTPS      ┌─────────────────┐
│   浏览器     │  ────────────────────►  │  Cloudflare Worker   │  ──────────►  │  智谱 GLM API   │
│  Vue 3 SPA  │                         │  src/worker.js       │               │  glm-5.3-flash  │
│             │  ◄──── SSE stream ────  │  env.ZHIPU_API_KEY   │  ◄── stream ─ │                 │
│  iframe     │                         │  ASSETS → dist/      │               └─────────────────┘
│  预览 / 会话 │  ◄──── 静态资源 ──────  │                      │
└─────────────┘                         └──────────────────────┘
        │
        └── localStorage（项目、消息）
```

前端由 Vite 构建到 `dist/`，Worker 通过 `[assets]` 绑定托管 SPA（404 回退到 `index.html`）。仅 `POST /api/chat` 走模型代理，其余请求交给静态资源。

**技术栈：** Vue 3（`<script setup>` + JavaScript）· Vite · Cloudflare Workers · 智谱 GLM-5.3-Flash · localStorage


## 5. 本地运行

需要 Node.js（建议 22+）和智谱 API Key。

```bash
git clone https://github.com/gallantwang/atoms-demo.git
cd atoms-demo
npm install
```

在项目根目录创建 `.dev.vars`：

```
ZHIPU_API_KEY=你的智谱密钥
```

先构建静态资源（Worker 的 `ASSETS` 指向 `dist/`），再启动：

```bash
npm run build
npm run dev
# 等价于
npx wrangler dev
```

仅调试前端界面、不走 Worker 时可用 `npm run dev:vite`（此时 `/api/chat` 不可用）。

部署：

```bash
npx wrangler secret put ZHIPU_API_KEY
npm run deploy
```

## 6. 已知限制

- 模型偶发输出不完整或有语法错误的 HTML，预览可能空白或控制台报错。
- `localStorage` 大约 5MB 上限，长对话或大段 HTML 过多时可能写入失败。
- 无用户认证与服务端存储，清站点数据即丢失项目；无法跨设备同步。

## 7. 未来扩展方向
1. **多 Agent 角色模拟**：产品 / 设计 / 开发分工生成，提高复杂应用的完整度。


## 8. 备注
1. **LLM 依赖**：Demo 调用智谱 GLM-5.3-Flash，当前使用免费额度，可正常交互。
2. **开发工具**：本项目使用 Cursor（Agent 模式）+ Claude 4.5 完成开发。
3. **联系方式**：如 Demo 出现 401 或异常，请联系更新 API Key。
