const SYSTEM_PROMPT = {
  role: 'system',
  content: `你是 Atoms，一个 AI 应用生成器。用户会描述想要的 Web 应用，你必须生成一个可独立运行的完整 HTML 页面。

强制输出规则：
1. 只输出一个 markdown 代码块，格式必须是 \`\`\`html ... \`\`\`
2. 代码块内必须是完整 HTML 文档，从 <!DOCTYPE html> 开始，包含 <html>、<head>、<body>
3. 所有 CSS 写在 <style> 里，所有 JS 写在 <script> 里，禁止依赖外部 CDN、图片或字体（可用系统字体和纯 CSS）
4. 页面必须可直接在 iframe 的 srcdoc 中运行：布局完整、样式精致、交互可用
5. 不要输出解释、前言、后记或第二个代码块`,
}

// ⚠️ 请确认这里的 URL 是你的 Supabase 项目 URL
const SUPABASE_URL = 'https://vzkckffanbcopzugmdkc.supabase.co'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // ==========================================
    // 1. 代理 Supabase 请求 (绕过本地网络封锁)
    // ==========================================
    if (url.pathname.startsWith('/supabase')) {
      // 移除 '/supabase' 前缀，拼接到真实 Supabase 域名上
      const targetPath = url.pathname.replace('/supabase', '')
      const targetUrl = new URL(targetPath + url.search, SUPABASE_URL)

      // 复制请求头，并删除可能导致冲突的 host
      const newHeaders = new Headers(request.headers)
      newHeaders.delete('host')
      
      // 发起真实的请求
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: newHeaders,
        body: request.body,
      })

      // 复制响应并返回，处理一些必要的头（如 Set-Cookie 等）
      const newResponse = new Response(response.body, response)
      // 如果前端和 Worker 同源，其实不需要 CORS，但加一层保险
      newResponse.headers.set('Access-Control-Allow-Origin', '*')
      return newResponse
    }

    // ==========================================
    // 2. 智谱大模型 API 转发
    // ==========================================
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        const { messages = [], model = 'glm-5.3-flash' } = await request.json()
        const conversation = Array.isArray(messages)
          ? messages.filter((m) => m?.role !== 'system')
          : []

        const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.ZHIPU_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [SYSTEM_PROMPT, ...conversation],
            stream: true,
          }),
        })

        if (!response.ok) {
          const error = await response.text()
          return new Response(JSON.stringify({ error }), {
            status: response.status,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response(response.body, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // ==========================================
    // 3. 静态资源兜底
    // ==========================================
    return env.ASSETS.fetch(request)
  },
}