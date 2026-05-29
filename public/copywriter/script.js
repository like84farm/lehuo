const loginView = document.querySelector('#loginView');
const appView = document.querySelector('#appView');
const loginForm = document.querySelector('#loginForm');
const passwordInput = document.querySelector('#passwordInput');
const loginError = document.querySelector('#loginError');
const logoutButton = document.querySelector('#logoutButton');
const categorySelect = document.querySelector('#categorySelect');
const sceneSelect = document.querySelector('#sceneSelect');
const contentTypeSelect = document.querySelector('#contentTypeSelect');
const draftInput = document.querySelector('#draftInput');
const draftButton = document.querySelector('#draftButton');
const optimizeButton = document.querySelector('#optimizeButton');
const copyButton = document.querySelector('#copyButton');
const statusText = document.querySelector('#statusText');
const warningBox = document.querySelector('#warningBox');
const outputBox = document.querySelector('#outputBox');

const sceneOptions = {
  diy: ['企业团建', '商场活动', '车企活动', '楼盘暖场'],
  photobooth: ['婚礼', '宝宝百日宴', '生日派对', '企业活动', '闺蜜聚会']
};

const placeholders = {
  diy: '例如：端午节-艾草花束，广州商场端午会员活动，想突出高级感、亲子参与和出片',
  photobooth: '例如：广州婚礼 photobooth，美悦盛宴文德店，想突出宾客排队拍、即拍即印、照片质感'
};

let latestOutput = '';

function setAuthenticated(authenticated) {
  loginView.classList.toggle('hidden', authenticated);
  appView.classList.toggle('hidden', !authenticated);
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', isError);
}

function setBusy(isBusy, message) {
  draftButton.disabled = isBusy;
  optimizeButton.disabled = isBusy;
  copyButton.disabled = isBusy;
  if (message) setStatus(message);
}

function updateScenes() {
  const scenes = sceneOptions[categorySelect.value] || sceneOptions.diy;
  sceneSelect.replaceChildren(...scenes.map((scene) => {
    const option = document.createElement('option');
    option.value = scene;
    option.textContent = scene;
    return option;
  }));
  draftInput.placeholder = placeholders[categorySelect.value] || placeholders.diy;
}

function currentPayload() {
  return {
    category: categorySelect.value,
    scene: sceneSelect.value,
    contentType: contentTypeSelect.value,
    draftInput: draftInput.value.trim(),
    draft: draftInput.value.trim()
  };
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatOutput(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function renderWarnings(warnings = []) {
  warningBox.classList.toggle('hidden', warnings.length === 0);
  warningBox.replaceChildren(...warnings.map((warning) => {
    const item = document.createElement('p');
    item.textContent = warning;
    return item;
  }));
}

function renderOutput(text, warnings) {
  latestOutput = text;
  outputBox.classList.remove('placeholder');
  outputBox.innerHTML = formatOutput(text);
  renderWarnings(warnings);
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

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';

  try {
    const data = await apiPost('/api/login', { password: passwordInput.value });
    if (data.ok) {
      passwordInput.value = '';
      setAuthenticated(true);
    }
  } catch (error) {
    loginError.textContent = error.message || '登录失败';
  }
});

logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  setAuthenticated(false);
});

categorySelect.addEventListener('change', updateScenes);

draftButton.addEventListener('click', async () => {
  setBusy(true, 'AI 正在生成初稿...');
  renderWarnings();

  try {
    const data = await apiPost('/api/copywriter/draft', currentPayload());
    draftInput.value = data.text;
    renderOutput(data.text, data.warnings);
    setStatus('初稿已生成。你可以先编辑，再点击“第二步：分析并优化”。');
  } catch (error) {
    setStatus(error.message || '文案生成失败', true);
  } finally {
    setBusy(false);
  }
});

optimizeButton.addEventListener('click', async () => {
  if (!draftInput.value.trim()) {
    setStatus('请先输入主题，或点击“第一步：出文案”。', true);
    return;
  }

  setBusy(true, 'AI 正在分析并优化...');
  renderWarnings();

  try {
    const data = await apiPost('/api/copywriter/optimize', currentPayload());
    renderOutput(data.text, data.warnings);
    setStatus('优化完成，可以复制结果。');
  } catch (error) {
    setStatus(error.message || '文案优化失败', true);
  } finally {
    setBusy(false);
  }
});

copyButton.addEventListener('click', async () => {
  if (!latestOutput) {
    setStatus('还没有可复制的优化结果。', true);
    return;
  }

  try {
    await navigator.clipboard.writeText(latestOutput);
    setStatus('已复制到剪贴板。');
  } catch {
    setStatus('复制失败，请手动选择文本复制。', true);
  }
});

updateScenes();
checkSession().catch(() => setAuthenticated(false));
