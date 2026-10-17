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

// ============ 1. 用户状态与登录逻辑 ============
const user = ref(null)
const authEmail = ref('')
const authPassword = ref('')
const authLoading = ref(false)
const authError = ref('')
const isLoginView = ref(true)

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
    <div class="auth-box">
      <div class="brand" style="justify-content: center; margin-bottom: 24px;">
        <div class="brand-mark" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
        <div>
          <h1>Atoms Demo</h1>
          <p style="text-align: center;">用对话生成 Web 应用</p>
        </div>
      </div>
      
      <h2 style="text-align: center; margin-bottom: 20px;">{{ isLoginView ? '登录' : '注册' }}账号</h2>
      
      <div class="form-group">
        <input v-model="authEmail" type="email" placeholder="邮箱" />
      </div>
      <div class="form-group">
        <input v-model="authPassword" type="password" placeholder="密码" @keyup.enter="handleAuth" />
      </div>
      
      <p v-if="authError" class="error-msg">{{ authError }}</p>
      
      <button class="auth-btn" @click="handleAuth" :disabled="authLoading">
        {{ authLoading ? '处理中...' : (isLoginView ? '登录' : '注册') }}
      </button>
      
      <p class="toggle-auth" @click="isLoginView = !isLoginView; authError = ''">
        {{ isLoginView ? '没有账号？去注册' : '已有账号？去登录' }}
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
        <span class="plus">+</span> 新建项目
      </button>

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
        <span class="user-email">{{ user.email }}</span>
        <button class="logout-btn" @click="handleLogout">退出</button>
      </div>
    </aside>

    <main class="workspace">
      <section ref="chatRef" class="chat">
        <div v-if="!currentProject?.messages.length" class="empty-chat">
          <div class="empty-icon">⚛</div>
          <h2>从一句话开始构建</h2>
          <p>描述你想要的应用，例如「做一个深色待办清单」或「写一个番茄钟」。</p>
        </div>

        <div v-for="(msg, index) in currentProject?.messages || []" :key="index" class="row" :class="msg.role">
          <div class="bubble" :class="msg.role">
            <div class="role-label">{{ msg.role === 'user' ? '你' : 'Atoms' }}</div>
            <pre class="content">{{
              msg.content || (isStreaming && index === currentProject.messages.length - 1 ? '正在生成…' : '')
            }}</pre>
          </div>
        </div>
      </section>

      <section class="preview">
        <header class="preview-bar">
          <span class="live-dot" :class="{ on: !!previewHtml }"></span>
          <span>实时预览</span>
          <span class="hint">{{ isStreaming ? '生成中…' : previewHtml ? '已提取 HTML' : '等待代码块' }}</span>
          <div class="preview-actions">
            <button v-if="previewHtml" type="button" title="刷新预览" @click="refreshPreview">↻ 刷新</button>
            <button v-if="previewHtml" type="button" title="新窗口打开" @click="openPreviewInNewTab">↗ 新窗口</button>
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
          {{ isStreaming ? '生成中' : '发送' }}
        </button>
      </section>
    </main>
  </div>
</template>

<style scoped>
:global(html), :global(body), :global(#app) { height: 100%; margin: 0; }
:global(body) {
  background: #09090b; color: #f4f4f5;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
}

/* 登录界面样式 */
.auth-container {
  height: 100vh; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(800px 400px at 50% 0%, rgba(59, 130, 246, 0.15), transparent 60%), #09090b;
}
.auth-box {
  width: 100%; max-width: 400px; background: #18181b;
  border: 1px solid #27272a; border-radius: 16px; padding: 32px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.5);
}
.auth-box h2 { font-size: 20px; color: #fafafa; }
.form-group { margin-bottom: 16px; }
.form-group input {
  width: 100%; padding: 10px 14px; border-radius: 8px; border: 1px solid #3f3f46;
  background: #09090b; color: #fafafa; font-size: 14px; outline: none; box-sizing: border-box;
}
.form-group input:focus { border-color: #3b82f6; }
.auth-btn {
  width: 100%; padding: 12px; background: #2563eb; color: #fff;
  border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
  margin-top: 8px;
}
.auth-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.error-msg { color: #ef4444; font-size: 13px; margin-top: -8px; margin-bottom: 12px; }
.toggle-auth { text-align: center; font-size: 13px; color: #a1a1aa; margin-top: 16px; cursor: pointer; }
.toggle-auth:hover { color: #3b82f6; }

/* 主应用样式 */
.app { display: flex; height: 100%; min-height: 100vh; background: radial-gradient(1200px 500px at 80% -10%, rgba(59, 130, 246, 0.12), transparent 50%), #09090b; color: #f4f4f5; }
.sidebar { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; gap: 16px; padding: 20px 16px; background: rgba(17, 17, 19, 0.92); border-right: 1px solid #27272a; }
.brand { display: flex; align-items: center; gap: 12px; }
.brand-mark { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(180deg, #3b82f6, #1d4ed8); display: grid; place-items: center; position: relative; box-shadow: 0 8px 24px rgba(37, 99, 235, 0.35); }
.brand-mark span { position: absolute; width: 7px; height: 7px; border-radius: 50%; background: #fff; }
.brand-mark span:nth-child(1) { transform: translate(-6px, -4px); }
.brand-mark span:nth-child(2) { transform: translate(6px, -4px); }
.brand-mark span:nth-child(3) { transform: translate(0, 6px); }
.brand h1 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: 0.01em; }
.brand p { margin: 2px 0 0; color: #a1a1aa; font-size: 12px; }
.new-btn { display: flex; align-items: center; justify-content: center; gap: 8px; height: 38px; border: 1px solid #3f3f46; border-radius: 10px; background: #18181b; color: #fafafa; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
.new-btn:hover { background: #27272a; border-color: #52525b; }
.plus { font-size: 16px; line-height: 1; }
.project-list { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
.project-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 10px 10px 12px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: inherit; text-align: left; cursor: pointer; transition: all 0.15s ease; }
.project-item:hover { background: #18181b; }
.project-item.active { background: #18181b; border-color: #27272a; box-shadow: inset 2px 0 0 #3b82f6; }
.project-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.project-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 550; }
.project-time { color: #71717a; font-size: 11px; }
.delete-btn { display: none; width: 22px; height: 22px; border-radius: 6px; color: #a1a1aa; font-size: 16px; line-height: 20px; text-align: center; }
.project-item:hover .delete-btn { display: block; }
.delete-btn:hover { background: #3f3f46; color: #fecaca; }

.user-profile { display: flex; align-items: center; justify-content: space-between; padding-top: 16px; border-top: 1px solid #27272a; }
.user-email { font-size: 12px; color: #a1a1aa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }
.logout-btn { background: transparent; border: 1px solid #3f3f46; color: #fafafa; padding: 4px 8px; border-radius: 6px; font-size: 12px; cursor: pointer; }
.logout-btn:hover { background: #27272a; }

.workspace { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 16px; gap: 12px; }
.chat { flex: 1; min-height: 0; overflow: auto; padding: 8px 8px 4px; }
.empty-chat { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #a1a1aa; text-align: center; }
.empty-icon { width: 52px; height: 52px; margin-bottom: 12px; border-radius: 16px; background: #18181b; border: 1px solid #27272a; display: grid; place-items: center; font-size: 24px; }
.empty-chat h2 { margin: 0 0 6px; color: #fafafa; font-size: 18px; font-weight: 600; }
.empty-chat p { margin: 0; max-width: 360px; font-size: 13px; line-height: 1.6; }
.row { display: flex; margin-bottom: 12px; }
.row.user { justify-content: flex-end; }
.row.assistant { justify-content: flex-start; }
.bubble { max-width: min(72%, 640px); padding: 10px 14px 12px; border-radius: 16px; line-height: 1.55; }
.bubble.user { background: linear-gradient(180deg, #3b82f6, #2563eb); color: #fff; border-bottom-right-radius: 6px; }
.bubble.assistant { background: #18181b; border: 1px solid #27272a; color: #e4e4e7; border-bottom-left-radius: 6px; }
.role-label { margin-bottom: 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; opacity: 0.72; }
.content { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 13.5px; }
.preview { height: 50vh; flex-shrink: 0; display: flex; flex-direction: column; border: 1px solid #27272a; border-radius: 14px; overflow: hidden; background: #111113; }
.preview-bar { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-bottom: 1px solid #27272a; color: #a1a1aa; font-size: 12px; font-weight: 600; }
.live-dot { width: 7px; height: 7px; border-radius: 50%; background: #3f3f46; }
.live-dot.on { background: #22c55e; box-shadow: 0 0 8px rgba(34, 197, 94, 0.7); }
.hint { margin-left: auto; font-weight: 500; }
.preview-actions { display: flex; gap: 6px; margin-left: 12px; }
.preview-actions button { background: transparent; border: 1px solid #3f3f46; color: #a1a1aa; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; }
.preview-actions button:hover { background: #27272a; color: #fafafa; border-color: #52525b; }
.preview-frame { flex: 1; min-height: 0; background: #fff; }
.preview-iframe { width: 100%; height: 100%; border: 0; background: #fff; display: block; }
.preview-empty { height: 100%; display: grid; place-items: center; color: #71717a; background: linear-gradient(180deg, #fafafa, #f4f4f5); font-size: 13px; }
.composer { flex-shrink: 0; display: flex; align-items: flex-end; gap: 10px; padding: 10px; border: 1px solid #27272a; border-radius: 14px; background: rgba(24, 24, 27, 0.9); }
.composer textarea { flex: 1; min-height: 44px; max-height: 120px; resize: none; border: 0; outline: none; background: transparent; color: #fafafa; font: inherit; font-size: 14px; line-height: 1.5; }
.composer textarea::placeholder { color: #71717a; }
.send-btn { height: 38px; padding: 0 16px; border: 0; border-radius: 10px; background: #2563eb; color: #fff; font-size: 13px; font-weight: 650; cursor: pointer; transition: all 0.15s ease; }
.send-btn:hover:not(:disabled) { background: #1d4ed8; }
.send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.project-list::-webkit-scrollbar, .chat::-webkit-scrollbar { width: 8px; }
.project-list::-webkit-scrollbar-thumb, .chat::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 8px; }
</style>