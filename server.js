import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('仅支持 PNG、JPG、WEBP 图片'));
  }
});

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'sam';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret';
const COOKIE_NAME = 'image2_session';
const jobs = new Map();

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function createSessionToken() {
  const value = crypto.randomBytes(24).toString('hex');
  return `${value}.${sign(value)}`;
}

function isValidSession(token) {
  if (!token || !token.includes('.')) return false;
  const [value, signature] = token.split('.');
  const expected = sign(value);
  return Boolean(signature) && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function requireAuth(req, res, next) {
  if (!isValidSession(req.cookies[COOKIE_NAME])) {
    res.status(401).json({ error: '请先登录' });
    return;
  }
  next();
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '');
}

function getImageApiConfig() {
  const apiKey = process.env.IMAGE_API_KEY;
  const baseUrl = process.env.IMAGE_API_BASE_URL;
  if (!apiKey || !baseUrl) {
    throw new Error('服务端缺少 IMAGE_API_KEY 或 IMAGE_API_BASE_URL');
  }
  return {
    apiKey,
    baseUrl: normalizeBaseUrl(baseUrl),
    model: process.env.IMAGE_MODEL || 'gpt-image-2'
  };
}

function mapSize(aspectRatio) {
  const sizes = {
    '1:1': '1024x1024',
    '16:9': '1024x576',
    '9:16': '576x1024',
    '3:4': '768x1024'
  };
  return sizes[aspectRatio] || sizes['1:1'];
}

function parseImageFromResponse(data) {
  const item = data?.data?.[0] || data?.output?.[0] || data?.images?.[0] || data;
  const base64 = item?.b64_json || item?.base64 || item?.image_base64;
  const url = item?.url || item?.image_url;
  if (base64) return `data:image/png;base64,${base64}`;
  if (url) return url;
  throw new Error('图片接口没有返回可识别的图片数据');
}

async function callTextToImage({ prompt, quality, aspectRatio }) {
  const { apiKey, baseUrl, model } = getImageApiConfig();
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      prompt,
      quality,
      aspect_ratio: aspectRatio,
      size: mapSize(aspectRatio),
      n: 1
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || '图片生成失败');
  }
  return parseImageFromResponse(data);
}

async function callImageToImage({ prompt, quality, aspectRatio, files }) {
  const { apiKey, baseUrl, model } = getImageApiConfig();
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('quality', quality);
  form.append('aspect_ratio', aspectRatio);
  form.append('size', mapSize(aspectRatio));
  form.append('n', '1');
  for (const file of files) {
    form.append('image', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  }

  const response = await fetch(`${baseUrl}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || '参考图生成失败');
  }
  return parseImageFromResponse(data);
}

app.post('/api/login', (req, res) => {
  const password = String(req.body?.password || '');
  if (password !== APP_PASSWORD) {
    res.status(401).json({ error: '密码错误' });
    return;
  }
  setSessionCookie(res, createSessionToken());
  res.json({ ok: true });
});

app.post('/api/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authenticated: isValidSession(req.cookies[COOKIE_NAME]) });
});

app.post('/api/generate', requireAuth, upload.array('referenceImages', 4), async (req, res) => {
  const startedAt = Date.now();
  try {
    const prompt = String(req.body?.prompt || '').trim();
    const quality = '1k';
    const aspectRatio = String(req.body?.aspectRatio || '1:1');

    if (!prompt) {
      res.status(400).json({ error: '请输入提示词' });
      return;
    }
    if (!['9:16', '16:9', '3:4', '1:1'].includes(aspectRatio)) {
      res.status(400).json({ error: '参数不正确' });
      return;
    }

    const files = req.files || [];
    const mode = files.length ? 'image-to-image' : 'text-to-image';
    console.log('generate request', {
      mode,
      files: files.map((file) => ({ type: file.mimetype, size: file.size })),
      aspectRatio
    });

    const jobId = crypto.randomUUID();
    jobs.set(jobId, { status: 'running', createdAt: Date.now(), mode });
    res.status(202).json({ jobId });

    try {
      const image = files.length
        ? await callImageToImage({ prompt, quality, aspectRatio, files })
        : await callTextToImage({ prompt, quality, aspectRatio });
      jobs.set(jobId, { status: 'done', image, createdAt: Date.now(), mode });
      console.log('generate success', { mode, jobId, ms: Date.now() - startedAt });
    } catch (error) {
      jobs.set(jobId, { status: 'error', error: error.message || '生成失败', createdAt: Date.now(), mode });
      console.error('generate failed', { message: error.message, jobId, ms: Date.now() - startedAt });
    }
  } catch (error) {
    console.error('generate failed before job', { message: error.message, ms: Date.now() - startedAt });
    res.status(500).json({ error: error.message || '生成失败' });
  }
});

app.get('/api/generate/:jobId', requireAuth, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '生成任务不存在或已过期' });
    return;
  }
  res.json(job);
});

app.use((error, _req, res, _next) => {
  res.status(400).json({ error: error.message || '请求失败' });
});

app.listen(PORT, () => {
  console.log(`Image2 generator running at http://localhost:${PORT}`);
});
