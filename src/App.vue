<script setup>
import { ref, onMounted, nextTick, computed, watch } from 'vue'
import { supabase } from './supabase'

const SYSTEM_PROMPT = {
  role: 'system',
  content: `你是 Atoms，一个 AI 应用生成器。根据用户描述生成完整、可独立运行的单页 Web 应用。
规则：
1. 输出一个完整 HTML 文档（含 <!DOCTYPE html>、内联 CSS 与 JS）
2. 必须用 markdown 代码块包裹，格式为 \`\`\`html ... \`\`\`
3. 界面要现代、精致，交互完整可用
4. 除代码块外不要输出多余解释`,
}

const SUGGESTIONS = [
  '做一个深色待办清单',
  '写一个番茄钟',
  '生成一个记账小工具',
  '做一个天气信息卡片',
]

// ============ 1. 用户状态与登录逻辑 ============
const user = ref(null)
const authEmail = ref('')
const authPassword = ref('')
const authLoading = ref(false)
const authError = ref('')
const isLoginView = ref(true)

const userInitial = computed(() => (user.value?.email || 'U').charAt(0).toUpperCase())

async function handleAuth() {
  authError.value = ''
  authLoading.value = true
  try {
    let result
    if (isLoginView.value) {
      result = await supabase.auth.signInWithPassword({
        email: authEmail.value,
        password: authPassword.value,
      })
    } else {
      result = await supabase.auth.signUp({
        email: authEmail.value,
        password: authPassword.value,
      })
    }
    if (result.error) throw result.error
    user.value = result.data.user
    if (result.data.session) {
      await fetchProjects()
    } else {
      alert('注册成功！请查收邮箱进行验证（如果在 Supabase 中关闭了邮箱验证则直接登录）。')
    }
  } catch (err) {
    authError.value = err.message || '认证失败'
  } finally {
    authLoading.value = false
  }
}

function switchAuthView(toLogin) {
  isLoginView.value = toLogin
  authError.value = ''
}

async function handleLogout() {
  await supabase.auth.signOut()
  user.value = null
  projects.value = []
  currentId.value = ''
  previewHtml.value = ''
}

// ============ 2. 项目数据与云端同步 ============
const projects = ref([])
const currentId = ref('')
const inputText = ref('')
const isStreaming = ref(false)
const chatRef = ref(null)
const inputRef = ref(null)

const currentProject = computed(() => projects.value.find((p) => p.id === currentId.value) || null)

const lastAssistantContent = computed(() => {
  const msgs = currentProject.value?.messages || []
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') return msgs[i].content
  }
  return ''
})

// 从 Supabase 获取当前用户的数据
async function fetchProjects() {
  if (!user.value) return
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false })

  if (!error && data) {
    projects.value = data
    if (data.length > 0) currentId.value = data[0].id
  }
}

// ============ 3. HTML 提取与预览渲染 ============
function getPreviewHtml(content) {
  if (!content) return ''
  const text = content.replace(/\r\n/g, '\n')
  const lower = text.toLowerCase()
  const findStart = (str) => {
    const docIdx = str.indexOf('<!doctype')
    const htmlIdx = str.indexOf('<html')
    if (docIdx === -1 && htmlIdx === -1) return -1
    if (docIdx === -1) return htmlIdx
    if (htmlIdx === -1) return docIdx
    return Math.min(docIdx, htmlIdx)
  }
  const start1 = findStart(lower)
  if (start1 !== -1) {
    const end1 = lower.lastIndexOf('</html>')
    if (end1 !== -1 && end1 > start1) return text.slice(start1, end1 + 7).trim()
  }
  const matches = [...text.matchAll(/```(?:html|HTML)?\s*\n([\s\S]*?)```/g)]
  for (const m of matches) {
    const code = (m[1] || '').trim()
    if (/<html|<!doctype/i.test(code)) {
      const codeLower = code.toLowerCase()
      const s = findStart(codeLower)
      if (s !== -1) {
        const e = codeLower.lastIndexOf('</html>')
        if (e !== -1 && e > s) return code.slice(s, e + 7).trim()
        return code.slice(s).trim()
      }
    }
  }
  if (start1 !== -1) return text.slice(start1).trim()
  return ''
}

function injectViewport(html) {
  if (!html) return ''
  if (/<meta[^>]*name=["']viewport["']/i.test(html)) return html
  const meta = '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`)
  }
  return meta + html
}

const previewHtml = ref('')
watch(
  [currentId, lastAssistantContent, isStreaming],
  ([, content, streaming]) => {
    if (streaming) return
    previewHtml.value = injectViewport(getPreviewHtml(content))
  },
  { immediate: true }
)

const previewKey = ref(0)
function refreshPreview() { previewKey.value++ }
function openPreviewInNewTab() {
  const html = previewHtml.value
  if (!html) return
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}

// ============ 4. 项目操作 (CRUD) ============
async function createProject() {
  if (!user.value) return alert('请先登录')
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: user.value.id,
      name: '未命名项目',
      messages: []
    })
    .select()
    .single()

  if (!error && data) {
    projects.value.unshift(data)
    currentId.value = data.id
    previewHtml.value = ''
    nextTick(() => inputRef.value?.focus())
  }
}

function selectProject(id) {
  if (isStreaming.value) return
  currentId.value = id
  nextTick(scrollChat)
}

async function deleteProject(id, event) {
  event.stopPropagation()
  if (isStreaming.value && id === currentId.value) return

  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (!error) {
    projects.value = projects.value.filter(p => p.id !== id)
    if (projects.value.length === 0) {
      currentId.value = ''
    } else if (currentId.value === id) {
      currentId.value = projects.value[0].id
    }
  }
}

function formatTime(ts) {
  const date = new Date(ts)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function scrollChat() {
  const el = chatRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function maybeRename(project, text) {
  if (project.name !== '未命名项目') return
  const name = text.replace(/\s+/g, ' ').trim().slice(0, 18)
  if (name) project.name = name
}

function useSuggestion(text) {
  inputText.value = text
  nextTick(() => inputRef.value?.focus())
}

// ============ 5. 对话与流式生成 ============
async function sendMessage() {
  const text = inputText.value.trim()
  const project = currentProject.value
  if (!text || !project || isStreaming.value) return

  project.messages.push({ role: 'user', content: text })
  maybeRename(project, text)
  project.updated_at = new Date().toISOString()

  // 保存用户消息
  await supabase.from('projects').update({
    name: project.name,
    messages: project.messages,
    updated_at: project.updated_at
  }).eq('id', project.id)

  inputText.value = ''
  await nextTick()
  scrollChat()

  const assistantIndex = project.messages.length
  project.messages.push({ role: 'assistant', content: '' })
  isStreaming.value = true

  try {
    await streamAssistant(project, assistantIndex)
  } catch (error) {
    const msg = project.messages[assistantIndex]
    if (msg && !msg.content) {
      msg.content = `生成失败：${error.message || '请稍后重试'}`
    }
  } finally {
    isStreaming.value = false
    project.updated_at = new Date().toISOString()

    // 保存 AI 回复
    await supabase.from('projects').update({
      messages: project.messages,
      updated_at: project.updated_at
    }).eq('id', project.id)

    const finalContent = project.messages[assistantIndex]?.content || ''
    previewHtml.value = injectViewport(getPreviewHtml(finalContent))

    await nextTick()
    scrollChat()
    inputRef.value?.focus()
  }
}

async function streamAssistant(project, assistantIndex) {
  const payload = {
    messages: [
      SYSTEM_PROMPT,
      ...project.messages.filter((m, i) => i !== assistantIndex && m.content),
    ],
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(errText || `HTTP ${response.status}`)
  }
  if (!response.body) throw new Error('浏览器不支持流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      applySseLine(line, project, assistantIndex)
    }
    await nextTick()
    scrollChat()
  }

  if (buffer.trim()) applySseLine(buffer, project, assistantIndex)
}

function applySseLine(line, project, assistantIndex) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return
  const data = trimmed.slice(5).trim()
  if (!data || data === '[DONE]') return
  try {
    const json = JSON.parse(data)
    const delta = json.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta) {
      project.messages[assistantIndex].content += delta
    }
  } catch { }
}

function onKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}

onMounted(async () => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user) {
    user.value = session.user
    await fetchProjects()
  }
})
</script>

<template>
  <!-- 登录/注册界面 -->
  <div v-if="!user" class="auth-container">
    <div class="auth-bg" aria-hidden="true">
      <span class="orb orb-1"></span>
      <span class="orb orb-2"></span>
      <span class="grid-lines"></span>
    </div>

    <div class="auth-box">
      <div class="auth-brand">
        <div class="brand-mark" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <h1>Atoms Demo</h1>
        <p>用对话生成 Web 应用</p>
      </div>

      <div class="auth-switch" role="tablist">
        <button type="button" :class="{ on: isLoginView }" @click="switchAuthView(true)">登录</button>
        <button type="button" :class="{ on: !isLoginView }" @click="switchAuthView(false)">注册</button>
      </div>

      <form class="auth-form" @submit.prevent="handleAuth">
        <label class="field">
          <span class="field-label">邮箱</span>
          <input v-model="authEmail" type="email" placeholder="you@example.com" autocomplete="email" />
        </label>

        <label class="field">
          <span class="field-label">密码</span>
          <input v-model="authPassword" type="password" placeholder="请输入密码" autocomplete="current-password" />
        </label>

        <p v-if="authError" class="error-msg">{{ authError }}</p>

        <button class="auth-btn" type="submit" :disabled="authLoading">
          <span v-if="authLoading" class="spinner" aria-hidden="true"></span>
          {{ authLoading ? '处理中…' : isLoginView ? '登录' : '创建账号' }}
        </button>
      </form>

      <p class="auth-foot">
        {{ isLoginView ? '还没有账号？' : '已经有账号了？' }}
        <a @click="switchAuthView(!isLoginView)">{{ isLoginView ? '去注册' : '去登录' }}</a>
      </p>
    </div>
  </div>

  <!-- 主应用界面 -->
  <div v-else class="app">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <div>
          <h1>Atoms Demo</h1>
          <p>用对话生成 Web 应用</p>
        </div>
      </div>

      <button class="new-btn" type="button" @click="createProject">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        新建项目
      </button>

      <div class="list-head">
        <span>项目</span>
        <span class="count">{{ projects.length }}</span>
      </div>

      <div class="project-list">
        <button
          v-for="project in projects" :key="project.id" type="button"
          class="project-item" :class="{ active: project.id === currentId }"
          @click="selectProject(project.id)"
        >
          <div class="project-meta">
            <span class="project-name">{{ project.name }}</span>
            <span class="project-time">{{ formatTime(project.updated_at) }}</span>
          </div>
          <span class="delete-btn" title="删除项目" @click="deleteProject(project.id, $event)">×</span>
        </button>
      </div>

      <div class="user-profile">
        <span class="avatar">{{ userInitial }}</span>
        <span class="user-email">{{ user.email }}</span>
        <button class="logout-btn" title="退出登录" @click="handleLogout">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 17l5-5-5-5M20 12H9M12 19H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
          </svg>
        </button>
      </div>
    </aside>

    <main class="workspace">
      <section ref="chatRef" class="chat">
        <div v-if="!currentProject?.messages.length" class="empty-chat">
          <div class="empty-icon">⚛</div>
          <h2>从一句话开始构建</h2>
          <p>描述你想要的应用，Atoms 会生成可直接运行的单页 Web 应用。</p>
          <div class="chips">
            <button v-for="item in SUGGESTIONS" :key="item" type="button" @click="useSuggestion(item)">
              {{ item }}
            </button>
          </div>
        </div>

        <div v-for="(msg, index) in currentProject?.messages || []" :key="index" class="row" :class="msg.role">
          <span class="msg-avatar" :class="msg.role">{{ msg.role === 'user' ? '你' : '⚛' }}</span>
          <div class="bubble" :class="msg.role">
            <pre v-if="msg.content" class="content">{{ msg.content }}</pre>
            <span v-else-if="isStreaming && index === currentProject.messages.length - 1" class="typing" aria-label="正在生成">
              <i></i><i></i><i></i>
            </span>
          </div>
        </div>
      </section>

      <section class="preview">
        <header class="preview-bar">
          <span class="live-dot" :class="{ on: !!previewHtml }"></span>
          <span>实时预览</span>
          <span class="hint">{{ isStreaming ? '生成中…' : previewHtml ? '已提取 HTML' : '等待代码块' }}</span>
          <div class="preview-actions">
            <button v-if="previewHtml" type="button" title="刷新预览" @click="refreshPreview">刷新</button>
            <button v-if="previewHtml" type="button" title="新窗口打开" @click="openPreviewInNewTab">新窗口</button>
          </div>
        </header>
        <div class="preview-frame">
          <iframe
            v-if="previewHtml" :key="previewKey" :srcdoc="previewHtml"
            class="preview-iframe" sandbox="allow-scripts allow-forms allow-modals allow-popups" title="应用预览"
          ></iframe>
          <div v-else class="preview-empty">
            {{ isStreaming ? '正在生成应用，请稍候…' : '生成的应用会在这里实时渲染' }}
          </div>
        </div>
      </section>

      <section class="composer">
        <textarea
          ref="inputRef" v-model="inputText" rows="1"
          placeholder="描述你想生成的应用，回车发送，Shift + Enter 换行"
          :disabled="isStreaming" @keydown="onKeydown"
        ></textarea>
        <button type="button" class="send-btn" :disabled="isStreaming || !inputText.trim()" @click="sendMessage">
          <span>{{ isStreaming ? '生成中' : '发送' }}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h13M12 5l7 7-7 7" />
          </svg>
        </button>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* ============ 设计令牌 ============ */
:global(:root) {
  --bg: #08080b;
  --panel: #0e0e13;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.13);
  --fg: #f5f5f7;
  --fg-2: #a3a3ad;
  --fg-3: #6c6c78;
  --brand: #4b83f0;
  --brand-soft: rgba(75, 131, 240, 0.15);
  --shadow-lg: 0 24px 60px -22px rgba(0, 0, 0, 0.85);
  --ease: cubic-bezier(0.22, 0.61, 0.36, 1);
}

:global(*), :global(*::before), :global(*::after) { box-sizing: border-box; }
:global(html), :global(body), :global(#app) { height: 100%; margin: 0; }
:global(body) {
  background: var(--bg);
  color: var(--fg);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
}
:global(::selection) { background: rgba(75, 131, 240, 0.35); }
:global(::-webkit-scrollbar) { width: 10px; height: 10px; }
:global(::-webkit-scrollbar-track) { background: transparent; }
:global(::-webkit-scrollbar-thumb) {
  border: 3px solid transparent; border-radius: 999px;
  background: rgba(255, 255, 255, 0.1); background-clip: content-box;
}
:global(::-webkit-scrollbar-thumb:hover) { background: rgba(255, 255, 255, 0.2); background-clip: content-box; }

/* ============ 品牌标识 ============ */
.brand-mark {
  position: relative; width: 36px; height: 36px; flex-shrink: 0;
  display: grid; place-items: center; border-radius: 11px;
  background: linear-gradient(155deg, #5b93f5, #3358d8 55%, #6d5cf0);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3);
  animation: brand-glow 3.6s ease-in-out infinite;
}
.brand-mark span {
  position: absolute; width: 6px; height: 6px; border-radius: 50%;
  background: #fff; box-shadow: 0 0 8px rgba(255, 255, 255, 0.85);
}
.brand-mark span:nth-child(1) { transform: translate(-6px, -3.5px); }
.brand-mark span:nth-child(2) { transform: translate(6px, -3.5px); }
.brand-mark span:nth-child(3) { transform: translate(0, 6px); }
@keyframes brand-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(75, 131, 240, 0.5), 0 8px 22px -8px rgba(75, 131, 240, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.3); }
  50% { box-shadow: 0 0 0 7px rgba(75, 131, 240, 0), 0 8px 22px -8px rgba(75, 131, 240, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.3); }
}

/* ============ 登录界面 ============ */
.auth-container {
  position: relative; height: 100vh; padding: 24px;
  display: grid; place-items: center; overflow: hidden;
}
.auth-bg { position: absolute; inset: 0; overflow: hidden; }
.grid-lines {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
  background-size: 48px 48px;
  -webkit-mask-image: radial-gradient(circle at 50% 42%, #000 0%, transparent 70%);
  mask-image: radial-gradient(circle at 50% 42%, #000 0%, transparent 70%);
}
.orb { position: absolute; border-radius: 50%; filter: blur(90px); }
.orb-1 {
  width: 440px; height: 440px; top: -170px; left: 50%; margin-left: -220px;
  background: #2f5fd0; opacity: 0.55; animation: orb-float 15s var(--ease) infinite;
}
.orb-2 {
  width: 360px; height: 360px; right: -80px; bottom: -150px;
  background: #5a3fd0; opacity: 0.4; animation: orb-float 19s var(--ease) infinite reverse;
}
@keyframes orb-float {
  50% { transform: translate3d(0, 36px, 0) scale(1.1); }
}

.auth-box {
  position: relative; z-index: 1; width: 100%; max-width: 396px; padding: 32px;
  border: 1px solid var(--line-strong); border-radius: 20px;
  background: linear-gradient(180deg, rgba(25, 25, 31, 0.9), rgba(13, 13, 18, 0.94));
  backdrop-filter: blur(18px);
  box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.auth-brand { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-bottom: 26px; text-align: center; }
.auth-brand h1 { margin: 0; font-size: 19px; font-weight: 650; letter-spacing: -0.01em; }
.auth-brand p { margin: 0; font-size: 12.5px; color: var(--fg-3); }

.auth-switch {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px;
  margin-bottom: 22px; border: 1px solid var(--line); border-radius: 12px;
  background: rgba(0, 0, 0, 0.35);
}
.auth-switch button {
  height: 34px; border: 0; border-radius: 9px; background: transparent;
  color: var(--fg-2); font: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.22s var(--ease);
}
.auth-switch button:hover { color: var(--fg); }
.auth-switch button.on {
  color: #fff;
  background: linear-gradient(180deg, #3d7bf0, #2757c4);
  box-shadow: 0 6px 16px -8px rgba(61, 123, 240, 1), inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.field { display: block; margin-bottom: 14px; }
.field-label { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 550; color: var(--fg-2); }
.field input {
  width: 100%; height: 42px; padding: 0 14px;
  border: 1px solid var(--line-strong); border-radius: 10px;
  background: rgba(0, 0, 0, 0.4); color: var(--fg);
  font: inherit; font-size: 14px; outline: none;
  transition: border-color 0.18s, box-shadow 0.18s, background 0.18s;
}
.field input::placeholder { color: #55555f; }
.field input:focus {
  border-color: var(--brand);
  background: rgba(0, 0, 0, 0.55);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.error-msg {
  display: flex; align-items: center; gap: 8px;
  margin: 0 0 14px; padding: 9px 12px;
  border: 1px solid rgba(239, 68, 68, 0.28); border-radius: 9px;
  background: rgba(239, 68, 68, 0.1); color: #fca5a5; font-size: 12.5px;
}
.error-msg::before {
  content: '!'; display: grid; place-items: center; flex-shrink: 0;
  width: 15px; height: 15px; border-radius: 50%;
  background: rgba(239, 68, 68, 0.85); color: #fff;
  font-size: 11px; font-weight: 700;
}

.auth-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; height: 44px; margin-top: 6px;
  border: 0; border-radius: 10px;
  background: linear-gradient(180deg, #3d7bf0, #2757c4);
  color: #fff; font: inherit; font-size: 14px; font-weight: 650; cursor: pointer;
  box-shadow: 0 10px 24px -12px rgba(61, 123, 240, 1), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  transition: filter 0.16s, transform 0.12s var(--ease), box-shadow 0.2s;
}
.auth-btn:hover:not(:disabled) { filter: brightness(1.08); }
.auth-btn:active:not(:disabled) { transform: translateY(1px); }
.auth-btn:disabled { opacity: 0.6; cursor: not-allowed; box-shadow: none; }

.spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35); border-top-color: #fff;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.auth-foot { margin: 18px 0 0; text-align: center; font-size: 12.5px; color: var(--fg-3); }
.auth-foot a { color: var(--brand); font-weight: 550; cursor: pointer; }
.auth-foot a:hover { text-decoration: underline; }

/* ============ 主应用布局 ============ */
.app {
  position: relative; display: flex; height: 100%; min-height: 100vh;
  overflow: hidden; background: var(--bg);
}
.app::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(900px 380px at 84% -14%, rgba(75, 131, 240, 0.13), transparent 62%),
    radial-gradient(700px 320px at 6% 112%, rgba(109, 92, 240, 0.1), transparent 60%);
}

/* ---------- 侧边栏 ---------- */
.sidebar {
  position: relative; z-index: 1; flex-shrink: 0;
  display: flex; flex-direction: column; gap: 14px;
  width: 268px; padding: 18px 14px;
  border-right: 1px solid var(--line);
  background: rgba(12, 12, 17, 0.72);
  backdrop-filter: blur(20px);
}
.brand { display: flex; align-items: center; gap: 11px; padding: 2px 4px; }
.brand h1 { margin: 0; font-size: 15px; font-weight: 650; letter-spacing: -0.01em; }
.brand p { margin: 3px 0 0; font-size: 11.5px; color: var(--fg-3); }

.new-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  height: 40px; border: 1px solid var(--line-strong); border-radius: 11px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02));
  color: var(--fg); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 0.18s var(--ease);
}
.new-btn svg { width: 14px; height: 14px; }
.new-btn:hover {
  border-color: rgba(75, 131, 240, 0.55);
  background: linear-gradient(180deg, rgba(75, 131, 240, 0.22), rgba(75, 131, 240, 0.08));
  box-shadow: 0 8px 20px -10px rgba(75, 131, 240, 1);
}
.new-btn:active { transform: translateY(1px); }

.list-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 6px 0; font-size: 10.5px; font-weight: 600;
  letter-spacing: 0.09em; text-transform: uppercase; color: var(--fg-3);
}
.list-head .count {
  padding: 1px 7px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.06); font-size: 10px; letter-spacing: 0;
}

.project-list {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 3px; padding-right: 2px;
}
.project-item {
  position: relative; display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 9px 9px 9px 12px;
  border: 1px solid transparent; border-radius: 10px;
  background: transparent; color: inherit; font: inherit;
  text-align: left; cursor: pointer;
  transition: background 0.16s, border-color 0.16s;
}
.project-item::before {
  content: ''; position: absolute; left: 0; top: 50%;
  width: 2px; height: 0; border-radius: 2px;
  background: linear-gradient(180deg, #5b93f5, #6d5cf0);
  transform: translateY(-50%);
  transition: height 0.22s var(--ease);
}
.project-item:hover { background: rgba(255, 255, 255, 0.045); }
.project-item.active { background: rgba(75, 131, 240, 0.11); border-color: rgba(75, 131, 240, 0.3); }
.project-item.active::before { height: 58%; }
.project-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.project-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 550; }
.project-time { font-size: 10.5px; color: var(--fg-3); }
.project-item.active .project-time { color: rgba(147, 180, 255, 0.75); }
.delete-btn {
  display: grid; place-items: center; flex-shrink: 0;
  width: 22px; height: 22px; border-radius: 6px;
  color: var(--fg-3); font-size: 15px; line-height: 1;
  opacity: 0; transition: opacity 0.16s, background 0.16s, color 0.16s;
}
.project-item:hover .delete-btn { opacity: 1; }
.delete-btn:hover { background: rgba(239, 68, 68, 0.16); color: #fca5a5; }

.user-profile {
  display: flex; align-items: center; gap: 9px;
  padding-top: 13px; border-top: 1px solid var(--line);
}
.avatar {
  display: grid; place-items: center; flex-shrink: 0;
  width: 28px; height: 28px; border-radius: 9px;
  background: linear-gradient(155deg, #5b93f5, #6d5cf0);
  color: #fff; font-size: 12px; font-weight: 700;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}
.user-email {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-size: 12px; color: var(--fg-2);
}
.logout-btn {
  display: grid; place-items: center; flex-shrink: 0;
  width: 28px; height: 28px; border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--fg-2); cursor: pointer;
  transition: all 0.16s;
}
.logout-btn svg { width: 14px; height: 14px; }
.logout-btn:hover { border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.12); color: #fca5a5; }

/* ---------- 工作区 ---------- */
.workspace {
  position: relative; z-index: 1; flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 12px; padding: 16px;
}
.chat { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 6px 8px 2px; }

.empty-chat {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center;
}
.empty-icon {
  display: grid; place-items: center; width: 56px; height: 56px;
  margin-bottom: 14px; border: 1px solid var(--line-strong); border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02));
  font-size: 25px; box-shadow: 0 14px 32px -16px rgba(75, 131, 240, 0.9);
}
.empty-chat h2 { margin: 0 0 7px; font-size: 17px; font-weight: 620; letter-spacing: -0.01em; }
.empty-chat p { margin: 0 0 20px; max-width: 330px; font-size: 13px; line-height: 1.65; color: var(--fg-3); }
.chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 460px; }
.chips button {
  padding: 7px 13px; border: 1px solid var(--line); border-radius: 999px;
  background: rgba(255, 255, 255, 0.03); color: var(--fg-2);
  font: inherit; font-size: 12.5px; cursor: pointer;
  transition: all 0.18s var(--ease);
}
.chips button:hover {
  border-color: rgba(75, 131, 240, 0.5);
  background: rgba(75, 131, 240, 0.12);
  color: #cfe0ff; transform: translateY(-1px);
}

/* ---------- 消息 ---------- */
.row { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 16px; }
.row.user { flex-direction: row-reverse; }
.msg-avatar {
  display: grid; place-items: center; flex-shrink: 0;
  width: 30px; height: 30px; border-radius: 10px;
  font-size: 11.5px; font-weight: 650;
}
.msg-avatar.user {
  background: linear-gradient(155deg, #5b93f5, #3358d8);
  color: #fff; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
}
.msg-avatar.assistant {
  border: 1px solid var(--line-strong); background: rgba(255, 255, 255, 0.05);
  color: var(--fg-2); font-size: 14px;
}
.bubble {
  max-width: min(78%, 660px); padding: 11px 14px;
  border-radius: 14px; line-height: 1.6;
}
.bubble.user {
  border: 1px solid rgba(75, 131, 240, 0.4);
  background: linear-gradient(180deg, rgba(61, 123, 240, 0.3), rgba(39, 87, 196, 0.22));
  border-bottom-right-radius: 5px;
}
.bubble.assistant {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.035);
  border-bottom-left-radius: 5px;
}
.content {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  font-size: 12.5px; line-height: 1.62; color: #d6d6de;
}
.bubble.user .content { font-family: inherit; font-size: 13.5px; color: #fff; }

.typing { display: inline-flex; gap: 4px; padding: 4px 0 2px; }
.typing i {
  width: 6px; height: 6px; border-radius: 50%; background: var(--fg-3);
  animation: typing-blink 1.3s ease-in-out infinite;
}
.typing i:nth-child(2) { animation-delay: 0.18s; }
.typing i:nth-child(3) { animation-delay: 0.36s; }
@keyframes typing-blink {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

/* ---------- 预览 ---------- */
.preview {
  flex-shrink: 0; height: 50vh; display: flex; flex-direction: column;
  overflow: hidden; border: 1px solid var(--line); border-radius: 14px;
  background: var(--panel);
  box-shadow: 0 24px 48px -34px rgba(0, 0, 0, 0.95);
}
.preview-bar {
  display: flex; align-items: center; gap: 9px; flex-shrink: 0;
  height: 42px; padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.02);
  font-size: 12px; font-weight: 600; color: var(--fg-2);
}
.live-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #3f3f46;
  transition: background 0.3s, box-shadow 0.3s;
}
.live-dot.on {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18), 0 0 10px rgba(34, 197, 94, 0.8);
}
.hint { margin-left: auto; font-size: 11.5px; font-weight: 500; color: var(--fg-3); }
.preview-actions { display: flex; gap: 6px; margin-left: 4px; }
.preview-actions button {
  padding: 5px 10px; border: 1px solid var(--line); border-radius: 8px;
  background: transparent; color: var(--fg-2);
  font: inherit; font-size: 11px; font-weight: 500; cursor: pointer;
  transition: all 0.16s;
}
.preview-actions button:hover {
  border-color: rgba(75, 131, 240, 0.5);
  background: rgba(75, 131, 240, 0.14);
  color: #cfe0ff;
}
.preview-frame { flex: 1; min-height: 0; background: #fff; }
.preview-iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
.preview-empty {
  height: 100%; display: grid; place-items: center;
  background: linear-gradient(180deg, #fbfbfc, #f1f1f4);
  color: #9a9aa6; font-size: 13px;
}

/* ---------- 输入区 ---------- */
.composer {
  flex-shrink: 0; display: flex; align-items: flex-end; gap: 10px;
  padding: 10px 10px 10px 14px;
  border: 1px solid var(--line-strong); border-radius: 15px;
  background: rgba(20, 20, 26, 0.85);
  backdrop-filter: blur(14px);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.composer:focus-within {
  border-color: rgba(75, 131, 240, 0.6);
  box-shadow: 0 0 0 3px rgba(75, 131, 240, 0.14);
}
.composer textarea {
  flex: 1; min-height: 40px; max-height: 132px;
  padding: 9px 0 8px; resize: none;
  border: 0; outline: none; background: transparent;
  color: var(--fg); font: inherit; font-size: 14px; line-height: 1.5;
}
.composer textarea::placeholder { color: #55555f; }
.send-btn {
  display: flex; align-items: center; gap: 6px; flex-shrink: 0;
  height: 38px; padding: 0 15px; border: 0; border-radius: 11px;
  background: linear-gradient(180deg, #3d7bf0, #2757c4);
  color: #fff; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer;
  box-shadow: 0 10px 22px -14px rgba(61, 123, 240, 1), inset 0 1px 0 rgba(255, 255, 255, 0.2);
  transition: filter 0.18s, transform 0.12s var(--ease), opacity 0.18s;
}
.send-btn svg { width: 15px; height: 15px; }
.send-btn:hover:not(:disabled) { filter: brightness(1.1); }
.send-btn:active:not(:disabled) { transform: translateY(1px); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }

/* ---------- 响应式 ---------- */
@media (max-width: 900px) {
  .sidebar { width: 224px; }
  .bubble { max-width: 88%; }
}
@media (max-width: 720px) {
  .app { flex-direction: column; }
  .sidebar {
    flex-direction: row; align-items: center; width: 100%; height: auto;
    padding: 10px 12px; border-right: 0; border-bottom: 1px solid var(--line);
  }
  .brand p, .list-head { display: none; }
  .project-list { flex-direction: row; overflow-x: auto; overflow-y: hidden; }
  .project-item { width: auto; flex-shrink: 0; }
  .project-time, .user-email { display: none; }
  .user-profile { border-top: 0; padding-top: 0; }
  .workspace { padding: 12px; }
  .preview { height: 44vh; }
  .bubble { max-width: 82%; }
}
</style>
