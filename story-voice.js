// 🔊 正文朗读（独立插件版）：给酒馆正文里的台词挂上 ▶ / ↻ / 🎭，按情绪读出来。
// 只改页面显示，不改聊天记录。音色在插件自己的「角色音色库」里配（所有聊天共用）。

import { favStore, needsTranslation } from './fav-store.js';
import { startAmbience, AMBIENCE_LABELS } from './ambience.js';
import { adaptScript, channelProfile } from './tts-adapt.js';
import { openDeepEditor } from './deep-editor.js';
import { gateCue, STORY_TONES } from './deep-analysis.js';
import { buildDeepMessages, numberStory, parseDeep, applyToneGate, scriptForModel, TENSION_TEMPERATURE, PACE_SPEED } from './deep-analysis.js';

const STORE_KEY = 'phone-story-voice';
const LOCAL_SETTINGS_KEY = 'yzr-settings-local';     // 设置的本机备份（带时间，取最新的）
const DEEP_KEY = 'phone-story-voice-deep';          // 旧版本存放位置（会自动搬走）
const DEEP_LOCAL_KEY = 'yzr-deep-analysis-cache';    // 现在：只存浏览器本地
const DEEP_MAX = 100;
const STYLE_ID = 'yzr-story-voice-style';
const DEFAULTS = Object.freeze({
    enabled: true,
    quotes: '「」, 『』, “”',
    skips: '（）, ()',
    voice: '',
    npcMode: 'npc', 
    emotionCue: true,   // 让模型给每句台词写语气，合成时交给 Fish（S2 用 [语气]）
      // only = 只读配了音色的人；npc = 没配音色的用默认 NPC 音色
    npcMale: '',
    npcFemale: '',
    npcProvider: '',      // NPC 默认音色属于哪个渠道（每人用自己的渠道时）：'' = 跟随默认渠道
    speakers: [],
    readUser: false,
    markSpeaker: true,
    analysisMode: 'simple', // simple = 简单分析（正文里的 [[名字|语气]]）；deep = 整楼深度分析；manual = 手动（自己逐句配）
    nsfw: false,          // 旧设置，已不用（情节由分析判断）
    ttsProvider: '',      // 正文朗读用哪个语音渠道：'' = 跟随小手机「设置 → 语音」
    ttsModels: {},        // 每个渠道单独指定的模型：{ fish: 's2.1-pro', minimax_cn: 'speech-2.8-hd' }
    lineEdit: true,       // 每句台词后面显示 🎭（单句调整）
    channelMode: 'per',   // per = 每个人按自己配的渠道（没单独配的用上面选的渠道）；unified = 统一用上面选的渠道
    deepPresets: [],      // 深度分析保存的接口：[{ id, name, url, key, model }]
    customUrl: '',        // 第三方（OpenAI 兼容）语音接口
    customKey: '',
    customModel: '',
    customModels: [],
    ambienceOn: true,     // 播放时垫环境声（深度分析自动判断；简单 / 手动在 🎭 里选）
    ambienceVol: 30,
    autoOno: true,        // 简单分析：按语气自动加拟声词（笑→哈哈，哭→呜……）
    deepProfile: '',      // 深度分析用哪条连接：'' = 跟随酒馆当前；'__custom__' = 自己填的 API；其他 = 酒馆连接配置
    deepApiUrl: '',
    deepApiKey: '',
    deepModel: '',
    deepModels: [],
    deepTimeout: 150,
    deepAuto: false       // true = 每轮写完自动分析并生成语音；false = 点 ▶ / ↻ 时才分析这一楼
});
const MARK_RE = /\[\[([^\[\]\n]{1,120})\]\][ \t]*[:：]?[ \t]*/g;

// 模型有时把动作、神态（本该是正文）写进了语气提示里：这种不藏，还原成一句旁白
const NARR_CUE_RE = /把|将|向|朝|往|察觉|发现|看|望|盯|抬|低头|垂|伸|握|抓|抱|搂|埋|靠|贴|转身|走|退|站|坐|跪|扑|推|拉|摸|抚|捏|咬住|揉|眼|脸|手|指|肩|颈|唇|嘴角|眉|身体|随即|然后|一边|同时/;
function isNarrCue(cue = '') {
    const c = String(cue || '').trim();
    if (!/[\u4e00-\u9fff]/.test(c) || /[a-z]{3,}/i.test(c)) return false;
    return c.length >= 6 && NARR_CUE_RE.test(c);
}
function narrFromMark(name = '', cue = '') {
    let c = String(cue || '').trim().replace(/[，,、；;。\s]+$/, '');
    if (name && c.startsWith(name)) c = c.slice(name.length);
    return `${name}${c}。`;
}
function parseMarkBody(body = '') {
    const parts = String(body).split(/[|｜]/).map(x => x.trim()).filter(Boolean);
    let head = parts.shift() || '';
    let cue = '';
    let g = '';
    parts.forEach(x => { if (/^(男|女|m|f|male|female)$/i.test(x)) g = /^(男|m|male)$/i.test(x) ? 'm' : 'f'; else cue = cue ? `${cue}，${x}` : x; });
    const gm = head.match(/^(.+?)\s*(?:\/\s*|[（(]\s*)(男|女|m|f|male|female)\s*[)）]?$/i);
    if (gm) { head = gm[1].trim(); g = g || (/^(男|m|male)$/i.test(gm[2]) ? 'm' : 'f'); }
    return { name: head, cue, g };
}
// 标记在显示时换成什么：普通标记藏掉；写成动作描写的，还原成旁白
// [[环境:cafe]]：简单分析里正文模型标的场景环境声（不是说话人）
const ENV_BODY_RE = /^\s*(?:环境声?|场景|ambience|amb|scene)\s*[:：|｜/]\s*([a-z]+)\s*$/i;
// [[基调:亲密]]：简单分析里正文模型判断的这一楼情节
const TONE_BODY_RE = /^\s*(?:基调|情节|氛围|tone)\s*[:：|｜/]\s*([\u4e00-\u9fff]{2,3})\s*$/;
const ENV_MARK_RE = /\[\[\s*(?:(?:环境声?|场景|ambience|amb|scene)\s*[:：|｜/]\s*[a-z]+|(?:基调|情节|氛围|tone)\s*[:：|｜/]\s*[\u4e00-\u9fff]{2,3})\s*\]\][ \t]*/gi;
const ENV_KINDS = Object.keys(AMBIENCE_LABELS);
function envOfMark(body = '') {
    const m = String(body).match(ENV_BODY_RE);
    const k = m ? m[1].toLowerCase() : '';
    return ENV_KINDS.includes(k) ? k : (m ? 'none' : '');
}
function markDisplay(body = '') {
    if (ENV_BODY_RE.test(body) || TONE_BODY_RE.test(body)) return '';
    const { name, cue } = parseMarkBody(body);
    return isNarrCue(cue) ? narrFromMark(name, cue) : '';
}
const PROMPT_KEY = 'yzr_speaker_mark';
const SILENT_WAV = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reEsc = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 长对白按标点切为短片段，避免语音服务对长输入只返回前半段。
export function splitSpeech(text, max = 120) {
    const value = String(text || '').trim();
    if (!value) return [];
    const out = [];
    let rest = value;
    while (rest.length > max) {
        const window = rest.slice(0, max + 1);
        let at = -1;
        for (const re of [/[。！？!?；;\n]/g, /[，,、：:]/g, /\s/g]) {
            let m;
            while ((m = re.exec(window)) !== null) if (m.index >= Math.floor(max * .35)) at = Math.max(at, m.index + m[0].length);
            if (at > 0) break;
        }
        if (at < 1) at = max;
        out.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trimStart();
    }
    if (rest) out.push(rest);
    return out;
}

// “「」, 『』, ** **” → [['「','」'],['『','』'],['**','**']]
export function parsePairs(text = '') {
    const out = [];
    String(text || '').split(/[,，、\n]/).map(s => s.trim()).filter(Boolean).forEach(part => {
        let pair = null;
        if (/\s/.test(part)) {
            const bits = part.split(/\s+/).filter(Boolean);
            if (bits.length === 2) pair = bits;
        } else {
            const chars = Array.from(part);
            if (chars.length === 2) pair = chars;
            else if (chars.length >= 2 && chars.length % 2 === 0) pair = [chars.slice(0, chars.length / 2).join(''), chars.slice(chars.length / 2).join('')];
        }
        if (pair && pair[0] && pair[1]) out.push(pair);
    });
    return out;
}

function findRanges(text, pairs, maxLen = 1200) {
    const ranges = [];
    pairs.forEach(([open, close]) => {
        const body = open === close ? `[^${reEsc(open)}\\n]` : `[^\\n]`;
        const re = new RegExp(`${reEsc(open)}(${body}{1,${maxLen}}?)${reEsc(close)}`, 'g');
        let m;
        while ((m = re.exec(text)) !== null) {
            ranges.push({ start: m.index, end: m.index + m[0].length, innerStart: m.index + open.length, innerEnd: m.index + m[0].length - close.length });
        }
    });
    return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

function encodeWav(pcm, rate) {
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
        const x = Math.max(-1, Math.min(1, pcm[i]));
        v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
}

export class StoryVoice {
    constructor({ storage, ttsManager, phoneShell, voiceSource } = {}) {
        this.storage = storage;
        this.voiceSource = voiceSource || null; // 独立插件：角色音色库
        this.standalone = !!voiceSource;
        this.tts = ttsManager;
        this.phoneShell = phoneShell;
        this.cache = new Map();
        this.audio = new Audio();
        this.playing = null; // { btn, queue, stop }
        this._timers = new Map();
        this._installed = false;
        this.speakerOverrides = this._loadOverrides();
        this._genderOf = this._loadGenders();
        this._speakerMemo = new Map();
        this._cueMemo = new Map(); // 模型标的 [[名字]] 显示时会被藏掉，重新处理时靠这里记住
        this._deepJobs = new Map(); // 正在深度分析的楼层：hash → Promise
        this._deepErr = new Map();
    }

    // ---------- 深度分析 ----------
    _hash(text = '') {
        let h = 2166136261;
        const t = String(text);
        for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
        return (h >>> 0).toString(36) + t.length.toString(36);
    }

    // 分析结果只存在这台设备的浏览器本地（localStorage），不进酒馆设置、不进聊天记录；
    // 最多留最近 DEEP_MAX 楼，超过自动删最旧的
    _deepStore() {
        if (this._deepCache) return this._deepCache;
        let obj = {};
        try { const raw = localStorage.getItem(DEEP_LOCAL_KEY); obj = raw ? JSON.parse(raw) : {}; } catch (e) { obj = {}; }
        // 旧版本存在小手机设置里的：搬过来并从设置里删掉，免得酒馆设置文件变大
        try {
            const old = this.storage?.get?.(DEEP_KEY, null);
            if (old) {
                const o = typeof old === 'string' ? JSON.parse(old) : old;
                if (o && typeof o === 'object') obj = { ...o, ...obj };
                this.storage?.remove?.(DEEP_KEY);
                this._deepCache = obj;
                this._deepWrite();
            }
        } catch (e) { /* 忽略 */ }
        this._deepCache = obj && typeof obj === 'object' ? obj : {};
        return this._deepCache;
    }

    _deepWrite() {
        const store = this._deepCache || {};
        const keys = Object.keys(store);
        if (keys.length > DEEP_MAX) keys.sort((a, b) => (store[a].at || 0) - (store[b].at || 0)).slice(0, keys.length - DEEP_MAX).forEach(k => delete store[k]);
        try { localStorage.setItem(DEEP_LOCAL_KEY, JSON.stringify(store)); }
        catch (e) {
            // 浏览器本地空间满了：只留最近一半再试
            const ks = Object.keys(store).sort((a, b) => (store[b].at || 0) - (store[a].at || 0));
            ks.slice(Math.ceil(ks.length / 2)).forEach(k => delete store[k]);
            try { localStorage.setItem(DEEP_LOCAL_KEY, JSON.stringify(store)); } catch (e2) { /* 只留在内存里 */ }
        }
    }

    _deepSave(hash, entry) {
        const store = this._deepStore();
        store[hash] = entry;
        this._deepWrite();
    }

    clearDeepCache() {
        this._deepCache = {};
        try { localStorage.removeItem(DEEP_LOCAL_KEY); } catch (e) { /* 忽略 */ }
    }

    // 一楼正文（<content> 里、去掉 [[标记]]）的指纹：正文改了就重新分析
    _deepText(msg) {
        return this._rawToText(msg?.mes || '');
    }

    _deepHashOf(msg) {
        const t = this._deepText(msg).replace(MARK_RE, '').replace(/\s+/g, '');
        return t ? this._hash(t) : '';
    }

    // 这一楼存下的逐句演法（分析结果 + 手动改的），哪种模式都可能有
    _lineEntry(msg) {
        if (!msg) return null;
        const h = this._deepHashOf(msg);
        return h ? this._deepStore()[h] || null : null;
    }

    // 深度分析模式下、模型真正分析过的那份
    _deepEntry(msg) {
        if (this.getSettings().analysisMode !== 'deep' || !msg) return null;
        const e = this._lineEntry(msg);
        return e && !e.manualOnly ? e : null;
    }

    _deepPending(msg) {
        const h = msg ? this._deepHashOf(msg) : '';
        return !!h && this._deepJobs.has(h);
    }

    // 开始分析某一楼（已经分析过就直接用缓存；force = 重新分析）
    _startDeep(id, { force = false } = {}) {
        const s = this.getSettings();
        if (s.analysisMode !== 'deep' || !s.enabled) return Promise.resolve(null); // 简单分析、手动模式绝不调用分析模型
        const ctx = window.SillyTavern?.getContext?.();
        const msg = ctx?.chat?.[id];
        if (!msg || msg.is_system || (msg.is_user && !s.readUser)) return Promise.resolve(null);
        const hash = this._deepHashOf(msg);
        if (!hash) return Promise.resolve(null);
        if (!force && this._deepStore()[hash] && !this._deepStore()[hash].manualOnly) return Promise.resolve(this._deepStore()[hash]);
        if (this._deepJobs.has(hash)) return this._deepJobs.get(hash);
        const job = (async () => {
            await this._getWechatData().catch(() => null);
            const full = this._deepText(msg);
            const { lines } = this._analyze(full, { id, msg });
            if (!lines.length) return null;
            const items = lines.map((r, i) => ({ id: i + 1, start: r.start, text: r.text, r }));
            const clean = (t) => t.replace(MARK_RE, (all, body) => markDisplay(body));
            // 编号插进正文，再藏掉 [[标记]]（位置从后往前插不会乱）
            const story = clean(numberStory(full, items));
            const speakers = {};
            items.forEach(it => { if (it.r.marked && it.r.speaker) speakers[it.id] = it.r.speaker; });
            const roster = [...new Set([...s.speakers.map(x => x.name), ...this._wechatVoiceNames(), String(ctx?.name2 || '').trim(), String(ctx?.name1 || '').trim()].filter(Boolean))];
            const prev = (ctx?.chat || []).slice(Math.max(0, id - 3), id).filter(m => m && !m.is_system)
                .map(m => ({ n: m.name || '', t: clean(this._rawToText(m.mes || '')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() })).filter(x => x.t).map(x => `【${x.n}】\n${x.t}`).join('\n\n');
            // 每个人用的语音引擎不同（每人用自己的渠道时）：告诉模型按引擎能认的写法标
            let engines = null;
            try {
                const map = {};
                roster.forEach(n => { map[n] = this._speakerChannel(n).profile.kind; });
                map['*'] = this._speakerChannel('').profile.kind;
                if (Object.values(map).some(k => k !== 'inline')) engines = map;
            } catch (e) { engines = null; }
            const messages = buildDeepMessages({ story, lines: items, roster, userName: String(ctx?.name1 || '').trim(), previous: prev, speakers, engines });
            this._refreshDeepStatus(id);
            const raw = await this._callModel(messages, { timeout: (Number(s.deepTimeout) || 150) * 1000 });
            const parsed = parseDeep(raw, items);
            if (!parsed) throw new Error('模型没有按格式返回分析结果');
            const out = { at: Date.now(), tone: parsed.tone, arc: parsed.arc, ambience: parsed.ambience || 'none', lines: {} };
            // 分析之前就手动改过的句子（没点「重新分析」覆盖）保留用户的
            const before = this._deepStore()[hash];
            const keepEdited = before && before.manualOnly ? before.lines || {} : {};
            // 自己在 🎭 里选过的情节、环境声，重新分析也保留
            if (before?.ambienceSet) { out.ambience = before.ambience; out.ambienceSet = true; }
            if (before?.toneSet) { out.tone = before.tone; out.toneSet = true; }
            items.forEach(it => {
                if (keepEdited[it.text]?.edited) { out.lines[it.text] = keepEdited[it.text]; return; }
                const v = parsed.items.get(it.id);
                if (!v) return;
                const script = v.script ? applyToneGate(v.script, out.tone || parsed.tone) : '';
                out.lines[it.text] = { role: v.role, pace: v.pace, t: v.tension, s: script && script !== it.text ? script : '', why: v.reason, ...(v.amb ? { amb: v.amb } : {}) };
            });
            this._deepSave(hash, out);
            this._deepErr.delete(hash);
            return out;
        })();
        this._deepJobs.set(hash, job);
        job.catch(err => {
            console.warn('[正文朗读] 深度分析失败:', err);
            this._deepErr.set(hash, String(err?.message || err).slice(0, 120));
            this._toast('深度分析失败', `${String(err?.message || err).slice(0, 120)}（这一楼先按不分析读）`, 'error');
        }).finally(() => {
            this._deepJobs.delete(hash);
            this.processById(id);
            if (this.getSettings().deepAuto && this._deepStore()[hash]) setTimeout(() => this._prefetchAfterDeep(id).catch(() => null), 60);
        });
        return job;
    }

    _refreshDeepStatus(id) {
        const el = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
        if (!el || this._streaming) return;
        this.processById(id);
    }

    // 后台调用模型：选了连接配置就走那条，否则跟随酒馆当前的 API
    async _callModel(messages, { timeout = 150000, maxTokens = 6000 } = {}) {
        const ctx = window.SillyTavern?.getContext?.();
        const profile = String(this.getSettings().deepProfile || '');
        const sys = messages.find(m => m.role === 'system')?.content || '';
        const user = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n');
        const ctl = new AbortController();
        const run = (async () => {
            if (profile === '__custom__') return this._customChat(messages, { maxTokens, signal: ctl.signal });
            const svc = ctx?.ConnectionManagerRequestService;
            if (profile && svc?.sendRequest) {
                const res = await svc.sendRequest(profile, messages, maxTokens, { stream: false, extractData: true, includePreset: false, includeInstruct: false });
                return typeof res === 'string' ? res : (res?.content ?? res?.choices?.[0]?.message?.content ?? '');
            }
            if (typeof ctx?.generateRaw === 'function') {
                try { return await ctx.generateRaw({ systemPrompt: sys, prompt: user, responseLength: maxTokens }); }
                catch (e) { return await ctx.generateRaw(user, null, false, false, sys, maxTokens); }
            }
            if (typeof ctx?.generateQuietPrompt === 'function') return ctx.generateQuietPrompt(`${sys}\n\n${user}`, false, true);
            throw new Error('当前酒馆版本不支持后台调用模型');
        })();
        let timer;
        const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`分析超过 ${Math.round(timeout / 1000)} 秒没有完成`)), timeout); });
        try { return String(await Promise.race([run, limit]) || ''); } finally { clearTimeout(timer); ctl.abort(); }
    }

    // ---------- 自定义 API（OpenAI 兼容）----------
    // 填的地址可能是 https://xx.com、https://xx.com/v1、…/v1/chat/completions，统一成 …/v1 这种
    _apiBase(url = '') {
        let u = String(url || '').trim().replace(/\/+$/, '');
        u = u.replace(/\/(?:chat\/completions|completions|models)$/i, '').replace(/\/+$/, '');
        return u;
    }

    // 浏览器直连被跨域挡住时，改走酒馆自带的转发（config.yaml 里 enableCorsProxy: true）
    async _apiFetch(url, init = {}) {
        if (!this._apiViaProxy) {
            try { return await fetch(url, init); }
            catch (e) {
                if (init.signal?.aborted || e?.name === 'AbortError') throw e;
                if (!(e instanceof TypeError)) throw e;
            }
        }
        const ctx = window.SillyTavern?.getContext?.();
        let headers = { ...(init.headers || {}) };
        try { headers = { ...(ctx?.getRequestHeaders?.() || {}), ...headers }; } catch (e) { /* 忽略 */ }
        const res = await fetch(`/proxy/${url}`, { ...init, headers });
        if (res.status === 404 && !this._apiViaProxy) throw new Error('浏览器不能直接访问这个地址（跨域），酒馆转发也没开：在酒馆 config.yaml 里把 enableCorsProxy 改成 true 并重启，或换一个允许跨域的地址');
        this._apiViaProxy = true;
        return res;
    }

    // 语音渠道的模型列表
    async fetchTtsModels(channel) {
        const st = this.getSettings();
        const known = (TTS_CHANNELS.find(c => c.id === channel) || {}).models || [];
        if (channel === 'fish') {
            const res = await this._apiFetch('https://api.fish.audio/compat/v1/models', {});
            const json = await res.json().catch(() => null);
            const ids = (json?.data || []).map(m => String(m?.id || '').replace(/^fish-audio\//, '')).filter(Boolean);
            return ids.length ? ids : known;
        }
        let url = '', key = '';
        if (channel === 'custom_openai') { url = st.customUrl; key = st.customKey; }
        else if (channel === 'openai' || channel === 'nimo') {
            const c = this.tts?._resolveConfig?.({ provider: channel }) || {};
            url = c.apiUrl; key = c.apiKey;
        } else return known; // MiniMax、豆包、IndexTTS 没有模型列表接口，用常用的
        const base = String(url || '').replace(/\/+$/, '').replace(/\/(?:audio\/speech|chat\/completions|models)$/i, '');
        const { models } = await this.fetchModels(base, key);
        return models;
    }

    async fetchModels(url, key) {
        const base = this._apiBase(url);
        if (!/^https?:\/\//i.test(base)) throw new Error('请先填写以 http 开头的 API 地址');
        const headers = key ? { Authorization: `Bearer ${key}` } : {};
        const tryList = [base];
        if (!/\/v\d+[a-z]*$/i.test(base)) tryList.push(`${base}/v1`);
        let lastErr = null;
        for (const b of tryList) {
            try {
                const res = await this._apiFetch(`${b}/models`, { headers });
                const text = await res.text();
                if (!res.ok) { lastErr = new Error(`HTTP ${res.status}：${text.slice(0, 160)}`); continue; }
                let json = null;
                try { json = JSON.parse(text); } catch (e) { lastErr = new Error('返回的不是模型列表'); continue; }
                const list = (Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : Array.isArray(json) ? json : [])
                    .map(m => String(m?.id || m?.name || m || '').replace(/^models\//, '')).filter(Boolean);
                if (!list.length) { lastErr = new Error('没有拉到模型'); continue; }
                return { base: b, models: [...new Set(list)].sort() };
            } catch (e) { lastErr = e; }
        }
        throw lastErr || new Error('拉取失败');
    }

    async _customChat(messages, { maxTokens = 6000, signal } = {}) {
        const s = this.getSettings();
        const base = this._apiBase(s.deepApiUrl);
        if (!base) throw new Error('深度分析选了自定义 API，但还没填地址');
        if (!s.deepModel) throw new Error('深度分析选了自定义 API，但还没选模型');
        const res = await this._apiFetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(s.deepApiKey ? { Authorization: `Bearer ${s.deepApiKey}` } : {}) },
            signal,
            body: JSON.stringify({ model: s.deepModel, messages, temperature: 0.6, max_tokens: maxTokens, stream: false })
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`自定义 API HTTP ${res.status}：${text.slice(0, 160)}`);
        let json = null;
        try { json = JSON.parse(text); } catch (e) { throw new Error('自定义 API 返回的不是 JSON'); }
        const msg = json?.choices?.[0]?.message;
        const out = msg?.content ?? json?.choices?.[0]?.text ?? json?.content?.[0]?.text ?? '';
        if (!String(out || '').trim()) throw new Error(`自定义 API 没有返回内容${json?.choices?.[0]?.finish_reason ? `（${json.choices[0].finish_reason}）` : ''}`);
        return Array.isArray(out) ? out.map(x => x?.text || '').join('') : String(out);
    }

    // 连接管理器里存的连接配置（深度分析可以单独选一条便宜/快的模型）
    connectionProfiles() {
        const ctx = window.SillyTavern?.getContext?.();
        const list = ctx?.extensionSettings?.connectionManager?.profiles;
        return Array.isArray(list) ? list.filter(p => p?.id).map(p => ({ id: String(p.id), name: String(p.name || p.id) })) : [];
    }

    // 一句台词的深度分析结果（给按钮和合成用）
    // 这一楼的情节（基调）：自己在 🎭 里选的 > 深度分析 > 正文模型标的 [[基调:xx]]
    _floorTone(msg) {
        const entry = this._lineEntry(msg);
        if (entry?.toneSet && entry.tone) return entry.tone;
        if (entry && !entry.manualOnly && entry.tone && this.getSettings().analysisMode === 'deep') return entry.tone;
        try {
            if (msg?.mes && /\[\[\s*(?:基调|情节|氛围|tone)/.test(String(msg.mes))) {
                const m = String(msg.mes).match(/\[\[\s*(?:基调|情节|氛围|tone)\s*[:：|｜/]\s*([\u4e00-\u9fff]{2,3})\s*\]\]/);
                if (m && STORY_TONES.includes(m[1])) return m[1];
            }
        } catch (e) { /* 忽略 */ }
        return '';
    }

    // 这一楼每句台词所处的环境声：从楼层开头的开始，遇到「从这句起换」的句子就换
    _floorAmbience(mid) {
        const msg = window.SillyTavern?.getContext?.()?.chat?.[mid];
        const entry = this._lineEntry(msg);
        const map = new Map();
        const bars = Array.from(document.querySelectorAll(`#chat .mes[mesid="${mid}"] .mes_text .yzsv-bar`));
        // 正文里模型标的 [[环境:xx]]（简单分析）：每句取它前面最近的那个
        const rawAt = new Map();
        try {
            if (msg?.mes && /\[\[\s*(?:环境|场景|amb|scene)/i.test(String(msg.mes))) {
                const { lines, envs } = this._analyze(this._rawToText(msg.mes), { id: mid, msg, useMemo: false });
                lines.forEach(r => {
                    let k = '';
                    (envs || []).forEach(e => { if (e.start < r.start) k = e.kind; });
                    if (k) rawAt.set(r.text, k);
                });
            }
        } catch (e) { /* 忽略 */ }
        const deep = !!entry && this.getSettings().analysisMode === 'deep' && !entry.manualOnly;
        // 优先级：自己在 🎭 里选的 > 深度分析 > 正文标记
        let cur = (entry && (deep || entry.ambienceSet) && entry.ambience) || '';
        bars.forEach((b, i) => {
            const v = entry?.lines?.[b.dataset.text];
            if (v?.amb && (deep || v.edited || v.ambSet)) cur = v.amb;
            else if (!deep && rawAt.has(b.dataset.text) && !(i === 0 && entry?.ambienceSet)) cur = rawAt.get(b.dataset.text);
            map.set(String(b.dataset.line), cur || 'none');
        });
        return map;
    }

    _deepFor(entry, text) {
        const v = entry?.lines?.[text];
        if (!v) return null;
        return { s: v.s || '', p: v.pace || 'normal', t: Number(v.t) || 0, tone: entry.tone || '', role: v.role || '', why: v.why || '', amb: v.amb || '' };
    }

    // ---------- 设置 ----------
    getSettings() {
        let raw = null;
        try { raw = this.storage?.get?.(STORE_KEY, false); } catch (e) { raw = null; }
        let obj = {};
        try { obj = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}; } catch (e) { obj = {}; }
        // 本机备份：酒馆设置还没存到服务器就刷新、或者被别的页面用旧设置覆盖时，以本机最新改的为准
        try {
            const bak = JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY) || 'null');
            if (bak && typeof bak === 'object' && Number(bak._at || 0) > Number(obj?._at || 0)) obj = bak;
        } catch (e) { /* 忽略 */ }
        const s = { ...DEFAULTS, ...(obj && typeof obj === 'object' ? obj : {}) };
        if (!['simple', 'deep', 'manual'].includes(s.analysisMode)) s.analysisMode = 'simple'; // 旧版的 none = 简单分析
        s.nsfw = !!s.nsfw;
        s.ttsProvider = String(s.ttsProvider || '').trim() || (this.standalone ? 'fish' : '');
        s.ttsModels = s.ttsModels && typeof s.ttsModels === 'object' ? s.ttsModels : {};
        s.markSpeaker = true;                          // 说话人标记一直要（认人靠它）
        s.emotionCue = s.analysisMode === 'simple';    // 语气只有简单分析需要正文模型写
        s.lineEdit = s.lineEdit !== false;
        s.channelMode = s.channelMode === 'unified' ? 'unified' : 'per';
        s.readUser = false;
        s.deepPresets = Array.isArray(s.deepPresets) ? s.deepPresets.filter(x => x && x.id) : [];
        s.customModels = Array.isArray(s.customModels) ? s.customModels.map(String).filter(Boolean).slice(0, 300) : [];
        s.deepModels = Array.isArray(s.deepModels) ? s.deepModels.map(String).filter(Boolean).slice(0, 500) : [];
        s.speakers = Array.isArray(s.speakers) ? s.speakers.filter(x => x && typeof x === 'object').map(x => ({ name: String(x.name || '').trim(), voice: String(x.voice || '').trim() })) : [];
        return s;
    }

    saveSettings(patch = {}) {
        const next = { ...this.getSettings(), ...patch, _at: Date.now() };
        const json = JSON.stringify(next);
        try { this.storage?.set?.(STORE_KEY, json); } catch (e) { /* 忽略 */ }
        try { localStorage.setItem(LOCAL_SETTINGS_KEY, json); } catch (e) { /* 忽略 */ }
        this.updatePrompt();
        this.refreshAll();
        return next;
    }

    _loadGenders() {
        try { return JSON.parse(this.storage?.get?.('phone-story-voice-genders', false) || '{}') || {}; }
        catch (_) { return {}; }
    }

    _setGender(name, g) {
        const n = String(name || '').trim();
        if (!n || !['m', 'f'].includes(g)) return;
        if (this._genderOf[n] === g) return;
        this._genderOf[n] = g;
        const keys = Object.keys(this._genderOf);
        if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(k => delete this._genderOf[k]);
        try { this.storage?.set?.('phone-story-voice-genders', JSON.stringify(this._genderOf)); } catch (e) { /* 忽略 */ }
    }

    // 说话人是男是女：模型标的 [[名字/男]] → 微信联系人的性别 → 不知道
    _genderFor(speaker = '') {
        const n = String(speaker || '').trim();
        if (!n) return '';
        if (this._genderOf[n]) return this._genderOf[n];
        const data = this._wx();
        try {
            const list = data?.getContacts?.() || [];
            const near = (a) => a && (a === n || (a.length >= 2 && n.length >= 2 && (a.includes(n) || n.includes(a))));
            const c = list.find(x => [x.realName, x.name, ...this._splitAliases(x.voiceAliases)].some(a => String(a || '').trim() === n))
                || list.find(x => [x.realName, x.name, ...this._splitAliases(x.voiceAliases)].some(a => near(String(a || '').trim())));
            const g = c ? String(data.getContactGender?.(c.id) || c.gender || '') : '';
            if (g === 'male') return 'm';
            if (g === 'female') return 'f';
        } catch (e) { /* 忽略 */ }
        return '';
    }

    _loadOverrides() {
        try { return JSON.parse(this.storage?.get?.('phone-story-voice-overrides', false) || '{}') || {}; }
        catch (_) { return {}; }
    }

    _overrideKey(id, line, text) {
        const chatId = String(window.SillyTavern?.getContext?.()?.chatId || 'current');
        return `${chatId}:${id}:${line}:${text.slice(0, 40)}`;
    }

    _chooseSpeaker(bar) {
        const speakers = this.getSettings().speakers.filter(x => x.name && x.voice);
        if (!speakers.length) { this._toast('未配置音色', '请先在朗读 App 配置角色名称和音色 ID'); return; }
        const options = speakers.map((x, i) => `${i + 1}. ${x.name}`).join('\n');
        const choice = window.prompt(`这句台词由谁来说？\n${options}\n输入序号，保存后点击 ↻ 重生成：`, '1');
        if (choice === null) return;
        const chosen = speakers[Number(choice.trim()) - 1];
        if (!chosen) { this._toast('选择无效', '请输入列表中的序号'); return; }
        this.stop();
        bar.dataset.speaker = chosen.name;
        bar.dataset.manualSpeaker = '1';
        const label = bar.querySelector('.yzsv-speaker');
        if (label) { label.textContent = `👤${chosen.name}`; label.title = `手动指定：${chosen.name}（点击修改）`; }
        const key = this._overrideKey(bar.dataset.mesid, bar.dataset.line, bar.dataset.text);
        this.speakerOverrides[key] = chosen.name;
        const keys = Object.keys(this.speakerOverrides);
        if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(k => delete this.speakerOverrides[k]);
        this.storage?.set?.('phone-story-voice-overrides', JSON.stringify(this.speakerOverrides));
        this.playBars([bar], { regen: true });
    }

    // 台词正前方的「名字 [02:22]：」「名字：」「名字说：」
    _labelBefore(full, start) {
        const before = full.slice(Math.max(0, start - 60), start);
        const m = before.match(/(?:^|[\n。！？!?」』”）)\]])\s*([^\s\n:：「」『』“”（）()\[\]【】，,。！？!?…~～、]{1,12}?)\s*(?:[\[［(（【]\s*\d{1,2}[:：]\d{2}(?:[:：]\d{2})?\s*[\]］)）】])?\s*(?:说道|说|问道|问|道|喊道|喊)?\s*[:：]\s*$/);
        if (!m) return '';
        const name = m[1].trim();
        if (!name || /^(?:他|她|我|你|它|对方|旁白)$/.test(name)) return '';
        if (!this._canonicalName(name) && /^(?:他|她|我|你|它|那|这|对方)/.test(name)) return '';
        // 「硝子推门进来：」这种是旁白里的动作，不是名字标签：取开头认得的名字，认不出就不算
        if (!this._canonicalName(name)) {
            const known = [...this.getSettings().speakers.map(x => x.name), ...this._wechatVoiceAliases()].filter(Boolean)
                .flatMap(n => [n, n.replace(/^家入|^五条|^夏油/, '')]).filter(n => n.length >= 2 && name.startsWith(n)).sort((a, b) => b.length - a.length)[0];
            if (known && known !== name) return this._canonicalName(known) || known;
            if (name.length > 4 && /进|来|着|了|起|推|走|看|笑|开口|抬|转|回/.test(name)) return '';
        }
        return name;
    }

    // 「硝子」「家入」「家入硝子」都对到登记的同一个角色
    _canonicalName(name = '') {
        const n = String(name || '').trim();
        if (!n) return '';
        const hit = this._findAppSpeaker(n);
        if (hit) return hit.name;
        const wx = this._findWechatVoice(n);
        return wx ? wx.primary : '';
    }

    _saveOverride(bar, name) {
        const key = this._overrideKey(bar.dataset.mesid, bar.dataset.line, bar.dataset.text);
        if (name) this.speakerOverrides[key] = name; else delete this.speakerOverrides[key];
        const keys = Object.keys(this.speakerOverrides);
        if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(k => delete this.speakerOverrides[k]);
        try { this.storage?.set?.('phone-story-voice-overrides', JSON.stringify(this.speakerOverrides)); } catch (e) { /* 忽略 */ }
        bar.dataset.speaker = name || bar.dataset.speaker;
        bar.querySelector('.yzsv-play')?.setAttribute('title', `播放（${bar.dataset.speaker || '默认音色'}）`);
    }

    // ↻：先让 AI 快速判断这句是谁说的，再按那个人的音色重新生成
    // ↻：按现在定好的说话人直接重新生成（不再让 AI 判断），生成好自动播放；
    // 长按 ↻ 可以自己选这句是谁说的
    async _regen(bar, btn, speaker = '') {
        if (bar._regenJob) return;
        this.stop();
        if (speaker && speaker !== bar.dataset.speaker) this._saveOverride(bar, speaker);
        btn?.classList.add('is-busy');
        bar.classList.add('is-loading');
        let analyzed = false;
        if (this.getSettings().analysisMode === 'deep' && !bar.dataset.deep) {
            const mid = Number(bar.dataset.mesid);
            const line = bar.dataset.line;
            const msg = window.SillyTavern?.getContext?.()?.chat?.[mid];
            if (msg && !this._deepEntry(msg)) {
                this._toast('正在分析情绪', '分析好、语音生成好会提示你');
                await this._startDeep(mid).catch(() => null);
                analyzed = true;
                const fresh = document.querySelector(`#chat .mes[mesid="${mid}"] .mes_text .yzsv-bar[data-line="${line}"]`);
                if (fresh && fresh !== bar) {
                    bar.classList.remove('is-loading');
                    btn?.classList.remove('is-busy');
                    bar = fresh;
                    btn = fresh.querySelector('.yzsv-regen');
                    btn?.classList.add('is-busy');
                    bar.classList.add('is-loading');
                }
            }
        }
        // 显示「重新生成中 Ns」，生成完才播（播的就是刚生成的这份）
        bar.classList.add('is-regen');
        bar.querySelector('.yzsv-regen-tip')?.remove();
        const tip = document.createElement('span');
        tip.className = 'yzsv-regen-tip';
        bar.appendChild(tip);
        const t0 = Date.now();
        const showTip = () => { tip.textContent = `重新生成中 ${Math.floor((Date.now() - t0) / 1000)}s`; };
        showTip();
        const ticker = setInterval(showTip, 500);
        const job = (async () => {
            const { vi, parts } = this._lineJob(await this._voiceFor(bar.dataset.speaker || ''), bar.dataset.text, bar.dataset.cue || '', this._barDeep(bar));
            const urls = await Promise.all(parts.map(part => this._synthRetry(part, vi, { regen: true })));
            return this._joinAudio(urls);
        })();
        bar._regenJob = job;
        let urls = null;
        try {
            urls = await job;
        } catch (err) {
            clearInterval(ticker);
            tip.textContent = '重新生成失败';
            setTimeout(() => tip.remove(), 2500);
            this._toast('重新生成失败', `${String(err?.message || err).slice(0, 120)}（原来的语音没有动）`, 'error');
            return;
        } finally {
            bar._regenJob = null;
            btn?.classList.remove('is-busy');
            bar.classList.remove('is-loading', 'is-regen');
            clearInterval(ticker);
        }
        tip.textContent = `已重新生成（${Math.max(1, Math.round((Date.now() - t0) / 1000))}s）`;
        setTimeout(() => tip.remove(), 2500);
        if (analyzed) this._toast('语音好了 🎧', '深度分析完毕，已按分析的情绪生成，开始播放', 'success');
        this.playBars([bar], { trigger: bar.querySelector('.yzsv-play'), prepared: { [String(bar.dataset.line)]: urls } });
    }

    // 长按 ↻：选说话人
    _openSpeakerPicker(bar, btn) {
        document.querySelectorAll('.yzsv-pop').forEach(n => n.remove());
        const names = [...new Set([...this.getSettings().speakers.filter(x => x.voice).map(x => x.name), ...this._wechatVoiceNames()].filter(Boolean))];
        const cur = bar.dataset.speaker || '';
        const pop = document.createElement('div');
        pop.className = 'yzsv-pop';
        pop.innerHTML = `
            <div class="yzsv-pop-title">这句是谁说的？<span>现在：${esc(cur || '未识别')}</span></div>
            ${names.length ? `<div class="yzsv-pop-names" style="margin-top:0">${names.map(n => `<button type="button" data-name="${esc(n)}" class="${n === cur ? 'is-on' : ''}">${esc(n)}</button>`).join('')}</div>` : '<div class="yzsv-pop-empty" style="margin-top:0">还没有填过音色的人：在微信私聊的「聊天设置 → 专属音色」里填音色ID</div>'}
            ${this.getSettings().npcMode === 'npc' ? `<div class="yzsv-pop-names"><button type="button" data-gender="m">按男声 NPC 读</button><button type="button" data-gender="f">按女声 NPC 读</button></div>` : ''}
            <div class="yzsv-pop-empty">选好后会按这个人的音色重新生成并播放</div>
            <div class="yzsv-pop-names"><button type="button" data-edit="1">🎭 调这句的演法</button><button type="button" data-fav="1">${this._isFav(bar.dataset.speaker || '', bar.dataset.text || '') ? '☆ 取消收藏' : '⭐ 收藏这句语音'}</button></div>`;
        document.body.appendChild(pop);
        const r = btn.getBoundingClientRect();
        const w = Math.min(280, window.innerWidth - 16);
        pop.style.width = `${w}px`;
        pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
        const below = r.bottom + 8;
        pop.style.top = `${below + pop.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - pop.offsetHeight - 8) : below}px`;
        const close = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); };
        const outside = (e) => { if (!pop.contains(e.target)) close(); };
        setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
        pop.addEventListener('click', (e) => {
            if (e.target.closest('button[data-fav]')) {
                e.stopPropagation();
                close();
                this.favoriteBar(bar);
                return;
            }
            if (e.target.closest('button[data-edit]')) {
                e.stopPropagation();
                close();
                openDeepEditor(this, Number(bar.dataset.mesid), bar.dataset.line, { single: true });
                return;
            }
            const gb = e.target.closest('button[data-gender]');
            if (gb) {
                e.stopPropagation();
                close();
                this._setGender(bar.dataset.speaker || '', gb.dataset.gender);
                this._unlockAudio();
                this._regen(bar, btn);
                return;
            }
            const b = e.target.closest('button[data-name]');
            if (!b) return;
            e.stopPropagation();
            close();
            this._unlockAudio();
            this._regen(bar, btn, b.dataset.name);
        });
    }

    async _askSpeaker(bar) {
        const ctx = window.SillyTavern?.getContext?.();
        const context = this._lineContext?.get(`${bar.dataset.mesid}:${bar.dataset.line}`) || `【${bar.dataset.text}】`;
        const names = [...new Set([...this.getSettings().speakers.filter(x => x.voice).map(x => x.name), ...this._wechatVoiceNames()].filter(Boolean))];
        const prompt = `【】里这句话是谁说的？只回答名字。${names.length ? `从中选：${names.join('、')}` : ''}\n${context}`;
        let out = '';
        if (typeof ctx?.generateRaw === 'function') {
            try { out = await ctx.generateRaw({ prompt, responseLength: 12 }); }
            catch (e) { out = await ctx.generateRaw(prompt, null, false, false, '', 12); }
        } else if (typeof ctx?.generateQuietPrompt === 'function') {
            out = await ctx.generateQuietPrompt(prompt, false, true);
        } else {
            throw new Error('当前酒馆版本不支持后台调用模型');
        }
        const text = String(out || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim().split(/\n/)[0].replace(/[「」『』“”"'【】\[\]：:。.!！\s]/g, '');
        if (!text) return '';
        return this._canonicalName(text) || names.find(n => text.includes(n)) || text.slice(0, 12);
    }

    // ---------- 酒馆挂钩 ----------
    install() {
        if (this._installed) return;
        this._installed = true;
        this._injectStyle();
        // 先把微信联系人（音色ID）读进来，再挂按钮：只有对得上音色的台词才显示按钮
        this._getWechatData().catch(() => null).then(() => setTimeout(() => this.refreshAll(), 50));
        this._loadFavKeys();
        const ctx = window.SillyTavern?.getContext?.();
        const es = ctx?.eventSource;
        const ev = ctx?.event_types || ctx?.eventTypes || {};
        const later = (id, delay = 120) => {
            const key = String(id);
            clearTimeout(this._timers.get(key));
            this._timers.set(key, setTimeout(() => { this._timers.delete(key); this.processById(id); }, delay));
        };
        if (es?.on) {
            ['CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED'].forEach(name => {
                if (ev[name]) es.on(ev[name], (id) => later(id, name === 'MESSAGE_EDITED' ? 300 : 120));
            });
            if (ev.CHAT_CHANGED) es.on(ev.CHAT_CHANGED, () => { this.stop(); this._wxDirty = true; this._getWechatData().catch(() => null).then(() => { this.updatePrompt(); setTimeout(() => this.refreshAll(), 400); }); });
            if (ev.MESSAGE_DELETED) es.on(ev.MESSAGE_DELETED, () => this.stop());
            if (ev.STREAM_TOKEN_RECEIVED) es.on(ev.STREAM_TOKEN_RECEIVED, () => this._onStreamToken());
            ['GENERATION_STOPPED', 'CHARACTER_MESSAGE_RENDERED', 'CHAT_CHANGED'].forEach(name => { if (ev[name]) es.on(ev[name], () => { this._streaming = false; }); });
            if (ev.GENERATION_ENDED) es.on(ev.GENERATION_ENDED, () => {
                this._streaming = false;
                const chat = window.SillyTavern?.getContext?.()?.chat || [];
                const id = chat.length - 1;
                setTimeout(() => {
                    this.processById(id);
                    const s = this.getSettings();
                    const msg = chat[id];
                    if (s.enabled && msg && !msg.is_system) {
                        if (s.analysisMode !== 'deep') this._prefetchMessage(id);
                        else if (s.deepAuto) this._startDeep(id);
                    }
                }, 250);
            });
        }
        // 往上加载更早的消息时，新出现的楼层也挂上按钮
        const chatEl = document.getElementById('chat');
        if (chatEl && window.MutationObserver) {
            const obs = new MutationObserver((list) => {
                list.forEach(m => m.addedNodes.forEach(n => {
                    if (n.nodeType === 1 && n.classList?.contains('mes')) later(n.getAttribute('mesid'), 200);
                }));
            });
            obs.observe(chatEl, { childList: true });
        }
        setTimeout(() => { this.updatePrompt(); this.refreshAll(); }, 600);
    }

    refreshAll() {
        document.querySelectorAll('#chat .mes[mesid]').forEach(el => this.processElement(el));
    }

    // 微信里改了音色ID：重新判断哪些台词能显示按钮
    onVoicesChanged() {
        clearTimeout(this._voiceRefreshTimer);
        this._wxDirty = true;
        this._voiceRefreshTimer = setTimeout(() => {
            if (this.playing) this.stop();
            this.refreshAll();
        }, 200);
    }

    // 这个说话人有没有能用的音色（「朗读」App 登记的，或微信里填过音色）
    _hasVoice(speaker = '') {
        if (this._findAppSpeaker(speaker) || this._findWechatVoice(speaker)) return true;
        // 选了「没配音色的用默认 NPC 音色」：谁说的都能读
        return this.getSettings().npcMode === 'npc' && !!String(speaker || '').trim();
    }

    processById(id) {
        const el = document.querySelector(`#chat .mes[mesid="${CSS.escape ? CSS.escape(String(id)) : id}"]`);
        if (el) this.processElement(el);
    }

    _clear(box) {
        box.querySelectorAll('.yzsv-bar, .yzsv-all').forEach(n => n.remove());
    }

    // 从一段正文文字里找出台词和说话人（显示的正文、生成中的原文都用它）
    _analyze(full, { id = -1, msg = null, useMemo = true, hints = null, cueHints = null } = {}) {
        const s = this.getSettings();
        // 模型标的说话人 [[角色名]]：记下来，显示时藏掉
        const marks = [];
        const envs = [];
        const tones = [];
        for (const m of full.matchAll(MARK_RE)) {
            // [[环境:rain]]：场景环境声，不是说话人，藏掉就行
            const toneM = String(m[1]).match(TONE_BODY_RE);
            if (toneM) {
                tones.push({ start: m.index, tone: toneM[1] });
                marks.push({ start: m.index, end: m.index + m[0].length, name: '', cue: '', show: '', env: true });
                continue;
            }
            const env = envOfMark(m[1]);
            if (env) {
                envs.push({ start: m.index, kind: env });
                marks.push({ start: m.index, end: m.index + m[0].length, name: '', cue: '', show: '', env: true });
                continue;
            }
            // [[名字/男]]、[[名字|女]]、[[名字（男）]] 都认：名字 + 性别
            // 也认 [[名字/女|语气]]、[[名字|语气]]：竖线后面是这句话的情绪语气
            const { name, cue: rawCue, g } = parseMarkBody(m[1]);
            if (g && useMemo) this._setGender(name, g);
            // 写成动作描写的提示：显示时还原成旁白；念的时候只取里面的情绪（换成核心情绪词）
            const narr = isNarrCue(rawCue);
            const cue = narr ? (this._cueToS1(rawCue) || '') : rawCue.slice(0, 40);
            marks.push({ start: m.index, end: m.index + m[0].length, name, cue, show: narr ? narrFromMark(name, rawCue) : '' });
        }

        const skips = findRanges(full, parsePairs(s.skips), 3000);
        const inSkip = (a, b) => skips.some(r => a >= r.start && b <= r.end);
        let lines = findRanges(full, parsePairs(s.quotes), 10000).filter(r => !inSkip(r.start, r.end));
        // 去掉互相重叠的（保留先出现、更长的）
        const kept = [];
        lines.forEach(r => { if (!kept.some(k => r.start < k.end && r.end > k.start)) kept.push(r); });
        lines = kept.map(r => {
            // 台词里夹的跳过符号内容（比如括号里的译文）不读
            let text = full.slice(r.innerStart, r.innerEnd);
            skips.filter(k => k.start >= r.innerStart && k.end <= r.innerEnd).sort((a, b) => b.start - a.start).forEach(k => {
                text = text.slice(0, k.start - r.innerStart) + text.slice(k.end - r.innerStart);
            });
            text = text.replace(/\s+/g, ' ').trim();
            return { ...r, text };
        }).filter(r => /[\p{L}\p{N}]/u.test(r.text))
            // 引号里其实是招牌、标题、名字（“B1F 食品フロア”图标、写着“营业中”），不是有人在说话
            .filter(r => {
                if (r.text.length > 30) return true;
                const before = full.slice(Math.max(0, r.start - 8), r.start);
                const after = full.slice(r.end, r.end + 8);
                if (/(?:的|叫|叫做|名叫|写着|写有|印着|标着|画着|上书|题着|名为|名字是|标题是)\s*$/.test(before)) return false;
                if (/^\s*(?:图标|字样|标志|招牌|标牌|牌子|指示牌|几个字|二字|三个字|四个字|这几个字|这行字|的招牌|的牌子|标签)/.test(after)) return false;
                return true;
            });
        if (!lines.length) return { marks, lines, envs, tones };

        const defaultSpeaker = String(msg?.name || '').trim();
        const speakerNames = [...new Set([...s.speakers.filter(x => x.voice).map(x => x.name), ...this._wechatVoiceAliases()].filter(Boolean))];
        let prevEnd = 0;
        // 这条消息的“角色名”如果是角色卡名（比如「xx模拟器」）、自己又没配音色，就不拿它当说话人，
        // 没标说话人的台词改为沿用上一句认出来的人
        const defaultIsPerson = !!defaultSpeaker && (!!this._findAppSpeaker(defaultSpeaker) || !!this._findWechatVoice(defaultSpeaker));
        let lastSpeaker = '';
        lines.forEach((r, i) => {
            r.index = i;
            // 0) 台词正前方写着「名字 [时间]：」「名字：」这种标签（群聊记录、对话体），最可靠
            const label = this._labelBefore(full, r.start);
            if (label) {
                r.speaker = this._canonicalName(label) || label;
                r.marked = true;
                prevEnd = r.end; lastSpeaker = r.speaker;
                return;
            }
            // 1) 模型标的 [[角色名]]（紧挨在台词前面）
            const mark = marks.find(mk => !mk.env && mk.end <= r.start && !/\S/.test(full.slice(mk.end, r.start).replace(ENV_MARK_RE, '')) && full.slice(mk.end, r.start).replace(ENV_MARK_RE, '').length <= 2);
            if (mark) {
                r.speaker = this._canonicalName(mark.name) || mark.name;
                r.cue = mark.cue || '';
                r.marked = true;
                if (useMemo) this._speakerMemo.set(`${id}:${i}:${r.text}`, r.speaker);
                if (useMemo && r.cue) this._cueMemo.set(`${id}:${i}:${r.text}`, r.cue);
                if (this._speakerMemo.size > 2000) this._speakerMemo.delete(this._speakerMemo.keys().next().value);
                prevEnd = r.end; lastSpeaker = r.speaker;
                return;
            }
            // 1.5) 之前处理时模型标过（标记已经藏掉了），或者聊天记录原文里标过
            const memo = this._speakerMemo.get(`${id}:${i}:${r.text}`) || hints?.get(r.text);
            if (memo) {
                r.speaker = memo;
                r.cue = this._cueMemo.get(`${id}:${i}:${r.text}`) || cueHints?.get(r.text) || '';
                r.marked = true;
                prevEnd = r.end; lastSpeaker = r.speaker;
                return;
            }
            // 2) 没标：这句台词前面最近出现的已登记角色名，再没有就用这条消息的角色
            const before = full.slice(Math.max(prevEnd, r.start - 120), r.start);
            let speaker = '';
            let best = -1;
            speakerNames.forEach(name => {
                const at = before.lastIndexOf(name);
                if (at > best) { best = at; speaker = name; }
            });
            // 识别引号后面的“硝子说/硝子问”等归属说明，避免整条五条消息全部按五条配音。
            {
                const after = full.slice(r.end, Math.min(full.length, r.end + 90));
                const candidate = speakerNames.find(name => {
                    const aliases = [name, name.replace(/^家入/, ''), name.replace(/^五条/, '')].filter(x => x.length >= 2);
                    return aliases.some(alias => new RegExp(`^\\s*[,，。！？!?]*\\s*${reEsc(alias)}(?:\\s*|[，,])(?:说|问|答|道|喊|笑|叹|低声|轻声|开口|接话)`).test(after));
                });
                if (candidate) speaker = candidate;
            }
            r.speaker = (speaker && (this._canonicalName(speaker) || speaker))
                || (!defaultIsPerson && lastSpeaker && r.start - prevEnd < 600 ? lastSpeaker : defaultSpeaker);
            if (speaker) lastSpeaker = r.speaker;
            prevEnd = r.end;
        });
        return { marks, lines, envs, tones };
    }

    processElement(mesEl, { live = false } = {}) {
        const box = mesEl?.querySelector?.('.mes_text');
        if (!box) return;
        this._clear(box);
        const s = this.getSettings();
        if (!s.enabled) return;
        if (box.querySelector('textarea')) return; // 正在编辑
        const id = Number(mesEl.getAttribute('mesid'));
        const msg = window.SillyTavern?.getContext?.()?.chat?.[id];
        if (msg?.is_system) return;
        if (msg?.is_user && !s.readUser) return;

        // 收集正文文字节点（跳过代码、按钮、其他插件的控件）
        const nodes = [];
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => {
                const p = n.parentElement;
                if (!p || p.closest('script,style,code,pre,button,textarea,iframe,select,.yzsv-bar,.yzsv-all')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let full = '';
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const block = n.parentElement.closest('p,div,li,blockquote,h1,h2,h3,h4,h5,h6,td') || box;
            if (nodes.length && nodes[nodes.length - 1].block !== block) full += '\n';
            nodes.push({ node: n, start: full.length, block });
            full += n.nodeValue;
        }
        if (!full.trim()) return;

        // 聊天记录原文里的 [[名字]] 一直都在，显示的正文里就算被藏掉了也能照着认
        let hints = null;
        let cueHints = null;
        if (msg?.mes && String(msg.mes).includes('[[')) {
            hints = new Map();
            try {
                cueHints = new Map();
                this._analyze(this._rawToText(msg.mes), { id, msg, useMemo: false }).lines.forEach(r => {
                    if (r.marked && !hints.has(r.text)) hints.set(r.text, r.speaker);
                    if (r.cue && !cueHints.has(r.text)) cueHints.set(r.text, r.cue);
                });
            } catch (e) { hints = null; }
        }
        const { marks, lines: found } = this._analyze(full, { id, msg, hints, cueHints });
        let lines = found;
        // 深度分析：说话人没标出来时用分析结果；每句挂上分析出的演法
        const deepOn = s.analysisMode === 'deep' && !live;
        const deepEntry = deepOn ? this._deepEntry(msg) : null;
        // 深度分析模式用整份分析；简单 / 手动模式只用你手动改过的句子
        const lineEntry = live ? null : (deepEntry || this._lineEntry(msg));
        if (lineEntry) lines.forEach(r => {
            const d = this._deepFor(lineEntry, r.text);
            if (!d) return;
            if (!deepEntry && !lineEntry.lines?.[r.text]?.edited) return;
            r.deep = d;
            const known = (n) => !!(this._findAppSpeaker(n) || this._findWechatVoice(n));
            if (d.role && (!r.marked || (!known(r.speaker) && known(d.role)))) r.speaker = this._canonicalName(d.role) || d.role;
        });
        if (!lines.length) { [...marks].reverse().forEach(mk => this._deleteText(nodes, mk.start, mk.end, mk.show)); return; }
        // 情节不是「亲密」：简单分析写的呻吟类语气不用
        const floorTone = live ? '' : this._floorTone(msg);
        if (!live && s.analysisMode === 'simple') lines.forEach(r => { if (r.cue) r.cue = gateCue(r.cue, floorTone); });

        // 记下每句的上下文，↻ 时可以让 AI 重新判断
        this._lineContext = this._lineContext || new Map();
        // 只给对得上音色的台词挂按钮（说话人在微信里没填音色ID就不显示）
        lines = lines.filter(r => this._hasVoice(this.speakerOverrides[this._overrideKey(id, r.index, r.text)] || r.speaker));
        // 还在生成中：只给语音已经准备好的台词挂按钮
        if (live) lines = lines.filter(r => this._ready?.has(this._readyKey(this.speakerOverrides[this._overrideKey(id, r.index, r.text)] || r.speaker, r.text)));

        // 从后往前改（插按钮、藏标记），前面的位置不会被打乱
        const ops = [
            ...lines.map(r => ({ at: r.end, kind: 'bar', r })),
            ...marks.map(mk => ({ at: mk.start, kind: 'mark', mk }))
        ].sort((a, b) => b.at - a.at);
        ops.forEach(op => {
            if (op.kind === 'mark') { this._deleteText(nodes, op.mk.start, op.mk.end, op.mk.show); return; }
            const r = op.r;
            const entry = [...nodes].reverse().find(x => x.start <= r.end - 1);
            if (!entry) return;
            const offset = Math.min(entry.node.nodeValue.length, r.end - entry.start);
            const bar = document.createElement('span');
            bar.className = 'yzsv-bar';
            bar.dataset.text = r.text;
            const override = this.speakerOverrides[this._overrideKey(id, r.index, r.text)];
            bar.dataset.speaker = override || r.speaker;
            if (r.cue) bar.dataset.cue = r.cue;
            if (r.deep) bar.dataset.deep = JSON.stringify(r.deep);
            if (r.deep?.why) bar.title = `${r.deep.why}${r.deep.t ? ` · 张力 ${r.deep.t}` : ''}`;
            bar.dataset.manualSpeaker = override ? '1' : '0';
            bar.dataset.mesid = String(id);
            bar.dataset.line = String(r.index);
            this._lineContext.set(`${id}:${r.index}`, full.slice(Math.max(0, r.start - 120), r.start) + '【' + full.slice(r.start, r.end) + '】' + full.slice(r.end, r.end + 30));
            bar.innerHTML = `<button type="button" class="yzsv-btn yzsv-play${this._isFav(bar.dataset.speaker || '', r.text) ? ' is-fav' : ''}" title="播放（${esc(bar.dataset.speaker || '默认音色')}）；长按收藏 / 取消收藏">▶</button><button type="button" class="yzsv-btn yzsv-regen" title="重新生成（长按：选说话人）">↻</button>${live || !s.lineEdit ? '' : `<button type="button" class="yzsv-btn yzsv-cfg${r.deep && lineEntry?.lines?.[r.text]?.edited ? ' is-edited' : ''}" title="调这句的演法（情绪、语速、语气词…）">🎭</button>`}`;
            const range = document.createRange();
            range.setStart(entry.node, offset);
            range.collapse(true);
            range.insertNode(bar);
        });

        if (!live && lines.length) {
            const all = document.createElement('div');
            all.className = 'yzsv-all';
            let deepHtml = '';
            if (deepOn) {
                const h = this._deepHashOf(msg);
                const pending = this._deepPending(msg);
                const err = h ? this._deepErr.get(h) : '';
                // 环境声的变化：咖啡馆 → 人声嘈杂
                let ambText = '';
                if (deepEntry && s.ambienceOn) {
                    const chain = [deepEntry.ambience || 'none'];
                    lines.forEach(r => { const a = deepEntry.lines?.[r.text]?.amb; if (a && a !== chain[chain.length - 1]) chain.push(a); });
                    const names = chain.filter((k, i) => k !== 'none' || i > 0).map(k => k === 'none' ? '安静' : (AMBIENCE_LABELS[k] || k));
                    if (names.length) ambText = ` · 🌧 ${names.join('→')}`;
                }
                const toneShown = this._floorTone(msg) || deepEntry?.tone || '';
                const label = pending ? '🎭 正在分析情绪…' : deepEntry ? `🎭 ${esc(toneShown || '已分析')}${toneShown === '亲密' ? ' · NSFW' : ''}${esc(ambText)}${deepEntry.arc ? ` · ${esc(deepEntry.arc)}` : ''}` : err ? '🎭 分析失败' : '🎭 未分析';
                deepHtml = deepEntry && !pending
                    ? `<button type="button" class="yzsv-deep yzsv-deep-open" title="点开查看、修改每句的分析">${label} ›</button><button type="button" class="yzsv-btn yzsv-deep-open">查看 / 编辑</button><button type="button" class="yzsv-btn yzsv-reanalyze">重新分析</button>`
                    : `<span class="yzsv-deep${pending ? ' is-busy' : ''}" title="${esc(err || '')}">${label}</span>${pending ? '' : `<button type="button" class="yzsv-btn yzsv-reanalyze">分析</button>`}`;
            }
            const toneChip = !deepOn && floorTone ? `<span class="yzsv-deep${floorTone === '亲密' ? ' is-nsfw' : ''}">🎬 ${esc(floorTone)}${floorTone === '亲密' ? ' · NSFW' : ''}</span>` : '';
            const editBtn = deepOn ? '' : `${toneChip}<button type="button" class="yzsv-btn yzsv-deep-open">🎭 逐句调整</button>`;
            all.innerHTML = `${lines.length > 1 ? `<button type="button" class="yzsv-btn yzsv-playall">▶ 朗读本条全部对白（${lines.length} 句）</button>` : ''}${deepHtml}${editBtn}`;
            box.appendChild(all);
        }
        this._bindBox(box);
    }

    // 删掉正文里 [start, end) 这段文字（可能跨多个文字节点）
    _deleteText(nodes, start, end, insert = '') {
        let put = !insert;
        nodes.forEach(entry => {
            const len = entry.node.nodeValue.length;
            const a = Math.max(start, entry.start);
            const b = Math.min(end, entry.start + len);
            if (a >= b) return;
            const v = entry.node.nodeValue;
            entry.node.nodeValue = v.slice(0, a - entry.start) + (put ? '' : insert) + v.slice(b - entry.start);
            put = true;
        });
    }

    // 让模型在台词前写 [[说话人]]（只加在发给模型的提示里，不改聊天记录）
    updatePrompt() {
        const ctx = window.SillyTavern?.getContext?.();
        if (typeof ctx?.setExtensionPrompt !== 'function') return;
        const s = this.getSettings();
        const types = ctx.extension_prompt_types || {};
        const roles = ctx.extension_prompt_roles || {};
        if (!s.enabled || !s.markSpeaker) {
            ctx.setExtensionPrompt(PROMPT_KEY, '', types.IN_CHAT ?? 1, 0);
            return;
        }
        const quotes = parsePairs(s.quotes).map(([a, b]) => `${a}${b}`).join('、') || '「」';
        const [qa, qb] = parsePairs(s.quotes)[0] || ['「', '」'];
        const userName = String(ctx.name1 || '').trim();
        const names = [...new Set([...s.speakers.map(x => x.name), ...this._wechatVoiceNames(), String(ctx.name2 || '').trim(), userName].filter(Boolean))];
        const text = [
            '【台词说话人标注】正文中每一句角色说出口的台词，在开头的对白符号前面紧贴写上说话人：[[角色名]]。',
            `对白符号：${quotes}。例：[[${names[0] || '角色名'}]]${qa}……${qb}`,
            userName ? `用户角色说的话标 [[${userName}]]。` : '',
            s.npcMode === 'npc' ? `下面名单以外的配角、路人、NPC，在名字后面加性别：[[名字/男]] 或 [[名字/女]]（例：[[店员/女]]${qa}……${qb}）。` : '',
            names.length ? `同一角色始终用同一个名字：${names.join('、')}。` : '',
            (s.emotionCue && s.analysisMode === 'simple') ? `再在名字后面用竖线写上这句话的【声音表演提示】：[[名字|提示]]。提示用英文写 1~2 个短语、逗号隔开，一共不超过 6 个单词，只写这句话【怎么说出口】：情绪和强度、音量、语速、停顿/哽咽、哭腔/颤抖/喘息/笑意/冷笑等。注意：这个标记读者看不见，所以动作、神态、心理、发生了什么都必须照常写在正文旁白里，绝对不能挪进标记（错误：[[某某|察觉到动静，呼吸一滞，把脸埋进你颈窝]]；正确：正文写“他呼吸一滞，把脸埋进你颈窝。”，标记写 [[某某|breathless, trembling whisper]]）。要结合当时的情景、人物此刻真实的心理和两人的关系判断强度：真崩溃就写到崩溃，强装镇定就写 forced calm。例：[[${names[0] || '角色名'}|furious, voice breaking with tears]]${qa}……${qb}、[[某某|teasing, playful laugh]]、[[某某|exhausted sigh, quiet]]、[[某某|panicked, speaking fast]]、[[某某|cold, sneering]]、[[某某|whispering, trembling]]。核心可选词：angry, furious, sad, crying, sobbing, excited, surprised, scared, panicked, desperate, gentle, tender, teasing, laughing, sigh, whisper, shouting, trembling, cold, sneering。同一角色每句的提示要跟着剧情变化。（只有这一楼的基调是「亲密」、正文写出了实质亲密接触时，才可以用 breathy、panting、moaning softly、moaning 这类，按强度递进；只是调情时用 whisper、breathy、seductive；其他基调不要写呻吟类。）` : '',
            s.analysisMode === 'simple' ? '【这一楼的情节】在每楼最开头单独写一个 [[基调:xx]]，xx 从 日常、轻松、温馨、浪漫、亲密、悲伤、紧张、悬疑、恐怖、战斗、壮阔 里选一个最贴切的；「亲密」只给旁白写出了实质亲密身体接触的楼，只有调情暧昧的写「浪漫」。这个标记读者也看不见。' : '',
            (s.analysisMode === 'simple' && s.ambienceOn) ? `【场景环境声】在每楼第一句台词之前，以及场景变化的地方（走进 / 走出某地、开始下雨、雨停、来到海边……），单独写一个 [[环境:xx]]，xx 只能从 ${ENV_KINDS.join("、")} 里选（none = 安静没有环境声）；场景没变就不要重复写。这个标记读者也看不见。` : '',
            '旁白、动作、心理描写、括号里的译文都不要标；不要解释这个标记，也不要漏标。'
        ].filter(Boolean).join('\n');
        ctx.setExtensionPrompt(PROMPT_KEY, text, types.IN_CHAT ?? 1, 0, false, roles.SYSTEM ?? 0);
    }

    _bindBox(box) {
        if (box.dataset.yzsvBound === '1') return;
        box.dataset.yzsvBound = '1';
        // 长按 ↻ 选说话人
        let pressTimer = null;
        const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
        // 长按 ▶ = 收藏这句语音
        box.addEventListener('pointerdown', (e) => {
            const pb = e.target.closest('.yzsv-play');
            if (!pb) return;
            cancelPress();
            pressTimer = setTimeout(() => {
                pressTimer = null;
                const bar = pb.closest('.yzsv-bar');
                if (!bar) return;
                this._longPressAt = Date.now();
                this.favoriteBar(bar);
            }, 550);
        }, true);
        box.addEventListener('pointerdown', (e) => {
            const btn = e.target.closest('.yzsv-regen');
            if (!btn) return;
            cancelPress();
            pressTimer = setTimeout(() => {
                pressTimer = null;
                const bar = btn.closest('.yzsv-bar');
                if (!bar) return;
                this._longPressAt = Date.now();
                this._openSpeakerPicker(bar, btn);
            }, 500);
        }, true);
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => box.addEventListener(t, cancelPress, true));
        box.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.yzsv-play')) { e.preventDefault(); return; }
            const btn = e.target.closest('.yzsv-regen');
            if (!btn) return;
            e.preventDefault();
            cancelPress();
            const bar = btn.closest('.yzsv-bar');
            if (bar && Date.now() - (this._longPressAt || 0) > 600) { this._longPressAt = Date.now(); this._openSpeakerPicker(bar, btn); }
        }, true);
        box.addEventListener('click', (e) => {
            const btn = e.target.closest('.yzsv-btn, .yzsv-deep-open');
            if (!btn) return;
            if ((btn.classList.contains('yzsv-regen') || btn.classList.contains('yzsv-play')) && Date.now() - (this._longPressAt || 0) < 700) { e.preventDefault(); e.stopPropagation(); return; }
            e.preventDefault();
            e.stopPropagation();
            this._unlockAudio();
            if (btn.classList.contains('yzsv-cfg')) {
                const bar = btn.closest('.yzsv-bar');
                if (bar) openDeepEditor(this, Number(bar.dataset.mesid), bar.dataset.line, { single: true });
                return;
            }
            if (btn.classList.contains('yzsv-deep-open')) {
                openDeepEditor(this, Number(btn.closest('.mes')?.getAttribute('mesid')));
                return;
            }
            if (btn.classList.contains('yzsv-reanalyze')) {
                const mes = btn.closest('.mes');
                const mid = Number(mes?.getAttribute('mesid'));
                const ent = this._deepEntry(window.SillyTavern?.getContext?.()?.chat?.[mid]);
                const had = !!ent;
                if (ent && Object.values(ent.lines || {}).some(v => v?.edited) && !window.confirm('这一楼有你手动改过的演法，重新分析会覆盖掉，确定吗？')) return;
                this._startDeep(mid, { force: had });
                this.processById(mid);
                return;
            }
            if (btn.classList.contains('yzsv-playall')) {
                const mes = btn.closest('.mes');
                this.playMessage(Number(mes?.getAttribute('mesid')), btn);
                return;
            }
            const bar = btn.closest('.yzsv-bar');
            if (!bar) return;
            if (btn.classList.contains('yzsv-regen')) { this._regen(bar, btn); return; }
            if (bar._regenJob) { this._toast('正在重新生成', '生成好会自动播放'); return; }
            this.playBars([bar], { trigger: btn });
        }, true);
    }

    // ---------- 合成与播放 ----------
    // 手机浏览器要求“点了才能出声”：点按钮的那一刻先用一段静音把播放器解锁，
    // 后面不管 AI 判断、合成要多久，生成好就能直接播
    _unlockAudio() {
        if (this.playing) return;
        try {
            const a = this.audio;
            a.src = SILENT_WAV;
            const p = a.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) { /* 忽略 */ }
    }

    // ---------- 提前生成 ----------
    _prefetchLines(items = []) {
        if (!this.getSettings().enabled) return;
        this._prefetchQ = this._prefetchQ || [];
        this._prefetchSeen = this._prefetchSeen || new Set();
        items.forEach(({ speaker, text, cue, deep }) => {
            if (!text || !this._hasVoice(speaker)) return;
            const key = `${speaker}\u0001${text}\u0001${deep ? JSON.stringify(deep) : ''}`;
            if (this._prefetchSeen.has(key)) return;
            this._prefetchSeen.add(key);
            this._prefetchQ.push({ speaker, text, cue: cue || '', deep: deep || null, key });
        });
        if (this._prefetchSeen.size > 1000) this._prefetchSeen = new Set([...this._prefetchSeen].slice(-500));
        this._pumpPrefetch();
    }

    _pumpPrefetch() {
        this._prefetchActive = this._prefetchActive || 0;
        while (this._prefetchActive < 3 && this._prefetchQ?.length) {
            const job = this._prefetchQ.shift();
            this._prefetchActive += 1;
            (async () => {
                try {
                    const { vi, parts } = this._lineJob(await this._voiceFor(job.speaker), job.text, job.cue, job.deep);
                    await Promise.all(parts.map(part => this._synth(part, vi)));
                    this._ready = this._ready || new Set();
                    this._ready.add(this._readyKey(job.speaker, job.text));
                    if (this._ready.size > 2000) this._ready = new Set([...this._ready].slice(-1000));
                    if (this._streaming) this._scheduleLive();
                } catch (err) {
                    console.warn('[正文朗读] 提前生成失败:', err);
                    this._prefetchSeen?.delete(job.key);
                } finally {
                    this._prefetchActive -= 1;
                    this._pumpPrefetch();
                }
            })();
        }
    }

    // 原文（可能带思考、<content> 标签和 HTML）→ 纯文字；生成到一半也能用
    _rawToText(raw) {
        let t = String(raw || '');
        // 思考过程不读也不发：<think>、<thinking>、<reasoning>、<cot>、<思考>、<思维链> 等（没写完的也去掉）
        const TH = '(?:think|thinking|reasoning|cot|thought|thoughts|思考|思维链|思维|内心分析)';
        t = t.replace(new RegExp(`<${TH}>[\\s\\S]*?<\\/${TH}>`, 'gi'), '').replace(new RegExp(`<${TH}>[\\s\\S]*$`, 'i'), '');
        t = t.replace(/^[\s\S]*?<\/think(?:ing)?>/i, ''); // 只有结尾 </think> 的（开头标签被预设吃掉了）
        const open = t.search(/<content>/i);
        if (open >= 0) {
            t = t.slice(open + 9);
            const close = t.search(/<\/content>/i);
            if (close >= 0) t = t.slice(0, close);
        }
        return t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, '\n').replace(/<[^>]*>?/g, '')
            .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
            .replace(/\*+/g, '');
    }

    // 找出已经说完（引号闭合）的台词，马上提前生成
    _prefetchRaw(raw, id, msg) {
        const { lines } = this._analyze(this._rawToText(raw), { id, msg });
        this._prefetchLines(lines.map(r => ({ speaker: this.speakerOverrides[this._overrideKey(id, r.index, r.text)] || r.speaker, text: r.text, cue: r.cue || '' })));
    }

    // 已经挂好按钮的楼层：把按钮对应的台词提前生成
    _prefetchMessage(id) {
        const el = document.querySelector(`#chat .mes[mesid="${id}"]`);
        const bars = Array.from(el?.querySelectorAll('.mes_text .yzsv-bar') || []);
        this._prefetchLines(bars.map(b => ({ speaker: b.dataset.speaker || '', text: b.dataset.text || '', cue: b.dataset.cue || '', deep: this._barDeep(b) })));
    }

    // 流式生成中：藏掉 [[名字]]；每句台词一说完（引号闭合）就马上开始生成语音
    _onStreamToken() {
        this._streaming = true;
        this._scheduleLive();
        if (this._streamTimer) return;
        this._streamTimer = setTimeout(() => {
            this._streamTimer = null;
            const s = this.getSettings();
            if (!s.enabled) return;
            const ctx = window.SillyTavern?.getContext?.();
            const chat = ctx?.chat || [];
            const id = chat.length - 1;
            const msg = chat[id];
            if (!msg || msg.is_system || (msg.is_user && !s.readUser)) return;
            const raw = String(msg.mes || '');
            if (!raw) return;
            // 深度分析：不边写边生成，等正文闭合（</content>）就整楼分析
            if (s.analysisMode === 'deep') {
                if (s.deepAuto && s.deepProfile && /<\/content>/i.test(raw) && this._deepStartedFor !== `${id}:${this._deepHashOf(msg)}`) {
                    this._deepStartedFor = `${id}:${this._deepHashOf(msg)}`;
                    const goDeep = () => this._startDeep(id);
                    if (this._wxData) goDeep(); else this._getWechatData().catch(() => null).then(goDeep);
                }
                return;
            }
            const go = () => this._prefetchRaw(raw, id, msg);
            if (this._wxData) go();
            else this._getWechatData().catch(() => null).then(go);
        }, 150);
    }

    // 生成中：每次正文刷新后，把已经生成好语音的台词按钮挂回去（藏掉 [[名字]]）
    _scheduleLive() {
        if (this._markRaf) return;
        this._markRaf = requestAnimationFrame(() => {
            this._markRaf = 0;
            this._hideLiveMarks();
            if (!this._streaming) return;
            const chat = window.SillyTavern?.getContext?.()?.chat || [];
            const el = document.querySelector(`#chat .mes[mesid="${chat.length - 1}"]`);
            if (el) { try { this.processElement(el, { live: true }); } catch (e) { /* 忽略 */ } }
        });
    }

    _readyKey(speaker, text) {
        return `${speaker || ''}\u0001${text || ''}`;
    }

    _hideLiveMarks() {
        const all = document.querySelectorAll('#chat .mes .mes_text');
        const box = all[all.length - 1];
        if (!box) return;
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n.nodeValue && n.nodeValue.includes('[[')) n.nodeValue = n.nodeValue.replace(MARK_RE, (all, body) => markDisplay(body));
        }
    }

    // 当前酒馆聊天的标识：换聊天后微信数据（联系人、音色）也要跟着换
    _chatSig() {
        const ctx = window.SillyTavern?.getContext?.() || {};
        let key = '';
        try { key = String(this.storage?.getContextKey?.() || ''); } catch (e) { key = ''; }
        return `${ctx.chatId || ''}|${ctx.characterId ?? ''}|${ctx.groupId ?? ''}|${key}`;
    }

    // 自己单独读一份微信数据（只读，不碰小手机里正在用的那份），聊天一换就重新读
    _wx() {
        if (this.voiceSource) return this.voiceSource;
        const d = this._wxData;
        if (!d) return null;
        const sig = this._chatSig();
        if (sig !== this._wxSig || this._wxDirty) {
            try { d.data = d.loadData(); } catch (e) { /* 忽略 */ }
            this._wxSig = sig;
            this._wxDirty = false;
        }
        return d;
    }

    async _getWechatData() {
        if (this.voiceSource) return this.voiceSource;
        if (this._wxData) return this._wx();
        if (!this.storage) return null;
        if (!this._wxLoading) {
            this._wxLoading = import('../wechat/wechat-data.js?v=20261011-wallet-credit-repayment').then(mod => {
                this._wxData = new mod.WechatData(this.storage);
                this._wxSig = this._chatSig();
                this._wxDirty = false;
                return this._wxData;
            }).catch(e => { console.warn('[正文朗读] 读取微信联系人失败:', e); this._wxLoading = null; return null; });
        }
        await this._wxLoading;
        return this._wx();
    }

    // 按小手机的规则算出某人（联系人或“我”）当前该用的音色
    // 正文朗读用的渠道：朗读 App 里选的，没选就跟随小手机语音设置
    _storyProvider() {
        const p = this.getSettings().ttsProvider;
        if (p === 'custom_openai') return 'openai'; // 第三方 OpenAI 兼容：按 OpenAI 的方式发
        return p || String(this.storage?.get?.('phone-tts-provider') || 'minimax_cn').trim() || 'minimax_cn';
    }

    // 这一句最后走哪个渠道：统一模式一律用选的渠道；按人模式用这个人自己配的渠道
    _providerFor(vi = {}) {
        const st = this.getSettings();
        const global = st.ttsProvider === 'custom_openai' ? 'custom_openai' : this._storyProvider();
        if (st.channelMode === 'unified') return global;
        return vi.provider || global;
    }

    // 这个说话人最后走哪个渠道、哪个模型、这个渠道认什么写法（编辑面板、深度分析用）
    _speakerChannel(speaker = '') {
        const vi = this._voiceForSync(speaker);
        const provider = this._providerFor(vi);
        const model = this._modelOf(provider);
        let volcV2 = true;
        if (provider === 'volcengine') {
            const rid = String(this.tts?._get?.('volcengine', 'resource-id') || 'seed-tts-2.0');
            volcV2 = /2\.0|tts-2|icl-2/i.test(rid);
        }
        return { vi, provider, model, profile: channelProfile(provider, model, { volcV2 }) };
    }

    // 编辑面板的实时预览：这句演法最后发给语音接口的文字和参数（和 _synth 的深度分析分支一致）
    previewLine(speaker = '', script = '', t = 0) {
        const ch = this._speakerChannel(speaker);
        const prov = ch.provider;
        if (prov === 'fish') {
            const text = this._applyReadings(this._prepScript(script, 'fish'));
            const base = 0.7;
            const temp = t && TENSION_TEMPERATURE[t] !== undefined ? Number((base + TENSION_TEMPERATURE[t]).toFixed(2)) : null;
            return { ...ch, text, opts: temp !== null ? { temperature: temp } : {} };
        }
        const raw = this._prepScript(script, prov, { keepTags: true });
        const a = adaptScript({ provider: prov, model: ch.model, script: this._applyReadings(raw), t: Number(t) || 0 });
        return { ...ch, text: a.text, opts: a.opts };
    }

    // 第三方渠道：完整的 /audio/speech 地址
    _customSpeechUrl() {
        let u = String(this.getSettings().customUrl || '').trim().replace(/\/+$/, '');
        if (!u) return '';
        if (/\/audio\/speech$/i.test(u)) return u;
        u = u.replace(/\/(?:models|chat\/completions)$/i, '');
        if (!/\/v\d+[a-z]*$/i.test(u)) u += '/v1';
        return `${u}/audio/speech`;
    }

    _pickVoice(obj = {}) {
        const globalProvider = this._storyProvider();
        const voices = obj.ttsVoices && typeof obj.ttsVoices === 'object' ? obj.ttsVoices : {};
        const bound = String(obj.ttsProvider || '').trim();
        const lang = String(obj.ttsLanguageBoost || 'auto').trim() || 'auto';
        const has = Object.entries(voices).filter(([, v]) => String(v || '').trim());
        const st = this.getSettings();
        if (st.channelMode === 'unified' && String(voices[st.ttsProvider === 'custom_openai' ? 'custom_openai' : globalProvider] || '').trim()) return { voice: String(voices[st.ttsProvider === 'custom_openai' ? 'custom_openai' : globalProvider]).trim(), provider: st.ttsProvider === 'custom_openai' ? 'custom_openai' : globalProvider, languageBoost: lang };
        // 统一用一个渠道：这个人没填这个渠道的音色，就用这个渠道的默认音色（别把别家的音色 ID 发过去，会报 voice id not exist）
        if (st.channelMode === 'unified') {
            return (has.length || String(obj.ttsVoice || '').trim()) ? { voice: '', provider: globalProvider, languageBoost: lang, fallbackVoice: true } : null;
        }
        // 每个人按自己配的：他填了哪个渠道的音色就走哪个渠道
        const provider = bound || globalProvider;
        if (String(voices[provider] || '').trim()) return { voice: String(voices[provider]).trim(), provider, languageBoost: lang };
        if (has.length) return { voice: String(has[0][1]).trim(), provider: has[0][0], languageBoost: lang };
        if (String(obj.ttsVoice || '').trim()) return { voice: String(obj.ttsVoice).trim(), provider, languageBoost: lang };
        return null;
    }

    _splitAliases(v) {
        return (Array.isArray(v) ? v : String(v || '').split(/[,，、;；\n]/)).map(x => String(x || '').trim()).filter(Boolean);
    }

    // 微信里填了音色的人：联系人（真实姓名 + 自己加的可识别名字）和“我”
    _wechatVoiceContacts() {
        const data = this._wx();
        const out = [];
        let list = [];
        try { list = data?.getContacts?.() || []; } catch (e) { list = []; }
        list.forEach(c => {
            const vi = this._pickVoice(c || {});
            if (!vi) return;
            const aliases = [...new Set([String(c.realName || c.name || '').trim(), ...this._splitAliases(c.voiceAliases)].filter(Boolean))];
            if (aliases.length) out.push({ primary: aliases[0], aliases, voiceInfo: vi });
        });
        const me = data?.data?.userInfo;
        const myVoice = me ? this._pickVoice(me) : null;
        if (myVoice) {
            const ctxName = String(window.SillyTavern?.getContext?.()?.name1 || '').trim();
            const aliases = [...new Set([ctxName, String(me.realName || me.name || '').trim(), ...this._splitAliases(me.voiceAliases)].filter(Boolean))];
            if (aliases.length) out.push({ primary: aliases[0], aliases, voiceInfo: myVoice, isMe: true });
        }
        return out;
    }

    _wechatVoiceNames() {
        return this._wechatVoiceContacts().map(x => x.primary);
    }

    _wechatVoiceAliases() {
        return this._wechatVoiceContacts().flatMap(x => x.aliases);
    }

    _findWechatVoice(name = '') {
        const n = String(name || '').trim();
        if (!n) return null;
        const list = this._wechatVoiceContacts();
        return list.find(x => x.aliases.includes(n))
            || list.find(x => x.aliases.some(a => a.length >= 2 && n.length >= 2 && (a.includes(n) || n.includes(a))))
            || null;
    }

    _findAppSpeaker(name = '') {
        const sp = String(name || '').trim();
        if (!sp) return null;
        const list = this.getSettings().speakers.filter(x => x.name && x.voice);
        return list.find(x => x.name === sp)
            || list.find(x => sp.length >= 2 && x.name.length >= 2 && (sp.includes(x.name) || x.name.includes(sp)))
            || null;
    }

    // 说话人 → 音色：先看「朗读」App 里登记的，再看角色库（联系人 / 我的音色），最后用默认 NPC 音色
    _voiceForSync(speaker = '') {
        const s = this.getSettings();
        // NPC 默认音色属于哪个渠道：每人用自己的渠道时按 NPC 设置里选的渠道，统一渠道时跟着统一的
        const npc = (voice) => (s.channelMode !== 'unified' && s.npcProvider) ? { voice, provider: s.npcProvider } : { voice };
        const hit = this._findAppSpeaker(speaker);
        if (hit) return { voice: hit.voice };
        if (String(speaker || '').trim()) {
            const wx = this._findWechatVoice(speaker);
            if (wx) return { ...wx.voiceInfo };
            if (s.npcMode === 'npc') {
                const g = this._genderFor(speaker);
                if (g === 'm' && s.npcMale) return npc(s.npcMale);
                if (g === 'f' && s.npcFemale) return npc(s.npcFemale);
            }
        }
        return npc(s.voice || '');
    }

    async _voiceFor(speaker = '') {
        if (String(speaker || '').trim()) await this._getWechatData();
        return this._voiceForSync(speaker);
    }

    // 缓存按「平台+音色+文本」区分：联系人音色改了，点 ▶ 就会自动重新生成
    async _synth(text, voiceInfo, { regen = false, signal } = {}) {
        if (!this.tts?.requestTTS) throw new Error('小手机的语音模块还没加载');
        let vi = typeof voiceInfo === 'object' && voiceInfo ? voiceInfo : { voice: voiceInfo || '' };
        const provider = this._providerFor(vi);
        const prov = provider; // 统一渠道时不能让联系人自己绑的渠道抢走
        let fish = null;
        let extra = null;
        if (vi.deep && prov !== 'fish') {
            // 其他引擎：同一份演法换成它们认的写法（情绪参数 / 语气说明 / 括号音效），见 tts-adapt.js
            const raw = vi.deep.scripted ? this._prepScript(text, prov, { keepTags: true }) : this._cleanSpeech(text);
            const a = adaptScript({ provider: prov, model: this._modelOf(prov), script: this._applyReadings(raw), t: Number(vi.deep.t) || 0 });
            text = a.text;
            if (Object.keys(a.opts).length) extra = a.opts;
        } else if (vi.deep) {
            // 深度分析：标签已经插在台词里；张力 → temperature，语速 → speed
            text = vi.deep.scripted ? this._applyReadings(this._prepScript(text, prov)) : this._applyReadings(this._cleanSpeech(text));
            if (prov === 'fish') {
                const base = 0.7;
                const t = Number(vi.deep.t) || 0;
                const temp = t && TENSION_TEMPERATURE[t] !== undefined ? Number((base + TENSION_TEMPERATURE[t]).toFixed(2)) : null;
                // 语速不交给 Fish（兼容接口会忽略），播放时变速，见 _playUrl
                if (temp !== null) fish = { temperature: temp };
            }
        } else if (vi.cue && prov !== 'fish' && this.getSettings().emotionCue) {
            text = this._autoOno(text, vi.cue);
            // 简单分析 + 其他引擎：把 [[名字|语气]] 的语气也换成它们认的写法
            const tags = String(vi.cue).replace(/[\[\]]/g, '').split(/[,，、;；]/).map(x => x.trim()).filter(Boolean).slice(0, 2);
            const a = adaptScript({ provider: prov, model: this._modelOf(prov), script: `${tags.map(x => `[${x}]`).join('')} ${this._applyReadings(this._cleanSpeech(text))}`, t: 0 });
            text = a.text;
            if (Object.keys(a.opts).length) extra = a.opts;
        } else {
            text = this._applyReadings(this._cleanSpeech(this._autoOno(text, vi.cue)));
            text = this._withCue(text, vi.cue, prov);
        }
        vi = fish ? { ...vi, fish } : vi;
        if (extra) vi = { ...vi, extra };
        const key = `${this.getSettings().ttsProvider || ''}\u0001${provider}\u0001${this.getSettings().ttsProvider === 'custom_openai' ? `${this.getSettings().customUrl}|${this.getSettings().customModel}` : (this.getSettings().ttsModels?.[provider] || '')}\u0001${vi.voice || ''}\u0001${vi.languageBoost || ''}\u0001${fish ? JSON.stringify(fish) : ''}\u0001${extra ? JSON.stringify(extra) : ''}\u0001${text}`;
        // 记下「这一句最后实际发给语音接口的是什么」，编辑面板里可以看到，方便查不对的地方
        const sentInfo = { text, provider: prov, model: this._modelOf(prov), fish: fish || null, extra: extra || null, at: Date.now() };
        if (!regen && this.cache.has(key)) { this._noteSent({ ...sentInfo, cached: true }); return this.cache.get(key); }
        this._noteSent({ ...sentInfo, cached: false });
        this._inflight = this._inflight || new Map();
        if (!regen && this._inflight.has(key)) return this._inflight.get(key);
        const job = this._synthNow(key, text, regen ? { ...vi, _regen: true } : vi, signal);
        this._inflight.set(key, job);
        try { return await job; } finally { if (this._inflight.get(key) === job) this._inflight.delete(key); }
    }

    async _synthNow(key, text, vi, signal) {
        this._gen = this._gen || new Map();
        const token = (this._gen.get(key) || 0) + 1;
        this._gen.set(key, token);
        const opts = { voice: vi.voice || undefined, signal };
        const st = this.getSettings();
        // 选了渠道：强制走它（别让联系人里绑的旧渠道抢走）
        opts.provider = this._providerFor(vi);
        if (opts.provider === 'custom_openai' || (st.channelMode === 'unified' && st.ttsProvider === 'custom_openai')) {
            opts.provider = 'openai';
            opts.apiUrl = this._customSpeechUrl();
            opts.apiKey = st.customKey || '';
            if (st.customModel) opts.model = st.customModel;
            if (!opts.apiUrl) throw new Error('第三方语音渠道还没填接口地址（朗读 App → 语音渠道）');
        } else {
            const mdl = st.ttsModels?.[opts.provider];
            if (mdl) opts.model = mdl;
        }
        if (vi.languageBoost) opts.languageBoost = vi.languageBoost;
        if (vi.fish) opts.fish = vi.fish;
        // 重新生成：让 Fish 的随机性稍微变一下，避免接口直接给回一模一样的音频
        if (vi._regen && opts.provider === 'fish') {
            const base = Number(opts.fish?.temperature) || 0.7;
            opts.fish = { ...(opts.fish || {}), temperature: Number(Math.min(0.95, Math.max(0.3, base + (Math.random() * 0.12 - 0.06))).toFixed(2)) };
        }
        if (vi.extra) Object.assign(opts, vi.extra);
        const url = await this.tts.requestTTS(text, opts);
        // 晚回来的旧请求不能盖掉新生成的语音
        if (this._gen.get(key) !== token) return this.cache.get(key) || url;
        const old = this.cache.get(key);
        this.cache.set(key, url);
        if (old && old !== url) this._safeRevoke(old);
        if (this.cache.size > 300) {
            const first = this.cache.keys().next().value;
            this._safeRevoke(this.cache.get(first));
            this.cache.delete(first);
        }
        return url;
    }

    // 正在播的音频不能回收，否则会播到一半断掉
    _safeRevoke(url) {
        if (!url) return;
        const playingNow = () => { try { return this.audio.src === url && !this.audio.paused; } catch (e) { return false; } };
        const go = () => { if (playingNow()) { setTimeout(go, 30000); return; } try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ } };
        setTimeout(go, 30000);
    }

    // 合成前把容易读出怪声（喘气、拖长音）的符号收拾一下
    _cleanSpeech(text = '') {
        let t = String(text || '');
        t = t.replace(/\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\u200d\ufe0f]/gu, '');
        t = t.replace(/[♡♥♪♫★☆◆◇■□●○※]/g, '');
        t = t.replace(/^[\s…‥．.。、，,—―\-~～]+/, '');           // 开头的省略号、破折号不读
        t = t.replace(/(?:…|‥|\.{3,}|・{3,}){1,}/g, '…');            // 省略号留一个：保留哽咽、迟疑的停顿
        t = t.replace(/[—―]{2,}/g, '…');
        t = t.replace(/([！!？?])\1+/g, '$1').replace(/([~～])\1+/g, '$1');
        t = t.replace(/、+/g, '、').replace(/、([。！？!?])/g, '$1').replace(/[、\s]+$/, '');
        return t.trim() || String(text || '').trim();
    }

    // 一句台词要合成的内容：深度分析有演法就念演法（拆段也按演法拆），否则念原文 + 语气
    _lineJob(voice, text, cue = '', deep = null) {
        if (deep) {
            const scripted = !!deep.s;
            const parts = splitSpeech(scripted ? deep.s : text);
            return { vi: { ...voice, cue: '', deep: { scripted, t: deep.t, p: deep.p, tone: deep.tone } }, parts };
        }
        return { vi: { ...voice, cue: this.getSettings().analysisMode === 'simple' ? (cue || '') : '' }, parts: splitSpeech(text) };
    }

    _barDeep(bar) {
        if (!bar?.dataset?.deep) return null;
        try { return JSON.parse(bar.dataset.deep); } catch (e) { return null; }
    }

    // 深度分析的演法：去掉 emoji，标签按模型换写法（S1 用 (英文)，Drama 去掉），保留 ！！、叠字、语气字
    // 简单分析：按 [[名字|语气]] 自动加一点拟声词（笑 → 哈哈，哭 → 呜……，叹气 → 唉……）
    _autoOno(text = '', cue = '') {
        const c = String(cue || '').toLowerCase();
        if (!c || !this.getSettings().autoOno || this.getSettings().analysisMode !== 'simple') return text;
        const ja = /[\u3040-\u30ff]/.test(text);
        const t = String(text);
        const has = (re) => re.test(t.slice(0, 6));
        if (/laugh|笑出声|大笑|哈哈/.test(c) && !has(/哈|あは|ははは|ふふ/)) return `${ja ? 'あはは、' : '哈哈，'}${t}`;
        if (/chuckl|giggl|轻笑|偷笑/.test(c) && !has(/呵|嘿|ふふ|へへ/)) return `${ja ? 'ふふっ、' : '嘿嘿，'}${t}`;
        if (/sob|cry|哭|泣|tears/.test(c) && !has(/呜|うぅ|ぐす|ひっく/)) return `${ja ? 'うぅ……' : '呜……'}${t}`;
        if (/sigh|叹/.test(c) && !has(/唉|はぁ/)) return `${ja ? 'はぁ……' : '唉……'}${t}`;
        if (/sneer|scoff|冷笑|嗤|哼/.test(c) && !has(/哼|ふん|はっ/)) return `${ja ? 'ふん、' : '哼，'}${t}`;
        return t;
    }

    // ---------- 语音收藏 ----------
    // 收藏过的句子：▶ 上显示一颗星（启动时从本地收藏里读一遍）
    async _loadFavKeys() {
        try { this._favKeys = new Set((await favStore.all()).map(x => `${x.speaker}\u0001${x.text}`)); }
        catch (e) { this._favKeys = new Set(); }
        this.refreshAll();
    }

    _isFav(speaker, text) { return !!this._favKeys?.has(`${speaker}\u0001${text}`); }

    // 长按 ▶：没收藏就收藏，已经收藏了就取消
    async favoriteBar(bar) {
        try {
            const text = bar.dataset.text || '';
            const speaker = bar.dataset.speaker || '';
            const had = await favStore.find(text, speaker, 'story');
            if (had) {
                await favStore.remove(had.id);
                this._favKeys?.delete(`${speaker}\u0001${text}`);
                bar.querySelector('.yzsv-play')?.classList.remove('is-fav');
                this._toast('已取消收藏', `${speaker ? `${speaker}：` : ''}${text.slice(0, 30)}`);
                return;
            }
            this._toast('正在收藏…', '把这句语音存到本地');
            const deep = this._barDeep(bar);
            const { vi, parts } = this._lineJob(await this._voiceFor(speaker), text, bar.dataset.cue || '', deep);
            const urls = await Promise.all(parts.map(part => this._synthRetry(part, vi, {})));
            const joined = await this._joinAudio(urls);
            const blobs = await Promise.all(joined.map(u => fetch(u).then(r => r.blob())));
            const blob = blobs.length === 1 ? blobs[0] : new Blob(blobs, { type: blobs[0]?.type || 'audio/mpeg' });
            const chat = String(window.SillyTavern?.getContext?.()?.name2 || '');
            const rec = await favStore.add({ text, speaker, source: 'story', chat, blob, rate: PACE_SPEED[deep?.p] || 1, tags: [] });
            this._favKeys = this._favKeys || new Set();
            this._favKeys.add(`${speaker}\u0001${text}`);
            bar.querySelector('.yzsv-play')?.classList.add('is-fav');
            this._toast('已收藏 ⭐', `${speaker ? `${speaker}：` : ''}${text.slice(0, 30)}（再长按一次取消）`, 'success');
            this._askTags(rec, bar.querySelector('.yzsv-play'));
        } catch (err) {
            this._toast('收藏失败', String(err?.message || err).slice(0, 120), 'error');
        }
    }

    // 小手机里的语音（微信语音消息等）也能收藏：blob 或 url 二选一
    async addFavorite({ text = '', speaker = '', source = 'wechat', chat = '', blob = null, url = '' } = {}) {
        try {
            if (!blob && url) blob = await fetch(url).then(r => r.blob());
            if (!blob) throw new Error('没有拿到音频');
            speaker = this._canonicalName(speaker) || speaker; // 记真实姓名，方便按角色筛选
            const had = await favStore.find(text, speaker, source);
            if (had) {
                await favStore.remove(had.id);
                this._toast('已取消收藏', `${speaker ? `${speaker}：` : ''}${String(text).slice(0, 30)}`);
                return null;
            }
            const rec = await favStore.add({ text, speaker, source, chat, blob, rate: 1, tags: [] });
            this._toast('已收藏 ⭐', `${speaker ? `${speaker}：` : ''}${String(text).slice(0, 30)}（再收藏一次就是取消）`, 'success');
            this._askTags(rec, null);
            return rec;
        } catch (err) {
            this._toast('收藏失败', String(err?.message || err).slice(0, 120), 'error');
            return null;
        }
    }

    // 收藏后弹一个小框加标签（可以跳过，6 秒不动自己消失）
    async _askTags(rec, anchor) {
        if (!rec) return;
        document.querySelectorAll('.yzsv-tagpop').forEach(n => n.remove());
        let known = [];
        try { known = [...new Set((await favStore.all()).flatMap(x => x.tags || []))].slice(0, 16); } catch (e) { known = []; }
        const pop = document.createElement('div');
        pop.className = 'yzsv-pop yzsv-tagpop';
        pop.innerHTML = `<div class="yzsv-pop-title">⭐ 已收藏，加个标签？<span>可以跳过</span></div>
            <div class="yzsv-pop-names">${known.map(t => `<button type="button" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>
            <div class="yzsv-tagrow"><input type="text" placeholder="新标签，比如：名场面、哭腔、甜" enterkeyhint="done"><button type="button" data-ok>好</button></div>`;
        document.body.appendChild(pop);
        const w = Math.min(300, window.innerWidth - 16);
        pop.style.width = `${w}px`;
        const r = anchor?.getBoundingClientRect?.() || { left: window.innerWidth / 2, width: 0, bottom: window.innerHeight / 3, top: window.innerHeight / 3 };
        pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
        const below = r.bottom + 8;
        pop.style.top = `${below + pop.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - pop.offsetHeight - 8) : below}px`;
        const chosen = new Set();
        let timer = setTimeout(() => close(), 6000);
        const close = async (save = false) => {
            clearTimeout(timer);
            document.removeEventListener('pointerdown', outside, true);
            const typed = String(pop.querySelector('input')?.value || '').split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);
            typed.forEach(t => chosen.add(t));
            pop.remove();
            if ((save || chosen.size) && chosen.size) {
                try { await favStore.update(rec.id, { tags: [...chosen].slice(0, 8) }); this._toast('标签已加上', [...chosen].join('、')); } catch (e) { /* 忽略 */ }
            }
        };
        const outside = (e) => { if (!pop.contains(e.target)) close(); };
        setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
        pop.addEventListener('pointerdown', () => { clearTimeout(timer); timer = setTimeout(() => close(), 15000); });
        pop.addEventListener('click', (e) => {
            e.stopPropagation();
            const t = e.target.closest('[data-tag]');
            if (t) { t.classList.toggle('is-on'); if (chosen.has(t.dataset.tag)) chosen.delete(t.dataset.tag); else chosen.add(t.dataset.tag); return; }
            if (e.target.closest('[data-ok]')) close(true);
        });
        pop.querySelector('input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(true); } });
    }

    // 翻译：先用免费的网页翻译（不用 Key），都不行再用模型
    async translateText(text = '') {
        const src = String(text || '').trim();
        if (!src) return '';
        const lang = /[\u3040-\u30ff]/.test(src) ? 'ja' : /[\uac00-\ud7af]/.test(src) ? 'ko' : 'auto';
        // 1) 浏览器自带的离线翻译（新版 Chrome 有）
        // 只在翻译包已经下载好时用（不触发下载，最多等 4 秒）
        const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
        try {
            if (window.Translator?.create && lang !== 'auto') {
                const av = await within(window.Translator.availability?.({ sourceLanguage: lang, targetLanguage: 'zh' }) ?? Promise.resolve('no'), 1500);
                if (av === 'available' || av === 'readily') {
                    const tr = await within(window.Translator.create({ sourceLanguage: lang, targetLanguage: 'zh' }), 3000);
                    const out = await within(tr.translate(src), 4000);
                    if (out) return String(out).trim();
                }
            }
        } catch (e) { /* 换下一个 */ }
        // 每个网页翻译最多等 6 秒（国内连不上 Google 时不会卡住）
        const tryGet = async (url, pick) => {
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 6000);
            try {
                let res;
                try { res = await fetch(url, { signal: ctl.signal }); }
                catch (e) {
                    if (ctl.signal.aborted) throw e;
                    res = await fetch(`/proxy/${url}`, { signal: ctl.signal }); // 跨域被挡：走酒馆转发
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const out = pick(await res.json());
                if (!out) throw new Error('空结果');
                return String(out).trim();
            } finally { clearTimeout(timer); }
        };
        // 2) Google 网页翻译接口
        try {
            return await tryGet(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${lang}&tl=zh-CN&dt=t&q=${encodeURIComponent(src)}`,
                j => (Array.isArray(j?.[0]) ? j[0].map(x => x?.[0] || '').join('') : ''));
        } catch (e) { /* 换下一个 */ }
        // 3) MyMemory 免费翻译
        try {
            return await tryGet(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(src)}&langpair=${lang === 'auto' ? 'en' : lang}|zh-CN`,
                j => j?.responseData?.translatedText);
        } catch (e) { /* 换下一个 */ }
        // 4) 最后才用模型
        return this._translateByModel(src);
    }

    async _translateByModel(text = '') {
        const out = await this._callModel([
            { role: 'system', content: '你是翻译。把用户给的一句台词翻译成自然、口语化的简体中文，保留语气和情绪，只输出译文，不要解释、不要加引号。' },
            { role: 'user', content: String(text) }
        ], { timeout: 60000, maxTokens: 400 });
        return String(out || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim().replace(/^["「『]|["」』]$/g, '');
    }

    // 编辑面板保存后：这句下次播放不用缓存
    markFresh(mesid, line) {
        this._forceFresh = this._forceFresh || new Set();
        this._forceFresh.add(`${mesid}:${line}`);
    }

    _noteSent(info) {
        this._sentLog = this._sentLog || [];
        this._sentLog.push(info);
        if (this._sentLog.length > 50) this._sentLog.shift();
    }

    _modelOf(provider = '') {
        if (provider === 'custom_openai') return this.getSettings().customModel || '';
        if (this.getSettings().ttsProvider === 'custom_openai' && provider === 'openai') return this.getSettings().customModel || '';
        const own = this.getSettings().ttsModels?.[provider];
        if (own) return own;
        try { return String(this.tts?._resolveConfig?.({ provider })?.model || ''); } catch (e) { return ''; }
    }

    _prepScript(text = '', provider = '', { keepTags = false } = {}) {
        let t = String(text || '');
        t = t.replace(/\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\u200d\ufe0f]/gu, '').replace(/[♡♥♪♫★☆◆◇■□●○※]/g, '');
        // 「……」在 Fish 里常被念成一口喘气 / 气声（日文台词尤其明显），统一收成一个「…」：停顿还在，不会平白喘
        t = t.replace(/[—―]{2,}/g, '…').replace(/(?:…|‥|\.{3,}|・{3,})+/g, '…');
        if (keepTags) return t.trim();
        if (provider !== 'fish') return t.replace(/\[[^\]\n]{1,40}\]\s*/g, '').trim();
        return scriptForModel(t, this._modelOf('fish')).trim();
    }

    // 给 Fish 加语气：S2 / S2.1 用 [自由描述]（和台词同一种语言），S1 只认固定的英文情绪 (tag)
    _withCue(text, cue = '', provider = '') {
        const c = String(cue || '').trim();
        if (!c || !this.getSettings().emotionCue || provider !== 'fish') return text;
        const model = this._modelOf('fish');
        if (/drama/i.test(model)) return text;
        if (/^s1\b|speech-1/i.test(model)) {
            const tag = this._cueToS1(c);
            return tag ? `(${tag}) ${text}` : text;
        }
        // 拆成最多 2 个短标签：[furious][voice breaking with tears]（官方建议叠 2 个以内，太长太杂会被“稀释”）
        let tags = c.replace(/[\[\]]/g, '').split(/[,，、;；]|\band\b/).map(x => x.trim()).filter(Boolean);
        // 旧格式的中文长描述：先换成 Fish 最稳的英文核心情绪词，再留一个短的中文补充
        if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(c) && !/[a-z]{3,}/i.test(c)) {
            const core = this._cueToS1(c);
            const extra = tags.find(x => x.length <= 8);
            tags = [core, extra].filter(Boolean);
        }
        tags = tags.slice(0, 2);
        return tags.length ? `${tags.map(t => `[${t}]`).join('')} ${text}` : text;
    }

    _cueToS1(cue = '') {
        const table = [
            [/哭|泣|涙|sob|cry/i, 'sobbing'], [/喘|呼吸.{0,3}(滞|急|乱|停)|屏住?呼吸|倒吸|息を呑|gasp|pant/i, 'gasping'], [/叹|ため息|sigh/i, 'sighing'], [/低语|小声|悄悄|ささや|小声|whisper/i, 'whispering'],
            [/喊|叫|怒鸣|叫ん|shout/i, 'shouting'], [/笑出声|大笑|爆笑|laugh/i, 'laughing'], [/轻笑|くすっ|chuckl/i, 'chuckling'],
            [/暴怒|激怒|furious/i, 'furious'], [/生气|怒|苛立|angry/i, 'angry'], [/不耐烦|イライラ|impatient/i, 'impatient'],
            [/讽刺|嘲|皮肉|sarcas/i, 'sarcastic'], [/轻蔑|鄙视|冷笑|見下|disdain|sneer/i, 'disdainful'], [/调侃|揶揄|からか|戏谑|tease|amus/i, 'amused'],
            [/得意|骄傲|自慢|proud/i, 'proud'], [/兴奋|激动|興奮|excit/i, 'excited'], [/开心|高兴|嬉し|楽し|joy|happy/i, 'joyful'],
            [/温柔|柔らか|优しい|優しく|soft|gentle/i, 'soft tone'], [/安慰|慰め|comfort/i, 'comforting'], [/真诚|真剣|sincere/i, 'sincere'],
            [/害羞|照れ|恥ずかし|embarrass/i, 'embarrassed'], [/尴尬|気まず|awkward/i, 'awkward'], [/委屈|不満|拗ね|upset/i, 'upset'],
            [/难过|伤心|悲し|sad/i, 'sad'], [/害怕|恐|怖|scared/i, 'scared'], [/紧张|緊張|nervous/i, 'nervous'], [/担心|心配|worr/i, 'worried'],
            [/慌|焦|panic/i, 'panicked'], [/惊|驚|surpris/i, 'surprised'], [/疑惑|困惑|不思議|confus/i, 'confused'], [/犹豫|ためら|hesita/i, 'hesitating'],
            [/冷淡|無関心|冷た|indifferent/i, 'indifferent'], [/严肃|真面目|serious/i, 'serious'], [/平静|落ち着|relax|calm/i, 'relaxed']
        ];
        for (const [re, tag] of table) if (re.test(cue)) return tag;
        return '';
    }

    // 名字读音：微信联系人 / 我的音色里填的「写法 → 读音」，合成前替换
    _readingRules() {
        const data = this._wx();
        const rules = [];
        const add = (list) => (Array.isArray(list) ? list : []).forEach(r => {
            const t = String(r?.text || '').trim(); const rd = String(r?.reading || '').trim();
            if (t && rd) rules.push([t, rd]);
        });
        try { (data?.getContacts?.() || []).forEach(c => add(c?.nameReadings)); } catch (e) { /* 忽略 */ }
        add(data?.data?.userInfo?.nameReadings);
        const seen = new Set();
        return rules.filter(([t]) => !seen.has(t) && seen.add(t)).sort((a, b) => b[0].length - a[0].length);
    }

    _applyReadings(text) {
        const rules = this._readingRules();
        if (!rules.length) return text;
        const re = new RegExp(rules.map(([t]) => reEsc(t)).join('|'), 'g');
        const map = new Map(rules);
        return String(text).replace(re, m => map.get(m) || m);
    }

    stop() {
        const p = this.playing;
        this.playing = null;
        try { this._amb?.stop(); } catch (e) { /* 忽略 */ }
        this._amb = null;
        try { this.audio.pause(); } catch (e) { /* 忽略 */ }
        if (p) {
            p.abort?.abort?.();
            p.bars.forEach(b => b.classList.remove('is-playing', 'is-loading'));
            p.trigger?.classList.remove('is-active');
        }
    }

    playMessage(id, trigger = null) {
        const el = document.querySelector(`#chat .mes[mesid="${id}"]`);
        const bars = Array.from(el?.querySelectorAll('.mes_text .yzsv-bar') || []);
        if (!bars.length) return;
        this.playBars(bars, { trigger });
    }

    async playBars(bars, { regen = false, trigger = null, prepared = null } = {}) {
        const same = this.playing && this.playing.trigger === trigger && trigger;
        this.stop();
        if (same) return; // 再点一次 = 停止
        const abort = new AbortController();
        const run = { bars, trigger, abort };
        this.playing = run;
        trigger?.classList.add('is-active');
        // 每句台词：长句拆成几段并行合成，合成完拼成一整段再播（不会播到一半断掉）；
        // 播这一句的时候，下一句已经在后台合成
        // 深度分析还没出结果：点播放时才分析的就现在开始；等它出来按分析的演法读
        let announce = false;
        if (this.getSettings().analysisMode === 'deep') {
            const mid = Number(bars[0]?.dataset?.mesid);
            const msg = window.SillyTavern?.getContext?.()?.chat?.[mid];
            const h = msg ? this._deepHashOf(msg) : '';
            const needStart = h && !this._deepJobs.has(h) && !this._deepEntry(msg);
            if (needStart) this._startDeep(mid);
            if (h && this._deepJobs.has(h)) {
                announce = true;
                bars.forEach(b => b.classList.add('is-loading'));
                trigger?.classList.add('is-busy');
                this._toast('正在分析情绪', '分析好、语音生成好会提示你');
                await this._deepJobs.get(h).catch(() => null);
                trigger?.classList.remove('is-busy');
                bars.forEach(b => b.classList.remove('is-loading'));
                if (this.playing !== run) return;
                const fresh = Array.from(document.querySelectorAll(`#chat .mes[mesid="${mid}"] .mes_text .yzsv-bar`));
                const byKey = new Map(fresh.map(b => [`${b.dataset.line}`, b]));
                bars = bars.map(b => byKey.get(`${b.dataset.line}`) || b);
                run.bars = bars;
            }
        }
        const queue = [];
        const voiceMemo = new Map();
        for (const bar of bars) {
            const sp = bar.dataset.speaker || '';
            if (!voiceMemo.has(sp)) voiceMemo.set(sp, await this._voiceFor(sp));
            if (this.playing !== run) return;
            const { vi, parts } = this._lineJob(voiceMemo.get(sp), bar.dataset.text, bar.dataset.cue || '', this._barDeep(bar));
            // 改过演法的句子：第一次播放时丢掉旧缓存，强制重新请求
            const fk = `${bar.dataset.mesid}:${bar.dataset.line}`;
            const fresh = !!this._forceFresh?.has(fk);
            if (fresh) this._forceFresh.delete(fk);
            if (parts.length) queue.push({ bar, parts, voice: vi, rate: PACE_SPEED[vi.deep?.p] || 1, fresh });
        }
        const jobs = new Array(queue.length);
        const start = (i) => {
            if (i >= queue.length || jobs[i]) return;
            const q = queue[i];
            // 刚重新生成好的：直接用那份，不再去缓存里找（保证播的是新的）
            const ready = prepared?.[String(q.bar.dataset.line)];
            jobs[i] = ready ? Promise.resolve(ready) : Promise.all(q.parts.map(part => this._synthRetry(part, q.voice, { regen: regen || q.fresh, signal: abort.signal })))
                .then(urls => this._joinAudio(urls));
            jobs[i].catch(() => {});
        };
        // 环境声：每句播之前看它所在的场景（这一楼开头的 + 中途换场景的那句起换），换了就交叉淡入淡出
        let ambMap = null;
        try { ambMap = this.getSettings().ambienceOn ? this._floorAmbience(Number(bars[0]?.dataset?.mesid)) : null; } catch (e) { ambMap = null; }
        const setAmb = (kind) => {
            const k = kind && kind !== 'none' ? kind : '';
            if ((this._amb?.kind || '') === k) return;
            try { this._amb?.stop(1.2); } catch (e) { /* 忽略 */ }
            this._amb = k ? startAmbience(k, (Number(this.getSettings().ambienceVol) || 30) / 100) : null;
        };
        try {
            start(0); start(1);
            for (let i = 0; i < queue.length; i++) {
                if (this.playing !== run) return;
                const q = queue[i];
                q.bar.classList.add('is-loading');
                const urls = await jobs[i];
                if (announce) { announce = false; this._toast('语音好了 🎧', '深度分析完毕，已按分析的情绪生成，开始播放', 'success'); }
                start(i + 1); start(i + 2);
                if (this.playing !== run) return;
                q.bar.classList.remove('is-loading');
                if (ambMap) setAmb(ambMap.get(String(q.bar.dataset.line)));
                q.bar.classList.add('is-playing');
                for (const url of urls) {
                    if (this.playing !== run) return;
                    await this._playUrl(url, run, q.rate);
                }
                q.bar.classList.remove('is-playing');
            }
        } catch (err) {
            if (abort.signal.aborted || err?.name === 'AbortError') return;
            console.warn('[正文朗读] 失败:', err);
            this._toast('朗读失败', String(err?.message || err).slice(0, 160));
        } finally {
            if (this.playing === run) this.stop();
        }
    }

    // 合成失败（比如免费额度并发限制）自动再试一次
    async _synthRetry(text, voice, opts) {
        try { return await this._synth(text, voice, opts); }
        catch (err) {
            if (opts?.signal?.aborted || err?.name === 'AbortError') throw err;
            await new Promise(r => setTimeout(r, 800));
            return this._synth(text, voice, { ...opts, regen: true });
        }
    }

    // 几段 mp3 直接首尾相接成一段；不是 mp3 的就按顺序分开播
    // 几段语音解码后拼成一段 WAV（时长准确，不会只播第一段）；解码不了就按顺序分开播
    async _joinAudio(urls) {
        if (urls.length <= 1) return urls;
        const key = urls.join('|');
        this._joined = this._joined || new Map();
        if (this._joined.has(key)) return [this._joined.get(key)];
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return urls;
            this._decoder = this._decoder || new Ctx();
            const bufs = [];
            for (const u of urls) {
                const ab = await (await fetch(u)).arrayBuffer();
                bufs.push(await new Promise((res, rej) => {
                    const p = this._decoder.decodeAudioData(ab, res, rej);
                    if (p && p.then) p.then(res, rej);
                }));
            }
            const rate = bufs[0].sampleRate;
            const gap = Math.round(rate * 0.12);
            const total = bufs.reduce((n, b) => n + b.length, 0) + gap * (bufs.length - 1);
            const pcm = new Float32Array(total);
            let at = 0;
            bufs.forEach((b, i) => {
                const ch0 = b.getChannelData(0);
                if (b.numberOfChannels > 1) {
                    const ch1 = b.getChannelData(1);
                    for (let k = 0; k < b.length; k++) pcm[at + k] = (ch0[k] + ch1[k]) / 2;
                } else pcm.set(ch0, at);
                at += b.length + (i < bufs.length - 1 ? gap : 0);
            });
            const url = URL.createObjectURL(encodeWav(pcm, rate));
            this._joined.set(key, url);
            if (this._joined.size > 80) {
                const first = this._joined.keys().next().value;
                this._safeRevoke(this._joined.get(first));
                this._joined.delete(first);
            }
            return [url];
        } catch (e) {
            console.warn('[正文朗读] 拼接失败，改为分段播放:', e);
            return urls;
        }
    }

    // 播一段，真正播完才进入下一段
    _playUrl(url, run, rate = 1) {
        return new Promise((resolve, reject) => {
            const a = this.audio;
            const r = Math.min(2, Math.max(0.5, Number(rate) || 1));
            let finished = false;
            const cleanup = () => { finished = true; a.onended = null; a.onerror = null; a.onpause = null; clearInterval(timer); };
            const done = () => { if (!finished) { cleanup(); resolve(); } };
            const fail = (err) => { if (!finished) { cleanup(); reject(err || new Error('音频播放失败')); } };
            // 有的手机浏览器播完不发 ended：暂停在结尾也算播完；被 stop() 打断也结束
            const timer = setInterval(() => {
                if (this.playing !== run) return done();
                if (a.paused && a.duration && a.currentTime >= a.duration - 0.25) done();
            }, 400);
            a.onended = done;
            a.onerror = () => fail();
            a.preload = 'auto';
            a.src = url;
            // 换 src 会把速度重置，所以每次都在 src 之后设；保持音调不变（不会变成花栗鼠 / 低沉）
            try { a.preservesPitch = true; a.mozPreservesPitch = true; a.webkitPreservesPitch = true; } catch (e) { /* 忽略 */ }
            try { a.defaultPlaybackRate = r; a.playbackRate = r; } catch (e) { /* 忽略 */ }
            const p = a.play();
            if (p && typeof p.catch === 'function') p.catch(err => fail(err));
        });
    }

    // 提示：小手机收起来时也要看得到，所以优先用酒馆自己的弹窗
    _toast(title, text, kind = 'info') {
        if (window.toastr) {
            const fn = window.toastr[kind] || window.toastr.info;
            try { fn.call(window.toastr, text, title, { timeOut: kind === 'error' ? 6000 : 3500 }); return; } catch (e) { /* 换下面的 */ }
        }
        if (this.phoneShell?.showNotification) this.phoneShell.showNotification(title, text, '🔊');
        else console.warn(title, text);
    }

    // 每轮自动分析：分析完把这一楼的语音全部生成好，再提示一次
    async _prefetchAfterDeep(id) {
        const el = document.querySelector(`#chat .mes[mesid="${id}"]`);
        const bars = Array.from(el?.querySelectorAll('.mes_text .yzsv-bar') || []);
        if (!bars.length) return;
        this._toast('深度分析完毕', `正在生成 ${bars.length} 句语音…`, 'info');
        const items = [];
        for (const b of bars) {
            const { vi, parts } = this._lineJob(await this._voiceFor(b.dataset.speaker || ''), b.dataset.text, b.dataset.cue || '', this._barDeep(b));
            items.push({ vi, parts, b });
        }
        let ok = 0, fail = 0, i = 0;
        const worker = async () => {
            while (i < items.length) {
                const it = items[i++];
                try { await Promise.all(it.parts.map(part => this._synthRetry(part, it.vi, {}))); ok += 1; }
                catch (e) { fail += 1; console.warn('[正文朗读] 生成失败:', e); }
            }
        };
        await Promise.all([worker(), worker(), worker()]);
        if (ok) this._toast('语音好了 🎧', `第 ${id} 楼 ${ok} 句已按分析的情绪生成${fail ? `，${fail} 句失败` : ''}，点 ▶ 就能听`, 'success');
        else this._toast('语音生成失败', '这一楼的语音都没生成成功，点 ▶ 会再试', 'error');
    }

    // 停下来后速度回到 1，别影响试听等其他播放
    _resetRate() { try { this.audio.defaultPlaybackRate = 1; this.audio.playbackRate = 1; } catch (e) { /* 忽略 */ } }

    async test(voice = '') {
        const url = await this._synth('你好呀，这是正文朗读的试听。', voice || this.getSettings().voice, { regen: true });
        this.stop();
        this.audio.src = url;
        this._resetRate();
        await this.audio.play();
    }

    clearCache() {
        this.cache.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { /* 忽略 */ } });
        this.cache.clear();
    }

    _injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = `
.yzsv-bar { display: inline-flex; align-items: center; gap: 3px; margin: 0 3px; vertical-align: middle; white-space: nowrap; }
.yzsv-btn { border: 1px solid rgba(255,255,255,.18); background: rgba(127,127,127,.16); color: inherit; opacity: .8; border-radius: 999px; padding: 0 8px; min-width: 26px; height: 22px; font-size: .75em; line-height: 20px; cursor: pointer; font-family: inherit; }
.yzsv-btn:hover { opacity: 1; }
.yzsv-regen { padding: 1px 7px; }
.yzsv-btn { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; touch-action: manipulation; }
.yzsv-regen.is-busy { animation: yzsv-spin .8s linear infinite; opacity: .8; pointer-events: none; }
@keyframes yzsv-spin { to { transform: rotate(360deg); } }
.yzsv-bar.is-loading .yzsv-play { opacity: .5; }
.yzsv-bar.is-loading .yzsv-play::after { content: '…'; }
.yzsv-bar.is-playing .yzsv-play { background: rgba(80,160,255,.28); border-color: rgba(80,160,255,.55); opacity: 1; }
.yzsv-all { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.yzsv-deep-open.yzsv-deep { border: 0; background: transparent; color: inherit; padding: 0; cursor: pointer; font-family: inherit; text-align: left; text-decoration: underline dotted; text-underline-offset: 3px; }
.yzsv-deep.is-nsfw { color: #e0608a; opacity: .95; }
.yzsv-deep { font-size: 12px; opacity: .72; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yzsv-deep.is-busy { animation: yzsvPulse 1.2s ease-in-out infinite; }
@keyframes yzsvPulse { 0%,100% { opacity: .45; } 50% { opacity: .9; } }
.yzsv-all .yzsv-btn.is-active { background: rgba(80,160,255,.28); border-color: rgba(80,160,255,.55); opacity: 1; }
.yzsv-pop { position: fixed; z-index: 100000; background: rgba(32,32,38,.96); color: #f2f2f2; border-radius: 14px; padding: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.35); font-size: 13px; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.yzsv-pop-title { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-weight: 600; margin-bottom: 10px; }
.yzsv-pop-title span { font-weight: 400; font-size: 11px; opacity: .6; }
.yzsv-pop button { font-family: inherit; cursor: pointer; }
.yzsv-pop-ai { width: 100%; border: 0; border-radius: 10px; padding: 9px; background: linear-gradient(135deg, #7f7fd5, #86a8e7); color: #fff; font-size: 13px; }
.yzsv-pop-ai:disabled { opacity: .7; }
.yzsv-pop-names { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.yzsv-pop-names button { border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.08); color: inherit; border-radius: 999px; padding: 5px 12px; font-size: 12.5px; }
.yzsv-pop-names button.is-on { background: rgba(134,168,231,.35); border-color: rgba(134,168,231,.8); }
.yzsv-pop-empty { margin-top: 10px; font-size: 11.5px; opacity: .75; line-height: 1.5; padding: 8px 10px; border-radius: 10px; border: 1px dashed rgba(255,255,255,.25); background: rgba(255,255,255,.05); }
.yzsv-pop-same { width: 100%; margin-top: 10px; border: 1px solid rgba(134,168,231,.65); background: rgba(134,168,231,.16); color: #dfe6ff; border-radius: 10px; font-size: 12.5px; padding: 8px 9px; line-height: 1.4; }
.yzsv-pop-same:active { background: rgba(134,168,231,.32); }

/* ---- 朗读 App ---- */
.yzsv-page { position: relative; height: 100%; width: 100%; display: flex; flex-direction: column; background: linear-gradient(180deg, #f3f0ff 0%, #f6f6fa 220px, #f6f6fa 100%); color: #222; overflow: hidden; font-size: 13px; box-sizing: border-box; }
.yzsv-head { flex: 0 0 auto; height: 68px; padding: 32px 10px 0; box-sizing: border-box; display: flex; align-items: center; gap: 4px; }
.yzsv-back { width: 34px; height: 34px; border: 0; background: transparent; color: #222; font-size: 16px; cursor: pointer; border-radius: 50%; }
.yzsv-head-title { flex: 1; text-align: center; font-size: 15px; font-weight: 600; margin-right: 38px; }
.yzsv-page .yzsv-body { flex: 1 1 0 !important; height: 0 !important; min-height: 0 !important; overflow-y: auto !important; overflow-x: hidden !important; -webkit-overflow-scrolling: auto !important; overscroll-behavior: contain; touch-action: pan-y !important; padding: 6px 14px 60px !important; box-sizing: border-box; scrollbar-width: none; }
.yzsv-page .yzsv-body::-webkit-scrollbar { display: none; }
.yzsv-hero { display: flex; align-items: center; gap: 12px; padding: 16px; border-radius: 18px; background: linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%); color: #fff; box-shadow: 0 8px 22px rgba(161,140,209,.35); margin-bottom: 16px; }
.yzsv-hero-icon { flex: 0 0 46px; height: 46px; border-radius: 14px; background: rgba(255,255,255,.25); display: flex; align-items: center; justify-content: center; font-size: 22px; }
.yzsv-hero b { display: block; font-size: 16px; }
.yzsv-hero small { display: block; margin-top: 3px; font-size: 11.5px; opacity: .9; }
.yzsv-sec { font-size: 12px; color: #8a8a99; margin: 0 6px 6px; font-weight: 600; letter-spacing: .5px; }
.yzsv-card { background: #fff; border-radius: 16px; padding: 4px 14px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
.yzsv-card.pad { padding: 14px; }
.yzsv-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f1f1f4; cursor: pointer; }
.yzsv-row:last-child { border-bottom: 0; }
.yzsv-row > span:first-child { flex: 1; min-width: 0; font-size: 14px; }
.yzsv-row small, .yzsv-note { display: block; color: #9a9aa6; font-size: 11px; line-height: 1.5; margin-top: 3px; font-weight: 400; }
.yzsv-switch { position: relative; flex: 0 0 44px; width: 44px; height: 26px; }
.yzsv-switch input, .yzsv-switch input[type=checkbox] { position: absolute !important; opacity: 0 !important; inset: 0 !important; width: 100% !important; height: 100% !important; margin: 0 !important; padding: 0 !important; cursor: pointer; -webkit-appearance: none !important; appearance: none !important; background: transparent !important; border: 0 !important; box-shadow: none !important; outline: none !important; z-index: 2; }
.yzsv-switch input::before, .yzsv-switch input::after { display: none !important; content: none !important; }
.yzsv-chips-mini { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.yzsv-chips-mini button { border: 1px solid #e3def2; background: #f7f5fc; color: #6b54a8; border-radius: 999px; padding: 3px 9px; font-size: 11.5px; cursor: pointer; font-family: inherit; }
.yzsv-chips-mini button.is-on { background: #3b82f6; border-color: #3b82f6; color: #fff; }
.yzsv-switch i { position: absolute; inset: 0; border-radius: 13px; background: #e2e2e8; transition: background .2s; pointer-events: none; }
.yzsv-switch i::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2); transition: transform .2s; }
.yzsv-switch.is-on i { background: #a18cd1; }
.yzsv-switch.is-on i::after { transform: translateX(18px); }
[data-sw-row] { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.yzsv-field { margin-bottom: 12px; }
.yzsv-field:last-child { margin-bottom: 0; }
.yzsv-field label { display: block; font-size: 12.5px; color: #555; margin-bottom: 6px; font-weight: 600; }
.yzsv-input { width: 100%; box-sizing: border-box; border: 1px solid #ececf2; border-radius: 11px; padding: 9px 11px; font-size: 13px; background: #f8f8fb; color: #222; outline: none; }
.yzsv-input:focus { border-color: #a18cd1; background: #fff; }
select.yzsv-input { height: 40px; padding: 0 30px 0 11px; line-height: 38px; -webkit-appearance: none; appearance: none; background-image: linear-gradient(45deg, transparent 50%, #999 50%), linear-gradient(135deg, #999 50%, transparent 50%); background-position: calc(100% - 16px) 17px, calc(100% - 11px) 17px; background-size: 5px 5px; background-repeat: no-repeat; text-overflow: ellipsis; }
.yzsv-api[hidden], .yzsv-deepbox[hidden], .yzsv-mode-note[hidden] { display: none !important; }
.yzsv-cfg { font-size: .7em; }
.yzsv-play.is-fav { position: relative; border-color: rgba(255,196,60,.8); box-shadow: 0 0 0 1px rgba(255,196,60,.35) inset; }
.yzsv-play.is-fav::after { content: '★'; position: absolute; top: -7px; right: -5px; font-size: 10px; color: #ffc43c; text-shadow: 0 0 2px rgba(0,0,0,.6); }
.yzsv-tagrow { display: flex; gap: 6px; margin-top: 8px; }
.yzsv-tagrow input { flex: 1; min-width: 0; height: 30px; border: 1px solid #ddd; border-radius: 8px; padding: 0 8px; font-size: 12.5px; }
.yzsv-tagrow button { border: 0; border-radius: 8px; padding: 0 12px; background: #a18cd1; color: #fff; font-size: 12.5px; cursor: pointer; }
.yzsv-range { width: 100%; accent-color: #a18cd1; }
.yzsv-favbtn { display: flex; align-items: center; gap: 8px; width: 100%; margin: 12px 0 2px; padding: 12px 14px; border: 0; border-radius: 16px; background: #fff; box-shadow: 0 2px 10px rgba(120,100,180,.08); cursor: pointer; text-align: left; font-family: inherit; color: #333; }
.yzsv-favbtn span { font-size: 14.5px; font-weight: 600; flex: 0 0 auto; }
.yzsv-favbtn small { flex: 1; min-width: 0; font-size: 11.5px; color: #999; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yzsv-favbtn i { font-style: normal; color: #bbb; font-size: 18px; }
.yzsv-ffilter { position: sticky; top: 0; z-index: 2; background: #f6f4fb; padding: 4px 0 8px; margin-bottom: 4px; }
.yzsv-fsearch { margin-bottom: 8px; }
.yzsv-frow { display: flex; align-items: center; gap: 5px; overflow-x: auto; scrollbar-width: none; padding: 2px 0; }
.yzsv-frow::-webkit-scrollbar { display: none; }
.yzsv-frow > span { flex: 0 0 auto; font-size: 11.5px; color: #999; width: 30px; }
.yzsv-fchip { flex: 0 0 auto; border: 1px solid #e3def2; background: #fff; color: #6b54a8; border-radius: 999px; padding: 3px 10px; font-size: 12px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.yzsv-fchip em { font-style: normal; margin-left: 4px; font-size: 10.5px; color: #aaa; }
.yzsv-fchip.is-on { background: #3b82f6; border-color: #3b82f6; color: #fff; }
.yzsv-fchip.is-on em { color: rgba(255,255,255,.8); }
.yzsv-fday { font-size: 12px; color: #999; margin: 12px 4px 6px; }
.yzsv-fav-top b { cursor: pointer; }
.yzsv-fav-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.yzsv-fav-tags span { font-size: 11.5px; color: #3b82f6; background: #eef4ff; border-radius: 6px; padding: 1px 7px; cursor: pointer; }
.yzsv-fav-tags button { border: 1px dashed #ccc; background: transparent; color: #999; border-radius: 6px; padding: 0 7px; font-size: 11.5px; cursor: pointer; font-family: inherit; }
.yzsv-fav { background: #fff; border-radius: 16px; padding: 12px 14px; margin-bottom: 10px; box-shadow: 0 2px 10px rgba(120,100,180,.06); }
.yzsv-fav-top { display: flex; align-items: baseline; gap: 8px; }
.yzsv-fav-top b { font-size: 14px; color: #6b54a8; }
.yzsv-fav-top span { font-size: 11px; color: #aaa; }
.yzsv-fav-text { margin-top: 6px; font-size: 14px; line-height: 1.6; color: #222; word-break: break-word; }
.yzsv-fav-trans { margin-top: 6px; padding: 7px 10px; border-radius: 10px; background: #f5f2fc; font-size: 13px; line-height: 1.55; color: #555; }
.yzsv-fav-trans[hidden] { display: none; }
.yzsv-fav-acts { display: flex; gap: 8px; margin-top: 9px; }
.yzsv-fav-acts button { border: 0; border-radius: 9px; padding: 6px 12px; font-size: 12.5px; background: #f1eefa; color: #6b54a8; cursor: pointer; font-family: inherit; }
.yzsv-fav-acts button.danger { margin-left: auto; background: #fbeeee; color: #c0504a; }
.yzsv-regen-tip { font-size: .72em; opacity: .85; margin-left: 4px; padding: 1px 7px; border-radius: 999px; background: rgba(161,140,209,.25); white-space: nowrap; }
.yzsv-bar.is-regen .yzsv-regen { animation: yzsvSpin 1s linear infinite; }
@keyframes yzsvSpin { to { transform: rotate(360deg); } }
.yzsv-bar.is-regen .yzsv-play { opacity: .35; pointer-events: none; }
.yzsv-cfg.is-edited { background: rgba(161,140,209,.35); border-color: rgba(161,140,209,.7); opacity: 1; }
.yzsv-key { display: flex; gap: 8px; align-items: center; }
.yzsv-key .yzsv-input { flex: 1; min-width: 0; }
.yzsv-eye { flex: 0 0 40px; height: 40px; border: 1px solid #ececf2; border-radius: 11px; background: #f8f8fb; color: #777; cursor: pointer; font-size: 14px; }
.yzsv-eye { display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.yzsv-eye .yzsv-eye-slash { display: none; }
.yzsv-eye.is-hidden .yzsv-eye-slash { display: inline; }
.yzsv-fetch { flex: 0 0 auto; height: 40px; white-space: nowrap; }
.yzsv-spk { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 12px; background: #f8f8fb; margin-bottom: 8px; }
.yzsv-spk-av { flex: 0 0 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg, #a18cd1, #fbc2eb); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; }
.yzsv-spk .yzsv-input { background: #fff; padding: 7px 9px; }
.yzsv-spk .yzsv-input[data-spk="name"] { flex: 0 0 34%; }
.yzsv-spk-del { flex: 0 0 28px; height: 28px; border: 0; border-radius: 50%; background: transparent; color: #c9c9d3; font-size: 15px; cursor: pointer; }
.yzsv-mini { border: 0; background: #f1f0f7; border-radius: 10px; padding: 9px 12px; font-size: 12.5px; color: #444; cursor: pointer; font-family: inherit; }
.yzsv-mini.is-primary { background: #a18cd1; color: #fff; font-weight: 600; }
.yzsv-mini.is-wide { width: 100%; border: 1.5px dashed #d9d4ec; background: transparent; color: #8a7bbf; }
.yzsv-seg { display: flex; gap: 6px; }
.yzsv-seg button { flex: 1; border: 1px solid #e3e0ef; background: #f8f8fb; border-radius: 10px; padding: 8px 6px; font-size: 12px; color: #555; cursor: pointer; font-family: inherit; }
.yzsv-seg button.is-on { border-color: #a18cd1; background: #f1ecff; color: #6b54b8; font-weight: 600; }
.yzsv-btns { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 12px; }
`;
        document.head.appendChild(st);
    }
}

// ---------- 小手机里的「朗读」App：设置页 ----------
const TTS_CHANNELS = [
    { id: 'fish', label: 'Fish Audio', models: ['s2.1-pro', 's2.1-pro-free', 's2-pro', 's1', 'drama-3-preview'] },
    { id: 'minimax_cn', label: 'MiniMax（国内）', models: ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-02-hd', 'speech-02-turbo'] },
    { id: 'minimax_intl', label: 'MiniMax（国际）', models: ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-02-hd', 'speech-02-turbo'] },
    { id: 'openai', label: 'OpenAI', models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] },
    { id: 'volcengine', label: '豆包 / 火山引擎', models: [] },
    { id: 'indextts', label: 'IndexTTS（本地）', models: ['index-tts2'] },
    { id: 'custom_openai', label: '第三方（OpenAI 兼容）', models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] }
];

export class StoryVoiceApp {
    constructor(phoneShell, storyVoice) {
        this.phoneShell = phoneShell;
        this.sv = storyVoice;
    }

    // 页面切换：main = 首页；api = API 设置；emotion = 情绪分析
    render(page) {
        if (page) this._page = page;
        const p = this._page || 'main';
        if (p === 'api') return this._renderApi();
        if (p === 'emotion') return this._renderEmotion();
        return this._renderMain();
    }

    _sw(s, k, title, desc, style = '') {
        return `<div class="yzsv-row" data-sw-row style="${style}"><span>${title}<small>${desc}</small></span><span class="yzsv-switch${s[k] ? ' is-on' : ''}" role="switch" aria-checked="${s[k] ? 'true' : 'false'}" data-k="${k}"><i></i></span></div>`;
    }

    _subHead(title) {
        return `<div class="yzsv-head">
                    <button class="yzsv-back" id="yzsv-sub-back" type="button" aria-label="返回"><i class="fa-solid fa-chevron-left"></i></button>
                    <div class="yzsv-head-title">${title}</div>
                </div>`;
    }

    _deepConnLabel(s) {
        if (s.deepProfile === '__custom__') return `自定义 API${s.deepModel ? ' · ' + s.deepModel : ''}`;
        if (s.deepProfile) { const p = this.sv.connectionProfiles().find(x => x.id === s.deepProfile); return `酒馆连接 · ${p?.name || '（已不存在）'}`; }
        return '跟随酒馆当前的 API';
    }

    _renderMain() {
        const s = this.sv.getSettings();
        const spk = s.speakers.length ? s.speakers : [{ name: '', voice: '' }];
        const sw = (...a) => this._sw(s, ...a);
        const row = (x) => `<div class="yzsv-spk"><span class="yzsv-spk-av">${esc((x.name || '?').slice(0, 1))}</span><input class="yzsv-input" data-spk="name" placeholder="角色名" value="${esc(x.name)}"><input class="yzsv-input" data-spk="voice" placeholder="音色 ID" value="${esc(x.voice)}"><button type="button" class="yzsv-spk-del" data-spk-del title="删除">✕</button></div>`;
        const count = this.sv.standalone ? (this.sv.voiceSource?.count?.() || 0) : s.speakers.filter(x => x.name && x.voice).length;
        // 角色库摘要
        let libSum = '';
        try {
            const all = this.sv.voiceSource?.active?.() || [];
            const me = all.find(x => x.isUser);
            libSum = `${me ? `我：${me.name}` : '还没设「我」'} · 角色 ${all.length - (me ? 1 : 0)} · NPC ${s.npcMode === 'npc' ? '都读' : '不读'}`;
        } catch (e) { libSum = ''; }
        // API 摘要
        const chanLabel = (id) => (TTS_CHANNELS.find(c => c.id === id) || {}).label || id;
        const ready = TTS_CHANNELS.filter(c => /✓/.test(this._channelState(c.id))).length;
        const apiSum = s.channelMode === 'unified' ? `统一用 ${chanLabel(s.ttsProvider || 'fish')}${this._channelState(s.ttsProvider || 'fish')}` : `每人用自己的渠道 · 已配好 ${ready} 个`;
        const modeName = { simple: '简单分析', deep: '深度分析', manual: '手动' }[s.analysisMode] || '简单分析';
        const emoSum = `${modeName}${s.analysisMode === 'deep' ? (s.deepAuto ? ' · 每轮自动' : ' · 点播放时分析') : ''} · 环境声${s.ambienceOn ? '开' : '关'}`;
        const entry = (go, ic, title, sum) => `<button type="button" class="yzr-entry" data-go="${go}"><span class="yzr-entry-ic">${ic}</span><span class="yzr-entry-t"><b>${title}</b><small>${esc(sum)}</small></span><i>›</i></button>`;
        const html = `
            <div class="yzsv-page">
                <div class="yzsv-head">
                    ${this.sv.standalone ? '' : '<button class="yzsv-back" id="yzsv-back" type="button" aria-label="返回"><i class="fa-solid fa-chevron-left"></i></button>'}
                    <div class="yzsv-head-title">正文朗读</div>
                </div>
                <div class="yzsv-body app-body">
                    <div class="yzsv-hero">
                        <div class="yzsv-hero-icon">🔊</div>
                        <div><b>${s.enabled ? '朗读已开启' : '朗读已关闭'}</b><small>角色音色 ${count} 个 · 对白符号 ${esc(s.quotes || '未设置')}</small></div>
                    </div>

                    <div class="yzsv-card yzr-entries">
                        ${this.sv.standalone ? entry('lib', '👥', '角色库', libSum) : ''}
                        ${entry('api', '🔌', 'API 设置', apiSum)}
                        ${entry('emotion', '🎭', '情绪分析', emoSum)}
                        ${entry('favs', '⭐', '语音收藏', '长按正文里的 ▶ 收藏，再长按取消')}
                    </div>

                    <div class="yzsv-sec">基础</div>
                    <div class="yzsv-card">
                        ${sw('enabled', '启用正文朗读', '正文里对白符号中的台词后面出现 ▶ 和 ↻')}
                        ${sw('lineEdit', '每句后面显示 🎭', '单句调整演法的按钮；关掉后每句只剩 ▶ ↻，想调时在楼层下面的「逐句调整」或长按 ↻ 里进')}
                    </div>

                    <div class="yzsv-sec">对白符号 · 跳过符号</div>
                    <div class="yzsv-card pad">
                        <div class="yzsv-field"><label>对白符号（这些符号里的是台词）</label><input class="yzsv-input" data-k="quotes" value="${esc(s.quotes)}"></div>
                        <div class="yzsv-field"><label>跳过符号（这些符号里的不读）</label><input class="yzsv-input" data-k="skips" value="${esc(s.skips)}"></div>
                        <div class="yzsv-note">成对写，逗号分隔；开合各一个字符写在一起（「」），多字符或相同字符中间空一格（** **）。台词在引号里、译文在括号里：对白填 “”，跳过填 （）。</div>
                    </div>

                    ${!this.sv.standalone ? `<div class="yzsv-sec">角色音色</div><div class="yzsv-card pad"><div class="yzsv-field"><div id="yzsv-spk-list">${spk.map(row).join('')}</div><button type="button" class="yzsv-mini is-wide" id="yzsv-spk-add">＋ 添加角色</button></div></div>` : ''}
                    <div class="yzsv-btns">
                        <button type="button" class="yzsv-mini is-primary" id="yzsv-save">保存</button>
                        <button type="button" class="yzsv-mini" id="yzsv-test">试听</button>
                        <button type="button" class="yzsv-mini" id="yzsv-clear">清缓存</button>
                    </div>
                    <div class="yzsv-note" style="margin:8px 6px 0;">每句语音生成后会缓存，再点 ▶ 不会重复扣费。「试听」用默认音色；角色、NPC 的音色在「角色库」里配。</div>
                </div>
            </div>`;
        this.phoneShell.setContent(html, 'story-voice');
        this._bind();
    }

    _renderApi() {
        const s = this.sv.getSettings();
        const html = `
            <div class="yzsv-page">
                ${this._subHead('API 设置')}
                <div class="yzsv-body app-body">
                    <div class="yzsv-sec">语音渠道</div>
                    <div class="yzsv-card pad">
                        <div class="yzsv-field"><label>每个人用哪个渠道</label>
                            <div class="yzsv-seg">
                                <button type="button" data-chmode="unified" class="${s.channelMode === 'unified' ? 'is-on' : ''}">统一用一个渠道</button>
                                <button type="button" data-chmode="per" class="${s.channelMode !== 'unified' ? 'is-on' : ''}">每个人用自己的渠道</button>
                            </div>
                        </div>
                        ${s.channelMode === 'unified' ? `
                        <div class="yzsv-field"><label>正文朗读用哪个渠道</label>
                            <select class="yzsv-input" data-k="ttsProvider">${TTS_CHANNELS.map(c => `<option value="${c.id}" ${s.ttsProvider === c.id ? 'selected' : ''}>${c.label}${this._channelState(c.id)}</option>`).join('')}</select>
                        </div>
                        ${this._channelFields(s, s.ttsProvider || 'fish')}
                        ` : `<div class="yzsv-note" style="margin:8px 0">每位角色在首页「角色库」里选自己的渠道和音色。下方列出全部渠道，可分别填写地址、密钥及模型；配置状态独立保存。</div>
                        ${TTS_CHANNELS.map(c => `<div class="yzsv-field" style="margin-top:15px"><label style="font-weight:600">${c.label} ${this._channelState(c.id)}</label></div>${this._channelFields(s, c.id)}`).join('')}`}
                    </div>


                    <div class="yzsv-sec">深度分析用的模型</div>
                    <div class="yzsv-card pad">
                        <div class="yzsv-note" style="margin:0 0 12px;">只在「情绪分析」选了深度分析时才会用到（当前：${esc({ simple: '简单分析', deep: '深度分析', manual: '手动' }[s.analysisMode] || '简单分析')}）。</div>
                        <div class="yzsv-field"><label>深度分析用的连接</label>
                            <select class="yzsv-input" data-k="deepProfile">
                                <option value="">跟随酒馆当前的 API</option>
                                <option value="__custom__" ${s.deepProfile === '__custom__' ? 'selected' : ''}>自定义 API（自己填地址和密钥）</option>
                                ${this.sv.connectionProfiles().map(p => `<option value="${esc(p.id)}" ${s.deepProfile === p.id ? 'selected' : ''}>酒馆连接 · ${esc(p.name)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="yzsv-api" ${s.deepProfile === '__custom__' ? '' : 'hidden'}>
                            <div class="yzsv-field"><label>已保存的接口（点一下切换）</label>
                                <div class="yzsv-key">
                                    <select class="yzsv-input" data-deep-preset>
                                        <option value="">${s.deepPresets.length ? '— 选一个快速切换 —' : '还没保存过'}</option>
                                        ${s.deepPresets.map(p => `<option value="${esc(p.id)}" ${p.url === s.deepApiUrl && p.model === s.deepModel && p.key === s.deepApiKey ? 'selected' : ''}>${esc(p.name)}（${esc(p.model || '未选模型')}）</option>`).join('')}
                                    </select>
                                    <button type="button" class="yzsv-mini yzsv-fetch" data-deep-preset-save>保存当前</button>
                                    <button type="button" class="yzsv-mini yzsv-fetch" data-deep-preset-del title="删除选中的">删除</button>
                                </div>
                            </div>
                            <div class="yzsv-field"><label>API 地址</label><input class="yzsv-input" data-k="deepApiUrl" value="${esc(s.deepApiUrl)}" placeholder="https://api.example.com/v1" spellcheck="false" autocomplete="off"></div>
                            <div class="yzsv-field"><label>API 密钥</label>
                                <div class="yzsv-key"><input class="yzsv-input" type="password" data-k="deepApiKey" value="${esc(s.deepApiKey)}" placeholder="sk-..." spellcheck="false" autocomplete="new-password"><button type="button" class="yzsv-eye is-hidden" title="显示 / 隐藏"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="yzsv-eye-slash" d="M4 4l16 16"/></svg></button></div>
                            </div>
                            <div class="yzsv-field"><label>模型</label>
                                <div class="yzsv-key">
                                    <select class="yzsv-input" data-k="deepModel">
                                        ${(s.deepModels.length || s.deepModel) ? [...new Set([s.deepModel, ...s.deepModels].filter(Boolean))].map(m => `<option value="${esc(m)}" ${m === s.deepModel ? 'selected' : ''}>${esc(m)}</option>`).join('') : '<option value="">先拉取模型</option>'}
                                    </select>
                                    <button type="button" class="yzsv-mini yzsv-fetch" id="yzsv-fetch">${s.deepModels.length ? '重新拉取' : '拉取模型'}</button>
                                </div>
                            </div>
                            <div class="yzsv-btns" style="margin-bottom:10px;"><button type="button" class="yzsv-mini" id="yzsv-api-test">测试连接</button></div>
                        </div>
                        <div class="yzsv-field"><label>单次分析最长等待（秒）</label><input class="yzsv-input" data-k="deepTimeout" type="number" min="30" max="600" value="${esc(s.deepTimeout)}"></div>
                        <div class="yzsv-note">可以跟随酒馆、选酒馆「连接配置管理」里存的连接，或者选「自定义 API」自己填地址和密钥（OpenAI 兼容格式），拉取后选模型。分析结果只存在这台设备的浏览器里（最近 100 楼，更早的自动删），正文没改就不会重复调用；「清缓存」会一起清掉；楼层下面可以点「重新分析」。</div>
                    </div>
                </div>
            </div>`;
        this.phoneShell.setContent(html, 'story-voice');
        this._bind();
    }

    _renderEmotion() {
        const s = this.sv.getSettings();
        const sw = (...a) => this._sw(s, ...a);
        const html = `
            <div class="yzsv-page">
                ${this._subHead('情绪分析')}
                <div class="yzsv-body app-body">
                    <div class="yzsv-sec">分析模式</div>
                    <div class="yzsv-card pad">
                        <div class="yzsv-field"><label>怎么分析情绪</label>
                            <div class="yzsv-seg">
                                <button type="button" data-mode="simple" class="${s.analysisMode === 'simple' ? 'is-on' : ''}">简单分析</button>
                                <button type="button" data-mode="deep" class="${s.analysisMode === 'deep' ? 'is-on' : ''}">深度分析</button>
                                <button type="button" data-mode="manual" class="${s.analysisMode === 'manual' ? 'is-on' : ''}">手动</button>
                            </div>
                            <input type="hidden" data-k="analysisMode" value="${esc(s.analysisMode)}">
                        </div>
                        <div class="yzsv-note yzsv-mode-note" data-for="simple" ${s.analysisMode === 'simple' ? '' : 'hidden'} style="margin:-4px 0 10px;">简单分析：正文模型写台词时顺手标上 [[名字|语气]]，边写边生成，最快，不额外调用模型。哪句不对，点那句后面的 🎭 自己调。</div>
                        <div class="yzsv-note yzsv-mode-note" data-for="manual" ${s.analysisMode === 'manual' ? '' : 'hidden'} style="margin:-4px 0 10px;">手动：模型只标是谁说的，不写语气、不调用任何分析，先按原样读；想要情绪就点那句后面的 🎭（或楼层下面的「🎭 逐句调整」）自己配：情绪、声音、语气词、叠字、张力、语速，改完点 ▶ 只调用 Fish 生成这一句。</div>

                        <div class="yzsv-deepbox" ${s.analysisMode === 'deep' ? '' : 'hidden'}>
                        <div class="yzsv-note" style="margin:-4px 0 12px;">把这一楼正文（连同前几楼的剧情）交给副 API 当配音导演：读懂剧情走向和人物此刻的心理，逐句定张力（1~5）、语速，在台词里插入叹气、倒抽气、哭腔、耳语、哽咽叠字等，合成时张力换成 Fish 的情绪起伏、语速换成快慢。</div>
                        <div class="yzsv-field"><label>什么时候分析</label>
                            <div class="yzsv-seg">
                                <button type="button" data-auto="0" class="${!s.deepAuto ? 'is-on' : ''}">点播放时才分析</button>
                                <button type="button" data-auto="1" class="${s.deepAuto ? 'is-on' : ''}">每轮自动分析</button>
                            </div>
                            <input type="hidden" data-k="deepAuto" value="${s.deepAuto ? '1' : '0'}">
                        </div>
                        <div class="yzsv-note" style="margin:-4px 0 12px;">点播放时才分析：每楼照常先挂 ▶ 和 ↻，点了哪一楼才调用副 API 分析那一楼，分析完生成语音、弹出提示并开始播放，不点就不花钱。<br>每轮自动分析：每次回复写完就自动分析并提前生成语音，点 ▶ 马上能听，但每轮都会调用一次副 API。</div>
                        <div class="yzsv-row" data-go="api" style="padding:8px 0 0;border:0"><span>深度分析用的连接<small>${esc(this._deepConnLabel(s))}</small></span><button type="button" class="yzr-link">去 API 设置改 ›</button></div>
                        </div>
                    </div>

                    <div class="yzsv-sec">环境声 · 拟声词</div>
                    <div class="yzsv-card pad">
                        ${sw('ambienceOn', '环境声', '播台词时在底下轻轻垫一层雨声、风声、海浪、虫鸣、室内、篝火、人声嘈杂、咖啡馆。深度分析和简单分析按正文场景自动选；手动在 🎭 里给这一楼选', 'padding:0 0 10px;')}
                        <div class="yzsv-field"><label>环境声音量 <span class="yzsv-ambv">${esc(s.ambienceVol)}</span>%</label><input type="range" min="5" max="80" step="5" class="yzsv-range" data-k="ambienceVol" value="${esc(s.ambienceVol)}"></div>
                        ${sw('autoOno', '自动加拟声词', '简单分析用：语气是大笑就在台词前加「哈哈」，哭加「呜……」，叹气加「唉……」（日文台词用 あはは / うぅ / はぁ）。深度分析由模型自己加，手动在 🎭 的「拟声/音效」里加', 'padding:0 0 10px;')}
                    </div>
                </div>
            </div>`;
        this.phoneShell.setContent(html, 'story-voice');
        this._bind();
    }

    _root() {
        return this.phoneShell?.rootEl || document.querySelector('.phone-view-current') || document;
    }

    // ---------- 语音收藏页 ----------
    async renderFavs() {
        let all = [];
        try { all = await favStore.all(); } catch (e) { all = []; }
        const f = this._favFilter = this._favFilter || { speaker: '', tag: '', source: '', q: '' };
        const speakers = new Map();
        const tags = new Map();
        all.forEach(x => {
            const sp = x.speaker || '未知';
            speakers.set(sp, (speakers.get(sp) || 0) + 1);
            (x.tags || []).forEach(t => tags.set(t, (tags.get(t) || 0) + 1));
        });
        const list = all.filter(x => (!f.speaker || (x.speaker || '未知') === f.speaker)
            && (!f.tag || (x.tags || []).includes(f.tag))
            && (!f.source || x.source === f.source)
            && (!f.q || `${x.text} ${x.translation || ''} ${x.speaker || ''}`.toLowerCase().includes(f.q.toLowerCase())));
        const day = (t) => {
            const d = new Date(t); const now = new Date();
            const same = (a, b) => a.toDateString() === b.toDateString();
            if (same(d, now)) return '今天';
            const y = new Date(now); y.setDate(now.getDate() - 1);
            if (same(d, y)) return '昨天';
            return `${d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '年'}${d.getMonth() + 1}月${d.getDate()}日`;
        };
        const hm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
        let lastDay = '';
        const chip = (kind, val, label, n) => `<button type="button" class="yzsv-fchip${f[kind] === val ? ' is-on' : ''}" data-f="${kind}" data-v="${esc(val)}">${esc(label)}${n !== undefined ? `<em>${n}</em>` : ''}</button>`;
        const html = `
            <div class="yzsv-page">
                <div class="yzsv-head">
                    <button class="yzsv-back" id="yzsv-fav-back" type="button" aria-label="返回"><i class="fa-solid fa-chevron-left"></i></button>
                    <div class="yzsv-head-title">语音收藏 <small style="font-weight:400;color:#999;font-size:12px">${all.length}</small></div>
                </div>
                <div class="yzsv-body app-body">
                    <div class="yzsv-ffilter">
                        <input class="yzsv-input yzsv-fsearch" type="search" placeholder="搜台词、翻译、角色" value="${esc(f.q)}">
                        <div class="yzsv-frow"><span>角色</span>${chip('speaker', '', '全部', all.length)}${[...speakers].sort((a, b) => b[1] - a[1]).map(([k, n]) => chip('speaker', k, k, n)).join('')}</div>
                        ${tags.size ? `<div class="yzsv-frow"><span>标签</span>${chip('tag', '', '全部')}${[...tags].sort((a, b) => b[1] - a[1]).map(([k, n]) => chip('tag', k, `#${k}`, n)).join('')}</div>` : ''}
                    </div>
                    ${all.length ? (list.length ? '' : '<div class="yzsv-note" style="text-align:center;padding:30px 10px;">没有符合筛选的收藏</div>') : '<div class="yzsv-note" style="text-align:center;padding:40px 10px;">还没有收藏<br>正文里长按某句的 ▶（再长按一次取消），或长按 ↻ 选「⭐ 收藏这句语音」</div>'}
                    ${list.map(x => {
                        const d = day(x.at);
                        const head = d !== lastDay ? `<div class="yzsv-fday">${d}</div>` : '';
                        lastDay = d;
                        return `${head}
                        <div class="yzsv-fav" data-id="${esc(x.id)}">
                            <div class="yzsv-fav-top"><b data-pick-speaker="${esc(x.speaker || '未知')}">${esc(x.speaker || '未知')}</b><span>${x.source === 'wechat' ? '微信语音' : '正文'}${x.chat && x.chat !== x.speaker ? ` · ${esc(x.chat)}` : ''} · ${hm(x.at)}</span></div>
                            <div class="yzsv-fav-text">${esc(x.text)}</div>
                            ${needsTranslation(x.text) ? `<div class="yzsv-fav-trans" ${x.translation ? '' : 'hidden'}>${esc(x.translation || '')}</div>` : ''}
                            <div class="yzsv-fav-tags">${(x.tags || []).map(t => `<span data-pick-tag="${esc(t)}">#${esc(t)}</span>`).join('')}<button type="button" data-fav-tag>＋标签</button></div>
                            <div class="yzsv-fav-acts">
                                <button type="button" data-fav-play>▶ 播放</button>
                                ${needsTranslation(x.text) ? `<button type="button" data-fav-trans>${x.translation ? '隐藏翻译' : '查看翻译'}</button>` : ''}
                                <button type="button" data-fav-del class="danger">删除</button>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        this.phoneShell.setContent(html, 'story-voice');
        const root = this._root();
        this._fixScroll(root);
        const toast = (t, m, i = '⭐') => this.phoneShell?.showNotification?.(t, m, i);
        const rerender = () => { const top = root.querySelector('.yzsv-body')?.scrollTop || 0; this.renderFavs().then(() => { const nb = this._root().querySelector('.yzsv-body'); if (nb) nb.scrollTop = top; }); };
        root.querySelector('#yzsv-fav-back')?.addEventListener('click', () => { this._favAudio?.pause(); this.render(); });
        root.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { f[b.dataset.f] = b.dataset.v; rerender(); }));
        root.querySelectorAll('[data-pick-speaker]').forEach(b => b.addEventListener('click', () => { f.speaker = b.dataset.pickSpeaker; rerender(); }));
        root.querySelectorAll('[data-pick-tag]').forEach(b => b.addEventListener('click', () => { f.tag = b.dataset.pickTag; rerender(); }));
        let qTimer = null;
        root.querySelector('.yzsv-fsearch')?.addEventListener('input', (e) => {
            clearTimeout(qTimer);
            qTimer = setTimeout(() => { f.q = e.target.value.trim(); rerender(); setTimeout(() => { const i = this._root().querySelector('.yzsv-fsearch'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 30); }, 400);
        });
        const byId = new Map(list.map(x => [x.id, x]));
        root.querySelectorAll('.yzsv-fav').forEach(card => {
            const rec = byId.get(card.dataset.id);
            card.querySelector('[data-fav-play]')?.addEventListener('click', (e) => {
                const btn = e.currentTarget;
                this._favAudio = this._favAudio || new Audio();
                const a = this._favAudio;
                if (this._favPlaying === rec.id && !a.paused) { a.pause(); btn.textContent = '▶ 播放'; return; }
                root.querySelectorAll('[data-fav-play]').forEach(b => { b.textContent = '▶ 播放'; });
                try { if (this._favUrl) URL.revokeObjectURL(this._favUrl); } catch (err) { /* 忽略 */ }
                this._favUrl = URL.createObjectURL(rec.blob);
                a.src = this._favUrl;
                try { a.preservesPitch = true; a.defaultPlaybackRate = rec.rate || 1; a.playbackRate = rec.rate || 1; } catch (err) { /* 忽略 */ }
                this._favPlaying = rec.id;
                btn.textContent = '■ 停止';
                a.onended = () => { btn.textContent = '▶ 播放'; };
                a.play().catch(err => { btn.textContent = '▶ 播放'; toast('播放失败', String(err?.message || err)); });
            });
            card.querySelector('[data-fav-tag]')?.addEventListener('click', async () => {
                const cur = (rec.tags || []).join('，');
                const v = window.prompt('标签（用逗号隔开，留空就是清空）', cur);
                if (v === null) return;
                const next = [...new Set(String(v).split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean))].slice(0, 8);
                await favStore.update(rec.id, { tags: next });
                rerender();
            });
            card.querySelector('[data-fav-trans]')?.addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                const box = card.querySelector('.yzsv-fav-trans');
                if (!box) return;
                if (!box.hidden && rec.translation) { box.hidden = true; btn.textContent = '查看翻译'; return; }
                if (!rec.translation) {
                    btn.disabled = true;
                    btn.textContent = '翻译中…';
                    try {
                        rec.translation = await this.sv.translateText(rec.text);
                        await favStore.update(rec.id, { translation: rec.translation });
                    } catch (err) {
                        btn.disabled = false;
                        btn.textContent = '查看翻译';
                        toast('翻译失败', String(err?.message || err).slice(0, 120), '⚠️');
                        return;
                    }
                    btn.disabled = false;
                }
                box.textContent = rec.translation;
                box.hidden = false;
                btn.textContent = '隐藏翻译';
            });
            card.querySelector('[data-fav-del]')?.addEventListener('click', async () => {
                if (!window.confirm('删除这条收藏？')) return;
                await favStore.remove(rec.id);
                this.sv._favKeys?.delete(`${rec.speaker}\u0001${rec.text}`);
                this.sv.refreshAll();
                rerender();
            });
        });
    }

    // 选中渠道下面的地址 / Key / 模型
    _channelFields(s, channel = null) {
        const ch = channel || s.ttsProvider || 'fish';
        const eye = '<button type="button" class="yzsv-eye is-hidden" data-eye title="显示 / 隐藏"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path class="yzsv-eye-slash" d="M4 4l16 16"/></svg></button>';
        const meta = TTS_CHANNELS.find(c => c.id === ch) || { models: [] };
        let url = '', key = '', model = '', placeholder = '';
        if (ch === 'custom_openai') {
            url = s.customUrl; key = s.customKey; model = s.customModel;
            placeholder = '例：gpt-4o-mini-tts';
        } else {
            let c = {};
            try { c = this.sv.tts?._resolveConfig?.({ provider: ch }) || {}; } catch (e) { c = {}; }
            url = c.apiUrl || ''; key = c.apiKey || '';
            model = s.ttsModels?.[ch] || '';
            placeholder = `留空 = 用「设置 → 语音」里的（${c.model || '默认'}）`;
        }
        const list = [...new Set([...(ch === 'custom_openai' ? s.customModels : []), ...(this._fetched?.[ch] || []), ...meta.models])];
        return `
            <div class="yzsv-chan" data-chan="${esc(ch)}">
                <div class="yzsv-field"><label>接口地址</label><input class="yzsv-input" data-ch="url" value="${esc(url)}" placeholder="${ch === 'custom_openai' ? 'https://example.com/v1' : '这个渠道的接口地址'}" spellcheck="false" autocomplete="off"></div>
                <div class="yzsv-field"><label>API Key${key ? '' : ' <span style="color:#d0605a">（还没填）</span>'}</label><div class="yzsv-key"><input class="yzsv-input" type="password" data-ch="key" value="${esc(key)}" placeholder="sk-..." spellcheck="false" autocomplete="new-password">${eye}</div></div>
                <div class="yzsv-field"><label>模型${list.length ? `（${list.length} 个可选）` : ''}</label>
                    <div class="yzsv-key">
                        <select class="yzsv-input" data-ch="modelsel">
                            <option value="" ${!model ? 'selected' : ''}>${ch === 'custom_openai' ? '不指定' : esc(placeholder)}</option>
                            ${list.map(m => `<option value="${esc(m)}" ${m === model ? 'selected' : ''}>${esc(m)}</option>`).join('')}
                            ${model && !list.includes(model) ? `<option value="${esc(model)}" selected>${esc(model)}</option>` : ''}
                            <option value="__manual__">✎ 手动输入…</option>
                        </select>
                        <button type="button" class="yzsv-mini yzsv-fetch" data-ch-fetch>${this._fetched?.[ch] ? '重新拉取' : '拉取模型'}</button>
                    </div>
                    <input class="yzsv-input" data-ch="model" value="${esc(model)}" placeholder="输入模型名" spellcheck="false" autocomplete="off" hidden style="margin-top:8px;">
                </div>
                ${ch === 'volcengine' ? `<div class="yzsv-field"><label>APP ID</label><input class="yzsv-input" data-ch="app-id" value="${esc(this.sv.tts?._get?.('volcengine', 'app-id') || '')}" spellcheck="false"></div><div class="yzsv-field"><label>Resource ID</label><input class="yzsv-input" data-ch="resource-id" value="${esc(this.sv.tts?._get?.('volcengine', 'resource-id') || 'seed-tts-2.0')}" placeholder="seed-tts-2.0 / seed-icl-2.0" spellcheck="false"></div>` : ''}
                ${ch !== 'custom_openai' ? `<div class="yzsv-field"><label>这个渠道的默认音色</label><input class="yzsv-input" data-ch="voice" value="${esc(this.sv.tts?._get?.(ch, 'voice') || '')}" placeholder="角色音色库里没给某人填音色时用" spellcheck="false"></div>` : ''}
                ${ch === 'custom_openai' ? '<div class="yzsv-note" style="margin-top:-4px">第三方渠道按 OpenAI 的 /v1/audio/speech 格式请求；角色音色填这个服务的音色名（如 alloy、nova，或服务商给的音色 ID）。</div>' : ''}
            </div>`;
    }

    // 下拉里提示这个渠道有没有配好 Key
    _channelState(provider) {
        if (provider === 'custom_openai') { const st = this.sv.getSettings(); return st.customUrl ? (st.customKey ? ' ✓ 已配置' : ' （还没填 Key）') : ' （还没填地址）'; }
        try {
            const c = this.sv.tts?._resolveConfig?.({ provider });
            if (!c) return '';
            if (provider === 'indextts') return c.apiUrl ? ' ✓' : ' （未配置）';
            return c.apiKey ? ' ✓ 已配置' : ' （还没填 Key）';
        } catch (e) { return ''; }
    }

    // 只收集当前页面上有的输入框；不在这一页的设置沿用已保存的值（分页后不会被清空）
    _collect() {
        const root = this._root();
        const cur = this.sv.getSettings();
        const val = k => root.querySelector(`[data-k="${k}"]`);
        const on = k => { const el = root.querySelector(`.yzsv-switch[data-k="${k}"]`); return el ? el.classList.contains('is-on') : !!cur[k]; };
        const str = k => { const el = val(k); return el ? String(el.value || '').trim() : cur[k]; };
        const num = (k, lo, hi, def) => { const el = val(k); return el ? Math.min(hi, Math.max(lo, Number(el.value) || def)) : cur[k]; };
        const speakers = root.querySelector('#yzsv-spk-list') ? Array.from(root.querySelectorAll('.yzsv-spk')).map(row => ({
            name: String(row.querySelector('[data-spk="name"]')?.value || '').trim(),
            voice: String(row.querySelector('[data-spk="voice"]')?.value || '').trim()
        })).filter(x => x.name || x.voice) : cur.speakers;
        const mode = str('analysisMode');
        return {
            enabled: on('enabled'),
            readUser: false,
            lineEdit: on('lineEdit'),
            analysisMode: ['simple', 'deep', 'manual'].includes(mode) ? mode : 'simple',
            ambienceOn: on('ambienceOn'),
            autoOno: on('autoOno'),
            ambienceVol: num('ambienceVol', 5, 80, 30),
            deepProfile: str('deepProfile') || '',
            deepApiUrl: str('deepApiUrl') || '',
            deepApiKey: str('deepApiKey') || '',
            deepModel: str('deepModel') || '',
            deepModels: cur.deepModels,
            deepAuto: val('deepAuto') ? String(val('deepAuto').value || '0') === '1' : !!cur.deepAuto,
            deepTimeout: num('deepTimeout', 30, 600, 150),
            quotes: val('quotes') ? (str('quotes') || DEFAULTS.quotes) : cur.quotes,
            skips: str('skips') || '',
            voice: str('voice') || '',
            npcMode: (str('npcMode') || 'only') === 'npc' ? 'npc' : 'only',
            ttsProvider: str('ttsProvider') || cur.ttsProvider || 'fish',
            npcMale: str('npcMale') || '',
            npcFemale: str('npcFemale') || '',
            speakers
        };
    }

    // 手机浏览器里滚到底/顶后，下一次滑动会被外层接走，看起来就“滑不动”了：
    // 每次手指按下时，让列表离开边缘 1px，滑动始终交给列表自己
    _fixScroll(root) {
        const body = root?.querySelector?.('.yzsv-body');
        if (!body || body.__yzsvScrollFix) return;
        body.__yzsvScrollFix = true;
        const nudge = () => {
            const max = body.scrollHeight - body.clientHeight;
            if (max <= 0) return;
            if (body.scrollTop <= 0) body.scrollTop = 1;
            else if (body.scrollTop >= max) body.scrollTop = max - 1;
        };
        body.addEventListener('touchstart', nudge, { passive: true });
        body.addEventListener('pointerdown', nudge, { passive: true });
        // 点输入框时浏览器可能把外层容器也顶上去，复位
        root.addEventListener('focusin', () => {
            setTimeout(() => {
                const page = root.querySelector('.yzsv-page');
                [page, page?.parentElement].forEach(el => { if (el && el.scrollTop) el.scrollTop = 0; });
            }, 300);
        });
        // 兜底：连续几下手指在动、列表却纹丝不动，就由我们自己滚（只在“卡住”时接管）
        let lastY = null, lastTop = 0, stuck = 0, manual = false;
        body.addEventListener('touchstart', (e) => { lastY = e.touches?.[0]?.clientY ?? null; lastTop = body.scrollTop; stuck = 0; manual = false; }, { passive: true });
        body.addEventListener('touchmove', (e) => {
            const y = e.touches?.[0]?.clientY;
            if (lastY == null || y == null) return;
            const dy = lastY - y;
            lastY = y;
            const max = body.scrollHeight - body.clientHeight;
            if (max <= 0 || Math.abs(dy) < 1) return;
            if (!manual) {
                const want = dy > 0 ? body.scrollTop < max : body.scrollTop > 0;
                if (want && body.scrollTop === lastTop) stuck += 1; else stuck = 0;
                lastTop = body.scrollTop;
                if (stuck >= 3) manual = true;
            }
            if (manual) {
                body.scrollTop = Math.max(0, Math.min(max, body.scrollTop + dy));
                lastTop = body.scrollTop;
            }
        }, { passive: true });
    }

    _bind() {
        const root = this._root();
        this._fixScroll(root);
        root.querySelectorAll('[data-npc]').forEach(b => b.addEventListener('click', () => {
            root.querySelectorAll('[data-npc]').forEach(x => x.classList.toggle('is-on', x === b));
            const h = root.querySelector('[data-k="npcMode"]');
            if (h) h.value = b.dataset.npc;
            this.sv.saveSettings(this._collect());
            toast('已保存', b.dataset.npc === 'npc' ? '没配音色的人用默认 NPC 音色读' : '只读配了音色的人');
        }));
        const toast = (t, m, i = '🔊') => this.phoneShell?.showNotification?.(t, m, i);
        // 首页入口 / 子页面返回
        root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
            const go = b.dataset.go;
            if (go === 'favs') return this.renderFavs();
            if (go === 'lib') return this.phoneShell?.openLibrary?.(this);
            this.render(go);
            const nb = this._root().querySelector('.yzsv-body');
            if (nb) nb.scrollTop = 0;
        }));
        root.querySelector('#yzsv-sub-back')?.addEventListener('click', () => this.render('main'));
        root.querySelector('#yzsv-back')?.addEventListener('click', () => {
            if (typeof this.phoneShell?.goHome === 'function') this.phoneShell.goHome();
            else window.dispatchEvent(new CustomEvent('phone:goHome'));
        });
        // 开关：点整行就切换（不用原生勾选框，酒馆的勾选框样式不会混进来）
        root.querySelectorAll('[data-sw-row]').forEach(row => row.addEventListener('click', () => {
            const swEl = row.querySelector('.yzsv-switch');
            if (!swEl) return;
            const next = !swEl.classList.contains('is-on');
            swEl.classList.toggle('is-on', next);
            swEl.setAttribute('aria-checked', next ? 'true' : 'false');
            const s = this.sv.saveSettings(this._collect());
            const hero = root.querySelector('.yzsv-hero b');
            if (hero) hero.textContent = s.enabled ? '朗读已开启' : '朗读已关闭';
        }));
        root.querySelector('#yzsv-save')?.addEventListener('click', () => {
            const s = this.sv.saveSettings(this._collect());
            toast('已保存', `对白符号 ${s.quotes || '（空）'}，角色音色 ${s.speakers.length} 个`, '✅');
        });
        const bindDel = (btn) => btn.addEventListener('click', () => {
            btn.closest('.yzsv-spk')?.remove();
            this.sv.saveSettings(this._collect());
        });
        root.querySelector('#yzsv-spk-add')?.addEventListener('click', () => {
            const list = root.querySelector('#yzsv-spk-list');
            if (!list) return;
            list.insertAdjacentHTML('beforeend', '<div class="yzsv-spk"><span class="yzsv-spk-av">?</span><input class="yzsv-input" data-spk="name" placeholder="角色名"><input class="yzsv-input" data-spk="voice" placeholder="音色 ID"><button type="button" class="yzsv-spk-del" data-spk-del title="删除">✕</button></div>');
            bindDel(list.lastElementChild.querySelector('[data-spk-del]'));
            bindName(list.lastElementChild.querySelector('[data-spk="name"]'));
            list.lastElementChild.querySelector('input')?.focus();
        });
        const bindName = (input) => input?.addEventListener('input', () => {
            const av = input.closest('.yzsv-spk')?.querySelector('.yzsv-spk-av');
            if (av) av.textContent = (input.value.trim() || '?').slice(0, 1);
        });
        root.querySelectorAll('[data-spk-del]').forEach(bindDel);
        root.querySelectorAll('[data-spk="name"]').forEach(bindName);
        root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
            root.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('is-on', x === b));
            const h = root.querySelector('[data-k="analysisMode"]');
            if (h) h.value = b.dataset.mode;
            const deepBox = root.querySelector('.yzsv-deepbox');
            if (deepBox) deepBox.hidden = b.dataset.mode !== 'deep';
            root.querySelectorAll('.yzsv-mode-note').forEach(n => { n.hidden = n.dataset.for !== b.dataset.mode; });
            this.sv.saveSettings(this._collect());
            toast('已保存', { deep: '深度分析：交给副 API 逐句分析情绪', simple: '简单分析：按正文里的 [[名字|语气]] 读', manual: '手动：自己逐句配情绪' }[b.dataset.mode] || '');
        }));
        const range = root.querySelector('input[data-k="ambienceVol"]');
        range?.addEventListener('input', () => { const v = root.querySelector('.yzsv-ambv'); if (v) v.textContent = range.value; });
        range?.addEventListener('change', () => this.sv.saveSettings(this._collect()));
        root.querySelectorAll('[data-chmode]').forEach(b => b.addEventListener('click', () => {
            root.querySelectorAll('[data-chmode]').forEach(x => x.classList.toggle('is-on', x === b));
            this.sv.saveSettings({ channelMode: b.dataset.chmode });
            const top = root.querySelector('.yzsv-body')?.scrollTop || 0;
            this.render();
            const nextBody = this._root().querySelector('.yzsv-body');
            if (nextBody) nextBody.scrollTop = top;
            toast('已保存', b.dataset.chmode === 'unified' ? '所有人统一用选的渠道' : '每个人按自己配的渠道读');
        }));
        root.querySelectorAll('[data-auto]').forEach(b => b.addEventListener('click', () => {
            root.querySelectorAll('[data-auto]').forEach(x => x.classList.toggle('is-on', x === b));
            const h = root.querySelector('[data-k="deepAuto"]');
            if (h) h.value = b.dataset.auto;
            this.sv.saveSettings(this._collect());
            toast('已保存', b.dataset.auto === '1' ? '每轮写完自动分析并生成语音' : '点播放时才分析那一楼');
        }));
        // 渠道的地址 / Key / 模型：第三方存在朗读设置里；小手机已有的渠道直接写回「设置 → 语音」
        root.querySelectorAll('.yzsv-chan').forEach(chanBox => {
        const saveChan = () => {
            if (!chanBox) return;
            const ch = chanBox.dataset.chan;
            const getRaw = (k) => String(chanBox.querySelector(`[data-ch="${k}"]`)?.value || '').trim();
            // 模型：下拉选的，或者选了「手动输入」后输入框里的
            const get = (k) => {
                if (k !== 'model') return getRaw(k);
                const sel = getRaw('modelsel');
                return sel === '__manual__' ? getRaw('model') : sel;
            };
            if (ch === 'custom_openai') {
                this.sv.saveSettings({ customUrl: get('url'), customKey: get('key'), customModel: get('model') });
            } else {
                const store = this.sv.storage;
                const keyOf = (f) => this.sv.tts?._getProviderConfigKey?.(ch, f) || `phone-tts-${ch}-${f}`;
                try {
                    store?.set?.(keyOf('url'), get('url')); store?.set?.(keyOf('key'), get('key'));
                    ['voice', 'app-id', 'resource-id'].forEach(f => { if (chanBox.querySelector(`[data-ch="${f}"]`)) store?.set?.(keyOf(f), get(f)); });
                } catch (e) { /* 忽略 */ }
                const models = { ...(this.sv.getSettings().ttsModels || {}) };
                if (get('model')) models[ch] = get('model'); else delete models[ch];
                this.sv.saveSettings({ ttsModels: models });
            }
            // 「已配置 / 还没填」的提示跟着更新
            const opt = root.querySelector(`select[data-k="ttsProvider"] option[value="${ch}"]`);
            const meta = TTS_CHANNELS.find(c => c.id === ch);
            if (opt && meta) opt.textContent = `${meta.label}${this._channelState(ch)}`;
            const keyLabel = chanBox.querySelector('[data-ch="key"]')?.closest('.yzsv-field')?.querySelector('label');
            if (keyLabel) keyLabel.innerHTML = `API Key${get('key') ? '' : ' <span style="color:#d0605a">（还没填）</span>'}`;
        };
        chanBox?.querySelector('[data-ch="modelsel"]')?.addEventListener('change', (e) => {
            const manual = chanBox.querySelector('[data-ch="model"]');
            if (manual) { manual.hidden = e.target.value !== '__manual__'; if (!manual.hidden) manual.focus(); }
            if (e.target.value !== '__manual__') toast('已保存', e.target.value ? `正文朗读用模型 ${e.target.value}` : '模型跟随默认');
        });
        chanBox?.querySelectorAll('[data-ch]').forEach(inp => inp.addEventListener('change', (e) => { e.stopPropagation(); if (inp.dataset.ch === 'modelsel' && inp.value === '__manual__') return; saveChan(); }));
        chanBox?.querySelector('[data-eye]')?.addEventListener('click', (e) => {
            const inp = chanBox.querySelector('[data-ch="key"]');
            const show = inp.type === 'password';
            inp.type = show ? 'text' : 'password';
            e.currentTarget.classList.toggle('is-hidden', !show);
        });
        chanBox?.querySelectorAll('[data-ch-pick]').forEach(b => b.addEventListener('click', () => {
            const inp = chanBox.querySelector('[data-ch="model"]');
            inp.value = b.dataset.chPick;
            chanBox.querySelectorAll('[data-ch-pick]').forEach(x => x.classList.toggle('is-on', x === b));
            saveChan();
            toast('已保存', `正文朗读用模型 ${b.dataset.chPick}`);
        }));
        chanBox?.querySelector('[data-ch-fetch]')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            saveChan();
            btn.disabled = true;
            btn.textContent = '拉取中…';
            try {
                const ch = chanBox.dataset.chan;
                const models = await this.sv.fetchTtsModels(ch);
                this._fetched = { ...(this._fetched || {}), [ch]: models };
                if (ch === 'custom_openai') this.sv.saveSettings({ customModels: models });
                const top = root.querySelector('.yzsv-body')?.scrollTop || 0;
                this.render();
                const nb = this._root().querySelector('.yzsv-body');
                if (nb) nb.scrollTop = top;
                toast('拉取成功', `${models.length} 个模型，点一下就选中`, '✅');
            } catch (err) {
                btn.disabled = false;
                btn.textContent = '重新拉取';
                toast('拉取失败', String(err?.message || err).slice(0, 160), '⚠️');
            }
        });
        }); // 每个渠道各自保存及绑定事件
        root.querySelector('select[data-k="ttsProvider"]')?.addEventListener('change', () => {
            const next = this._collect();
            const prov = next.ttsProvider || String(this.sv.storage?.get?.('phone-tts-provider') || 'minimax_cn');
            this.sv.saveSettings({ ttsProvider: next.ttsProvider });
            const body = root.querySelector('.yzsv-body');
            const top = body?.scrollTop || 0;
            this.render();
            const nb = this._root().querySelector('.yzsv-body');
            if (nb) nb.scrollTop = top;
            toast('已保存', `正文朗读改用 ${(TTS_CHANNELS.find(c => c.id === prov) || {}).label || prov}`);
        });
        root.querySelector('select[data-k="deepProfile"]')?.addEventListener('change', (e) => {
            const box = root.querySelector('.yzsv-api');
            if (box) box.hidden = e.target.value !== '__custom__';
            this.sv.saveSettings(this._collect());
        });
        // 深度分析的接口：保存 / 快速切换 / 删除
        const presetSel = root.querySelector('[data-deep-preset]');
        presetSel?.addEventListener('change', () => {
            const p = this.sv.getSettings().deepPresets.find(x => x.id === presetSel.value);
            if (!p) return;
            const st = this.sv.getSettings();
            const models = [...new Set([p.model, ...(p.models || []), ...st.deepModels].filter(Boolean))];
            this.sv.saveSettings({ deepApiUrl: p.url, deepApiKey: p.key, deepModel: p.model, deepModels: models });
            const top = root.querySelector('.yzsv-body')?.scrollTop || 0;
            this.render();
            const nb = this._root().querySelector('.yzsv-body');
            if (nb) nb.scrollTop = top;
            toast('已切换', `深度分析改用「${p.name}」`, '✅');
        });
        root.querySelector('[data-deep-preset-save]')?.addEventListener('click', () => {
            const cur = this._collect();
            if (!cur.deepApiUrl) { toast('还没填地址', '先填好 API 地址和密钥再保存', '⚠️'); return; }
            let host = '';
            try { host = new URL(cur.deepApiUrl).hostname; } catch (e) { host = cur.deepApiUrl; }
            const name = String(window.prompt('给这个接口起个名字', `${host}${cur.deepModel ? ' · ' + cur.deepModel : ''}`) || '').trim();
            if (!name) return;
            const st = this.sv.getSettings();
            const list = st.deepPresets.filter(x => x.name !== name);
            list.push({ id: `dp_${Date.now()}`, name, url: cur.deepApiUrl, key: cur.deepApiKey, model: cur.deepModel, models: st.deepModels.slice(0, 200) });
            this.sv.saveSettings({ ...cur, deepPresets: list });
            const top = root.querySelector('.yzsv-body')?.scrollTop || 0;
            this.render();
            const nb = this._root().querySelector('.yzsv-body');
            if (nb) nb.scrollTop = top;
            toast('已保存', `「${name}」，以后在下拉里一点就能切换`, '✅');
        });
        root.querySelector('[data-deep-preset-del]')?.addEventListener('click', () => {
            const id = presetSel?.value;
            const st = this.sv.getSettings();
            const p = st.deepPresets.find(x => x.id === id);
            if (!p) { toast('先选一个', '在下拉里选中要删除的接口', '⚠️'); return; }
            if (!window.confirm(`删除保存的接口「${p.name}」？`)) return;
            this.sv.saveSettings({ deepPresets: st.deepPresets.filter(x => x.id !== id) });
            const top = root.querySelector('.yzsv-body')?.scrollTop || 0;
            this.render();
            const nb = this._root().querySelector('.yzsv-body');
            if (nb) nb.scrollTop = top;
            toast('已删除', p.name);
        });
        root.querySelector('select[data-k="deepModel"]')?.addEventListener('change', () => { this.sv.saveSettings(this._collect()); toast('已保存', `深度分析用 ${root.querySelector('select[data-k="deepModel"]').value}`); });
        root.querySelector('.yzsv-api .yzsv-eye')?.addEventListener('click', (e) => {
            const inp = root.querySelector('[data-k="deepApiKey"]');
            if (!inp) return;
            const show = inp.type === 'password';
            inp.type = show ? 'text' : 'password';
            e.currentTarget.classList.toggle('is-hidden', !show);
        });
        root.querySelector('#yzsv-fetch')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const cur = this._collect();
            btn.disabled = true;
            const old = btn.textContent;
            btn.textContent = '拉取中…';
            try {
                const { base, models } = await this.sv.fetchModels(cur.deepApiUrl, cur.deepApiKey);
                const keep = models.includes(cur.deepModel) ? cur.deepModel : models[0];
                const sel = root.querySelector('select[data-k="deepModel"]');
                if (sel) sel.innerHTML = models.map(m => `<option value="${esc(m)}" ${m === keep ? 'selected' : ''}>${esc(m)}</option>`).join('');
                const urlInp = root.querySelector('[data-k="deepApiUrl"]');
                if (urlInp && base !== this.sv._apiBase(cur.deepApiUrl)) urlInp.value = base;
                this.sv.saveSettings({ ...this._collect(), deepModels: models, deepModel: keep });
                btn.textContent = '重新拉取';
                toast('拉取成功', `共 ${models.length} 个模型，已选 ${keep}`, '✅');
            } catch (err) {
                btn.textContent = old;
                toast('拉取失败', String(err?.message || err).slice(0, 160), '⚠️');
            } finally { btn.disabled = false; }
        });
        root.querySelector('#yzsv-api-test')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            this.sv.saveSettings(this._collect());
            btn.disabled = true;
            btn.textContent = '测试中…';
            try {
                const out = await this.sv._customChat([{ role: 'user', content: '只回复两个字：收到' }], { maxTokens: 20 });
                toast('连接正常', `模型回复：${String(out).trim().slice(0, 40)}`, '✅');
            } catch (err) {
                toast('连接失败', String(err?.message || err).slice(0, 160), '⚠️');
            } finally { btn.disabled = false; btn.textContent = '测试连接'; }
        });
        root.querySelectorAll('input.yzsv-input[data-k]').forEach(inp => inp.addEventListener('change', () => this.sv.saveSettings(this._collect())));
        root.querySelector('#yzsv-test')?.addEventListener('click', async () => {
            const s = this.sv.saveSettings(this._collect());
            try {
                toast('试听', '正在生成…', '⏳');
                await this.sv.test(s.voice);
            } catch (e) {
                toast('试听失败', String(e?.message || e).slice(0, 160), '⚠️');
            }
        });
        root.querySelector('#yzsv-clear')?.addEventListener('click', () => {
            this.sv.clearCache();
            this.sv.clearDeepCache();
            toast('已清除', '语音缓存和深度分析结果都已清空', '🧹');
        });
    }
}

// 小手机启动时调用一次
let INSTANCE = null;
export function installStoryVoice(options = {}) {
    if (!INSTANCE) {
        INSTANCE = new StoryVoice(options);
        INSTANCE.install();
    } else {
        if (options.ttsManager) INSTANCE.tts = options.ttsManager;
        if (options.phoneShell) INSTANCE.phoneShell = options.phoneShell;
    }
    try {
        window.storyvoiceReader = window.storyvoiceReader || {};
        window.storyvoiceReader.storyVoice = INSTANCE;
    } catch (e) { /* 忽略 */ }
    return INSTANCE;
}
