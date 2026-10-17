// 原有手机插件 · 正文朗读：把同一份「演法」翻译成各家语音引擎听得懂的样子
// 演法统一写成 Fish 风格：台词里插 [英文标签]，再加张力 1~5、语速（语速在播放时变速，所有引擎通用）。
//   Fish      → 原样（S1 / Drama 在 story-voice 里另外换写法），张力 → temperature
//   MiniMax   → 情绪参数 emotion + 2.8 系列的 (laughs)(sighs) 等语气标签 + <#0.5#> 停顿
//   OpenAI    → gpt-4o-mini-tts 的 instructions（英文语气说明）
//   豆包/火山 → 2.0 音色的 context_texts（中文语气指令）
//   MiMo      → 句首 (风格) + 句中 (音效)，MiMo v2.5 的写法
//   IndexTTS  → emoText 情绪描述（雨落版接口）
//   其他      → 去掉标签，保留叠字、语气词、标点

const TAG_RE = /\[([^\]\n]{1,40})\]\s*/g;

// 标签 → 中文说明（豆包、IndexTTS 用）
const ZH = {
    happy: '开心', excited: '兴奋', proud: '得意', tender: '宠溺', gentle: '温柔', coquettish: '撒娇', whiny: '撒娇耍赖', embarrassed: '害羞',
    teasing: '调侃', curious: '好奇', moved: '感动', relieved: '释然', hopeful: '期待', sad: '悲伤', upset: '委屈', heartbroken: '心疼',
    disappointed: '失落', lonely: '孤独', guilty: '愧疚', desperate: '绝望', exhausted: '疲惫', resigned: '无奈', nervous: '紧张', anxious: '焦急',
    scared: '害怕', panicked: '惊慌', surprised: '惊讶', confused: '困惑', doubtful: '怀疑', angry: '生气', furious: '暴怒', frustrated: '烦躁',
    jealous: '嫉妒', disdainful: '不屑', sarcastic: '嘲讽', indifferent: '冷淡', cold: '冷漠', serious: '严肃', determined: '坚定', hysterical: '歇斯底里',
    lazy: '慵懒', drunk: '醉醺醺', smug: '得意洋洋', sleepy: '困倦',
    whisper: '压低声音耳语', breathy: '带气声', 'soft tone': '小声', loud: '大声', shouting: '喊出来', screaming: '尖叫',
    'through gritted teeth': '咬着牙', 'voice trembling': '声音发抖', 'voice breaking': '声音破音', 'holding back tears': '强忍着眼泪',
    'choked up': '哽咽', sobbing: '带着哭腔', 'crying loudly': '放声大哭', sniffling: '吸着鼻子', sigh: '叹气', gasp: '倒抽一口气',
    panting: '急促喘息', 'panting softly': '轻轻喘息', groan: '低哼', chuckling: '轻笑', laughter: '笑出声', laughing: '笑着说',
    'laughing loudly': '大笑', 'bitter laugh': '苦笑', snicker: '冷笑', yawning: '打着哈欠', 'clear throat': '清了清嗓子',
    'in a hurry tone': '急促地', 'drawn out': '拖长音', seductive: '勾人', 'holding back': '隐忍', satisfied: '餍足',
    'moaning softly': '低吟', moaning: '呻吟'
};
const ZH_T = { 1: '情绪很平静克制', 2: '情绪轻微', 3: '情绪明显', 4: '情绪强烈', 5: '情绪极其强烈、到达顶点' };
const EN_T = { 1: 'calm and restrained', 2: 'mild emotion', 3: 'clear emotion', 4: 'strong emotion', 5: 'extremely intense, at the emotional peak' };

// MiniMax 的情绪参数
const MM_EMO = [
    [/happy|excited|proud|tender|gentle|coquettish|whiny|teasing|curious|moved|relieved|hopeful|smug|laugh|chuckl|satisfied|seductive/, 'happy'],
    [/sad|upset|heartbroken|disappointed|lonely|guilty|desperate|sob|crying|tears|choked|sniffl|voice breaking/, 'sad'],
    [/angry|furious|frustrated|gritted|shouting|screaming/, 'angry'],
    [/scared|panicked|nervous|anxious|trembling|hysterical/, 'fearful'],
    [/disdainful|sarcastic|jealous|snicker/, 'disgusted'],
    [/surprised|gasp/, 'surprised'],
    [/calm|indifferent|cold|serious|resigned|exhausted|lazy|sleepy|determined/, 'calm']
];
// MiniMax speech-2.8 的语气标签
const MM_SOUND = {
    laughter: '(laughs)', laughing: '(laughs)', 'laughing loudly': '(laughs)', chuckling: '(chuckle)', snicker: '(chuckle)', 'bitter laugh': '(chuckle)',
    sigh: '(sighs)', gasp: '(gasps)', panting: '(pant)', 'panting softly': '(breath)', breathy: '(breath)', groan: '(groans)',
    moaning: '(groans)', 'moaning softly': '(breath)', sniffling: '(sniffs)', 'clear throat': '(clear-throat)', yawning: '(exhale)'
};
// MiMo 的音效（括号里的英文它也能理解，常用的换成它文档里的词）
const MIMO_SOUND = { sigh: 'sighs', gasp: 'gasps', panting: 'pants', laughter: 'laughs', laughing: 'laughs', chuckling: 'chuckles', sobbing: 'sobs', snicker: 'scoffs', 'clear throat': 'clears throat', pause: 'pauses' };

export function splitTags(script = '') {
    const s = String(script || '');
    const lead = [];
    const m = s.match(/^\s*((?:\[[^\]\n]{1,40}\]\s*)+)/);
    if (m) (m[1].match(/\[([^\]\n]{1,40})\]/g) || []).forEach(x => lead.push(x.slice(1, -1).trim().toLowerCase()));
    const all = [...s.matchAll(/\[([^\]\n]{1,40})\]/g)].map(x => x[1].trim().toLowerCase());
    return { lead, all, rest: m ? s.slice(m[0].length) : s };
}

// 不认标签的引擎：声音类标签换成真的拟声字（中文 / 日文），情绪类标签去掉
const SOUND_TEXT = {
    laughter: ['哈哈，', 'あはは、'], laughing: ['哈哈，', 'あはは、'], 'laughing loudly': ['哈哈哈哈，', 'あはははっ、'],
    chuckling: ['呵呵，', 'ふふっ、'], snicker: ['哼，', 'ふっ、'], 'bitter laugh': ['呵……', 'はは……'],
    sigh: ['唉……', 'はぁ……'], gasp: ['啊，', 'はっ、'], panting: ['哈……哈……', 'はぁ、はぁ……'], 'panting softly': ['哈……', 'はぁ……'],
    sobbing: ['呜……', 'うぅ……'], 'crying loudly': ['呜哇……', 'うわぁ……'], 'choked up': ['呜……', 'うっ……'], sniffling: ['（吸鼻子）', 'ぐすっ……'],
    'clear throat': ['咳，', 'こほん、'], yawning: ['哈啊……', 'ふぁ……'], groan: ['唔……', 'うぅ……'], 'moaning softly': ['嗯……', 'ん……'], moaning: ['啊……', 'あっ……']
};
const ONO_NEXT = /^[哈呵嘿嘻哼唉啊呜嗯唔咳あはふへうぐこんっ]/;
const stripAll = (s) => {
    const str = String(s || '');
    const ja = /[\u3040-\u30ff]/.test(str);
    return str.replace(/\[long pause\]\s*/gi, '……').replace(/\[pause\]\s*/gi, '…')
        .replace(/\[([^\]\n]{1,40})\]\s*/g, (all, w, off) => {
            const t = SOUND_TEXT[w.trim().toLowerCase()];
            if (!t) return '';
            const next = str.slice(off + all.length);
            return ONO_NEXT.test(next) ? '' : t[ja ? 1 : 0]; // 后面已经写了拟声字就不重复
        })
        .replace(/（吸鼻子）/g, '').replace(/[ \t]{2,}/g, ' ').trim();
};

export function instructionEn(tags, t) {
    const words = tags.filter(x => !/^(pause|long pause)$/.test(x));
    const parts = [];
    if (words.length) parts.push(`Voice: ${words.join(', ')}.`);
    if (t) parts.push(`Intensity ${t}/5 (${EN_T[t]}).`);
    return parts.join(' ');
}

export function instructionZh(tags, t) {
    const words = tags.filter(x => !/^(pause|long pause)$/.test(x)).map(x => ZH[x] || x);
    const parts = [];
    if (words.length) parts.push(`用${words.join('、')}的语气说`);
    if (t) parts.push(ZH_T[t]);
    return parts.length ? `${parts.join('，')}。` : '';
}

/**
 * @param {object} o
 * @param {string} o.provider  fish / minimax_cn / minimax_intl / openai / volcengine / nimo / indextts / …
 * @param {string} o.model
 * @param {string} o.script  台词（可带 [标签]）
 * @param {number} o.t  张力 1~5（0 = 没设）
 * @returns {{ text: string, opts: object }}
 */
export function adaptScript({ provider = '', model = '', script = '', t = 0 } = {}) {
    const { lead, all } = splitTags(script);
    const tags = [...new Set(all)];
    if (String(provider).startsWith('minimax')) {
        const is28 = /2\.8/.test(String(model || ''));
        let text = String(script)
            .replace(/\[long pause\]\s*/gi, '<#1.0#>')
            .replace(/\[pause\]\s*/gi, '<#0.4#>')
            .replace(TAG_RE, (all, w) => { const k = w.trim().toLowerCase(); return is28 && MM_SOUND[k] ? MM_SOUND[k] : `[${w}] `; })
            .replace(/[ \t]{2,}/g, ' ').trim();
        text = stripAll(text); // 2.8 以外：声音标签换成拟声字，情绪标签去掉（情绪交给 emotion 参数）
        const key = (lead.length ? lead : tags).join(' ');
        const emo = (MM_EMO.find(([re]) => re.test(key)) || [])[1] || '';
        return { text, opts: emo ? { minimax: { emotion: emo } } : {} };
    }
    if (provider === 'openai') {
        const ins = instructionEn(tags, t);
        return { text: stripAll(script), opts: ins ? { instructions: ins } : {} };
    }
    if (provider === 'volcengine') {
        const ins = instructionZh(tags, t);
        return { text: stripAll(script), opts: ins ? { contextTexts: [ins] } : {} };
    }
    if (provider === 'indextts') {
        const ins = instructionZh(tags, t);
        return { text: stripAll(script), opts: ins ? { emoText: ins } : {} };
    }
    if (provider === 'nimo') {
        // MiMo v2.5：句首 (风格1, 风格2)，句中 (音效)
        const { rest } = splitTags(script);
        const style = lead.filter(x => !/^(pause|long pause)$/.test(x));
        const body = rest.replace(/\[long pause\]\s*/gi, '(long pause) ').replace(TAG_RE, (all, w) => {
            const k = w.trim().toLowerCase();
            return `(${MIMO_SOUND[k] || k}) `;
        }).replace(/[ \t]{2,}/g, ' ').trim();
        return { text: `${style.length ? `(${style.join(', ')})` : ''}${body}`, opts: {} };
    }
    return { text: stripAll(script), opts: {} };
}
