/* =========================================================
   每日单词 · 小学 3–6 年级晨听版
   训练流程：昨日回顾 → 听新词 → 跟我读 → 拼写 → 快问快答
   复习算法：Leitner 5 盒 + 到期日调度
   ========================================================= */

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------- 常量 ---------- */
const STORE_KEY = 'eng_daily_v1';
const BOX_GAP = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 30 };

const STAGES = {
  warmup: { name: '昨日回顾', color: '#00A3C4', tip: '听过就过，不用停' },
  new:    { name: '听新词',   color: '#4F63FF', tip: '听发音，记意思' },
  speak:  { name: '跟我读',   color: '#12B886', tip: '大声读出来' },
  spell:  { name: '拼写',     color: '#FF8A3D', tip: '听字母，跟着拼' },
  quiz:   { name: '快问快答', color: '#B04CF0', tip: '先想，再听答案' }
};
const STAGE_ORDER = ['warmup', 'new', 'speak', 'spell', 'quiz'];

/* ---------- 状态 ---------- */
const DEFAULT_DB = {
  version: 2,
  currentGrade: 'g6',
  settings: {
    accent: 'en-US',
    pace: 0.9,
    repeat: 2,
    style: 'teach',      // teach = 讲解式（默认）｜ word = 逐词朗读
    voiceURI: '',        // 英文发音人
    voiceZh: '',         // 中文发音人（中英必须分开存，不能共用一个）
    zhRate: 1,           // 中文单独语速，不跟 pace 联动
    dailyNew: 10,
    minutes: 20,
    reminder: '07:00'
  },
  progress: {},
  history: {},
  unitPick: {},          // 每个年级选中的单元序号；没选就是按词库顺序学
  streak: { last: '', count: 0 }
};

let DB = null;

function loadDB() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_DB));
    const d = JSON.parse(raw);
    const merged = JSON.parse(JSON.stringify(DEFAULT_DB));
    merged.settings = Object.assign(merged.settings, d.settings || {});
    merged.progress = d.progress || {};
    merged.history = d.history || {};
    merged.streak = Object.assign(merged.streak, d.streak || {});
    merged.currentGrade = d.currentGrade || DEFAULT_DB.currentGrade;
    merged.unitPick = d.unitPick || {};

    /* 迁移 v1 → v2：旧版进度以纯单词为 key，统一归入六年级 */
    if (!d.version || d.version < 2) {
      const np = {};
      Object.keys(merged.progress).forEach(k => {
        const nk = k.indexOf(':') > 0 ? k : ('g6:' + k);
        np[nk] = merged.progress[k];
      });
      merged.progress = np;
      merged.version = 2;
    }
    return merged;
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

function saveDB() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); } catch (e) {}
}

/* ---------- 年级 ---------- */
function gradeOf(id) {
  return window.GRADE_MAP[id] || window.GRADE_MAP[window.DEFAULT_GRADE] || window.GRADES[0];
}
function curGrade() { return gradeOf(DB.currentGrade); }
function currentWords() { return curGrade().words; }

/* 当前年级选中的单元（没选或选的单元不存在时返回 null） */
function pickedUnit() {
  const v = (DB.unitPick || {})[DB.currentGrade];
  if (v == null || v === '') return null;
  return curGrade().units.find(u => u.words[0].unitIndex === Number(v)) || null;
}

function switchGrade(id) {
  if (!window.GRADE_MAP[id] || id === DB.currentGrade) return;
  DB.currentGrade = id;
  saveDB();
  const g = curGrade();
  renderGradeTabs();
  refreshHome();
  if (document.getElementById('screen-stats').classList.contains('active')) renderStats();
  toast(`已切到${g.name} · ${g.total} 个词`);
}

/* ---------- 日期 ---------- */
function isoOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function todayISO() { return isoOf(new Date()); }
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return isoOf(dt);
}
function fmtCN(iso) {
  const [, m, d] = iso.split('-');
  return `${Number(m)} 月 ${Number(d)} 日`;
}
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* 用日期做种子的随机，保证同一天首页预览和实际播放的内容一致 */
function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleBy(arr, rnd) {
  const b = arr.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
function uniqByWord(list) {
  const seen = new Set();
  return list.filter(w => (seen.has(w.w) ? false : (seen.add(w.w), true)));
}
/* 页面内的确认框。不用浏览器自带的 confirm()：内嵌浏览器、部分手机的主屏幕模式会把它
   直接屏蔽（立即返回「取消」），表现就是点了「结束」没有任何反应。 */
function askConfirm(msg, okText, danger) {
  return new Promise(resolve => {
    const box = $('#confirmBox');
    $('#confirmMsg').textContent = msg;
    const ok = $('#confirmOk');
    ok.textContent = okText || '确定';
    ok.classList.toggle('danger', !!danger);
    box.classList.add('show');
    const close = v => {
      box.classList.remove('show');
      ok.onclick = $('#confirmCancel').onclick = box.onclick = null;
      resolve(v);
    };
    ok.onclick = e => { e.stopPropagation(); close(true); };
    $('#confirmCancel').onclick = e => { e.stopPropagation(); close(false); };
    box.onclick = e => { if (e.target === box) close(false); };
  });
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- 语音 ---------- */
let voiceCache = [];

function refreshVoices() {
  try { voiceCache = window.speechSynthesis.getVoices() || []; } catch (e) { voiceCache = []; }
}

/* TTS 语速基准：rate=1 时每秒大约读多少「字符」。
   中文按汉字算、英文按字母算，两者差两倍多，估时和超时守卫必须分开。
   英文沿用 9.0（原有课时校准就是按这个值调的，改了会让 20 分钟档缩水 1 分钟）；
   中文按普通话 TTS 实测约 5.2 字/秒，原先的 4.0 高估三成。 */
const TTS_CPS = { zh: 5.2, en: 9.0 };

function langBase(s) {
  return String(s || '').replace('_', '-').toLowerCase().slice(0, 2);
}
function isZhLang(s) { return langBase(s) === 'zh'; }

/* 只取「同一语言家族」的发音人。
   关键点：英文发音人绝不能跨过来读中文 —— 浏览器里 utterance.voice 的优先级高于
   utterance.lang，一旦把 en-US 的嗓音塞给中文句子，引擎会用英文字母的规则去念汉字，
   表现为吞字、只念出一两个音，甚至整句静默（onend 立刻触发，听感上像被跳过）。 */
function voicesOf(lang) {
  if (!voiceCache.length) refreshVoices();
  const lc = String(lang).replace('_', '-').toLowerCase();
  const base = lc.slice(0, 2);
  let pool = voiceCache.filter(v => String(v.lang).replace('_', '-').toLowerCase() === lc);
  if (!pool.length) pool = voiceCache.filter(v => langBase(v.lang) === base);
  return pool;
}

function resolveLang(short) {
  if (short === 'zh') return 'zh-CN';
  if (short === 'en') return DB.settings.accent || 'en-US';
  return short || DB.settings.accent || 'en-US';
}

/* 按语言分开维护的发音人偏好：中文优先普通话，其次台湾/粤语兜底 */
const VOICE_PREF = {
  zh: ['Tingting', 'Ting-Ting', 'Google 普通话', 'Google Chinese', 'Xiaoxiao', 'Huihui',
       'Yaoyao', 'Meijia', 'Mei-Jia', 'Sinji', 'Sin-ji', 'Yushu', 'Lili', 'Liang'],
  en: ['Samantha', 'Google US English', 'Google UK English Female', 'Karen', 'Daniel',
       'Microsoft Aria', 'Microsoft Zira', 'Alex', 'Moira']
};

/* 嗓音分级。macOS 每个语言都塞了一堆「角色音」（中文的 Grandma 是老太太腔、
   Grandpa 是老头腔，Eddy/Flo/Reed/Rocko/Sandy/Shelley 是卡通腔），它们和正常嗓音
   在 getVoices() 里是平级的。一旦自动兜底抓到 pool[0]，孩子听到的就是卡通人物念
   「医院」—— 这正是「怪怪的」的另一个来源。所以角色音只允许手动选，绝不自动选中。
   另外「增强版/优质版」嗓音比系统默认的紧凑版自然得多，要优先。 */
const VOICE_NOVELTY = /grandma|grandpa|eddy|flo\b|reed|rocko|sandy|shelley|albert|bahh|bells|boing|bubbles|jester|organ|superstar|trinoids|whisper|wobble|zarvox|ralph|fred|kathy|princess|deranged|hysterical|zzzane/i;
const VOICE_HQ = /enhanced|premium|增强|优质/i;

function voiceRank(v) {
  if (VOICE_NOVELTY.test(String(v.name))) return 2;   // 角色音：垫底
  if (VOICE_HQ.test(String(v.name))) return 0;        // 增强版：最优
  return 1;
}

function pickVoice(lang) {
  const all = voicesOf(lang);
  if (!all.length) return null;
  /* 增强版排前面，角色音排最后 */
  const pool = all.slice().sort((a, b) => voiceRank(a) - voiceRank(b));

  /* 用户选过的发音人：只在本语言的池子里认，跨语言一律不认 */
  const want = isZhLang(lang) ? DB.settings.voiceZh : DB.settings.voiceURI;
  if (want) {
    const v = pool.find(x => x.voiceURI === want);
    if (v) return v;
  }

  const pref = VOICE_PREF[isZhLang(lang) ? 'zh' : 'en'];
  const norm = s => String(s).replace(/[\s\-_·]/g, '').toLowerCase();
  for (const p of pref) {
    /* 只在非角色音里挑，避免名字里带 grandma 之类被误命中 */
    const v = pool.find(x => voiceRank(x) < 2 && norm(x.name).indexOf(norm(p)) >= 0);
    if (v) return v;
  }
  const firstNormal = pool.find(x => voiceRank(x) < 2);
  return firstNormal || pool[0];
}

/* 词库里少数几条去掉省略号后读不通的说法，单独修一下（屏幕上不动） */
const ZH_SAY_FIX = [
  ['在……之间', '在两者之间']
];

/* 中文送读前的口语化清洗：屏幕保留原文，只改送给引擎的那一份。
   词库里 46 处「；」会被部分引擎读成"分号"或把后半句吞掉；「（过去式）」这类全角括号
   会被读成"括号 过去式 括号"；「在……上面」的省略号会被读成"省略号"或长停顿。
   最后补一个句末停顿：中文两三个字孤立朗读时引擎给的是平调，加句号后才有正常的
   降调收尾，听感从「蹦字」变回「说话」。 */
function ttsText(text, lang) {
  let s = String(text == null ? '' : text);
  if (!isZhLang(lang)) return s.replace(/\s+/g, ' ').trim();
  ZH_SAY_FIX.forEach(([from, to]) => { s = s.split(from).join(to); });
  s = s
    .replace(/（/g, '，')        // （过去式）→ ，过去式
    .replace(/[）)]/g, '')
    .replace(/[；;]/g, '，')      // 橙色；橙子 → 橙色，橙子
    .replace(/[…]+/g, '')         // 在……上面 → 在上面
    .replace(/[、]/g, '，')
    .replace(/[·•]/g, '')
    .replace(/[「」『』“”"']/g, '')
    .replace(/\s+/g, '')
    .replace(/，{2,}/g, '，')
    .replace(/^，+/, '');      // 只去开头的逗号，结尾的逗号留着当"话没说完"的连结
  if (s && !/[。！？!?，,、；;：:…]$/.test(s)) s += '。';
  return s;
}

/* ---------- 中文：预录音频 ----------
   系统自带的中文嗓音（紧凑版婷婷）是老式拼接音，怎么调参数都生硬。
   课程里会说到的中文句子是有限的（每个词的讲解句、词义，加十几句固定播报），
   所以全部用神经网络嗓音（微软晓晓）预先合成好，放在 audio/zh/ 下，
   data/zh-audio.js 记录「句子指纹 → 时长」。指纹按送读文本算，文案一改就对不上，
   对不上的句子自动退回系统 TTS —— 改了词库记得重跑 tools/make-zh-audio.sh。 */
function clipKey(say) {
  return seedFrom(say).toString(16).padStart(8, '0');
}
function zhClipOf(say) {
  const lib = window.ZH_AUDIO;
  if (!lib) return null;
  const k = clipKey(say);
  return lib[k] ? { src: 'audio/zh/' + k + '.mp3', ms: lib[k] } : null;
}

/* ---------- 英文单词和例句：预录音频 ----------
   和中文、拼读一样，用神经网络嗓音（微软 Michelle，美音）提前录好，放在 audio/en/。
   - 单词录两版：常速（n）和慢速（s）。跟读、首听要放得很慢，把常速录音硬拉到一半速度会
     发闷、有金属声，所以慢的那一版是合成时就说慢的，听起来是人在慢慢读。
   - 例句录一版（x），比自然语速略慢。
   播放时按脚本要的语速挑版本，再用播放速度微调（只在 0.8～1.2 之间动，不伤音质）。
   口音选了英音时不用这套录音，回到系统 TTS。 */
const EN_BASE = { n: 0.9, s: 0.65, x: 0.85 };    // 各版本合成时的语速（1 = 嗓音的自然语速）
/* 拼写一样、读音要看语境的词，告诉合成引擎该怎么读（屏幕上不变） */
const EN_SAY_FIX = {
  'read a book': 'red a book',                       // 六下「读了书」，过去式读 /red/
  'I read a book last night.': 'I red a book last night.',
  'Lu Xun is a famous writer.': 'Lu Shoon is a famous writer.'   // Xun 会被读成 Sun
};
/* Michelle 单独读这几个短词时含糊（语音识别把 eye 听成 bye、warm 听成 one、slept 听成
   slapped，换语速、加标点都不稳定）。这几个词改用 Jenny 录，识别稳定。只影响单词本身，
   例句里它们读得没问题。 */
const EN_ALT_VOICE = { bear: 1, eye: 1, her: 1, neck: 1, slept: 1, warm: 1 };
function enClipOf(say, rate) {
  const lib = window.EN_AUDIO;
  if (!lib || (DB.settings.accent || 'en-US') !== 'en-US') return null;
  const pick = v => {
    const k = clipKey('en:' + v + ':' + say);
    if (!lib[k]) return null;
    const r = clampNum((rate || 1) / EN_BASE[v], 0.8, 1.2);
    return { src: 'audio/en/' + k + '.mp3', ms: lib[k], rate: r };
  };
  return pick('x') || ((rate || 1) < 0.72 ? pick('s') : null) || pick('n') || pick('s');
}
/* 供 tools/ 下的合成脚本枚举：{ 指纹: { t: 送读文本, r: 合成语速 } } */
function allEnLines() {
  const out = {};
  const add = (v, text) => {
    const say = ttsText(text, 'en-US');
    if (!say) return;
    const pct = Math.round((EN_BASE[v] - 1) * 100);
    const line = { t: EN_SAY_FIX[say] || say, r: (pct >= 0 ? '+' : '') + pct + '%' };
    if (v !== 'x' && EN_ALT_VOICE[say]) line.v = 'en-US-JennyNeural';
    out[clipKey('en:' + v + ':' + say)] = line;
  };
  window.GRADES.forEach(g => g.words.forEach(w => { add('n', w.w); add('s', w.w); add('x', w.ex); }));
  return out;
}

let pendingResolve = null;

function speak(text, opt) {
  return new Promise(resolve => {
    if (!text || !('speechSynthesis' in window)) return resolve();

    let finished = false;
    let guard = null;
    /* gap：这句话说完到下一句之间的空隙。讲解模式靠它把中英文"粘"成一句人话，
       默认的 80ms 是给逐词朗读用的。 */
    const gapMs = opt.gap == null ? 80 : opt.gap;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (guard) clearTimeout(guard);
      if (pendingResolve === finish) pendingResolve = null;
      setTimeout(resolve, gapMs);
    };
    pendingResolve = finish;

    const lang = opt.lang;
    const say = ttsText(text, lang);
    if (!say) { finish(); return; }

    /* 中文优先放预录音频；没有对应音频或放不出来，再走下面的系统 TTS */
    const clip = opt.noClip ? null : (isZhLang(lang) ? zhClipOf(say) : enClipOf(say, opt.rate));
    if (clip) {
      const r = isZhLang(lang) ? clampNum(DB.settings.zhRate || 1, 0.7, 1.3) : clip.rate;
      LetterAudio.playSrc(clip.src, r, clip.ms / r + 4000).then(ok => {
        if (ok || finished) return finish();
        pendingResolve = null;
        speak(text, Object.assign({}, opt, { noClip: true })).then(resolve);
      });
      return;
    }

    const cps = isZhLang(lang) ? TTS_CPS.zh : TTS_CPS.en;
    const estMs = (say.length / (cps * opt.rate)) * 1000 + 1800;

    /* 没有任何发音人时（部分 headless / 精简系统），静默按估算时长走，不卡住流程 */
    if (!voiceCache.length) refreshVoices();
    if (!voiceCache.length) {
      guard = setTimeout(finish, Math.min(estMs, 6000));
      return;
    }

    const u = new SpeechSynthesisUtterance(say);
    u.rate = Math.min(1.6, Math.max(0.4, opt.rate));
    /* 中文嗓音对 pitch 很敏感，抬 2% 就会发尖发飘，保持原调 */
    u.pitch = isZhLang(lang) ? 1 : 1.02;
    u.volume = 1;

    /* 语言和嗓音必须成对：找到发音人就以它自己的 lang 为准（避免 lang/voice 冲突被
       引擎丢弃），找不到就只声明 lang、不指定 voice，交回系统默认引擎。 */
    const v = pickVoice(lang);
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = lang; }

    u.onend = finish;
    u.onerror = finish;
    /* Chrome 会把还在排队的 utterance 当垃圾回收掉，导致 onend 永远不来；留一个引用 */
    speak.current = u;

    try { window.speechSynthesis.speak(u); } catch (e) { finish(); }

    guard = setTimeout(finish, Math.max(3000, estMs * 1.25 + 1500));
  });
}

function stopSpeech() {
  if (pendingResolve) { const r = pendingResolve; pendingResolve = null; r(); }
  try { window.speechSynthesis.cancel(); } catch (e) {}
  LetterAudio.stop();
}

/* ---------- 字母名：预录音频 ----------
   拼读不再让 TTS 去猜字母怎么念。各家引擎对孤立字母的处理都不一样（实测 Samantha 把
   "ay" 读成 eye，所以 pizza 听成 p-i-z-z-i），换一台设备就要重调一遍。
   data/letters.js 里是按音标合成好的 26 个字母名，Mac / iPhone / 安卓听到的完全一样。
   只有音频放不出来时（文件缺失、浏览器拦截）才退回 TTS。 */
const LetterAudio = {
  el: null,
  broken: false,
  cancel: null,

  clipOf(L) {
    const lib = window.LETTER_AUDIO || {};
    const k = String(L).toLowerCase();
    /* 英音的 z 读 zed */
    if (k === 'z' && DB.settings.accent === 'en-GB' && lib.zed) return lib.zed;
    return lib[k] || '';
  },

  ensure() {
    if (!this.el) {
      this.el = new Audio();
      this.el.preload = 'auto';
      this.el.preservesPitch = true;
    }
    return this.el;
  },

  /* iOS 只允许在用户点击的那一刻启动音频。点「开始」时静音播一下，
     之后同一个 <audio> 换 src 再播就不会被拦。 */
  unlock() {
    const src = this.clipOf('a');
    if (!src) return;
    try {
      const el = this.ensure();
      el.muted = true;
      el.src = src;
      const p = el.play();
      /* 解锁用的这一下是异步结束的。如果这期间正式的音频已经开始播（点「开始」后
         第一句开场白马上就来），就不能再 pause —— 否则会把开场白掐掉，让它退回系统 TTS。 */
      const done = () => {
        if (this.cancel) return;
        try { el.pause(); } catch (e) {}
        el.muted = false;
      };
      if (p && p.then) p.then(done, done); else done();
      this.broken = false;
    } catch (e) {}
  },

  /* 播一个字母。resolve(true) = 播完了；resolve(false) = 没放出来，调用方退回 TTS */
  play(L, rate) { return this.playSrc(this.clipOf(L), rate, 2500); },

  /* 播任意一段预录音频（字母、中文句子共用同一个 <audio>，iOS 只需解锁一次） */
  playSrc(src, rate, maxMs) {
    return new Promise(resolve => {
      if (!src || this.broken) return resolve(false);
      const el = this.ensure();
      let over = false;
      let guard = null;
      const end = ok => {
        if (over) return;
        over = true;
        clearTimeout(guard);
        el.onended = el.onerror = null;
        if (this.cancel === stop) this.cancel = null;
        resolve(ok);
      };
      const stop = () => { try { el.pause(); } catch (e) {} end(true); };
      this.cancel = stop;
      el.onended = () => end(true);
      /* 单个文件加载失败只影响这一句（退回 TTS），不把整条音频通道判死 */
      el.onerror = () => end(false);
      try {
        el.muted = false;
        el.src = src;
        el.playbackRate = clampNum(rate || 1, 0.7, 1.3);
        const p = el.play();
        if (p && p.catch) p.catch(err => {
          /* NotAllowedError = 浏览器不让自动播放，后面的也别试了；其余按单句失败处理 */
          if (err && err.name === 'NotAllowedError') this.broken = true;
          end(false);
        });
      } catch (e) { this.broken = true; return end(false); }
      guard = setTimeout(() => end(true), maxMs || 2500);
    });
  },

  stop() {
    if (this.cancel) { const c = this.cancel; this.cancel = null; c(); }
  }
};

/* ---------- 拼读：整词预录 ----------
   把孤立的字母录音一个个接起来，听着还是一顿一顿的机器味。所以每个词的拼读整段录好
   （P, I, Z, Z, A —— 老师念拼写的那种节奏），放在 audio/spell/。
   找不到整段录音时（新加的词、英音里带 z 的词）才退回逐字母播放。 */
function spellNorm(word) {
  return String(word).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}
function spellClipOf(word) {
  const lib = window.SPELL_AUDIO;
  const norm = spellNorm(word);
  /* 录音是美音（z 读 zee）；选了英音且词里有 z，就走逐字母，那边有 zed */
  if (!lib || (DB.settings.accent === 'en-GB' && norm.indexOf('z') >= 0)) return null;
  const k = clipKey('spell:' + norm);
  return lib[k] ? { src: 'audio/spell/' + k + '.mp3', ms: lib[k] } : null;
}
/* 供 tools/ 下的合成脚本枚举：{ 指纹: 送去合成的文本 }，post office → "P, O, S, T; O, F, F, I, C, E."
   词与词之间用分号而不是句号：read a book 里单独成句的 "A." 会被读成冠词的弱读「呃」。 */
function allSpellLines() {
  const out = {};
  window.GRADES.forEach(g => g.words.forEach(w => {
    if (!canSpell(w.w)) return;
    const norm = spellNorm(w.w);
    out[clipKey('spell:' + norm)] = norm.split(' ').map(seg => seg.toUpperCase().split('').join(', ')).join('; ') + '.';
  }));
  return out;
}

async function saySpelling(word, rate, token) {
  const clip = spellClipOf(word);
  if (clip) {
    const r = clampNum((rate || 1) * (DB.settings.pace || 0.9) / 0.9, 0.7, 1.3);
    if (await LetterAudio.playSrc(clip.src, r, clip.ms / r + 4000)) return;
    if (token && token.cancelled) return;
  }
  /* 兜底：逐字母，两个词之间换一口气 */
  const segs = spellNorm(word).split(' ');
  for (let i = 0; i < segs.length; i++) {
    if (i) await wait(250, token);
    for (const L of segs[i]) {
      if (token && token.cancelled) return;
      await sayLetter(L, token);
      await wait(170, token);
    }
  }
}

async function sayLetter(L, token) {
  /* 字母录音的原速对应「标准」档，慢/快档跟着英文语速等比变 */
  const ok = await LetterAudio.play(L, (DB.settings.pace || 0.9) / 0.9);
  if (ok || (token && token.cancelled)) return;
  const lang = resolveLang('en');
  await speak(letterSay(L), { lang, rate: speechRate(0.88, lang), gap: 0 });
}

/* Chrome 有个老毛病：连续朗读十几秒后会自己"卡住"，之后 speak() 全部静默。
   逐字母拼读把每趟的 utterance 数从 270 涨到 475，更容易踩到。
   定时 resume() 是社区通用解法，无副作用（没卡住时调用也是空操作）。 */
let speechHeartbeat = null;
function startSpeechHeartbeat() {
  stopSpeechHeartbeat();
  speechHeartbeat = setInterval(() => {
    try { if (P.state === 'playing') window.speechSynthesis.resume(); } catch (e) {}
  }, 5000);
}
function stopSpeechHeartbeat() {
  if (speechHeartbeat) { clearInterval(speechHeartbeat); speechHeartbeat = null; }
}

/* 播放期间保持屏幕常亮：锁屏会掐断网页语音 */
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) {}
}
function releaseAwake() {
  if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
}

/* ---------- 会话构建 ---------- */
/* 单条脚本的预计秒数。cps 与 speak() 共用 TTS_CPS，中英文分开算，
   避免中文段落被高估或低估导致课时校准迭代跑偏。 */
function estimateSeconds(script) {
  let ms = 0;
  for (const step of script) {
    if (step.spell) {
      const clip = spellClipOf(step.spell);
      const n = spellNorm(step.spell).replace(/ /g, '').length;
      ms += (clip ? clip.ms : n * 630) / (step.rate || 1) + 100;
    } else if (step.say !== undefined) {
      const lang = resolveLang(step.lang);
      const text = ttsText(step.say, lang);
      const rate = step.rate || 1;
      const cps = isZhLang(lang) ? TTS_CPS.zh : TTS_CPS.en;
      /* 单个字母（读作 oh / eff / double you）是逐条发出来的，底噪比整句小得多 */
      const clip = isZhLang(lang) ? zhClipOf(text) : enClipOf(text, rate * (DB.settings.pace || 0.9));
      if (clip) { ms += clip.ms / (clip.rate || 1) + 60 + (step.gap == null ? 80 : step.gap); continue; }
      const short = text.length <= 4;
      const overhead = short ? 110 : 280;
      ms += Math.max(short ? 180 : 350, (text.length / (cps * rate)) * 1000 + overhead) + (step.gap || 0);
    } else if (step.pause) {
      ms += step.pause;
    } else {
      ms += 200;
    }
  }
  return ms / 1000;
}

function cueNew(w) {
  const rep = DB.settings.repeat;
  const script = [{ say: w.w, lang: 'en', rate: 0.56 }, { pause: 700 }];
  if (rep >= 2) { script.push({ say: w.w, lang: 'en', rate: 0.76 }, { pause: 600 }); }
  if (rep >= 3) { script.push({ say: w.w, lang: 'en', rate: 0.9 }, { pause: 550 }); }
  script.push(
    { say: w.cn, lang: 'zh', rate: 1.0 },
    { pause: 800 },
    /* 例句同样只读一遍，后面留白跟读（原来读两遍，听感是莫名重复） */
    { say: w.ex, lang: 'en', rate: 0.75 },
    { pause: 1800 },
    { say: w.w, lang: 'en', rate: 0.58 },
    { pause: 2800 },
    { say: w.w, lang: 'en', rate: 0.72 },
    { pause: 2200 }
  );
  return {
    stage: 'new', w,
    view: { type: 'word', word: w.w, ph: w.p, cn: w.cn, ex: w.ex, show: ['word', 'ph', 'cn', 'ex'] },
    script
  };
}

/* ---------- 讲解模式（把词串成老师讲课，而不是逐词朗读） ---------- */
/* 引出例句的说法要轮换，不然十个词听下来全是"比如说" */
const ZH_EG = ['比如说，', '比如，', '例句是，', '句子里是这样说的，'];
/* 每个词开头的中文句子。{cn} 会换成词义 —— 句子随词变，十个词不会是一个腔，
   也不会出现"第一个词一大段讲解、后面每个词只剩三个字"的落差。 */
const ZH_ASK = [
  '{cn}，用英语怎么说呢？',
  '我们来看{cn}这个词。',
  '{cn}，这个词英语里怎么讲？',
  '{cn}，听听英语怎么说。'
];
const ZH_OPENING = '准备好了吗？我们开始。每个词会配一句例句，不用全听懂，能听出刚学的那个词就够了。';
const ZH_SPELL_IT = '拼一下，';
const ZH_READ = '跟读，';
const ZH_SPELL = '拼写，';

/* 每个词开头那句中文。一个词永远对应同一句（不随它在当天排第几个而变），
   这样才能提前录好。优先级：故事串讲（data/tips.js）> 单元导入语（只给单元的
   第一个词，它就是照着那个词写的）> 模板句式。 */
function askTextOf(w) {
  /* 故事串讲优先：写了故事的单元，连第一个词也用故事的开头，不再用通用导入语 */
  const tip = tipOf(w);
  if (tip) return tip + w.cn + '。';
  const g = window.GRADE_MAP && window.GRADE_MAP[w.grade];
  const unit = g && g.units.find(u => u.words.indexOf(w) >= 0);
  if (unit && unit.words[0] === w && guideOf(w)) return guideOf(w) + w.cn + '。';
  /* 词义带多个义项或括号时（「堂；表兄弟姐妹」），不能塞进「我们来看…这个词」中间，
     只用词义打头的那几句 */
  const pool = /[；;，,（(…]/.test(w.cn) ? ZH_ASK.filter(t => t.indexOf('{cn}') === 0) : ZH_ASK;
  return pool[(w.idx || 0) % pool.length].replace('{cn}', w.cn);
}

/* 课程里所有会说到的中文句子，供 tools/ 下的合成脚本枚举 */
function allZhLines() {
  const set = new Set([ZH_OPENING, ZH_SPELL_IT, ZH_READ, ZH_SPELL].concat(ZH_EG));
  Object.keys(STAGES).forEach(k => set.add(STAGES[k].name));
  window.GRADES.forEach(g => g.words.forEach(w => { set.add(w.cn); set.add(askTextOf(w)); }));
  const out = {};
  set.forEach(t => { const say = ttsText(t, 'zh-CN'); if (say) out[clipKey(say)] = say; });
  return out;
}

/* 拼读用的字母序列。整词拼（含短语里的每个词）：post office → P,O,S,T,O,F,F,I,C,E。
   空格不作为字母读，但两个词之间留一口气（用 pause 处理）。
   撇号（mustn't）去掉，否则会念 apostrophe。 */
function spellLettersOf(word) {
  return String(word).toUpperCase().replace(/[^A-Z]/g, '').split('');
}
function canSpell(word) {
  return String(word).length >= 2 && spellLettersOf(word).length >= 2;
}

/* TTS 兜底用的字母名 —— 正常情况下字母走预录音频（LetterAudio），只有音频放不出来才用到这张表。
   踩坑记录：
   1. 大写单字母 → 引擎念 "capital O"（区分大小写），六个字母 = "capital O, capital F, ..."
   2. 小写单字母 a → 被读成弱读的"呃"
   3. a 写成 "ay" 会被读成 "eye"（/aɪ/），pizza 的 a 就错读成字母 i，整词听成 p-i-z-z-i
   —— 元音字母名最容易翻车，因为字母名恰好是常见音节。用字母 + 句点（"a."）强制引擎
   进入"拼读"语境读字母名，避开它按单词去猜。其余辅音字母名映射已验证正确。 */
const LETTER_SAY = {
  a: 'a.', e: 'e.', i: 'i.', o: 'o.', u: 'u.',
  b: 'bee', c: 'see', d: 'dee', f: 'eff', g: 'gee', h: 'aitch',
  j: 'jay', k: 'kay', l: 'el', m: 'em', n: 'en', p: 'pee',
  q: 'cue', r: 'ar', s: 'ess', t: 'tee', v: 'vee', w: 'double you',
  x: 'ex', y: 'why', z: 'zee'
};
function letterSay(L) {
  const k = String(L).toLowerCase();
  return LETTER_SAY[k] || k;
}

/* 单元导入语，见 data/guide.js */
function guideOf(w) {
  const g = window.UNIT_GUIDE || {};
  return g[w.grade + ':' + w.unitIndex] || '';
}

/* 词级过渡句，见 data/tips.js。没写到的词回落到模板句式。 */
function tipOf(w) {
  const t = window.WORD_TIPS || {};
  return t[w.grade + ':' + w.w] || '';
}

/* 一个词的讲解段。结构照搬教学音频：
     中文串场 → 中文词 → 英文词 → 拼读 → 英文词 → 中文词 → 比如 + 例句两遍
   句与句之间的 gap 压到 150~300ms，听起来是一口气说完，而不是一条条念。 */
function cueTeach(w, opt) {
  opt = opt || {};
  const multi = String(w.w).indexOf(' ') >= 0;
  /* 整串拼读：post office → P O S T 空格换气 O F F I C E。字母序列含空格占位。 */
  const spell = canSpell(w.w) ? spellLettersOf(w.w) : [];
  const script = [];
  const say = (text, lang, rate, gap) => {
    if (text) script.push({ say: text, lang, rate: rate, gap: gap });
  };

  script.push({ pause: 450 });                     // 换词的换气
  say(askTextOf(w), 'zh', 1.0, 200);               // 每个词都从一句完整的中文开始

  say(w.w, 'en', multi ? 0.78 : 0.88, 150);        // 先听一遍
  if (DB.settings.repeat >= 3) say(w.w, 'en', 0.7, 200);   // 设置里要 3 遍就多给一遍
  if (spell.length) {
    say(ZH_SPELL_IT, 'zh', 1.0, 260);
    script.push({ spell: w.w, rate: 1 });
    script.push({ pause: 700 });                   // 留白让孩子跟着拼
  }
  say(w.w, 'en', multi ? 0.86 : 0.9, 240);         // 再听一遍，把字母和整词接回去
  say(w.cn, 'zh', 1.0, 320);                       // 落回中文，闭环

  say(opt.example || '比如说，', 'zh', 1.0, 80);
  /* 例句只读一遍 + 留白跟读（原来紧挨着读两遍，听感像复读） */
  say(w.ex, 'en', 0.76, 1500);

  return {
    stage: 'new', w,
    view: { type: 'word', word: w.w, ph: w.p, cn: w.cn, ex: w.ex, show: ['word', 'ph', 'cn', 'ex'] },
    script
  };
}

function cueWarm(w) {
  return {
    stage: 'warmup', w,
    view: { type: 'word', word: w.w, ph: w.p, cn: w.cn, ex: '', show: ['word', 'ph', 'cn'] },
    script: [
      { say: w.w, lang: 'en', rate: 0.8 },
      { pause: 420 },
      { say: w.cn, lang: 'zh', rate: 1.0 },
      { pause: 520 },
      { say: w.ex, lang: 'en', rate: 0.82 },
      { pause: 1200 },
      { say: w.w, lang: 'en', rate: 0.9 },
      { pause: 700 }
    ]
  };
}

function cueSpeak(w) {
  return {
    stage: 'speak', w,
    view: { type: 'word', word: w.w, ph: w.p, cn: w.cn, ex: '', show: ['word', 'ph', 'cn'] },
    script: [
      /* 先用中文报一下这个词，后面四遍英文才不会变成"无意义的重复音" */
      { say: ZH_READ, lang: 'zh', rate: 1.0, gap: 60 },
      { say: w.cn, lang: 'zh', rate: 1.0, gap: 300 },
      { say: w.w, lang: 'en', rate: 0.5 },
      { pause: 2400 },
      { say: w.w, lang: 'en', rate: 0.62 },
      { pause: 2600 },
      { say: w.w, lang: 'en', rate: 0.72 },
      { pause: 2200 },
      { say: w.w, lang: 'en', rate: 0.6 },
      { pause: 2400 }
    ]
  };
}

function cueSpell(w) {
  /* 第一遍原速，揭晓后第二遍稍快一点 */
  const spell1 = canSpell(w.w) ? [{ spell: w.w, rate: 1 }] : [];
  const spell2 = canSpell(w.w) ? [{ spell: w.w, rate: 1.12 }] : [];
  return {
    stage: 'spell', w,
    view: { type: 'spell', word: w.w, ph: w.p, cn: w.cn },
    script: [
      /* 中文报词，避免进了拼写环节就只剩英文字母 */
      { say: ZH_SPELL, lang: 'zh', rate: 1.0, gap: 60 },
      { say: w.cn, lang: 'zh', rate: 1.0, gap: 320 },
      { say: w.w, lang: 'en', rate: 0.6 },
      { pause: 900 }
    ].concat(spell1).concat([
      { pause: 2000 },
      { do: () => revealLetters() },
      { say: w.w, lang: 'en', rate: 0.7 },
      { pause: 900 }
    ]).concat(spell2).concat([
      { pause: 1200 },
      { say: w.w, lang: 'en', rate: 0.8 },
      { pause: 900 }
    ])
  };
}

function cueQuiz(w, mode) {
  if (mode === 'cn2en') {
    return {
      stage: 'quiz', w,
      view: { type: 'quiz', q: w.cn, tip: '英文怎么说？', ans: w.w },
      script: [
        { say: w.cn, lang: 'zh', rate: 1.0 },
        { pause: 3000 },
        { say: w.w, lang: 'en', rate: 0.72 },
        { do: () => showQuizAnswer() },
        { pause: 1600 },
        { say: w.ex, lang: 'en', rate: 0.78 },
        { pause: 1200 }
      ]
    };
  }
  return {
    stage: 'quiz', w,
    view: { type: 'quiz', q: w.w, tip: '中文什么意思？', ans: w.cn },
    script: [
      { say: w.w, lang: 'en', rate: 0.8 },
      { pause: 2800 },
      { say: w.cn, lang: 'zh', rate: 1.0 },
      { do: () => showQuizAnswer() },
      { pause: 1600 },
      { say: w.ex, lang: 'en', rate: 0.78 },
      { pause: 1200 }
    ]
  };
}

function cueTransition(stage, idxText) {
  const st = STAGES[stage];
  return {
    stage,
    view: { type: 'transition', title: st.name, sub: st.tip, idx: idxText || '' },
    script: [
      { say: st.name, lang: 'zh', rate: 1.0 },
      { pause: 900 }
    ]
  };
}

/* 每个 cue 的参考时长（秒），用来按时间预算反推各阶段词数 */
const PER = { warmup: 9.7, new: 25.5, speak: 13.4, spell: 20.7, quiz: 15.4 };

function clampNum(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* 实际给几个新词：短时长的档位自动少给，避免撑爆 15 分钟 */
function newQuotaOf(s) {
  return Math.min(s.dailyNew, Math.max(4, Math.round(s.dailyNew * s.minutes / 20)));
}

/* 池子不够时，把已有词再循环一轮补足（间隔重复，不是注水） */
function fillPool(base, need, rnd) {
  const out = base.slice(0, need);
  if (out.length >= need || base.length < 4) return out;
  return out.concat(shuffleBy(base, rnd).slice(0, need - out.length));
}

function buildSession() {
  const s = DB.settings;
  const target = s.minutes * 60;

  /* 先按固定配比装一次，再按实测时长迭代缩放词数。
     年级越低单词越短，实际语音时长会比估算少，迭代能把总时长拉回目标附近。 */
  let scale = 1;
  let best = null;
  for (let i = 0; i < 4; i++) {
    const r = assembleSession(s, scale);
    best = r;
    if (!r.totalSeconds) break;
    const ratio = r.totalSeconds / target;
    if (ratio >= 0.93 && ratio <= 1.08) break;
    scale = scale * Math.min(1.55, Math.max(0.72, target / r.totalSeconds));
  }
  return best;
}

function assembleSession(s, scale) {
  const today = todayISO();
  const unit = pickedUnit();
  const rnd = mulberry32(seedFrom(today + '|' + s.minutes + '|' + s.dailyNew + '|' + s.accent + '|' + DB.currentGrade + '|' + (unit ? unit.name : '')));

  const pool = currentWords();

  /* 到期复习词（盒 1-4，且到期日 <= 今天），越不熟的排前面 */
  const due = pool.filter(w => {
    const p = DB.progress[w.key];
    return p && p.box < 5 && p.next <= today;
  }).sort((a, b) => {
    const pa = DB.progress[a.key], pb = DB.progress[b.key];
    if (pa.box !== pb.box) return pa.box - pb.box;
    return pa.next.localeCompare(pb.next);
  });

  /* 新词：按当前年级的词库顺序往下取。短时长的档位自动少给几个 */
  const newQuota = newQuotaOf(s);
  /* 今天已经学过的新词排在最前面：同一天再点开（提前结束后继续 / 完成后再听一遍）
     听到的还是今天这批词，而不是把明天的词提前拿出来。 */
  /* 选了单元时，「今天这批」只认这个单元里的词。否则今天早些时候学过别的单元，
     这里就会被那批词占满名额，选的单元一个词都排不进来 —— 选了等于没选。 */
  const newWords = pool.filter(w => DB.progress[w.key] && DB.progress[w.key].first === today &&
    (!unit || w.unitIndex === unit.words[0].unitIndex));

  /* 选了单元：从这个单元开始往后取没学过的词（取到年级末尾再绕回开头）。
     没选：按词库顺序。 */
  let order = pool;
  if (unit) {
    const at = pool.indexOf(unit.words[0]);
    order = pool.slice(at).concat(pool.slice(0, at));
  }
  let replayUnit = false;
  if (unit && unit.words.every(w => DB.progress[w.key])) {
    /* 选中的单元已经全学过了：那就是想重听这个单元。把它的词当作今天的讲解内容再讲一遍，
       最久没听的排前面，这样连着几天重听能把整个单元轮一遍。不会重复入库。 */
    replayUnit = true;
    unit.words.slice()
      .sort((a, b) => String(DB.progress[a.key].heard || '').localeCompare(String(DB.progress[b.key].heard || '')) || a.idx - b.idx)
      .forEach(w => { if (newWords.length < newQuota && newWords.indexOf(w) < 0) newWords.push(w); });
    newWords.sort((a, b) => a.idx - b.idx);      // 讲的时候还是按故事顺序
  } else {
    for (const w of order) {
      if (newWords.length >= newQuota) break;
      if (!DB.progress[w.key]) newWords.push(w);
    }
  }

  /* 按时间预算反推每个阶段要装多少词；scale 由外面的迭代校准给出 */
  const target = s.minutes * 60;
  const usable = Math.max(600, target - 34);           // 扣掉开场与 5 个过场
  const warmN  = clampNum(Math.round(usable * 0.08 / PER.warmup * scale), 4, 20);
  const speakN = clampNum(Math.round(usable * 0.20 / PER.speak * scale), 4, 32);
  const spellN = clampNum(Math.round(usable * 0.22 / PER.spell * scale), 4, 28);
  const quizN  = clampNum(Math.round(usable * 0.28 / PER.quiz * scale), 6, 40);

  const dueRest0 = due.filter(w => newWords.indexOf(w) < 0);
  const warmWords = dueRest0.slice(0, Math.min(warmN, dueRest0.length));
  const restDue = dueRest0.slice(warmWords.length);

  /* 复习池：新词优先，其次到期复习词 */
  const freshPool = uniqByWord([].concat(newWords, restDue));

  const speakWords = fillPool(freshPool, speakN, rnd);
  const spellWords = fillPool(freshPool.filter(w => w.w.indexOf(' ') < 0), spellN, rnd);
  const quizPool = uniqByWord([].concat(freshPool, warmWords));
  const quizWords = fillPool(shuffleBy(quizPool, rnd), quizN, rnd);

  const cues = [];

  /* 开场 */
  cues.push({
    stage: 'new',
    view: {
      type: 'transition',
      title: '准备好了吗？',
      sub: '跟着声音走，不用一直看屏幕',
      idx: `${fmtCN(today)} ${WEEK[new Date().getDay()]}`
    },
    script: [
      /* 开场先把预期说清楚：例句是整句英文，孩子听不懂是正常的，只需要听出刚学的那个词。
         不说明的话，每句例句都会变成"一段听不懂的东西"。 */
      { pause: 350 },
      { say: ZH_OPENING, lang: 'zh', rate: 1.0 },
      { pause: 900 }
    ]
  });

  /* 1. 昨日回顾 */
  if (warmWords.length) {
    cues.push(cueTransition('warmup', `${warmWords.length} 个到期词`));
    warmWords.forEach(w => cues.push(cueWarm(w)));
  }

  /* 2. 听新词：讲解模式把词串成老师讲课，逐词模式保持原样 */
  if (newWords.length) {
    cues.push(cueTransition('new', `${newWords.length} 个新词`));
    if (s.style === 'teach') {
      newWords.forEach((w, i) => cues.push(cueTeach(w, { example: ZH_EG[i % ZH_EG.length] })));
    } else {
      newWords.forEach(w => cues.push(cueNew(w)));
    }
  }

  /* 3. 跟我读 */
  if (speakWords.length) {
    cues.push(cueTransition('speak', '慢速 · 每词四遍'));
    speakWords.forEach(w => cues.push(cueSpeak(w)));
  }

  /* 4. 拼写 */
  if (spellWords.length) {
    cues.push(cueTransition('spell', '听字母 · 心里拼'));
    spellWords.forEach(w => cues.push(cueSpell(w)));
  }

  /* 5. 快问快答 */
  if (quizWords.length) {
    cues.push(cueTransition('quiz', '最后一个环节'));
    quizWords.forEach((w, i) => cues.push(cueQuiz(w, i % 2 === 0 ? 'cn2en' : 'en2cn')));
  }

  cues.forEach(c => { c.est = Math.max(2, estimateSeconds(c.script)); });

  const total = cues.reduce((a, c) => a + c.est, 0);
  const reviewSet = new Set();
  cues.forEach(c => { if (c.w && newWords.indexOf(c.w) < 0) reviewSet.add(c.w.key); });

  return {
    cues,
    newWords,
    reviewCount: reviewSet.size,
    estMinutes: Math.max(1, Math.round(total / 60)),
    totalSeconds: total,
    gradeId: curGrade().id,
    gradeName: curGrade().name,
    replayUnit
  };
}

/* ---------- 播放器 ---------- */
const P = {
  cues: [],
  i: 0,
  token: null,
  state: 'idle',          // idle | playing | paused | done
  session: null,
  startedAt: 0
};

function updateProgress() {
  if (!P.cues.length) return;
  const total = P.cues.reduce((a, c) => a + c.est, 0);
  const done = P.cues.slice(0, P.i).reduce((a, c) => a + c.est, 0);
  const pct = Math.min(100, (done / total) * 100);
  $('#plBar').style.width = pct + '%';
  const remMin = Math.max(1, Math.ceil((total - done) / 60));
  $('#plRemain').textContent = `还剩 ${remMin} 分钟`;
}

function renderCue(cue) {
  const st = STAGES[cue.stage] || STAGES.new;
  $('#plStage').textContent = st.name;
  $('#plStage').style.background = st.color;

  const v = cue.view;
  const box = $('#cardInner');

  if (v.type === 'transition') {
    box.innerHTML =
      `<div class="trans-title">${esc(v.title)}</div>` +
      `<div class="trans-sub">${esc(v.sub)}</div>` +
      (v.idx ? `<div class="trans-idx">${esc(v.idx)}</div>` : '');
  } else if (v.type === 'word') {
    const show = v.show || ['word', 'ph', 'cn'];
    box.innerHTML =
      `<div class="word">${esc(v.word)}</div>` +
      (show.indexOf('ph') >= 0 ? `<div class="phonetic">${esc(v.ph)}</div>` : '') +
      (show.indexOf('cn') >= 0 ? `<div class="cn">${esc(v.cn)}</div>` : '') +
      (show.indexOf('ex') >= 0 && v.ex ? `<div class="ex">${esc(v.ex)}</div>` : '');
  } else if (v.type === 'spell') {
    const chars = v.word.split('');
    const nLetter = chars.filter(c => c !== ' ').length;
    const gap = nLetter > 9 ? 3 : (nLetter > 7 ? 4 : 6);
    const avail = Math.min(342, window.innerWidth - 74);
    const cellW = Math.max(16, Math.min(50, Math.floor((avail - (chars.length - 1) * gap) / nLetter)));
    const cellH = Math.round(cellW * 1.46);
    const fsize = Math.max(12, Math.round(cellW * 0.6));
    box.innerHTML =
      `<div class="letters" style="gap:${gap}px">` +
      chars.map(c => (c === ' '
        ? `<span class="lt gap" style="width:${Math.round(cellW * 0.4)}px;height:${cellH}px"></span>`
        : `<span class="lt" data-lt style="width:${cellW}px;height:${cellH}px;font-size:${fsize}px">${esc(c)}</span>`
      )).join('') +
      `</div>` +
      `<div class="phonetic">${esc(v.ph)}</div>` +
      `<div class="spell-cn">${esc(v.cn)}</div>`;
  } else if (v.type === 'quiz') {
    box.innerHTML =
      `<div class="quiz-cn">${esc(v.q)}</div>` +
      `<div class="quiz-tip">${esc(v.tip)}</div>` +
      `<div class="quiz-ans" id="quizAns">${esc(v.ans)}</div>`;
  }
}

function revealLetters() {
  const els = Array.from(document.querySelectorAll('[data-lt]'));
  els.forEach((el, k) => setTimeout(() => el.classList.add('shown'), k * 70));
}
function showQuizAnswer() {
  const el = document.getElementById('quizAns');
  if (el) el.classList.add('show');
}

function wait(ms, token) {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function tick() {
      if ((token && token.cancelled) || Date.now() - t0 >= ms) return resolve();
      setTimeout(tick, 70);
    })();
  });
}

/* 中文语速不跟英文的「慢速」档联动。英文慢放是为了听清连读，中文被拖到 0.9 以下
   会变成逐字念稿，"医院"听起来像"医——院"，这就是中文显怪的主因之一。 */
function speechRate(base, lang) {
  if (isZhLang(lang)) return base * (DB.settings.zhRate || 1);
  return base * (DB.settings.pace || 0.9);
}

async function runScript(script, token) {
  for (const step of script) {
    if (token.cancelled) return;
    if (typeof step.do === 'function') {
      try { step.do(); } catch (e) {}
      continue;
    }
    if (step.spell) {
      await saySpelling(step.spell, step.rate, token);
      if (token.cancelled) return;
    } else if (step.say !== undefined) {
      const lang = resolveLang(step.lang);
      const rate = speechRate(step.rate || 1, lang);
      await speak(step.say, { lang, rate, gap: step.gap });
      if (token.cancelled) return;
    } else if (step.pause) {
      await wait(step.pause, token);
    }
  }
}

async function runFrom(index) {
  P.i = index;
  const token = { cancelled: false };
  P.token = token;
  P.state = 'playing';
  setPauseUI(false);
  startSpeechHeartbeat();

  for (; P.i < P.cues.length; P.i++) {
    if (token.cancelled) return;
    const cue = P.cues[P.i];
    renderCue(cue);
    updateProgress();
    await runScript(cue.script, token);
    if (token.cancelled) return;
  }
  if (!token.cancelled) finishSession();
}

function stopCurrent() {
  if (P.token) P.token.cancelled = true;
  stopSpeech();
}

function setPauseUI(paused) {
  $('#pauseIcon').textContent = paused ? '▶' : '⏸';
  $('#pauseTxt').textContent = paused ? '继续' : '暂停';
}

function startSession() {
  const session = buildSession();
  if (session.cues.length <= 1) { toast('全部单词都掌握了，暂时没有要练的'); return; }

  P.session = session;
  P.cues = session.cues;
  P.i = 0;
  P.startedAt = Date.now();

  /* iOS 需要用户手势内触发一次语音，否则后续 speechSynthesis 全部静默 */
  try {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch (e) {}
  LetterAudio.unlock();

  showScreen('player');
  $('#plBar').style.width = '0%';
  keepAwake();
  startSpeechHeartbeat();
  runFrom(0);
}

function togglePause() {
  if (P.state === 'playing') {
    P.state = 'paused';
    setPauseUI(true);
    stopCurrent();
  } else if (P.state === 'paused') {
    setPauseUI(false);
    const i = P.i;
    setTimeout(() => runFrom(i), 40);
  }
}

function skipCue() {
  if (P.state !== 'playing' && P.state !== 'paused') return;
  const next = P.i + 1;
  stopCurrent();
  setPauseUI(false);
  if (next >= P.cues.length) { finishSession(); return; }
  setTimeout(() => runFrom(next), 40);
}

async function quitSession() {
  if (P.state !== 'playing' && P.state !== 'paused') return;
  /* 弹确认框的时候先停下来，不然声音还在往下念 */
  const wasPlaying = P.state === 'playing';
  if (wasPlaying) togglePause();
  if (!(await askConfirm('结束今天的练习？已经听过的部分会计入进度。', '结束'))) {
    if (wasPlaying && P.state === 'paused') togglePause();
    return;
  }
  stopCurrent();
  finishSession(true);
}

/* ---------- 结算 ---------- */
function finishSession(early) {
  stopCurrent();
  stopSpeechHeartbeat();
  releaseAwake();
  P.state = 'done';

  const today = todayISO();
  const newWords = P.session ? P.session.newWords : [];

  /* 只结算真正听到的部分：提前结束时，还没播到的词不入库、不升盒。
     （原来是只要点过开始，哪怕 10 秒就退出，10 个新词也全算学过了。） */
  if (P.session) {
    const played = early ? P.cues.slice(0, P.i) : P.cues;
    const heard = new Set();
    played.forEach(c => { if (c.w) heard.add(c.w.key); });
    const newSet = new Set(newWords.map(w => w.key));

    /* 记下每个词最近一次被讲解的日期，重听单元时用它来轮换 */
    newWords.forEach(w => { if (heard.has(w.key) && DB.progress[w.key]) DB.progress[w.key].heard = today; });

    /* 新词入库：盒 1，明天复习 */
    let learned = 0;
    newWords.forEach(w => {
      if (heard.has(w.key) && !DB.progress[w.key]) {
        DB.progress[w.key] = { box: 1, next: addDays(today, 1), right: 0, wrong: 0, first: today, last: today, heard: today };
        learned++;
      }
    });

    /* 复习过的词升一盒；同一天听两遍不重复升 */
    let reviewed = 0;
    heard.forEach(key => {
      if (newSet.has(key)) return;
      const p = DB.progress[key];
      if (!p || p.box >= 5 || p.last === today) return;
      p.box = Math.min(5, p.box + 1);
      p.next = addDays(today, BOX_GAP[p.box]);
      p.last = today;
      p.right = (p.right || 0) + 1;
      reviewed++;
    });

    if (heard.size) {
      /* 打卡 */
      if (DB.streak.last !== today) {
        if (DB.streak.last === addDays(today, -1)) DB.streak.count += 1;
        else DB.streak.count = 1;
        DB.streak.last = today;
      }
      const mins = Math.max(1, Math.round((Date.now() - P.startedAt) / 60000));
      const old = DB.history[today] || { newN: 0, reviewN: 0, minutes: 0, full: false };
      DB.history[today] = {
        newN: (old.newN || 0) + learned,
        reviewN: (old.reviewN || 0) + reviewed,
        minutes: (old.minutes || 0) + mins,
        full: !!old.full || !early
      };
    }
    saveDB();
  }

  /* 完成页文案 */
  const h = DB.history[today] || { newN: 0, reviewN: 0, minutes: 0 };
  const mins = h.minutes || 0;
  $('#doneNew').textContent = h.newN || 0;
  $('#doneRev').textContent = h.reviewN || 0;
  $('#doneMin').textContent = mins;
  $('#doneStreak').textContent = DB.streak.count;

  const hour = new Date().getHours();
  $('#doneEmoji').textContent = DB.streak.count >= 7 ? '🏆' : (hour < 10 ? '🌅' : '🎉');
  $('.done-title').textContent = early ? '今天就到这儿' : `今天的 ${mins} 分钟完成！`;

  /* 自评列表 */
  const list = $('#reviewList');
  const rated = newWords.filter(w => DB.progress[w.key]);
  if (rated.length) {
    $('#reviewBlock').style.display = '';
    $('#reviewTitle').textContent = `这 ${rated.length} 个词，哪些还需要再练？`;
    list.innerHTML = rated.map(w => `
      <div class="rv-item" data-k="${esc(w.key)}">
        <div class="rv-line">
          <b class="rv-word">${esc(w.w)}</b>
          <span class="rv-cn">${esc(w.cn)}</span>
        </div>
        <button class="rv-toggle" data-on="0">🤔 再练</button>
      </div>`).join('');
  } else {
    $('#reviewBlock').style.display = 'none';
  }

  /* 明天预告 */
  const pool = currentWords();
  const gName = curGrade().name;
  const upcomingDue = pool.filter(w => {
    const p = DB.progress[w.key];
    return p && p.box < 5 && p.next <= addDays(today, 1);
  }).length;
  const remainNew = pool.filter(w => !DB.progress[w.key]).length;
  let tip = `明早（${gName}）：${Math.min(newQuotaOf(DB.settings), remainNew)} 个新词 + ${upcomingDue} 个复习词。`;
  if (remainNew === 0) tip = `${gName} ${pool.length} 个词都学完了，接下来只做循环复习（每天 ${upcomingDue} 个到期词）。`;
  if (early) tip += ' 今天提前结束了，剩下的明天补。';
  $('#nextTip').textContent = tip;

  showScreen('done');
  refreshHome();
}

/* 自评：点一下切换「明天重来 / 记住」 */
document.addEventListener('click', e => {
  const btn = e.target.closest('.rv-toggle');
  if (!btn) return;
  const item = btn.closest('.rv-item');
  const key = item.dataset.k;
  const p = DB.progress[key];
  if (!p) return;

  const nowOn = btn.dataset.on !== '1';
  btn.dataset.on = nowOn ? '1' : '0';
  btn.classList.toggle('on', nowOn);
  btn.textContent = nowOn ? '↩ 明天重来' : '🤔 再练';

  if (nowOn) {
    p.box = 1;
    p.next = addDays(todayISO(), 1);
    p.wrong = (p.wrong || 0) + 1;
    toast('明天再练一次');
  } else {
    p.next = addDays(todayISO(), BOX_GAP[p.box] || 1);
    toast('记住了');
  }
  saveDB();
});

/* ---------- 页面切换 ---------- */
let screenStack = [];
function showScreen(name) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) {
    el.classList.add('active');
    el.scrollTop = 0;
  }
  if (testToken) { testToken.cancelled = true; testToken = null; stopSpeech(); }
  if (name === 'home') refreshHome();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
}

/* ---------- 年级选项卡 ---------- */
function renderGradeTabs() {
  const html = window.GRADES.map(g => {
    const on = g.id === DB.currentGrade ? ' on' : '';
    return `<button class="${on.trim()}" data-grade="${g.id}">${esc(g.name)}</button>`;
  }).join('');
  ['#gradeTabs', '#gradeTabs2'].forEach(sel => {
    const box = $(sel);
    if (box) box.innerHTML = html;
  });
}

/* ---------- 单元选择 ---------- */
function renderUnitSelect() {
  const sel = $('#selUnit');
  if (!sel) return;
  const grade = curGrade();
  sel.innerHTML = '<option value="">按顺序学（自动接着上次）</option>' + grade.units.map(u => {
    const done = u.words.filter(w => DB.progress[w.key]).length;
    const mark = done === u.words.length ? ' ✓' : '';
    return `<option value="${u.words[0].unitIndex}">${esc(u.name.replace(/（.*?）/g, ''))}　${done}/${u.words.length}${mark}</option>`;
  }).join('');
  const u = pickedUnit();
  sel.value = u ? String(u.words[0].unitIndex) : '';
}

/* ---------- 首页 ---------- */
function refreshHome() {
  const now = new Date();
  $('#homeDate').textContent = `${fmtCN(todayISO())} ${WEEK[now.getDay()]}`;

  const s = DB.settings;
  const today = todayISO();
  const pool = currentWords();
  const grade = curGrade();

  const remainNew = pool.filter(w => !DB.progress[w.key]).length;

  /* 按当前进度试算一次，拿到真实的今日词数与时长 */
  const session = buildSession();
  const est = session.estMinutes;
  const allDone = session.cues.length <= 1;

  $('#planNew').textContent = session.newWords.length;
  $('#planRev').textContent = session.reviewCount;
  $('#planMin').textContent = est;

  /* 品牌副标题：当前年级 + 今天要讲的单元 */
  const nextWord = session.newWords[session.newWords.length - 1];
  $('#brandSub').textContent = grade.name + ' · ' + (nextWord ? nextWord.unit.split('·')[1].trim() : (pool.length ? '全部学完' : '晨听单词'));
  $('#planNewLbl').textContent = session.replayUnit ? '个重听' : '个新词';
  renderUnitSelect();

  /* 统计只算当前年级 */
  const learnedList = pool.filter(w => DB.progress[w.key]);
  $('#statStreak').textContent = DB.streak.count;
  $('#statKnown').textContent = learnedList.filter(w => DB.progress[w.key].box >= 5).length;
  $('#statTotal').textContent = learnedList.length;

  const btn = $('#btnStart');
  btn.disabled = false;
  btn.style.opacity = '1';

  const doneToday = !!(DB.history[today] && DB.history[today].full);
  const partToday = !!DB.history[today] && !doneToday;
  if (allDone) {
    $('#btnStartTxt').textContent = '这个年级已全部掌握';
    $('#homeHint').textContent = `${grade.name} ${pool.length} 个词都进 5 号盒了，换个年级或等抽查`;
    btn.disabled = true;
    btn.style.opacity = '.5';
  } else if (doneToday) {
    $('#btnStartTxt').textContent = '今天已完成 · 再听一遍';
    $('#homeHint').textContent = `今日已练 ${DB.history[today].minutes} 分钟 · 连续 ${DB.streak.count} 天`;
  } else if (partToday) {
    $('#btnStartTxt').textContent = '接着练今天的';
    $('#homeHint').textContent = `今天已练 ${DB.history[today].minutes} 分钟，还没练完`;
  } else {
    $('#btnStartTxt').textContent = `开始今天的 ${est} 分钟`;
  }

  /* 选了单元：按钮直接写明要学哪个单元，点下去就是它 */
  const picked = pickedUnit();
  if (picked && !allDone) {
    const short = picked.name.split('·').pop().replace(/（.*?）/g, '').trim();
    $('#btnStartTxt').textContent = (session.replayUnit ? '重听「' : '开始学「') + short + '」';
    $('#homeHint').textContent = `共 ${est} 分钟 · 想换单元在上面重新选`;
  } else if (allDone || doneToday || partToday) {
    /* 上面已经写好文案 */
  } else {
    $('#btnStartTxt').textContent = `开始今天的 ${est} 分钟`;
    if (est < s.minutes - 3) {
      $('#homeHint').textContent = `复习词攒到 30 个左右就会自动加长到 ${s.minutes} 分钟`;
    } else if (session.reviewCount > 12) {
      $('#homeHint').textContent = `今天排了 ${session.reviewCount} 个复习词，别断`;
    } else {
      $('#homeHint').textContent = '起床就能听 · 不用看屏幕也能跟';
    }
  }

  renderGradeTabs();
}

/* ---------- 进度页 ---------- */
function renderStats() {
  const pool = currentWords();
  const grade = curGrade();

  /* 盒子分布（当前年级） */
  const counts = [0, 0, 0, 0, 0, 0];
  pool.forEach(w => {
    const p = DB.progress[w.key];
    if (p) counts[p.box] = (counts[p.box] || 0) + 1;
  });
  const max = Math.max(1, ...counts.slice(1));
  const colors = ['', '#4F63FF', '#6E7CFF', '#12B886', '#FFC145', '#14C38E'];
  let html = '';
  for (let b = 1; b <= 5; b++) {
    const h = Math.round((counts[b] / max) * 78);
    html += `<div class="bx">
      <div class="bx-bar"><div class="bx-fill" style="height:${Math.max(2, h)}px;background:${colors[b]}"></div></div>
      <div class="bx-num">${counts[b]}</div>
      <div class="bx-lbl">${b} 号盒</div>
    </div>`;
  }
  $('#boxChart').innerHTML = html;

  /* 热力图：按周对齐（周日开头） */
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(addDays(todayISO(), -i));
  const firstWd = new Date(days[0].replace(/-/g, '/')).getDay();
  let heatHtml = '';
  for (let i = 0; i < firstWd; i++) heatHtml += '<div class="ht blank"></div>';
  heatHtml += days.map(d => {
    const h = DB.history[d];
    const cls = 'ht' + (h ? ' done' : '') + (d === todayISO() ? ' today' : '');
    return `<div class="${cls}">${h ? '✓' : Number(d.split('-')[2])}</div>`;
  }).join('');
  $('#heatHead').innerHTML = ['日', '一', '二', '三', '四', '五', '六']
    .map(x => `<span>${x}</span>`).join('');
  $('#heatMap').innerHTML = heatHtml;
  const practiced = days.filter(d => DB.history[d]).length;
  $('#heatTip').textContent = `最近 14 天练了 ${practiced} 天，连续 ${DB.streak.count} 天。`;

  /* 今天到期（当前年级） */
  const today = todayISO();
  const due = pool.filter(w => {
    const p = DB.progress[w.key];
    return p && p.box < 5 && p.next <= today;
  }).sort((a, b) => DB.progress[a.key].box - DB.progress[b.key].box);
  $('#dueList').innerHTML = due.length
    ? due.map(w => {
        const p = DB.progress[w.key];
        return `<div class="due-item"><span class="dw">${esc(w.w)}</span>
          <span class="dc">${esc(w.cn)}</span>
          <span class="tag-box">${p.box} 盒</span></div>`;
      }).join('')
    : '<div class="empty">今天没有到期的复习词 👌</div>';

  /* 词汇表：按单元分组，可展开 */
  const learnedCount = pool.filter(w => DB.progress[w.key]).length;
  $('#allCnt').textContent = `${grade.name} ${learnedCount} / ${pool.length}`;
  $('#unitList').innerHTML = grade.units.map((u, ui) => {
    const done = u.words.filter(w => DB.progress[w.key]).length;
    const words = u.words.map(w => {
      const p = DB.progress[w.key];
      const cls = p ? '' : ' unlearned';
      const tag = p ? (p.box >= 5 ? '毕业' : p.box + ' 盒') : '未学';
      const tagCls = p ? (p.box >= 5 ? 'b5' : '') : 'none';
      return `<div class="uw${cls}">
        <span class="uw-w">${esc(w.w)}</span>
        <span class="uw-p">${esc(w.p)}</span>
        <span class="uw-c">${esc(w.cn)}</span>
        <span class="tag-box ${tagCls}">${tag}</span>
      </div>`;
    }).join('');
    return `<div class="unit-row" data-u="${ui}">
      <div class="unit-head">
        <span class="unit-name">${esc(u.name)}</span>
        <span class="unit-meta">${u.words.length} 词 · 已学 ${done}</span>
        <span class="unit-arrow">▾</span>
      </div>
      <div class="unit-words">${words}</div>
    </div>`;
  }).join('');

  renderGradeTabs();
}

/* 年级选项卡切换（选项卡会被重渲染，用事件委托） */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-grade]');
  if (!b) return;
  switchGrade(b.dataset.grade);
});

/* 展开 / 收起单元 */
document.addEventListener('click', e => {
  const head = e.target.closest('.unit-head');
  if (!head) return;
  const row = head.closest('.unit-row');
  row.classList.toggle('open');
});

/* ---------- 设置页 ---------- */
function setSeg(id, value) {
  $$('#' + id + ' button').forEach(b => {
    b.classList.toggle('on', String(b.dataset.v) === String(value));
  });
}

function renderSettings() {
  const s = DB.settings;
  setSeg('segStyle', s.style || 'teach');
  setSeg('segAccent', s.accent);
  setSeg('segPace', s.pace);
  setSeg('segZhRate', s.zhRate || 1);
  setSeg('segRepeat', s.repeat);
  setSeg('segDailyNew', s.dailyNew);
  setSeg('segMinutes', s.minutes);
  $('#inpReminder').value = s.reminder || '07:00';
  fillVoices();
}

function voiceOptions(list, emptyLabel) {
  /* 按质量排序并把档次写进选项文字：孩子要听的是「高质量」，角色音只供大人试 */
  const sorted = list.slice().sort((a, b) => voiceRank(a) - voiceRank(b));
  return `<option value="">${esc(emptyLabel)}</option>` +
    sorted.map(v => {
      const tag = voiceRank(v) === 0 ? ' · 高质量' : (voiceRank(v) === 2 ? ' · 角色音' : '');
      return `<option value="${esc(v.voiceURI)}">${esc(v.name)}${tag} · ${esc(String(v.lang).replace('_', '-'))}</option>`;
    }).join('');
}

function fillVoices() {
  refreshVoices();
  const en = voicesOf('en-US');
  const zh = voicesOf('zh-CN');

  const selEn = $('#selVoice');
  if (selEn) {
    selEn.innerHTML = voiceOptions(en, '系统默认（英文）');
    selEn.value = DB.settings.voiceURI || '';
  }

  const selZh = $('#selVoiceZh');
  if (selZh) {
    selZh.innerHTML = zh.length
      ? voiceOptions(zh, '系统默认（中文）')
      : '<option value="">未检测到中文语音</option>';
    selZh.value = DB.settings.voiceZh || '';
    selZh.disabled = !zh.length;
  }

  /* 把「实际会用谁读」直接写出来，家长一眼能核对有没有配错 */
  const hint = $('#zhVoiceHint');
  if (hint) {
    const zv = pickVoice('zh-CN');
    const ev = pickVoice(DB.settings.accent || 'en-US');
    if (window.ZH_AUDIO) {
      hint.textContent = '中文已经用预录好的音频（晓晓）来读，这里选的发音人只在个别句子没有录音时兜底。';
      hint.classList.remove('warn');
    } else if (zh.length) {
      const hq = zv && voiceRank(zv) === 0;
      hint.textContent = `中文用 ${zv ? zv.name : '系统默认'}，英文用 ${ev ? ev.name : '系统默认'}。` +
        (hq ? '当前是高质量嗓音。' : '系统里装了「增强版」中文嗓音会更自然。');
      hint.classList.remove('warn');
    } else {
      hint.textContent = '⚠️ 这台设备没有中文语音，中文释义会被英文嗓音念成乱码。到系统设置里添加「中文（普通话）」语音后刷新本页。';
      hint.classList.add('warn');
    }
  }
}

/* 设备没装中文语音时只提醒一次：不提醒的话，用户只会觉得「中文念得怪」却找不到原因 */
let zhWarned = false;
function warnIfNoChinese() {
  if (zhWarned || window.ZH_AUDIO || !('speechSynthesis' in window)) return;
  if (voicesOf('zh-CN').length) { zhWarned = true; return; }
  if (!voiceCache.length) return;            // 列表还没加载完，等 voiceschanged 再判
  zhWarned = true;
  console.warn('[tts] 未检测到中文发音人，中文释义将退化为系统默认嗓音');
  toast('没找到中文语音，中文释义可能读不准 — 去「设置」看看');
}

function bindSeg(id, key, cast) {
  $('#' + id).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = cast ? cast(b.dataset.v) : b.dataset.v;
    DB.settings[key] = v;
    saveDB();
    setSeg(id, v);
    if (key === 'accent' || key === 'pace' || key === 'style') { refreshHome(); }
  });
}

let testToken = null;   // 试听的取消令牌：连点两次或离开设置页时掐掉上一段

/* ---------- 事件绑定 ---------- */
function init() {
  DB = loadDB();

  /* 支持 index.html?g=g3 直达某个年级 */
  try {
    const q = new URLSearchParams(location.search).get('g');
    if (q && window.GRADE_MAP[q]) DB.currentGrade = q;
  } catch (e) {}

  saveDB();                       // 把数据迁移的结果落盘
  renderGradeTabs();

  $('#btnStart').addEventListener('click', startSession);
  $('#selUnit').addEventListener('change', e => {
    DB.unitPick = DB.unitPick || {};
    if (e.target.value === '') delete DB.unitPick[DB.currentGrade];
    else DB.unitPick[DB.currentGrade] = Number(e.target.value);
    saveDB();
    refreshHome();
    const u = pickedUnit();
    toast(u ? (u.words.every(w => DB.progress[w.key]) ? '这个单元学过了，会重听一遍' : '从这个单元开始学') : '按词库顺序学');
  });
  $('#btnPause').addEventListener('click', togglePause);
  $('#btnSkip').addEventListener('click', skipCue);
  $('#btnQuit').addEventListener('click', quitSession);
  $('#btnDoneHome').addEventListener('click', () => showScreen('home'));

  $('#btnStats').addEventListener('click', () => showScreen('stats'));
  $('#btnSettings').addEventListener('click', () => showScreen('settings'));
  $$('[data-back]').forEach(b => b.addEventListener('click', () => showScreen('home')));

  bindSeg('segStyle', 'style');
  bindSeg('segAccent', 'accent');
  bindSeg('segPace', 'pace', Number);
  bindSeg('segZhRate', 'zhRate', Number);
  bindSeg('segRepeat', 'repeat', Number);
  bindSeg('segDailyNew', 'dailyNew', Number);
  bindSeg('segMinutes', 'minutes', Number);

  $('#selVoice').addEventListener('change', e => {
    DB.settings.voiceURI = e.target.value;
    saveDB();
    fillVoices();
    toast('英文发音人已切换');
  });

  const selZh = $('#selVoiceZh');
  if (selZh) {
    selZh.addEventListener('change', e => {
      DB.settings.voiceZh = e.target.value;
      saveDB();
      fillVoices();
      toast('中文发音人已切换');
    });
  }

  $('#btnTestVoice').addEventListener('click', () => {
    if (testToken) testToken.cancelled = true;
    stopSpeech();
    LetterAudio.unlock();
    const accent = DB.settings.accent || 'en-US';
    /* 直接播一段真实讲解，听到的就是上课的样子，不是一个孤零零的单词 */
    /* pizza 同时含 i 和 a 两个最容易读错的元音字母，正好用来验拼读 */
    const demo = window.GRADE_MAP.g6.words.find(w => w.w === 'pizza') ||
      { w: 'pizza', p: '/ˈpiːtsə/', cn: '比萨饼', ex: 'I like pizza very much.' };
    const cue = (DB.settings.style === 'word')
      ? cueNew(demo)
      : cueTeach(demo, {});
    testToken = { cancelled: false };
    runScript(cue.script, testToken);
    const enV = pickVoice(accent);
    const zhV = pickVoice('zh-CN');
    toast(`英文：${enClipOf('pizza', 1) ? '预录音频（Michelle）' : (enV ? enV.name : '系统默认')} ｜ 中文：${window.ZH_AUDIO ? '预录音频（晓晓）' : (zhV ? zhV.name : '没找到中文语音')}`);
  });

  $('#inpReminder').addEventListener('change', e => {
    DB.settings.reminder = e.target.value;
    saveDB();
    toast('已保存提醒时间');
  });

  $('#btnNotify').addEventListener('click', async () => {
    if (!('Notification' in window)) { toast('这台设备不支持通知'); return; }
    const r = await Notification.requestPermission();
    if (r === 'granted') {
      DB.settings.notifyOn = true;
      saveDB();
      new Notification('提醒已开启', { body: '每天早上会在这个页面提醒你练单词。' });
      toast('通知已开启');
      $('#remindHint').textContent = '通知已开启。注意：网页关闭后通知不会来，建议把本页固定成常驻标签页。';
    } else {
      toast('没有拿到通知权限');
    }
  });

  $('#btnReset').addEventListener('click', async () => {
    if (!(await askConfirm('清空所有进度？单词、复习记录、连续天数都会归零，不能恢复。', '清空', true))) return;
    DB = JSON.parse(JSON.stringify(DEFAULT_DB));
    saveDB();
    toast('已清空');
    showScreen('home');
  });

  if ('speechSynthesis' in window) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      refreshVoices();
      warnIfNoChinese();
      if (document.getElementById('screen-settings').classList.contains('active')) fillVoices();
    };
    /* 语音列表是异步加载的，晚一点再查一次中文发音人 */
    setTimeout(() => { refreshVoices(); warnIfNoChinese(); }, 1500);
  } else {
    toast('当前浏览器不支持语音，请用 Chrome 或 Safari 打开');
  }

  /* 每日提醒检查 */
  setInterval(checkReminder, 60000);
  checkReminder();

  showScreen('home');

  /* 支持 index.html#stats / #settings 直达内页 */
  const hash = (location.hash || '').replace('#', '');
  if (hash === 'stats' || hash === 'settings') showScreen(hash);
}

let lastRemindDay = '';
function checkReminder() {
  const s = DB.settings;
  if (!s.notifyOn || !s.reminder) return;
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = todayISO();
  if (hm !== s.reminder) return;
  if (lastRemindDay === today) return;
  lastRemindDay = today;
  if (DB.history[today]) return;
  try {
    new Notification('该练单词啦', { body: `今天的 ${s.minutes} 分钟还没开始，点开练一下吧。` });
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', init);
