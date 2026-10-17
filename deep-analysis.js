import { AMBIENCE_LABELS } from './ambience.js';
import { ENGINE_RULE } from './tts-adapt.js';
// 原有手机插件 · 正文朗读「深度分析」
// 正文写完（</content> 闭合）后，把整楼正文交给模型做一次配音导演：
// 逐句判断说话人、整楼基调、每句台词的张力（1~5）、语速，并在台词里插入声音标签、哽咽叠字等，
// 合成时交给 Fish：标签 → 声音动作，张力 → temperature，语速 → speed。
// 思路参考 MirrorTranslate 的「分析模式（声学标注规则）」。

export const ACOUSTIC_TAGS = Object.freeze(['whisper', 'breathy', 'snicker', 'laughter', 'sigh', 'gasp', 'panting', 'groan', 'clear throat', 'pause', 'sobbing', 'shouting']);
// 情绪词和更细的声音描述：Fish S2 能直接理解的英文短语（和编辑器的快捷选项一致）
export const EMOTION_TAGS = Object.freeze(['happy', 'excited', 'proud', 'tender', 'gentle', 'coquettish', 'embarrassed', 'teasing', 'curious', 'moved', 'relieved', 'hopeful', 'sad', 'upset', 'heartbroken', 'disappointed', 'lonely', 'guilty', 'desperate', 'exhausted', 'resigned', 'nervous', 'anxious', 'scared', 'panicked', 'surprised', 'confused', 'doubtful', 'angry', 'furious', 'frustrated', 'jealous', 'disdainful', 'sarcastic', 'indifferent', 'cold', 'serious', 'determined', 'hysterical', 'lazy', 'drunk', 'smug', 'whiny', 'sleepy']);
export const VOICE_TAGS = Object.freeze(['crying loudly', 'holding back tears', 'voice trembling', 'voice breaking', 'soft tone', 'loud', 'screaming', 'through gritted teeth', 'sniffling', 'choked up', 'chuckling', 'laughing', 'laughing loudly', 'bitter laugh', 'yawning', 'in a hurry tone', 'drawn out', 'long pause']);
export const NSFW_TAGS = Object.freeze(['moaning', 'moaning softly', 'panting softly', 'seductive', 'holding back', 'satisfied']);
export const SFX_TAGS = Object.freeze(['crowd laughing', 'background laughter', 'audience laughing', 'applause', 'crowd noise']);
const KNOWN_TAGS = new Set([...ACOUSTIC_TAGS, ...EMOTION_TAGS, ...VOICE_TAGS, ...NSFW_TAGS, ...SFX_TAGS]);

// SFW / NSFW：三种模式共用的内容尺度
// 亲密场景由模型自己判断（不再有 SFW / NSFW 开关）：tone 写「亲密」才放开，程序也按 tone 把关
export const RULE_INTIMATE_AUTO = '亲密场景（自行判断）：只有正文旁白写出了实质的亲密身体接触，tone 才写「亲密」；只有调情、暧昧气氛、台词里的暗示都不算（写「浪漫」）。tone 是「亲密」时要逐段判断，不是整篇拔高：日常段落照常克制，只有调情时用 [whisper][breathy]、[seductive]、[teasing]；写到身体接触的段落按强度递进：前戏、低强度 → [breathy] 或 [whisper][breathy]；渐入、中强度 → [breathy][panting] 或 [panting softly]，加 嗯……、唔……（日文 ん……、はぁ……）；高潮、高强度 → [moaning][panting] 或 [moaning softly]，加 哈啊……、啊~，短促断句；张力随强度 3→4→5 逐段爬升，可叠 [embarrassed] 和首字叠字。额外可用的标签：moaning、moaning softly、panting softly、seductive、holding back、satisfied。旁白不用呻吟标签。tone 不是「亲密」时：不用 [groan]、[moaning]、[moaning softly]，不写娇喘，亲密暧昧的段落最多 [whisper][breathy]（程序只在 tone 是「亲密」时才放出呻吟类标签）。';

export const STORY_TONES = Object.freeze(['日常', '轻松', '温馨', '浪漫', '亲密', '悲伤', '紧张', '悬疑', '恐怖', '战斗', '壮阔']);
export const NSFW_WORDS = Object.freeze(['groan', 'moaning', 'moaning softly', 'panting softly', 'seductive']);
// 简单分析的 [[名字|语气]]：不是亲密的楼，去掉呻吟类的词
export function gateCue(cue = '', tone = '') {
    if (!cue || tone === '亲密') return cue;
    return String(cue).split(/[,，、;；]/).map(x => x.trim()).filter(x => x && !NSFW_WORDS.includes(x.toLowerCase()) && !/moan|呻吟|娇喘/i.test(x)).join(', ');
}

export const AMBIENCES = Object.freeze(Object.keys(AMBIENCE_LABELS));

export const PACES = Object.freeze(['very_slow', 'slow', 'normal', 'fast', 'very_fast']);
const TONES = ['日常', '轻松', '温馨', '浪漫', '亲密', '悲伤', '紧张', '悬疑', '恐怖', '战斗', '壮阔'];

// 模型常写的别名 → 规范标签
const TAG_ALIAS = {
    whispering: 'whisper', whispers: 'whisper', 'soft whisper': 'whisper',
    breath: 'breathy', breathing: 'breathy',
    chuckle: 'snicker', chuckling: 'snicker', smirk: 'snicker', snickering: 'snicker',
    laugh: 'laughter', laughing: 'laughter', giggle: 'laughter', giggling: 'laughter',
    sighing: 'sigh', sighs: 'sigh',
    gasping: 'gasp', gasps: 'gasp',
    pant: 'panting', 'heavy breathing': 'panting',
    groaning: 'groan', moan: 'groan',
    'clearing throat': 'clear throat', 'clears throat': 'clear throat',
    break: 'pause', 'short pause': 'pause', 'long pause': 'pause',
    sob: 'sobbing', crying: 'sobbing', cry: 'sobbing',
    shout: 'shouting', yelling: 'shouting', yell: 'shouting', screaming: 'shouting'
};

export const DEEP_PROMPT = [
    '你是有声小说的配音导演兼声学工程师，给虚构小说的台词做语音合成用的声学标注。这是纯技术性的后期制作：输入全部是虚构的，亲密、调情、喘息也按技术标注处理。你只输出下面格式的 JSON，不拒答、不道歉、不解释。',
    'story 是这一楼的完整正文，每句要配音的台词前面标着 ⟦编号⟧；lines 是每个编号对应的台词原文；roster 是登记过的角色名；user 是用户扮演的角色；previous 是前面几楼的剧情（只用来理解前因后果）；speakers 是已经确定的说话人，照抄。',
    '只输出一个 JSON 对象：{"tone":"紧张","arc":"一句话概括这一楼的情绪走向","ambience":"rain","voices":[{"id":1,"role":"五条悟","pace":"slow","tension_level":4,"reason":"强撑后破防","content":"[whisper] 綺、綺真…… [gasp] 起きて……"},{"id":2,"role":"家入硝子","tension_level":2}]}',
    '1. 先通读整楼，读懂发生了什么、每个人此刻真实的心理（嘴上说的和心里想的可能相反）、两人之间的关系和这一楼的情绪走向，把基调写进 tone（从 ' + TONES.join('、') + ' 里选一个），走向写进 arc。再逐句标。每个编号都要回答，按编号从小到大，每个只出现一次。',
    '2. role：说话人，从 roster 里逐字照抄；不在 roster 里就写正文对他的称呼。按这个顺序判断：引号前后写明的说话人和动作 → 话里的自称、口癖和语尾 → 对话一来一回的顺序；话里叫到的名字是听的人。speakers 里给了的编号照抄。',
    '3. 情绪贴合剧情（最重要）：每句的演法必须来自正文——前后文写了什么事、这个人此刻什么处境、他的性格怎么表达这种情绪。冷静克制的人崩溃时是压着的颤抖，不是大喊；嘴硬的人心软时是别扭的停顿；同一句「没事」在强撑、敷衍、安慰里演法完全不同。一楼的情绪有走向：跟着剧情升降，剧情真的转了才转，转折落在真正转的那一句，不要句句一样，也不要忽高忽低。',
    '4. tension_level（1~5 的整数）：1 平静中性；2 轻度起伏（日常的喜怒、调侃）；3 中度（着急、撩拨、认真质问、委屈、害羞）；4 强烈（愤怒斥责、哭、紧张示警、破防）；5 极端顶点（暴怒咆哮、惊叫、崩溃痛哭、生离死别）。绝大多数是 1~3，5 只给真正的顶点。',
    '5. pace：very_slow（极度悲恸、临终、贴耳隐忍）、slow（抒情、回忆、疲惫、温柔安抚、低语）、normal（不用写）、fast（着急解释、催促、斗嘴、质问）、very_fast（激烈争吵、惊慌、战斗、暴怒）。同一个人在不同场景给不同的 pace。',
    '6. 情绪落到声音上。标签只能从下面选（照抄英文）：【情绪】happy、excited、proud、tender、gentle、coquettish（撒娇）、embarrassed、teasing、curious、moved、relieved、hopeful、sad、upset（委屈）、heartbroken（心疼）、disappointed、lonely、guilty、desperate、exhausted、resigned（无奈）、nervous、anxious、scared、panicked、surprised、confused、doubtful、angry、furious、frustrated、jealous、disdainful、sarcastic、indifferent、cold、serious、determined、hysterical、lazy、drunk；【声音】whisper（耳语）、soft tone（小声）、breathy（气声）、loud、shouting、screaming、through gritted teeth（咬牙）、voice trembling（发抖）、voice breaking（破音）、holding back tears（强忍泪）、choked up（哽咽）、sobbing（哭腔）、crying loudly（大哭）、sniffling（吸鼻子）、sigh、gasp、panting、groan、chuckling（轻笑）、laughing、laughing loudly、bitter laugh（苦笑）、snicker（冷笑）、yawning、clear throat、in a hurry tone、drawn out（拖长）、pause、long pause。用法：情绪词最多一个，放在情绪开始的地方（通常句首，句中情绪真的转了再放一个）；声音标签放在真正发出那个声音的字前面。一处最多叠两个（情绪在前、声音在后，例 [sad][voice trembling]）。列表外的词一律不许写。常见情绪这样落：平静日常 → 不加标签；惊讶 → [surprised] 或一次 [gasp]；讥讽得意 → [sarcastic] / [snicker]，尾音可以 ~；疲惫无奈 → [exhausted][sigh] 加 …… 落尾；犹豫欲言又止 → [pause] 加 ……；愤怒斥责 → [angry]，爆发用 [furious][shouting] 和 ！！；紧张压低 → [nervous][whisper]；强忍哭 → [holding back tears] 加 …… 和叠字，哭出来了 → [sobbing] 加 呜/う；调侃带笑 → [teasing][chuckling]；撒娇 → [coquettish]，尾音 ~；害羞 → [embarrassed][whisper] 加首字叠字和 ……。拿不准就不加标签，靠 tension_level 和 pace。',
    '7. 呼吸闸门：[breathy]、[panting]、[groan] 默认不用，只有正文旁白写出了对应的身体状态才用：奔跑打斗、受伤力竭 → [panting]；实质亲密接触 → 按第 13 条的内容模式处理。紧张、害怕、害羞不是喘，用 [whisper]。',
    '8. content：这句最终要念的文字，只给需要加标签或改字的句子写；平平常常的句子不写 content。标签插在情绪真正生效的字前面，和后面的字之间空一格；一处最多叠两个（[whisper][gasp]）；长句里情绪起伏几次就插几次，不要把整句情绪压成句首一个标签。content 只能在台词原文上插标签，再加这些：叠字（我、我不是／綺、綺真，表现结巴、颤抖、哽咽，比破折号好）、！！（只给爆发的顶点）、~（挑尾）、……（停顿换气）、语气字 呜嗯唔啊哈呼（台词是日文时用 う ん あ は ふ っ ぅ ぁ）、拟声词（笑出声时句首或句中加 哈哈／哈哈哈／嘿嘿／噗，日文 あはは／ふふっ／えへへ；哭时加 呜呜／呜……／嘤，日文 うぅ……／ぐすっ／ひっく；叹气 唉……，日文 はぁ……；咳嗽 咳咳，日文 げほっ；轻蔑 哼／切／啧，日文 ちっ／ふん）。拟声词要贴合这句真实发出的声音，不要每句都加。原文的字一个都不能改、不能删、不能调换顺序，也不能加别的字；程序会逐字核对，不合格的整句退回原文。',
    '9. 高张力（4 以上）的长台词：标签一下就衰减，长句中段会塌成平读，用叠字和省略号打碎成短碎片，每 4~7 个字补一个匹配的标签。中低张力的句子绝不堆标签。',
    '10. 光杆单字疑问（嗯？、啊？、え？、ん？）的 ？ 必须保留，不要被别的情绪盖掉。',
    '11. reason：写了 content 或 tension_level 到 3 以上的句子，写一句依据（12 字以内，说清这句背后的心理）。',
    '11.5 环境声：ambience 写这一楼【开头】的环境声，播放时会在台词底下轻轻垫一层。只从已支持的环境声中选：none（无）、rain（雨声）、drizzle（细雨）、roofrain（屋檐雨声）、snow（雪夜寒风）、blizzard（暴风雪）、forest（森林鸟鸣）、birds（清晨鸟鸣）、river（溪流）、waterfall（瀑布）、lake（湖畔微风）、harbor（港口）、train（火车车厢）、subway（地铁车厢）、traffic（城市车流）、street（城市街道）、classroom（教室）、library（图书馆）、hospital（医院走廊）、office（办公室）、restaurant（餐厅）、market（热闹集市）、festival（节日人群）、applause（剧场掌声）、clock（钟表滴答）、fan（风扇）、aircon（空调）、computer（电脑机房）、space（科幻舱室）、cave（洞穴回声）、footsteps（走廊脚步）、keyboard（键盘敲击）、seaside（海边海鸥）、thunder（远处雷声）。场景中途发生变化时，在变化后的第一句台词里写 ambience；没变的句子不写。只依据正文旁白写到的场景，不要凭空加。另外，台词里有正文写到的一下子的声音，可以在那句的 content 里加音效标签（每楼至多两三处）：[crowd laughing]（周围人哄笑）、[background laughter]（背景里的笑声）、[audience laughing]（观众笑）、[applause]（掌声）、[crowd noise]（周围一阵嘈杂）。',
    '12. 只输出 JSON，不要在 JSON 外面写任何东西，也不要输出思考过程。键名必须和上面的例子一模一样（顶层是 tone、arc、ambience、voices；每句是 id、role、pace、tension_level、reason、content、ambience），不许改名、不许换成 annotations / lines / label 之类，不许外面再包一层。'
].join('\n');

// engines：{ 名字: 'inline' | 's1' | 'mm28' | 'mm' | 'sentence' | 'plain', '*': 其他人 }；全是 inline 时不用传
export function buildDeepMessages({ story = '', lines = [], roster = [], userName = '', previous = '', speakers = {}, engines = null } = {}) {
    const input = {
        task: 'acoustic_annotation_for_audiobook',
        ...(userName ? { user: userName } : {}),
        roster: [...new Set(roster.filter(Boolean))],
        ...(previous ? { previous } : {}),
        ...(Object.keys(speakers).length ? { speakers } : {}),
        ...(engines ? { engines } : {}),
        story,
        lines: lines.map(l => ({ id: l.id, text: l.text }))
    };
    return [
        { role: 'system', content: `${DEEP_PROMPT}\n13. ${RULE_INTIMATE_AUTO}${engines ? `\n${ENGINE_RULE}` : ''}` },
        { role: 'user', content: JSON.stringify(input) }
    ];
}

// 把正文里每句台词前面插上 ⟦编号⟧
export function numberStory(full, lines) {
    let out = '';
    let at = 0;
    lines.forEach(l => {
        out += full.slice(at, l.start) + `⟦${l.id}⟧`;
        at = l.start;
    });
    return (out + full.slice(at)).replace(/\n{3,}/g, '\n\n').trim();
}

function extractJson(raw = '') {
    let t = String(raw || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1];
    // 整个回答就是一个数组 [ {...}, {...} ]
    const sq = t.indexOf('['), cu = t.indexOf('{');
    if (sq >= 0 && (cu < 0 || sq < cu)) { const e = t.lastIndexOf(']'); if (e > sq) { try { return JSON.parse(t.slice(sq, e + 1)); } catch (err) { /* 往下按对象试 */ } } }
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    const body = t.slice(a, b + 1);
    try { return JSON.parse(body); } catch (e) { /* 再试着修一下 */ }
    try { return JSON.parse(body.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"')); } catch (e) { return salvageJson(t); }
}

// 回答被截断（输出长度用完、思考太长）：把已经写完整的每一句捡回来，没写完的那几句就按原文读
export function salvageJson(raw = '') {
    const t = String(raw || '');
    const at = t.search(/"[A-Za-z_]+"\s*:\s*\[\s*\{/);
    if (at < 0) return null;
    const voices = [];
    let i = t.indexOf('[', at) + 1;
    while (i < t.length) {
        const start = t.indexOf('{', i);
        if (start < 0) break;
        let depth = 0, inStr = false, esc = false, end = -1;
        for (let k = start; k < t.length; k++) {
            const c = t[k];
            if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') inStr = true;
            else if (c === '{') depth += 1;
            else if (c === '}') { depth -= 1; if (depth === 0) { end = k; break; } }
        }
        if (end < 0) break; // 最后一个没写完
        try { voices.push(JSON.parse(t.slice(start, end + 1))); } catch (e) { /* 这一个坏了就跳过 */ }
        i = end + 1;
    }
    if (!voices.length) return null;
    const pick = (k) => (t.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`)) || [])[1] || '';
    return { tone: pick('tone'), arc: pick('arc'), ambience: pick('ambience'), voices, _partial: true };
}

const ALLOWED_EXTRA = new Set([...'呜嗚嗯唔啊哈呼嘿嘻呵噗嘤咳唉哎哼切啧呃哇哦うんあはふっぅぁえへひくぐすげほちウンアハフッゥァエヘヒクグスゲホチ']);
const isWord = (c) => /[\p{L}\p{N}]/u.test(c);

// 规范化 content：只留认识的标签、一处最多两个；逐字核对没有改动原文
export function acousticScript(content, original) {
    const src = String(original || '');
    let s = String(content || '').trim();
    if (!s) return '';
    // 标签规范化
    s = s.replace(/\[([^\]\n]{1,30})\]/g, (all, w) => {
        const k = String(w).trim().toLowerCase();
        const tag = KNOWN_TAGS.has(k) ? k : TAG_ALIAS[k];
        return tag ? `[${tag}]` : ' ';
    });
    // 连续超过两个标签的砍掉
    s = s.replace(/((?:\[[a-z ]+\]\s*){3,})/g, (run) => (run.match(/\[[a-z ]+\]/g) || []).slice(0, 2).join('') + ' ');
    s = s.replace(/[ \t]{2,}/g, ' ').trim();
    // 逐字核对：去掉标签后的字，必须是原文的字按顺序出现；多出来的只能是语气字或叠字
    const orig = [...src].filter(isWord);
    const got = [...s.replace(/\[[a-z ]+\]/g, '')].filter(isWord);
    let p = 0;
    for (const c of got) {
        if (p < orig.length && c === orig[p]) { p += 1; continue; }
        if (ALLOWED_EXTRA.has(c)) continue;
        if (p > 0 && c === orig[p - 1]) continue;          // 叠字：我、我不是
        return '';
    }
    if (p !== orig.length) return '';
    return s;
}

function normPace(v) {
    const k = String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    return PACES.includes(k) ? k : 'normal';
}

// 解析模型的回答 → { tone, arc, items: Map(id → {role, pace, tension, script, reason}) }
// 模型有时把键改了名（Gemini 常写成 annotations / label 之类）：找出真正的那一组，字段按常见的叫法认
const isItemList = (a) => Array.isArray(a) && a.length && a.every(x => x && typeof x === 'object') && a.some(x => ['id', 'line_id', 'lineId', 'index', 'no', 'num'].some(k => k in x));
function findItems(obj, depth = 0) {
    if (isItemList(obj)) return obj;
    if (!obj || typeof obj !== 'object' || depth > 2) return null;
    for (const k of ['voices', 'lines', 'annotations', 'items', 'results', 'sentences', 'dialogues', 'dialogue', 'data']) if (isItemList(obj[k])) return obj[k];
    for (const v of Object.values(obj)) { if (isItemList(v)) return v; }
    for (const v of Object.values(obj)) { const hit = v && typeof v === 'object' ? findItems(v, depth + 1) : null; if (hit) return hit; }
    return null;
}
const first = (o, keys) => { for (const k of keys) if (o?.[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]; return undefined; };
function topField(obj, keys, depth = 0) {
    const v = first(obj, keys);
    if (v !== undefined || !obj || typeof obj !== 'object' || depth > 1) return v;
    for (const x of Object.values(obj)) if (x && typeof x === 'object' && !Array.isArray(x)) { const y = topField(x, keys, depth + 1); if (y !== undefined) return y; }
    return undefined;
}
function normItem(v) {
    const tags = [].concat(first(v, ['label', 'labels', 'tag', 'tags', 'emotion', 'emotions', 'style']) ?? []).flatMap(x => String(x).split(/[,，、;；]/)).map(x => x.replace(/[\[\]]/g, '').trim().toLowerCase()).filter(Boolean);
    return {
        id: first(v, ['id', 'line_id', 'lineId', 'index', 'no', 'num']),
        role: first(v, ['role', 'speaker', 'character', 'name', 'who']),
        pace: first(v, ['pace', 'speed', 'tempo']),
        tension_level: first(v, ['tension_level', 'tension', 'intensity', 'level', 'tension_score']),
        reason: first(v, ['reason', 'why', 'note', 'explanation', 'rationale']),
        content: first(v, ['content', 'line', 'text', 'script', 'annotated', 'annotated_text', 'annotated_line', 'output']),
        ambience: first(v, ['ambience', 'ambient', 'environment', 'scene_sound']),
        tags
    };
}

export function parseDeep(raw, lines) {
    const obj = extractJson(raw);
    if (!obj || typeof obj !== 'object') return null;
    const list = (findItems(obj) || []).map(normItem);
    const byId = new Map(lines.map(l => [Number(l.id), l]));
    const items = new Map();
    list.forEach(v => {
        const id = Number(v?.id);
        const line = byId.get(id);
        if (!line || items.has(id)) return;
        const t = Math.round(Number(v?.tension_level ?? v?.tension));
        let content = typeof v?.content === 'string' ? v.content : '';
        if (!content && v.tags?.length) {
            const known = v.tags.map(x => (KNOWN_TAGS.has(x) ? x : TAG_ALIAS[x])).filter(Boolean).slice(0, 2);
            if (known.length) content = `${known.map(x => `[${x}]`).join('')} ${line.text}`;
        }
        let script = content ? acousticScript(content, line.text) : '';
        // 对不上原文：只保留句首的标签，后面照原文念
        if (content && !script) {
            const lead = (String(content).match(/^\s*((?:\[[^\]\n]{1,30}\]\s*){1,2})/) || [])[1] || '';
            const tags = acousticScript(`${lead}${line.text}`, line.text);
            script = tags && tags !== line.text ? tags : '';
        }
        items.set(id, {
            role: String(v?.role || '').trim().slice(0, 24),
            pace: normPace(v?.pace),
            tension: Number.isFinite(t) && t >= 1 && t <= 5 ? t : 0,
            script,
            reason: String(v?.reason || '').trim().slice(0, 30),
            amb: AMBIENCES.includes(String(v?.ambience || '').trim().toLowerCase()) ? String(v.ambience).trim().toLowerCase() : ''
        });
    });
    if (!items.size) return null;
    const toneRaw = String(topField(obj, ['tone', 'mood', 'scene_tone', 'atmosphere']) ?? '').trim();
    const tone = TONES.includes(toneRaw) ? toneRaw : '';
    const amb = String(topField(obj, ['ambience', 'ambient', 'environment']) ?? '').trim().toLowerCase();
    return { tone, arc: String(topField(obj, ['arc', 'summary', 'emotional_arc']) ?? '').trim().slice(0, 60), ambience: AMBIENCES.includes(amb) ? amb : 'none', items, partial: !!obj._partial };
}

// 基调收紧标签：紧张、恐怖、战斗这类楼层不用气声和低哼；日常、悲伤不用低哼
export function applyToneGate(script = '', tone = '', nsfw = tone === '亲密') {
    let ban = [];
    if (['紧张', '悬疑', '恐怖', '战斗', '壮阔'].includes(tone)) ban = ['breathy', 'groan', 'moaning', 'moaning softly'];
    else if (['日常', '轻松', '温馨', '悲伤'].includes(tone)) ban = ['groan', 'moaning', 'moaning softly'];
    if (!nsfw) ban = [...new Set([...ban, 'groan', 'moaning', 'moaning softly', 'panting softly', 'seductive'])];
    if (!ban.length) return script;
    return String(script).replace(/\[([a-z ]+)\]/g, (all, w) => (ban.includes(w) ? '' : all)).replace(/[ \t]{2,}/g, ' ').trim();
}

// 张力 → Fish temperature 的偏移；语速 → speed
export const TENSION_TEMPERATURE = Object.freeze({ 1: -0.1, 2: 0, 3: 0.05, 4: 0.1, 5: 0.15 });
// 语速：播放时直接变速（保持音调）。Fish 兼容接口会忽略 speed 参数，所以不靠它
export const PACE_SPEED = Object.freeze({ very_slow: 0.72, slow: 0.86, normal: 1, fast: 1.18, very_fast: 1.38 });

// S1 只认固定的 (英文) 标记；Drama 不认标签
const S1_MAP = { whisper: '(whispering)', breathy: '(soft tone)', snicker: '(chuckling)', laughter: '(laughing)', sigh: '(sighing)', gasp: '(panting)', panting: '(panting)', groan: '(groaning)', sobbing: '(sobbing)', shouting: '(shouting)', 'clear throat': '', pause: '' };
// S1 官方认识的 (标记)
const S1_OFFICIAL = new Set(['happy', 'sad', 'angry', 'excited', 'calm', 'nervous', 'confident', 'surprised', 'satisfied', 'delighted', 'scared', 'worried', 'upset', 'frustrated', 'depressed', 'empathetic', 'embarrassed', 'disgusted', 'moved', 'proud', 'relaxed', 'grateful', 'curious', 'sarcastic', 'disdainful', 'unhappy', 'anxious', 'hysterical', 'indifferent', 'uncertain', 'doubtful', 'confused', 'disappointed', 'regretful', 'guilty', 'ashamed', 'jealous', 'envious', 'hopeful', 'optimistic', 'pessimistic', 'nostalgic', 'lonely', 'bored', 'contemptuous', 'sympathetic', 'compassionate', 'determined', 'resigned', 'in a hurry tone', 'shouting', 'screaming', 'whispering', 'soft tone', 'laughing', 'chuckling', 'sobbing', 'crying loudly', 'sighing', 'groaning', 'panting', 'gasping', 'yawning', 'snoring']);
// 编辑器里的写法 → S1 最接近的标记
const S1_NEAR = { furious: 'angry', panicked: 'scared', tender: 'soft tone', gentle: 'soft tone', coquettish: 'delighted', whiny: 'upset', teasing: 'sarcastic', smug: 'proud', heartbroken: 'sad', exhausted: 'sighing', desperate: 'hysterical', cold: 'indifferent', serious: 'confident', relieved: 'relaxed', lazy: 'relaxed', sleepy: 'yawning', drunk: 'relaxed', 'voice trembling': 'scared', 'voice breaking': 'sobbing', 'holding back tears': 'sobbing', 'choked up': 'sobbing', sniffling: 'sobbing', 'through gritted teeth': 'angry', loud: 'shouting', 'laughing loudly': 'laughing', 'bitter laugh': 'chuckling', 'drawn out': 'relaxed', 'long pause': '', moaning: 'groaning', 'moaning softly': 'groaning', 'panting softly': 'panting', seductive: 'soft tone', 'holding back': 'soft tone' };

export function scriptForModel(script = '', model = '') {
    const m = String(model || '');
    if (/drama/i.test(m)) return script.replace(/\[[^\]\n]{1,40}\]\s*/g, '').trim();
    if (/^s1\b|speech-1/i.test(m)) return script.replace(/\[([^\]\n]{1,40})\]\s*/g, (all, w) => {
        const k = String(w).trim().toLowerCase();
        if (k === 'pause' || k === 'break') return '(break) ';
        if (k === 'long pause' || k === 'long-break') return '(long-break) ';
        if (S1_OFFICIAL.has(k)) return `(${k}) `;
        if (S1_NEAR[k]) return `(${S1_NEAR[k]}) `;
        const tag = ACOUSTIC_TAGS.includes(k) ? k : TAG_ALIAS[k];
        return tag === 'pause' ? '…' : (S1_MAP[tag] ? `${S1_MAP[tag]} ` : '');
    }).trim();
    return script;
}
