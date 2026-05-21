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
const gallery = document.querySelector('#gallery');
const clearGalleryButton = document.querySelector('#clearGalleryButton');

const galleryKey = 'image2-gallery';
let referenceFiles = [];

function setAuthenticated(authenticated) {
  loginView.classList.toggle('hidden', authenticated);
  appView.classList.toggle('hidden', !authenticated);
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', isError);
}

function loadGallery() {
  try {
    return JSON.parse(localStorage.getItem(galleryKey) || '[]');
  } catch {
    return [];
  }
}

function saveGallery(items) {
  localStorage.setItem(galleryKey, JSON.stringify(items.slice(0, 30)));
}

function renderGallery() {
  const items = loadGallery();
  gallery.innerHTML = '';

  if (!items.length) {
    gallery.innerHTML = '<div class="empty">还没有生成记录。</div>';
    return;
  }

  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'gallery-item';

    const image = document.createElement('img');
    image.src = item.image;
    image.alt = item.prompt;
    image.loading = 'lazy';
    image.addEventListener('click', () => showResult(item.image));

    const meta = document.createElement('div');
    meta.className = 'gallery-meta';

    const text = document.createElement('p');
    text.textContent = item.prompt;

    const info = document.createElement('p');
    info.textContent = `${item.quality} · ${item.aspectRatio} · ${new Date(item.createdAt).toLocaleString()}`;

    const actions = document.createElement('div');
    actions.className = 'gallery-actions';

    const viewButton = document.createElement('button');
    viewButton.type = 'button';
    viewButton.textContent = '查看';
    viewButton.addEventListener('click', () => showResult(item.image));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = '删除';
    deleteButton.addEventListener('click', () => {
      saveGallery(loadGallery().filter((entry) => entry.id !== item.id));
      renderGallery();
    });

    actions.append(viewButton, deleteButton);
    meta.append(text, info, actions);
    card.append(image, meta);
    gallery.append(card);
  }
}

function showResult(image) {
  resultImage.src = image;
  downloadLink.href = image;
  resultImage.classList.remove('hidden');
  downloadLink.classList.remove('hidden');
  resultEmpty.classList.add('hidden');
}

function addToGallery(entry) {
  const items = loadGallery();
  items.unshift(entry);
  saveGallery(items);
  renderGallery();
}

async function checkSession() {
  const response = await fetch('/api/session');
  const data = await response.json();
  setAuthenticated(Boolean(data.authenticated));
  if (data.authenticated) renderGallery();
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
  renderGallery();
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

referenceInput.addEventListener('change', () => {
  const files = Array.from(referenceInput.files || []);
  referenceFiles = files.slice(0, 4);
  renderReferencePreviews();
  if (files.length > 4) setStatus('最多使用前 4 张参考图。');
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

    showResult(data.image);
    addToGallery({
      id: crypto.randomUUID(),
      image: data.image,
      prompt,
      quality: '1k',
      aspectRatio: ratioSelect.value,
      createdAt: new Date().toISOString()
    });
    setStatus('生成完成。');
  } catch (error) {
    setStatus(error.message || '生成失败', true);
  } finally {
    generateButton.disabled = false;
  }
});

clearGalleryButton.addEventListener('click', () => {
  if (!confirm('确定清空当前浏览器里的图库吗？')) return;
  saveGallery([]);
  renderGallery();
});

checkSession().catch(() => setAuthenticated(false));
