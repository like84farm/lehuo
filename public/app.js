const loginView = document.querySelector('#loginView');
const appView = document.querySelector('#appView');
const loginForm = document.querySelector('#loginForm');
const passwordInput = document.querySelector('#passwordInput');
const loginError = document.querySelector('#loginError');
const logoutButton = document.querySelector('#logoutButton');
const promptInput = document.querySelector('#promptInput');
const ratioSelect = document.querySelector('#ratioSelect');
const referenceInput = document.querySelector('#referenceInput');
const previewWrap = document.querySelector('#previewWrap');
const previewImages = document.querySelector('#previewImages');
const removeReferenceButton = document.querySelector('#removeReferenceButton');
const generateButton = document.querySelector('#generateButton');
const statusText = document.querySelector('#statusText');
const resultEmpty = document.querySelector('#resultEmpty');
const resultImage = document.querySelector('#resultImage');
const downloadLink = document.querySelector('#downloadLink');
const installButton = document.querySelector('#installButton');
const maxReferenceFiles = 4;
const maxReferenceDimension = 1600;
const referenceOutputQuality = 0.82;
let referenceFiles = [];

function setAuthenticated(authenticated) {
  loginView.classList.toggle('hidden', authenticated);
  appView.classList.toggle('hidden', !authenticated);
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', isError);
}

function showResult(image) {
  resultImage.src = image;
  downloadLink.href = image;
  resultImage.classList.remove('hidden');
  downloadLink.classList.remove('hidden');
  resultEmpty.classList.add('hidden');
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`无法读取图片：${file.name}`));
    };
    image.src = url;
  });
}

async function resizeReferenceImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('参考图仅支持 PNG、JPG、WEBP。');
  }

  const image = await loadImage(file);
  const scale = Math.min(1, maxReferenceDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', referenceOutputQuality));
  if (!blob) throw new Error(`无法处理图片：${file.name}`);
  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
}

async function prepareReferenceFiles(files) {
  return Promise.all(files.map(resizeReferenceImage));
}

async function checkSession() {
  const response = await fetch('/api/session');
  const data = await response.json();
  setAuthenticated(Boolean(data.authenticated));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGeneration(jobId) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await wait(2000);
    const response = await fetch(`/api/generate/${jobId}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '查询生成结果失败');
    if (data.status === 'done') return data.image;
    if (data.status === 'error') throw new Error(data.error || '生成失败');
    setStatus(`正在生成图片... ${Math.min(6, Math.floor((attempt + 1) / 5) + 1)}0秒内通常完成`);
  }
  throw new Error('生成时间过长，请稍后再试。');
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';

  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: passwordInput.value })
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    loginError.textContent = data.error || '登录失败';
    return;
  }

  passwordInput.value = '';
  setAuthenticated(true);
});

logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  setAuthenticated(false);
});

function renderReferencePreviews() {
  previewImages.innerHTML = '';
  previewWrap.classList.toggle('hidden', referenceFiles.length === 0);

  for (const file of referenceFiles) {
    const image = document.createElement('img');
    image.src = URL.createObjectURL(file);
    image.alt = file.name;
    previewImages.append(image);
  }
}

referenceInput.addEventListener('change', async () => {
  const files = Array.from(referenceInput.files || []);
  referenceFiles = [];
  renderReferencePreviews();

  if (!files.length) return;

  setStatus('正在处理参考图...');
  try {
    referenceFiles = await prepareReferenceFiles(files.slice(0, maxReferenceFiles));
    renderReferencePreviews();
    setStatus(files.length > maxReferenceFiles ? `已使用前 ${maxReferenceFiles} 张参考图。` : '参考图已准备好。');
  } catch (error) {
    referenceInput.value = '';
    referenceFiles = [];
    renderReferencePreviews();
    setStatus(error.message || '参考图处理失败。', true);
  }
});

removeReferenceButton.addEventListener('click', () => {
  referenceFiles = [];
  referenceInput.value = '';
  renderReferencePreviews();
});

generateButton.addEventListener('click', async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    setStatus('请输入提示词。', true);
    return;
  }

  const form = new FormData();
  form.append('prompt', prompt);
  form.append('quality', '1k');
  form.append('aspectRatio', ratioSelect.value);
  for (const file of referenceFiles) form.append('referenceImages', file);

  generateButton.disabled = true;
  setStatus(referenceFiles.length ? '正在根据参考图生成...' : '正在生成图片...');

  try {
    const response = await fetch('/api/generate', { method: 'POST', body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '生成失败');

    const image = data.image || await waitForGeneration(data.jobId);
    showResult(image);
    setStatus('生成完成。');
  } catch (error) {
    setStatus(error.message || '生成失败', true);
  } finally {
    generateButton.disabled = false;
  }
});

checkSession().catch(() => setAuthenticated(false));

let installPromptEvent = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPromptEvent = event;
  installButton?.classList.remove('hidden');
});

installButton?.addEventListener('click', async () => {
  if (!installPromptEvent) return;

  installButton.classList.add('hidden');
  installPromptEvent.prompt();
  await installPromptEvent.userChoice;
  installPromptEvent = null;
});

window.addEventListener('appinstalled', () => {
  installPromptEvent = null;
  installButton?.classList.add('hidden');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch((error) => {
        console.warn('Service worker registration failed:', error);
      });
  });
}
