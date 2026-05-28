const cityInput = document.querySelector('#city');
const customerTypeInput = document.querySelector('#customerType');
const activityTypeInput = document.querySelector('#activityType');
const styleTypeInput = document.querySelector('#styleType');
const sceneInput = document.querySelector('#scene');
const generateBtn = document.querySelector('#generateBtn');
const copyBtn = document.querySelector('#copyBtn');
const resetBtn = document.querySelector('#resetBtn');
const statusText = document.querySelector('#statusText');
const titlesEl = document.querySelector('#titles');
const coversEl = document.querySelector('#covers');
const bodyCopyEl = document.querySelector('#bodyCopy');
const tagsEl = document.querySelector('#tags');

let latestResult = '';

const styleProfiles = {
  自然种草: {
    opening: '这场活动真的很适合想做轻松互动的客户参考。',
    tone: '像朋友分享一样，把现场氛围和体验感讲清楚。',
    cta: '如果你也想做一场好拍、好玩、好传播的活动，可以直接拿这个方向来参考。'
  },
  专业可信: {
    opening: '这类活动适合需要兼顾现场秩序、参与体验和品牌呈现的客户。',
    tone: '从活动动线、物料准备、现场执行和互动效果几个角度呈现。',
    cta: '如果你正在筹备类似活动，可以提前沟通场地、人数和预算，我们会给到更匹配的执行建议。'
  },
  轻松活泼: {
    opening: '现场氛围太适合拍照发朋友圈了。',
    tone: '重点突出好玩、出片、参与门槛低和现场热闹感。',
    cta: '想让活动不冷场，可以把这种互动项目安排进流程里。'
  },
  高级精致: {
    opening: '这场活动的重点不是堆项目，而是把体验感和画面感做出来。',
    tone: '突出布置质感、细节设计、品牌调性和成片效果。',
    cta: '适合重视审美、质感和现场传播效果的活动参考。'
  },
  成交转化: {
    opening: '如果你正在找能提升现场参与感的活动方案，这个案例可以重点参考。',
    tone: '直接说明适合谁、解决什么问题、现场能带来什么效果。',
    cta: '可以把活动时间、城市、人数和场地发来，我们帮你快速判断适合的方案。'
  }
};

function getFormData() {
  return {
    city: cityInput.value,
    customerType: customerTypeInput.value,
    activityType: activityTypeInput.value,
    styleType: styleTypeInput.value,
    scene: sceneInput.value.trim() || '一场有互动、有拍照点、适合现场传播的活动'
  };
}

function renderList(element, items) {
  element.classList.remove('placeholder');
  element.replaceChildren(...items.map((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    return li;
  }));
}

function renderTags(tags) {
  tagsEl.classList.remove('placeholder');
  tagsEl.replaceChildren(...tags.map((tag) => {
    const span = document.createElement('span');
    span.className = 'tag';
    span.textContent = `#${tag}`;
    return span;
  }));
}

function makeTitles({ city, customerType, activityType, scene }) {
  const shortScene = scene.replace(/[，。,.]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4).join('');
  return [
    `${city}${activityType}这样做，现场真的很出片`,
    `${customerType}看过来｜一场不冷场的${activityType}`,
    `${shortScene || activityType}活动案例，氛围感拉满`,
    `在${city}办活动，互动项目可以这样安排`,
    `${activityType}不只是好玩，还能帮现场留住人`
  ];
}

function makeCovers({ activityType, customerType }) {
  return [
    `${activityType}\n这样做更出片`,
    `${customerType}\n活动灵感来了`,
    `现场不冷场\n互动感拉满`
  ];
}

function makeBody(data) {
  const profile = styleProfiles[data.styleType];
  return `${profile.opening}\n\n这次案例是【${data.scene}】，地点在${data.city}，比较适合${data.customerType}参考。\n\n我们建议这类${data.activityType}不要只看项目本身，更要看三个点：\n1. 现场参与门槛低，路过的人愿意停下来；\n2. 画面好看，方便拍照、小红书和朋友圈传播；\n3. 执行流程清晰，不会给主办方增加太多沟通成本。\n\n${profile.tone}\n\n从现场反馈看，好的互动项目能把“到场”变成“参与”，也能让客户后续发内容时有更多素材。\n\n${profile.cta}`;
}

function makeTags({ city, customerType, activityType }) {
  const baseTags = [city, activityType, customerType, '乐活互动', '活动策划', '团建活动', '商场活动', '企业活动', '活动案例', '小红书运营'];
  return [...new Set(baseTags)].slice(0, 10);
}

function buildPlainText({ titles, covers, body, tags }) {
  return [
    '小红书标题：',
    ...titles.map((title, index) => `${index + 1}. ${title}`),
    '',
    '封面大字：',
    ...covers.map((cover, index) => `${index + 1}. ${cover.replace('\n', ' / ')}`),
    '',
    '正文：',
    body,
    '',
    '标签：',
    tags.map((tag) => `#${tag}`).join(' ')
  ].join('\n');
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.append(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 220);
  }, 1600);
}

function generateCopy() {
  const data = getFormData();
  const titles = makeTitles(data);
  const covers = makeCovers(data);
  const body = makeBody(data);
  const tags = makeTags(data);

  renderList(titlesEl, titles);
  renderList(coversEl, covers);
  bodyCopyEl.classList.remove('placeholder');
  bodyCopyEl.textContent = body;
  renderTags(tags);

  latestResult = buildPlainText({ titles, covers, body, tags });
  statusText.textContent = '已生成初稿，可以复制后再按真实案例微调。';
}

generateBtn.addEventListener('click', generateCopy);

copyBtn.addEventListener('click', async () => {
  if (!latestResult) {
    generateCopy();
  }

  try {
    await navigator.clipboard.writeText(latestResult);
    showToast('已复制到剪贴板');
  } catch {
    showToast('复制失败，请手动选择文本复制');
  }
});

resetBtn.addEventListener('click', () => {
  sceneInput.value = '';
  latestResult = '';
  titlesEl.className = 'result-list placeholder';
  titlesEl.innerHTML = '<li>等待生成...</li>';
  coversEl.className = 'result-list placeholder';
  coversEl.innerHTML = '<li>等待生成...</li>';
  bodyCopyEl.className = 'body-copy placeholder';
  bodyCopyEl.textContent = '等待生成...';
  tagsEl.className = 'tag-box placeholder';
  tagsEl.textContent = '等待生成...';
  statusText.textContent = '请先填写活动信息，然后点击“生成文案”。';
});
