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
app.get('/sw.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});
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
    '3:4': '1024x1536',
    '9:16': '1024x1536',
    '16:9': '1536x1024',
    '1:1': '1024x1024'
  };
  return sizes[aspectRatio] || sizes['1:1'];
}

function imageFromItem(item) {
  const base64 = item?.b64_json || item?.base64 || item?.image_base64;
  const url = item?.url || item?.image_url;
  if (base64) return `data:image/png;base64,${base64}`;
  if (url) return url;
  return null;
}

function parseImageFromResponse(data, preferLast = false) {
  const list = data?.data || data?.output || data?.images;
  if (Array.isArray(list) && list.length) {
    const items = preferLast ? [...list].reverse() : list;
    for (const item of items) {
      const image = imageFromItem(item);
      if (image) return image;
    }
  }

  const image = imageFromItem(data);
  if (image) return image;
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
  return parseImageFromResponse(data, true);
}


const copywriterSceneOptions = {
  diy: ['企业团建', '商场活动', '车企活动', '楼盘暖场'],
  photobooth: ['婚礼', '宝宝百日宴', '生日派对', '企业活动', '闺蜜聚会']
};

const copywriterContentTypes = ['story', 'proposal'];
const copywriterCategories = Object.keys(copywriterSceneOptions);
const bannedCopyTerms = [
  '私我', '加V', '戳我', '私信我', '加微信', '微信号', '手机号',
  '扣1送', '三连抽', '评论区抽', '关注我领', '互关互赞',
  '在当今', '随着', '值得一提的是', '综上所述', '谁能拒绝呢', '告别千篇一律',
  '材料包', '报纸打印'
];

function getCopywriterApiConfig() {
  const apiKey = process.env.COPYWRITER_API_KEY;
  if (!apiKey) {
    throw new Error('服务端缺少 COPYWRITER_API_KEY');
  }
  return {
    apiKey,
    baseUrl: normalizeBaseUrl(process.env.COPYWRITER_API_BASE_URL || 'https://api.deepseek.com/v1'),
    model: process.env.COPYWRITER_MODEL || 'deepseek-chat',
    maxTokens: Number(process.env.COPYWRITER_MAX_TOKENS || 3000)
  };
}

function normalizeCopywriterPayload(body, mode) {
  const category = String(body?.category || '').trim();
  const scene = String(body?.scene || '').trim();
  const contentType = String(body?.contentType || '').trim();
  const draftInput = String(body?.draftInput || '').trim();
  const draft = String(body?.draft || '').trim();

  if (!copywriterCategories.includes(category)) {
    throw new Error('请选择正确的业务类型');
  }
  if (!copywriterSceneOptions[category].includes(scene)) {
    throw new Error('请选择正确的场景');
  }
  if (!copywriterContentTypes.includes(contentType)) {
    throw new Error('请选择正确的文案类型');
  }
  if (draftInput.length > 3000) {
    throw new Error('输入内容过长，请控制在 3000 字以内');
  }
  if (mode === 'optimize' && !draft) {
    throw new Error('请先输入或生成需要优化的文案');
  }
  if (draft.length > 6000) {
    throw new Error('待优化文案过长，请控制在 6000 字以内');
  }

  return { category, scene, contentType, draftInput, draft };
}

function contentTypeLabel(contentType) {
  return contentType === 'proposal' ? '方案型' : '种草型';
}

function categoryLabel(category) {
  return category === 'photobooth' ? '复古拍照机 photobooth' : '手工DIY团建';
}

function buildCopywriterBaseRules({ category, scene, contentType }) {
  const sharedRules = `你是乐活互动的小红书文案顾问，熟悉珠三角本地活动营销。\n当前业务：${categoryLabel(category)}。\n当前场景：${scene}。\n文案类型：${contentTypeLabel(contentType)}。\n\n统一要求：\n- 输出中文，适合小红书发布，像真实运营人员写的，不要像广告公司提案。\n- 标题不超过20个中文字符。\n- 正文 200-500 字，每段不超过3行。\n- 结尾给 5-10 个话题标签，每个以 # 开头。\n- 标题和正文前几行自然出现城市或区域关键词，例如广州、深圳、佛山、东莞、珠三角。\n- 不出现手机号、微信号、二维码、加V、私我、戳我、私信我。\n- 不诱导点赞、收藏、评论、关注，不写抽奖福利。\n- 避免AI腔：不要写“在当今”“随着”“值得一提的是”“综上所述”“谁能拒绝呢”“告别千篇一律”。\n- 不要堆砌三连形容词，不要四字/八字口号堆叠。`;

  if (category === 'photobooth') {
    return `${sharedRules}\n\nphotobooth 业务要求：\n- 核心关键词是 photobooth、复古拍照机、婚礼拍照机、婚礼互动、备婚。\n- 标题必须包含“城市名 + photobooth”，例如“广州婚礼photobooth”。\n- 正文前3行必须自然出现“城市名 + photobooth”。\n- 强调可视化拍照、不盲拍、十几秒即拍即印、照片质感、模板设计、现场互动。\n- 语气像备婚/活动现场真实分享，不要官方硬广。\n- 不要使用“报纸”“报纸打印”“惊艳全场”“必入”等表达。`;
  }

  const diySceneRules = {
    企业团建: '目标读者是企业HR/行政，重点写省心、不翻车、员工愿意参与、现场好交差。自然出现DIY/手工/手作和团建关键词。',
    商场活动: '目标读者是商场/购物中心运营，重点写VIP会员沙龙、节日活动、停留时长、复购与打卡传播，不要写成普通路演。',
    车企活动: '目标读者是车企/4S店运营，重点写延长客户停留时间、试驾留客、亲子/车主互动、销售沟通窗口。',
    楼盘暖场: '目标读者是地产/楼盘策划，重点写家庭友好、大人看房小孩做手工、停留时长、销售沟通机会。'
  };

  return `${sharedRules}\n\nDIY 业务要求：\n- ${diySceneRules[scene]}\n- 强调定制课件、老师控场、流程省心、出片好看、珠三角可执行。\n- 站在客户视角写“客户能得到什么”，不要只介绍我们有什么。\n- 绝对不要出现“材料包”。\n- 正文不要硬塞“乐活互动”品牌名。`;
}

function buildCopywriterDraftPrompt(payload) {
  return `${buildCopywriterBaseRules(payload)}\n\n你要完成“第一步：出文案”。\n请根据用户给的主题/项目线索，直接输出一版可编辑的小红书初稿。\n\n输出格式必须是：\n标题：...\n\n正文：\n...\n\n话题标签：\n#标签1 #标签2 #标签3`;
}

function buildCopywriterDraftUserMessage({ category, scene, contentType, draftInput }) {
  const seed = draftInput || (category === 'photobooth' ? `${scene} photobooth 活动案例` : `${scene} DIY活动案例`);
  return `请写一篇${categoryLabel(category)}的${contentTypeLabel(contentType)}小红书文案。\n场景：${scene}\n用户输入/主题：${seed}\n\n如果用户输入形如“端午节-艾草花束”，前半部分是活动主题，后半部分是具体项目，不能擅自改项目。`;
}

function buildCopywriterOptimizePrompt(payload) {
  return `${buildCopywriterBaseRules(payload)}\n\n你要完成“第二步：分析并优化”。\n请先诊断用户文案，再给出一版更适合小红书搜索和转化的改写版。\n\n输出格式必须是：\n### 诊断打分\n- 标题：1-5分，说明原因\n- 正文：1-5分，说明原因\n- AI感检测：1-5分，说明原因\n- 话题标签：1-5分，说明原因\n- 关键词布局：1-5分，说明原因\n\n### 主要问题\n- ...\n- ...\n\n### 改写版\n标题：...\n\n正文：\n...\n\n话题标签：\n#标签1 #标签2 #标签3`;
}

function findCopywriterWarnings(text) {
  const warnings = [];
  for (const term of bannedCopyTerms) {
    if (text.includes(term)) warnings.push(`检测到疑似禁用词：${term}`);
  }
  if (/1[3-9]\d{9}/.test(text)) warnings.push('检测到疑似手机号');
  if (/(微信|VX|V信|wechat)[:：]?\s?[a-zA-Z0-9_-]{5,}/i.test(text)) warnings.push('检测到疑似微信联系方式');
  return [...new Set(warnings)];
}

async function callCopywriterChat({ systemPrompt, userMessage, temperature = 0.7 }) {
  const { apiKey, baseUrl, model, maxTokens } = getCopywriterApiConfig();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature,
      max_tokens: maxTokens
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || '文案模型请求失败');
  }

  const text = data?.choices?.[0]?.message?.content || data?.output_text || data?.text;
  if (!text || !String(text).trim()) {
    throw new Error('文案模型没有返回可用内容');
  }
  return String(text).trim();
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


app.post('/api/copywriter/draft', requireAuth, async (req, res) => {
  const startedAt = Date.now();
  try {
    const payload = normalizeCopywriterPayload(req.body, 'draft');
    const text = await callCopywriterChat({
      systemPrompt: buildCopywriterDraftPrompt(payload),
      userMessage: buildCopywriterDraftUserMessage(payload),
      temperature: 0.75
    });
    res.json({ text, warnings: findCopywriterWarnings(text) });
    console.log('copywriter draft success', {
      category: payload.category,
      scene: payload.scene,
      contentType: payload.contentType,
      ms: Date.now() - startedAt
    });
  } catch (error) {
    console.error('copywriter draft failed', { message: error.message, ms: Date.now() - startedAt });
    res.status(error.message?.startsWith('请选择') || error.message?.includes('过长') ? 400 : 500)
      .json({ error: error.message || '文案生成失败' });
  }
});

app.post('/api/copywriter/optimize', requireAuth, async (req, res) => {
  const startedAt = Date.now();
  try {
    const payload = normalizeCopywriterPayload(req.body, 'optimize');
    const text = await callCopywriterChat({
      systemPrompt: buildCopywriterOptimizePrompt(payload),
      userMessage: `请分析并优化以下文案：\n\n${payload.draft}`,
      temperature: 0.55
    });
    res.json({ text, warnings: findCopywriterWarnings(text) });
    console.log('copywriter optimize success', {
      category: payload.category,
      scene: payload.scene,
      contentType: payload.contentType,
      ms: Date.now() - startedAt
    });
  } catch (error) {
    console.error('copywriter optimize failed', { message: error.message, ms: Date.now() - startedAt });
    res.status(error.message?.startsWith('请选择') || error.message?.includes('过长') || error.message?.startsWith('请先') ? 400 : 500)
      .json({ error: error.message || '文案优化失败' });
  }
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
