const loginView = document.querySelector('#loginView');
const chatApp = document.querySelector('#chatApp');
const loginForm = document.querySelector('#loginForm');
const passwordInput = document.querySelector('#passwordInput');
const loginError = document.querySelector('#loginError');
const logoutButton = document.querySelector('#logoutButton');
const sidebar = document.querySelector('#sidebar');
const openSidebarButton = document.querySelector('#openSidebarButton');
const closeSidebarButton = document.querySelector('#closeSidebarButton');
const newChatButton = document.querySelector('#newChatButton');
const deleteChatButton = document.querySelector('#deleteChatButton');
const searchInput = document.querySelector('#searchInput');
const sessionList = document.querySelector('#sessionList');
const chatTitle = document.querySelector('#chatTitle');
const messagesEl = document.querySelector('#messages');
const composerForm = document.querySelector('#composerForm');
const promptInput = document.querySelector('#promptInput');
const sendButton = document.querySelector('#sendButton');

const STORAGE_KEY = 'lehuo-gpt.sessions.v1';
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' });
let sessions = [];
let activeSessionId = null;
let isSending = false;

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function setAuthenticated(authenticated) {
  loginView.classList.toggle('hidden', authenticated);
  chatApp.classList.toggle('hidden', !authenticated);
}

function loadSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    sessions = Array.isArray(parsed) ? parsed : [];
  } catch {
    sessions = [];
  }

  if (!sessions.length) createSession(false);
  activeSessionId = sessions[0]?.id || null;
}

function saveSessions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function getActiveSession() {
  return sessions.find((session) => session.id === activeSessionId) || null;
}

function makeTitle(messages) {
  const firstUser = messages.find((message) => message.role === 'user')?.content || '新的对话';
  return firstUser.replace(/\s+/g, ' ').trim().slice(0, 24) || '新的对话';
}

function createSession(shouldRender = true) {
  const session = {
    id: uid(),
    title: '新的对话',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages: []
  };
  sessions.unshift(session);
  activeSessionId = session.id;
  saveSessions();
  if (shouldRender) renderAll();
  return session;
}

function groupName(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return '今天';
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return dateFormatter.format(date);
}

function renderSessions() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = sessions.filter((session) => {
    const haystack = [session.title, ...session.messages.map((message) => message.content)].join(' ').toLowerCase();
    return !query || haystack.includes(query);
  });

  sessionList.innerHTML = '';
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '没有匹配的聊天记录。';
    sessionList.append(empty);
    return;
  }

  let currentGroup = '';
  for (const session of filtered) {
    const group = groupName(session.updatedAt);
    if (group !== currentGroup) {
      currentGroup = group;
      const title = document.createElement('p');
      title.className = 'session-group-title';
      title.textContent = group;
      sessionList.append(title);
    }

    const button = document.createElement('button');
    button.className = `session-item${session.id === activeSessionId ? ' active' : ''}`;
    button.type = 'button';
    button.innerHTML = `<span class="session-title"></span><span class="session-meta"></span>`;
    button.querySelector('.session-title').textContent = session.title;
    button.querySelector('.session-meta').textContent = `${session.messages.length} 条消息`;
    button.addEventListener('click', () => {
      activeSessionId = session.id;
      sidebar.classList.remove('open');
      renderAll();
    });
    sessionList.append(button);
  }
}

function appendMessageElement(message) {
  const bubble = document.createElement('div');
  bubble.className = `message ${message.role}`;
  bubble.textContent = message.content;
  messagesEl.append(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function renderMessages() {
  messagesEl.innerHTML = '';
  const session = getActiveSession();
  chatTitle.textContent = session?.title || '新的对话';

  if (!session?.messages.length) {
    appendMessageElement({ role: 'system', content: '开始新的 GPT 对话。聊天记录只保存在当前浏览器。' });
    return;
  }

  for (const message of session.messages) appendMessageElement(message);
}

function renderAll() {
  renderSessions();
  renderMessages();
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

async function checkSession() {
  const response = await fetch('/api/session');
  const data = await response.json();
  setAuthenticated(Boolean(data.authenticated));
}

async function streamChat(messages, onChunk) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'GPT 请求失败');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('浏览器不支持流式响应');

  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}

function autoresize() {
  promptInput.style.height = 'auto';
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
}

async function sendMessage(content) {
  const session = getActiveSession() || createSession(false);
  const userMessage = { role: 'user', content };
  const assistantMessage = { role: 'assistant', content: '' };

  session.messages.push(userMessage, assistantMessage);
  session.title = makeTitle(session.messages);
  session.updatedAt = nowIso();
  saveSessions();
  renderAll();

  const assistantBubble = messagesEl.querySelector('.message.assistant:last-child');
  isSending = true;
  sendButton.disabled = true;

  try {
    await streamChat(session.messages.slice(0, -1), (chunk) => {
      assistantMessage.content += chunk;
      assistantBubble.textContent = assistantMessage.content || '...';
      messagesEl.scrollTop = messagesEl.scrollHeight;
      session.updatedAt = nowIso();
      saveSessions();
    });
    if (!assistantMessage.content.trim()) assistantMessage.content = '没有收到回复。';
  } catch (error) {
    assistantMessage.content = `请求失败：${error.message || 'GPT 请求失败'}`;
  } finally {
    session.updatedAt = nowIso();
    saveSessions();
    isSending = false;
    sendButton.disabled = false;
    renderAll();
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';

  try {
    const data = await apiPost('/api/login', { password: passwordInput.value });
    if (data.ok) {
      passwordInput.value = '';
      setAuthenticated(true);
      renderAll();
    }
  } catch (error) {
    loginError.textContent = error.message || '登录失败';
  }
});

logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  setAuthenticated(false);
});

newChatButton.addEventListener('click', () => createSession());

deleteChatButton.addEventListener('click', () => {
  if (!confirm('确定删除当前对话吗？')) return;
  sessions = sessions.filter((session) => session.id !== activeSessionId);
  if (!sessions.length) createSession(false);
  activeSessionId = sessions[0].id;
  saveSessions();
  renderAll();
});

searchInput.addEventListener('input', renderSessions);
openSidebarButton.addEventListener('click', () => sidebar.classList.add('open'));
closeSidebarButton.addEventListener('click', () => sidebar.classList.remove('open'));

promptInput.addEventListener('input', autoresize);
promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    composerForm.requestSubmit();
  }
});

composerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isSending) return;
  const content = promptInput.value.trim();
  if (!content) return;
  promptInput.value = '';
  autoresize();
  await sendMessage(content);
});

loadSessions();
checkSession().catch(() => setAuthenticated(false));
renderAll();
