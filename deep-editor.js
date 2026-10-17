// 原有手机插件 · 正文朗读：查看 / 编辑深度分析结果
// 点楼层下面的「🎭 …」打开：逐句看模型给的说话人、张力、语速、演法（带标签的台词）和理由，
// 可以直接改；点「生成一版试听」按草稿生成一版（不调用分析模型），可以反复生成对比，保存时只留选中的那版。

import { AMBIENCE_LABELS, startAmbience } from './ambience.js';
import { fitTags, MM_EMOTION_TAGS, MM28_SOUND_TAGS } from './tts-adapt.js';

const STYLE_ID = 'yzsv-editor-style';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 一键演法：张力 + 语速 + 句首标签（+ 首字叠字 / 句尾符号），点一下整句套用
export const PRESETS = [
    { label: '平静日常', tags: [], t: 1, p: 'normal' },
    { label: '温柔安抚', tags: ['gentle', 'soft tone'], t: 2, p: 'slow' },
    { label: '宠溺', tags: ['tender', 'chuckling'], t: 2, p: 'slow', tail: '~' },
    { label: '撒娇', tags: ['coquettish', 'whiny'], t: 3, p: 'normal', tail: '~' },
    { label: '开心', tags: ['happy'], t: 2, p: 'normal' },
    { label: '兴奋', tags: ['excited'], t: 3, p: 'fast', tail: '！' },
    { label: '调侃坏笑', tags: ['teasing', 'chuckling'], t: 2, p: 'normal' },
    { label: '得意', tags: ['proud', 'smug'], t: 2, p: 'normal' },
    { label: '害羞结巴', tags: ['embarrassed', 'whisper'], t: 3, p: 'normal', stutter: true },
    { label: '委屈', tags: ['upset', 'voice trembling'], t: 3, p: 'slow' },
    { label: '强忍哭', tags: ['whisper', 'holding back tears'], t: 4, p: 'slow', stutter: true },
    { label: '哭着说', tags: ['sobbing'], t: 4, p: 'slow', stutter: true, pre: ['呜……', 'うぅ……'] },
    { label: '抽泣', tags: ['sobbing', 'sniffling'], t: 4, p: 'slow', pre: ['呜、呜呜……', 'ひっく……ぐすっ……'] },
    { label: '崩溃大哭', tags: ['crying loudly', 'hysterical'], t: 5, p: 'slow', stutter: true, pre: ['呜哇……', 'うわぁ……'] },
    { label: '大笑', tags: ['laughing loudly'], t: 3, p: 'normal', pre: ['哈哈哈哈，', 'あはははっ、'] },
    { label: '笑着说', tags: ['laughing'], t: 2, p: 'normal', pre: ['哈哈，', 'あはは、'] },
    { label: '偷笑', tags: ['chuckling'], t: 2, p: 'normal', pre: ['嘿嘿，', 'ふふっ、'] },
    { label: '苦笑', tags: ['bitter laugh'], t: 2, p: 'slow', pre: ['呵……', 'はは……'] },
    { label: '嗤笑', tags: ['disdainful', 'snicker'], t: 2, p: 'normal', pre: ['哼，', 'はっ、'] },
    { label: '长叹', tags: ['sigh'], t: 2, p: 'slow', pre: ['唉……', 'はぁ……'] },
    { label: '咳嗽', tags: ['clear throat'], t: 2, p: 'normal', pre: ['咳咳，', 'げほっ、'] },
    { label: '心疼', tags: ['heartbroken', 'soft tone'], t: 3, p: 'slow' },
    { label: '疲惫叹气', tags: ['exhausted', 'sigh'], t: 2, p: 'slow' },
    { label: '无奈', tags: ['resigned', 'sigh'], t: 2, p: 'slow' },
    { label: '紧张小声', tags: ['nervous', 'whisper'], t: 3, p: 'fast' },
    { label: '害怕发抖', tags: ['scared', 'voice trembling'], t: 4, p: 'fast', stutter: true },
    { label: '惊慌', tags: ['panicked', 'gasp'], t: 4, p: 'very_fast' },
    { label: '惊讶', tags: ['surprised', 'gasp'], t: 3, p: 'normal' },
    { label: '生气质问', tags: ['angry'], t: 4, p: 'fast', tail: '！' },
    { label: '暴怒吼', tags: ['furious', 'shouting'], t: 5, p: 'very_fast', tail: '！！' },
    { label: '咬牙切齿', tags: ['angry', 'through gritted teeth'], t: 4, p: 'slow' },
    { label: '冷淡', tags: ['indifferent', 'cold'], t: 1, p: 'slow' },
    { label: '嘲讽', tags: ['sarcastic', 'snicker'], t: 2, p: 'normal' },
    { label: '严肃', tags: ['serious'], t: 2, p: 'slow' },
    { label: '绝望', tags: ['desperate', 'voice breaking'], t: 5, p: 'slow' },
    { label: '释然', tags: ['relieved', 'sigh'], t: 2, p: 'slow' },
    { label: '慵懒', tags: ['lazy', 'sleepy'], t: 1, p: 'slow' },
    { label: '喘着说', tags: ['panting'], t: 3, p: 'fast' }
];

// 插在光标处的选项，按类分页
export const OPTION_GROUPS = [
    { key: 'emo', label: '情绪', items: [
        ['开心', '[happy]'], ['兴奋', '[excited]'], ['得意', '[proud]'], ['宠溺', '[tender]'], ['温柔', '[gentle]'], ['撒娇', '[coquettish]'],
        ['害羞', '[embarrassed]'], ['调侃', '[teasing]'], ['好奇', '[curious]'], ['感动', '[moved]'], ['释然', '[relieved]'], ['期待', '[hopeful]'],
        ['悲伤', '[sad]'], ['委屈', '[upset]'], ['心疼', '[heartbroken]'], ['失落', '[disappointed]'], ['孤独', '[lonely]'], ['愧疚', '[guilty]'],
        ['绝望', '[desperate]'], ['疲惫', '[exhausted]'], ['无奈', '[resigned]'], ['紧张', '[nervous]'], ['焦急', '[anxious]'], ['害怕', '[scared]'],
        ['惊慌', '[panicked]'], ['惊讶', '[surprised]'], ['困惑', '[confused]'], ['怀疑', '[doubtful]'], ['生气', '[angry]'], ['暴怒', '[furious]'],
        ['烦躁', '[frustrated]'], ['嫉妒', '[jealous]'], ['不屑', '[disdainful]'], ['嘲讽', '[sarcastic]'], ['冷淡', '[indifferent]'], ['严肃', '[serious]'],
        ['坚定', '[determined]'], ['歇斯底里', '[hysterical]'], ['慵懒', '[lazy]'], ['醉醺醺', '[drunk]']
    ] },
    { key: 'voice', label: '声音', items: [
        ['哭腔', '[sobbing]'], ['大哭', '[crying loudly]'], ['强忍泪', '[holding back tears]'], ['声音发抖', '[voice trembling]'], ['破音', '[voice breaking]'],
        ['耳语', '[whisper]'], ['小声', '[soft tone]'], ['气声', '[breathy]'], ['大声', '[loud]'], ['喊', '[shouting]'], ['尖叫', '[screaming]'],
        ['咬牙', '[through gritted teeth]'], ['叹气', '[sigh]'], ['倒抽气', '[gasp]'], ['急喘', '[panting]'], ['吸鼻子', '[sniffling]'], ['哽咽', '[choked up]'],
        ['轻笑', '[chuckling]'], ['笑出声', '[laughing]'], ['大笑', '[laughing loudly]'], ['冷笑', '[snicker]'], ['苦笑', '[bitter laugh]'], ['打哈欠', '[yawning]'],
        ['清嗓', '[clear throat]'], ['低哼', '[groan]'], ['急促', '[in a hurry tone]'], ['拖长音', '[drawn out]']
    ] },
    { key: 'ono', label: '拟声/音效', items: [
        ['哈哈', '哈哈，'], ['哈哈哈', '哈哈哈哈，'], ['嘿嘿', '嘿嘿，'], ['嘻嘻', '嘻嘻，'], ['呵呵', '呵呵，'], ['噗', '噗——'], ['呜呜', '呜呜……'], ['呜哇', '呜哇……'],
        ['嘤', '嘤……'], ['抽噎', '呜、呜……'], ['唉', '唉……'], ['咳咳', '咳咳，'], ['啧', '啧，'], ['哼', '哼，'], ['哇', '哇——'], ['哎呀', '哎呀，'],
        ['あはは', 'あはは、'], ['ふふっ', 'ふふっ、'], ['えへへ', 'えへへ、'], ['くすくす', 'くすくす……'], ['ひっく', 'ひっく……'], ['ぐすっ', 'ぐすっ……'], ['うわぁ', 'うわぁ……'], ['げほっ', 'げほっ、'],
        ['🔊人群笑声', '[crowd laughing]'], ['🔊背景笑声', '[background laughter]'], ['🔊掌声', '[applause]'], ['🔊人群嘈杂', '[crowd noise]'], ['🔊观众哄笑', '[audience laughing]']
    ] },
    { key: 'pause', label: '停顿/标点', items: [
        ['短停顿', '[pause]'], ['长停顿', '[long pause]'], ['……', '……'], ['…', '…'], ['、', '、'], ['！', '！'], ['！！', '！！'],
        ['？', '？'], ['？！', '？！'], ['~', '~'], ['～？', '~？'], ['っ', 'っ'], ['——', '……']
    ] },
    { key: 'zh', label: '语气词·中', items: [
        ['嗯', '嗯'], ['嗯？', '嗯？'], ['唔', '唔'], ['呜', '呜'], ['呜呜', '呜呜'], ['啊', '啊'], ['啊？', '啊？'], ['哈', '哈'], ['哈啊', '哈啊'],
        ['呼', '呼……'], ['诶', '诶'], ['欸？', '欸？'], ['哼', '哼'], ['切', '切'], ['呀', '呀'], ['嘛', '嘛'], ['啦', '啦'], ['呢', '呢'], ['喂', '喂'], ['噗', '噗']
    ] },
    { key: 'ja', label: '语气词·日', items: [
        ['ん', 'ん'], ['ん？', 'ん？'], ['うん', 'うん'], ['う', 'う'], ['うぅ', 'うぅ'], ['あ', 'あ'], ['あっ', 'あっ'], ['え', 'え'], ['えっ', 'えっ'],
        ['は', 'は'], ['はぁ', 'はぁ……'], ['ふ', 'ふ'], ['ふふ', 'ふふ'], ['へへ', 'へへ'], ['ちっ', 'ちっ'], ['ねぇ', 'ねぇ'], ['よ', 'よ'], ['っ', 'っ'], ['ぐすっ', 'ぐすっ']
    ] },
    { key: 'rep', label: '叠字/结巴', items: [
        ['首字结巴', '@stutter-first'], ['光标前一个字叠一下', '@stutter-cursor'], ['首字拖长', '@drag-first'], ['句尾拖长', '@drag-tail'], ['整句打碎', '@shatter']
    ] }
];
// NSFW 模式才出现：成人亲密场景用（SFW 默认不显示）
export const NSFW_PRESETS = [
    { label: '暧昧低语', tags: ['whisper', 'breathy'], t: 3, p: 'slow', tail: '~' },
    { label: '贴耳调情', tags: ['seductive', 'whisper'], t: 3, p: 'slow', tail: '~' },
    { label: '动情轻喘', tags: ['breathy', 'panting'], t: 3, p: 'slow' },
    { label: '隐忍', tags: ['holding back', 'breathy'], t: 4, p: 'very_slow', stutter: true },
    { label: '娇喘', tags: ['moaning softly', 'panting'], t: 4, p: 'slow', stutter: true },
    { label: '失控', tags: ['moaning', 'panting'], t: 5, p: 'slow', stutter: true },
    { label: '餍足', tags: ['satisfied', 'breathy'], t: 2, p: 'very_slow', tail: '……' },
    { label: '耳边轻笑', tags: ['whisper', 'chuckling'], t: 3, p: 'slow', pre: ['呵……', 'ふふ……'] },
    { label: '撒娇讨饶', tags: ['coquettish', 'breathy'], t: 3, p: 'slow', stutter: true, tail: '~' },
    { label: '羞耻难耐', tags: ['embarrassed', 'panting softly'], t: 4, p: 'slow', stutter: true, pre: ['唔……', 'んっ……'] },
    { label: '压抑低吟', tags: ['holding back', 'moaning softly'], t: 4, p: 'very_slow', pre: ['嗯……', 'ん……'] },
    { label: '断断续续', tags: ['panting', 'voice trembling'], t: 4, p: 'slow', shatter: true },
    { label: '事后温存', tags: ['tender', 'breathy'], t: 2, p: 'very_slow', tail: '……' }
].map(p => ({ ...p, nsfw: true }));
export const NSFW_GROUP = { key: 'nsfw', label: '亲密', items: [
    ['气声', '[breathy]'], ['轻喘', '[panting softly]'], ['急喘', '[panting]'], ['低吟', '[moaning softly]'], ['呻吟', '[moaning]'], ['低哼', '[groan]'],
    ['勾人', '[seductive]'], ['隐忍', '[holding back]'], ['颤抖', '[voice trembling]'], ['餍足', '[satisfied]'],
    ['嗯…', '嗯……'], ['唔…', '唔……'], ['哈啊', '哈啊……'], ['啊~', '啊~'], ['ん…', 'ん……'], ['はぁ', 'はぁ……'], ['あっ', 'あっ……']
] };
// 按说话人的渠道筛选能用的选项：不认的不显示，免得点了没用
const tagOf = (v) => (String(v).match(/^\[([^\]]+)\]$/) || [])[1] || '';
const SFX = new Set(['crowd laughing', 'background laughter', 'audience laughing', 'applause', 'crowd noise']);
export function groupsFor(groups, prof = {}) {
    const k = prof.kind || 'inline';
    if (k === 'inline' || k === 's1') return groups;
    const textOnly = (items) => items.filter(([, v]) => !tagOf(v) || /^(pause|long pause)$/.test(tagOf(v)));
    return groups.map(g => {
        if (g.key === 'emo') {
            if (k === 'plain') return null;
            if (k === 'mm' || k === 'mm28') return { ...g, label: '情绪（整句）', items: MM_EMOTION_TAGS.map(([l, t]) => [l, `[${t}]`]) };
            return { ...g, label: '情绪（整句）' };
        }
        if (g.key === 'voice') {
            if (k === 'plain' || k === 'mm') return null;
            if (k === 'mm28') return { ...g, items: g.items.filter(([, v]) => MM28_SOUND_TAGS.includes(tagOf(v))) };
            return { ...g, label: '声音（整句）' };
        }
        if (g.key === 'ono') return { ...g, items: g.items.filter(([, v]) => !SFX.has(tagOf(v))) };
        if (g.key === 'nsfw') {
            if (k === 'sentence') return g;
            if (k === 'mm28') return { ...g, items: g.items.filter(([, v]) => !tagOf(v) || MM28_SOUND_TAGS.includes(tagOf(v))) };
            return { ...g, items: textOnly(g.items) };
        }
        return g;
    }).filter(g => g && g.items.length);
}

const PACES = [['very_slow', '1 很慢'], ['slow', '2 慢'], ['normal', '3 正常'], ['fast', '4 快'], ['very_fast', '5 很快']];
const TENSIONS = [[1, '1 平静'], [2, '2 轻微'], [3, '3 明显'], [4, '4 强烈'], [5, '5 爆发']];
const isWordCh = (c) => /[\p{L}\p{N}]/u.test(c);
const TONES = ['日常', '轻松', '温馨', '浪漫', '亲密', '悲伤', '紧张', '悬疑', '恐怖', '战斗', '壮阔'];

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
.yzsv-ed-mask { position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,.45); display: flex; align-items: flex-end; justify-content: center; }
.yzsv-ed { width: min(560px, 100vw); max-height: 86vh; display: flex; flex-direction: column; background: #f6f6f9; color: #222; border-radius: 18px 18px 0 0; box-shadow: 0 -8px 30px rgba(0,0,0,.25); font-size: 14px; font-family: inherit; overflow: hidden; }
@media (min-width: 700px) { .yzsv-ed-mask { align-items: center; } .yzsv-ed { border-radius: 18px; } }
.yzsv-ed-head { padding: 14px 16px 10px; border-bottom: 1px solid #e6e6ee; background: #fff; }
.yzsv-ed-head b { font-size: 16px; }
.yzsv-ed-head .row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.yzsv-ed-head select, .yzsv-ed-head input { border: 1px solid #e3e3ea; border-radius: 9px; padding: 6px 8px; font-size: 13px; background: #f8f8fb; color: #222; font-family: inherit; }
.yzsv-ed-head input { flex: 1; min-width: 0; }
.yzsv-ed-close { float: right; border: 0; background: rgba(0,0,0,.06); width: 30px; height: 30px; border-radius: 50%; font-size: 16px; cursor: pointer; color: #555; }
.yzsv-ed-tip { font-size: 12px; color: #888; margin-top: 6px; line-height: 1.5; }
.yzsv-ed-body { overflow-y: auto; padding: 10px 12px 16px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.yzsv-ed-line { background: #fff; border: 1px solid #ececf2; border-radius: 14px; padding: 11px 12px; margin-bottom: 10px; }
.yzsv-ed-line.is-focus { border-color: #a18cd1; box-shadow: 0 0 0 2px rgba(161,140,209,.25); }
.yzsv-ed-line.is-edited .yzsv-ed-no::after { content: '已改'; margin-left: 6px; font-size: 10px; color: #fff; background: #a18cd1; border-radius: 6px; padding: 1px 5px; }
.yzsv-ed-top { display: flex; align-items: center; gap: 8px; }
.yzsv-ed-no { font-size: 12px; color: #999; flex: 0 0 auto; }
.yzsv-ed-spk { flex: 1; min-width: 0; border: 1px solid transparent; background: transparent; font-weight: 600; font-size: 14px; color: #333; border-radius: 8px; padding: 3px 6px; font-family: inherit; }
.yzsv-ed-spk:focus { border-color: #d8d0ee; background: #faf9fe; outline: none; }
.yzsv-ed-why { font-size: 12px; color: #8a6fc0; margin: 4px 0 0; }
.yzsv-ed-lineamb { margin: 0 0 6px; font-size: 12px; color: #888; }
.yzsv-ed-lineamb select { padding: 3px 6px; font-size: 12px; }
.yzsv-ed-nsfw { color: #c0396b; font-size: 12px; }
.yzsv-ed-nsfw[hidden] { display: none; }
.yzsv-ed-amb.is-flash select { box-shadow: 0 0 0 3px rgba(224,96,138,.45); transition: box-shadow .3s; }
.yzsv-ed-sent { margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: #f4f6fb; border: 1px dashed #cdd5e6; font-size: 11.5px; line-height: 1.55; color: #556; word-break: break-all; }
.yzsv-ed-sent b { color: #334; }
.yzsv-ed-warn { margin-top: 8px; padding: 7px 10px; border-radius: 10px; background: #fff6e6; color: #9a6400; font-size: 12px; line-height: 1.5; }
.yzsv-ed-orig { font-size: 12px; color: #999; margin: 6px 0; line-height: 1.5; word-break: break-all; }
.yzsv-ed-script { width: 100%; box-sizing: border-box; min-height: 58px; border: 1px solid #e3e3ea; border-radius: 10px; padding: 8px 10px; font-size: 14px; line-height: 1.55; background: #fbfbfd; color: #222; resize: vertical; font-family: inherit; }
.yzsv-ed-script:focus { outline: none; border-color: #a18cd1; background: #fff; }
.yzsv-ed-chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 7px 0 2px; }
.yzsv-ed-chips button { border: 1px solid #e0daf1; background: #f6f3fd; color: #6b54a8; border-radius: 999px; padding: 3px 9px; font-size: 12px; cursor: pointer; font-family: inherit; }
.yzsv-ed-tabs { display: flex; flex-wrap: wrap; gap: 4px 4px; margin-top: 10px; }
.yzsv-ed-tabs::-webkit-scrollbar { display: none; }
.yzsv-ed-tabs button { flex: 0 0 auto; border: 0; background: transparent; color: #888; font-size: 12.5px; padding: 4px 8px; border-radius: 8px; cursor: pointer; font-family: inherit; }
.yzsv-ed-tabs button.is-on { background: #efeaf9; color: #6b54a8; font-weight: 600; }
.yzsv-ed-chips[hidden] { display: none !important; }
.yzsv-ed-chips button[data-preset] { background: #fff4f0; border-color: #f4d9cf; color: #b0603f; }
.yzsv-ed-chips button[data-preset].is-nsfw, .yzsv-ed-chips.is-nsfw button { background: #fdeef3; border-color: #f2bfd0; color: #c0396b; }
.yzsv-ed-chips button[data-preset].is-sel { background: #3b82f6 !important; border-color: #3b82f6 !important; color: #fff !important; box-shadow: 0 2px 6px rgba(59,130,246,.35); }
.yzsv-ed-chips button[data-preset].is-sel::before { filter: brightness(1.6); }
.yzsv-ed-chips button[data-preset].is-nsfw::before, .yzsv-ed-tabs button[data-tab="nsfw"]::before { content: '🔞'; font-size: 10px; margin-right: 2px; }
.yzsv-ed-tabs button[data-tab="nsfw"] { color: #c0396b; }
.yzsv-ed-tabs button[data-tab="nsfw"].is-on { background: #fdeef3; }
.yzsv-ed-amb { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12.5px; color: #666; }
.yzsv-ed-amb select { border: 1px solid #e3e3ea; border-radius: 9px; padding: 5px 8px; font-size: 13px; background: #f8f8fb; color: #222; font-family: inherit; }
.yzsv-ed-hint { font-size: 11px; color: #aaa; margin-top: 4px; line-height: 1.45; }
.yzsv-ed-set { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.yzsv-ed-set > span { font-size: 12px; color: #888; width: 34px; flex: 0 0 34px; }
.yzsv-ed-seg { display: inline-flex; background: #f1f1f5; border-radius: 9px; padding: 2px; flex-wrap: wrap; }
.yzsv-ed-seg button { border: 0; background: transparent; padding: 4px 9px; font-size: 12px; border-radius: 7px; cursor: pointer; color: #555; font-family: inherit; }
.yzsv-ed-seg button.is-on { background: #fff; color: #6b54a8; box-shadow: 0 1px 3px rgba(0,0,0,.1); font-weight: 600; }
.yzsv-ed-acts { display: flex; gap: 8px; margin-top: 10px; }
.yzsv-ed-acts button { border: 0; border-radius: 9px; padding: 7px 14px; font-size: 13px; cursor: pointer; font-family: inherit; }
.yzsv-ed-play { background: #a18cd1; color: #fff; }
.yzsv-ed-play.is-busy { background: #8a7bb0; }
.yzsv-ed-reset { background: #f1f1f5; color: #666; }
.yzsv-ed-foot { padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid #e6e6ee; background: #fff; display: flex; gap: 8px; }
.yzsv-ed-foot button { flex: 1; border: 0; border-radius: 11px; padding: 10px; font-size: 14px; cursor: pointer; font-family: inherit; }
.yzsv-ed-foot .primary { background: #a18cd1; color: #fff; }
.yzsv-ed-foot .ghost { background: #f1f1f5; color: #555; }
.yzsv-ed-ch { margin: 6px 0 2px; padding: 6px 9px; border-radius: 9px; background: #f3f0fb; font-size: 11.5px; line-height: 1.5; color: #6b54a8; }
.yzsv-ed-ch b { font-weight: 600; }
.yzsv-ed-ch span { display: block; color: #8a7fa8; }
.yzsv-ed-ch.is-plain { background: #fff6e6; color: #9a6400; }
.yzsv-ed-ch.is-plain span { color: #a8803a; }
.yzsv-ed-prev { margin-top: 6px; padding: 6px 9px; border-radius: 9px; border: 1px dashed #d5dbe8; background: #f8f9fc; font-size: 11.5px; line-height: 1.55; color: #556; word-break: break-all; }
.yzsv-ed-prev b { color: #334; font-weight: 600; }
.yzsv-ed-takes { margin-top: 8px; padding: 8px; border-radius: 11px; background: #f6f3fd; border: 1px solid #e6def7; }
.yzsv-ed-takes[hidden] { display: none; }
.yzsv-ed-takes .hd { font-size: 11.5px; color: #8a7fa8; margin: 0 2px 6px; line-height: 1.45; }
.yzsv-ed-take { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 9px; background: #fff; border: 1px solid transparent; margin-top: 4px; }
.yzsv-ed-take.is-sel { border-color: #a18cd1; box-shadow: 0 0 0 2px rgba(161,140,209,.18); }
.yzsv-ed-take span { flex: 1; min-width: 0; font-size: 12px; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yzsv-ed-take span b { color: #6b54a8; font-weight: 600; margin-right: 4px; }
.yzsv-ed-take button { flex: 0 0 auto; border: 0; border-radius: 8px; padding: 4px 9px; font-size: 12px; cursor: pointer; font-family: inherit; background: #f1eefa; color: #6b54a8; }
.yzsv-ed-take button[data-take-play].is-playing { background: #a18cd1; color: #fff; }
.yzsv-ed-take.is-sel button[data-take-use] { background: #a18cd1; color: #fff; }
.yzsv-ed-take button[data-take-del] { background: transparent; color: #bbb; padding: 4px 6px; }
`;
    document.head.appendChild(st);
}

/**
 * @param {import('./story-voice.js').StoryVoice} sv
 * @param {number} mesid
 * @param {string|number} focusLine  打开后滚到这一句
 */
export function openDeepEditor(sv, mesid, focusLine = null, { single = false } = {}) {
    injectStyle();
    document.querySelectorAll('.yzsv-ed-mask').forEach(n => n.remove());
    const ctx = window.SillyTavern?.getContext?.();
    const msg = ctx?.chat?.[mesid];
    const settings = sv.getSettings();
    // 三种模式都能逐句调：没有分析结果就新建一份（只存改过的句子）
    let entry = sv._lineEntry(msg);
    if (!entry) entry = { at: Date.now(), tone: '', arc: '', lines: {}, manualOnly: true };
    entry.lines = entry.lines || {};
    const analyzed = !entry.manualOnly;
    let bars = Array.from(document.querySelectorAll(`#chat .mes[mesid="${mesid}"] .mes_text .yzsv-bar`));
    if (single && focusLine !== null) bars = bars.filter(b => String(b.dataset.line) === String(focusLine));
    if (!bars.length) { sv._toast('没有可编辑的台词', '这一楼没有找到挂了按钮的台词'); return; }
    // 所有标签都显示；用了 🔞 的标签，这一楼的情节自动标成「亲密」（可以再改回来）
    const presets = [...PRESETS, ...NSFW_PRESETS];
    const curTone = sv._floorTone(msg) || entry.tone || '';
    // 顺序：情绪、声音、拟声/音效、停顿、叠字、（亲密）、语气词放最后
    const lang = OPTION_GROUPS.filter(g => g.key === 'zh' || g.key === 'ja');
    const groups = [...OPTION_GROUPS.filter(g => g.key !== 'zh' && g.key !== 'ja'), NSFW_GROUP, ...lang];
    // 简单分析：没改过的句子，用模型写的 [[名字|语气]] 作为初稿
    const cueScript = (cue, text) => {
        const tags = String(cue || '').replace(/[\[\]]/g, '').split(/[,，、;；]/).map(x => x.trim()).filter(Boolean).slice(0, 2);
        return tags.length && settings.analysisMode === 'simple' ? `${tags.map(t => `[${t}]`).join('')} ${text}` : text;
    };

    const profOf = (speaker) => { try { return sv._speakerChannel(speaker).profile; } catch (e) { return { kind: 'inline', name: '', note: '' }; } };
    const chHtml = (prof) => prof?.name ? `<b>🔈 ${esc(prof.name)}</b><span>${esc(prof.note || '')}</span>` : '';
    const toolsHtml = (prof, text, v = {}) => {
        const gs = groupsFor(groups, prof).filter(g => !(g.key === 'ja' && !/[\u3040-\u30ff]/.test(text)) && !(g.key === 'zh' && /[\u3040-\u30ff]/.test(text)));
        return `<div class="yzsv-ed-tabs">${[['preset', '一键演法'], ...gs.map(g => [g.key, g.label])].map(([k, l]) => `<button type="button" data-tab="${k}" class="${(k === 'preset') ? 'is-on' : ''}">${l}</button>`).join('')}</div>
            <div class="yzsv-ed-chips" data-pane="preset">${presets.map((p, j) => { const tg = fitTags(p.tags, prof); return `<button type="button" data-preset="${j}" class="${p.nsfw ? 'is-nsfw' : ''}${v.preset === p.label ? ' is-sel' : ''}" title="张力 ${p.t} · ${esc(p.p)}${tg.length ? ' · ' + esc(tg.map(x => `[${x}]`).join('')) : ''}">${esc(p.label)}</button>`; }).join('')}</div>
            ${gs.map(g => `<div class="yzsv-ed-chips${g.key === 'nsfw' ? ' is-nsfw' : ''}" data-pane="${g.key}" hidden>${g.items.map(([l, iv]) => `<button type="button" data-ins="${esc(iv)}" data-group="${g.key}" title="${esc(iv)}">${esc(l)}</button>`).join('')}</div>`).join('')}
            <div class="yzsv-ed-hint">${prof.kind === 'mm' || prof.kind === 'mm28' ? 'MiniMax 的情绪整句只有一个：点情绪会放到句首并换掉原来的。' : prof.kind === 'sentence' ? '这个渠道的语气整句生效：情绪、声音会放到句首（最多两个）。' : prof.kind === 'plain' ? '这个渠道不认标签：用拟声、语气词、叠字、标点来演。' : '情绪、声音放在要生效的字前面（光标在哪就插在哪，没点过就插在句首）；'}一键演法会换掉句首的标签并设好张力和语速。</div>`;
    };

    const lineHtml = (bar, i) => {
        const text = bar.dataset.text || '';
        const prof = profOf(bar.dataset.speaker || '');
        const v = entry.lines?.[text] || {};
        const script = v.s || (v.edited ? text : cueScript(bar.dataset.cue, text));
        const t = Number(v.t) || 2;
        const pace = v.pace || 'normal';
        return `
        <div class="yzsv-ed-line${v.edited ? ' is-edited' : ''}" data-line="${esc(bar.dataset.line)}" data-text="${esc(text)}">
            <div class="yzsv-ed-top"><span class="yzsv-ed-no">#${i + 1}</span><input class="yzsv-ed-spk" value="${esc(bar.dataset.speaker || v.role || '')}" title="说话人（改了会按这个人的音色读）"></div>
            ${v.why ? `<div class="yzsv-ed-why">💭 ${esc(v.why)}</div>` : ''}
            <div class="yzsv-ed-ch${prof.kind === 'plain' ? ' is-plain' : ''}">${chHtml(prof)}</div>
            <div class="yzsv-ed-orig">原文：${esc(text)}</div>
            <div class="yzsv-ed-amb yzsv-ed-lineamb">🌧 从这句起换环境声<select class="yzsv-ed-lineambsel"><option value="">不变（接着上一句）</option>${Object.entries(AMBIENCE_LABELS).map(([k, l]) => `<option value="${k}" ${k === (v.amb || '') ? 'selected' : ''}>${k === 'none' ? '停掉环境声' : l}</option>`).join('')}</select></div>
            <textarea class="yzsv-ed-script" rows="2" spellcheck="false">${esc(script)}</textarea>
            <div class="yzsv-ed-set"><span>张力</span><div class="yzsv-ed-seg" data-k="t">${TENSIONS.map(([n, l]) => `<button type="button" data-v="${n}" class="${n === t ? 'is-on' : ''}">${l}</button>`).join('')}</div></div>
            <div class="yzsv-ed-set"><span>语速</span><div class="yzsv-ed-seg" data-k="pace">${PACES.map(([k, l]) => `<button type="button" data-v="${k}" class="${k === pace ? 'is-on' : ''}">${l}</button>`).join('')}</div></div>
            <div class="yzsv-ed-prev"></div>
            <div class="yzsv-ed-tools">${toolsHtml(prof, text, v)}</div>
            <div class="yzsv-ed-acts"><button type="button" class="yzsv-ed-play">▶ 生成一版试听</button><button type="button" class="yzsv-ed-reset">去掉标签</button></div>
            <div class="yzsv-ed-takes" hidden></div>
            <div class="yzsv-ed-sent" hidden></div>
        </div>`;
    };

    const mask = document.createElement('div');
    mask.className = 'yzsv-ed-mask';
    mask.innerHTML = `
        <div class="yzsv-ed" role="dialog">
            <div class="yzsv-ed-head">
                <button type="button" class="yzsv-ed-close" title="关闭">✕</button>
                <b>${single ? '🎭 这句的演法' : analyzed ? '🎭 深度分析结果' : '🎭 逐句调整演法'}</b> <small class="yzsv-ed-nsfw" ${curTone === '亲密' ? '' : 'hidden'}>NSFW</small>
                <div class="yzsv-ed-amb">🎬 这一楼的情节<select class="yzsv-ed-tone">${['', ...TONES].map(x => `<option value="${esc(x)}" ${x === curTone ? 'selected' : ''}>${x ? (x === '亲密' ? '亲密（NSFW）' : x) : '没判断'}</option>`).join('')}</select>${analyzed && !single ? `<input class="yzsv-ed-arc" value="${esc(entry.arc || '')}" placeholder="情绪走向" style="flex:1;min-width:0;border:1px solid #e3e3ea;border-radius:9px;padding:5px 8px;font-size:13px;background:#f8f8fb;">` : ''}</div>
                <div class="yzsv-ed-amb">🌧 这一楼开头的环境声<select class="yzsv-ed-ambsel">${Object.entries(AMBIENCE_LABELS).map(([k, l]) => `<option value="${k}" ${k === (entry.ambience || 'none') ? 'selected' : ''}>${l}</option>`).join('')}</select><button type="button" class="yzsv-ed-ambtry" style="border:0;background:#f1f1f5;border-radius:8px;padding:5px 9px;cursor:pointer;font-size:12px;">试听</button></div>
                <div class="yzsv-ed-tip">张力 1 平静 → 5 爆发，越高情绪越强；语速在播放时直接变快变慢（不用重新生成）。每句上面写了这个人用的渠道和它认什么：不同渠道下面能选的选项不一样，虚线框里是实际会发过去的内容。演法里 [方括号] 是声音标签，放在要生效的字前面，可以点下面的按钮插入，也可以自己写 [crying softly] 这类英文描述；可以加叠字（我、我不是）、……、！！、呜。点「生成一版试听」只调用语音接口生成这一句（不会调用分析模型），可以反复生成、来回对比，保存时只留选中的那版。</div>
            </div>
            <div class="yzsv-ed-body">${bars.map(lineHtml).join('')}</div>
            <div class="yzsv-ed-foot"><button type="button" class="ghost yzsv-ed-cancel">关闭</button><button type="button" class="primary yzsv-ed-save">${single ? '保存' : '保存全部'}</button></div>
        </div>`;
    document.body.appendChild(mask);

    const read = (row) => {
        const seg = (k) => row.querySelector(`.yzsv-ed-seg[data-k="${k}"] button.is-on`)?.dataset.v;
        return {
            text: row.dataset.text,
            line: row.dataset.line,
            speaker: row.querySelector('.yzsv-ed-spk').value.trim(),
            script: row.querySelector('.yzsv-ed-script').value.replace(/\s*\n\s*/g, ' ').trim(),
            amb: row.querySelector('.yzsv-ed-lineambsel')?.value || '',
            t: Number(seg('t')) || 2,
            pace: seg('pace') || 'normal'
        };
    };

    // 存一句：写回分析结果（标记为已改）；说话人改了就记成手动指定
    const saveRow = (row) => {
        if (!row._dirty) return false; // 没动过的句子不存（保持分析 / 原样）
        const r = read(row);
        const old = entry.lines[r.text] || {};
        const script = r.script && r.script !== r.text ? r.script : '';
        const next = { ...old, role: r.speaker || old.role || '', pace: r.pace, t: r.t, s: script, amb: r.amb, ambSet: true, preset: row._preset !== undefined ? row._preset : (old.preset || '') };
        if (!r.amb) delete next.amb;
        const changed = ['role', 'pace', 't', 's', 'amb'].some(k => String(next[k] ?? '') !== String(old[k] ?? ''));
        if (changed || !old.edited) { next.edited = true; entry.lines[r.text] = next; row.classList.add('is-edited'); }
        // 选了试听里的某一版：以后就播这版；否则丢掉这句的旧语音，下次播放重新生成
        const take = Number.isInteger(row._chosen) ? row._takes?.[row._chosen] : null;
        const sig = sv.takeSig(r.speaker, script, r.t, r.pace);
        if (take && take.sig === sig) { sv.pinTake(mesid, r.line, sig, take.urls); take.kept = true; }
        else sv.markFresh(mesid, r.line);
        row._dirty = false;
        const bar = document.querySelector(`#chat .mes[mesid="${mesid}"] .mes_text .yzsv-bar[data-line="${CSS.escape(r.line)}"]`);
        if (bar && r.speaker && r.speaker !== (bar.dataset.speaker || '')) sv._saveOverride(bar, r.speaker);
        return true;
    };
    const saveAll = () => {
        let n = 0;
        mask.querySelectorAll('.yzsv-ed-line').forEach(row => { if (saveRow(row)) n += 1; });
        mask._saved = (mask._saved || 0) + n;
        const amb = mask.querySelector('.yzsv-ed-ambsel');
        if (amb && amb.value !== (entry.ambience || 'none')) { entry.ambience = amb.value; entry.ambienceSet = true; n += 1; }
        const tone = mask.querySelector('.yzsv-ed-tone');
        const arc = mask.querySelector('.yzsv-ed-arc');
        if (tone && tone.value !== curTone) { entry.tone = tone.value; entry.toneSet = true; n += 1; }
        if (arc && arc.value.trim() !== (entry.arc || '')) { entry.arc = arc.value.trim(); n += 1; }
        if (n || analyzed) { entry.at = Date.now(); sv._deepSave(sv._deepHashOf(msg), entry); }
        sv.processById(mesid);
        return n;
    };

    // 记住每个输入框最后的光标位置（点按钮时输入框会失焦）
    mask.querySelectorAll('.yzsv-ed-script').forEach(ta => {
        const keep = () => { ta._sel = [ta.selectionStart, ta.selectionEnd]; };
        ['select', 'keyup', 'click', 'input', 'blur'].forEach(ev => ta.addEventListener(ev, keep));
        ta.addEventListener('input', () => { ta._base = null; }); // 手动改过：下次一键演法以改后的为底
    });
    // 动过哪句就记哪句（输入、点选项、改说话人）
    mask.querySelectorAll('.yzsv-ed-line').forEach(row => {
        row.addEventListener('input', () => { row._dirty = true; });
        row.addEventListener('click', (e) => { if (e.target.closest('button') && !e.target.closest('.yzsv-ed-tabs, .yzsv-ed-play, .yzsv-ed-takes')) row._dirty = true; });
    });
    // 每句：记住说话人的渠道，实时预览发过去的内容；改了说话人就换成那个人渠道的选项
    const prevHtml = (row) => {
        const r = read(row);
        try {
            const pv = sv.previewLine(r.speaker, r.script || r.text, r.t);
            const opt = Object.keys(pv.opts || {}).length ? ` · 参数 ${esc(JSON.stringify(pv.opts))}` : '';
            return `<b>会发给 ${esc(pv.profile?.name || pv.provider)}：</b>${esc(pv.text)}${opt}`;
        } catch (e) { return ''; }
    };
    const refreshPrev = (row) => { const box = row.querySelector('.yzsv-ed-prev'); if (box) box.innerHTML = prevHtml(row); };
    // 试听对比：每生成一版就记一版，可以来回播、选一版；保存时只留选中的，关掉不保存就全丢
    const PACE_L = Object.fromEntries(PACES);
    const setRow = (row, v) => {
        row.querySelector('.yzsv-ed-spk').value = v.speaker;
        row.querySelector('.yzsv-ed-script').value = v.script || row.dataset.text;
        const setSeg = (k, val) => row.querySelectorAll(`.yzsv-ed-seg[data-k="${k}"] button`).forEach(b => b.classList.toggle('is-on', String(b.dataset.v) === String(val)));
        setSeg('t', v.t);
        setSeg('pace', v.pace);
        refreshPrev(row);
    };
    const renderTakes = (row) => {
        const box = row.querySelector('.yzsv-ed-takes');
        const takes = row._takes || [];
        box.hidden = !takes.length;
        if (!takes.length) { box.innerHTML = ''; return; }
        const faved = (key) => key !== 'orig' && takes[key]?.fav;
        const item = (key, label, sel) => `<div class="yzsv-ed-take${sel ? ' is-sel' : ''}"><button type="button" data-take-play="${key}">▶</button><span>${label}</span><button type="button" data-take-fav="${key}" title="收藏这版（单独保存，删除去「语音收藏」里）">${faved(key) ? '★' : '☆'}</button><button type="button" data-take-use="${key}">${sel ? '✓ 选中' : '用这版'}</button>${key === 'orig' ? '' : `<button type="button" data-take-del="${key}" title="删掉这版">✕</button>`}</div>`;
        box.innerHTML = `<div class="hd">试听对比：可以反复生成、来回听，选一版。点「保存」时只留选中的那版（以后 ▶ 就播它），其余的清掉；不保存直接关掉就全部丢掉。点 ☆ 收藏的版本单独保存，不会被清掉，只能在「语音收藏」里删。</div>`
            + item('orig', '<b>原来的</b>改之前的演法', row._chosen === 'orig')
            + takes.map((tk, i) => tk ? item(i, `<b>#${i + 1}</b>张力 ${tk.t} · ${esc(PACE_L[tk.pace] || tk.pace)} · ${esc(tk.script || row.dataset.text)}`, row._chosen === i) : '').join('');
    };
    const dropTakes = () => {
        mask.querySelectorAll('.yzsv-ed-line').forEach(row => (row._takes || []).forEach(tk => { if (tk && !tk.kept) tk.urls.forEach(u => sv._safeRevoke(u)); }));
    };
    mask.querySelectorAll('.yzsv-ed-line').forEach(row => {
        row._orig = read(row);
        row._takes = [];
        row._chosen = null;
        row._prof = profOf(row.querySelector('.yzsv-ed-spk').value.trim());
        refreshPrev(row);
        let tm = null;
        row.addEventListener('input', (ev) => {
            clearTimeout(tm);
            tm = setTimeout(() => {
                if (ev.target.classList.contains('yzsv-ed-spk')) {
                    const prof = profOf(ev.target.value.trim());
                    if (prof.name !== row._prof?.name) {
                        row._prof = prof;
                        const ch = row.querySelector('.yzsv-ed-ch');
                        ch.innerHTML = chHtml(prof);
                        ch.classList.toggle('is-plain', prof.kind === 'plain');
                        row.querySelector('.yzsv-ed-tools').innerHTML = toolsHtml(prof, row.dataset.text || '', {});
                    }
                }
                refreshPrev(row);
            }, 300);
        });
    });

    // 正文开始的位置（跳过句首的标签和空格）
    const leadEnd = (v) => (v.match(/^\s*(?:\[[^\]\n]{1,40}\]\s*)*/) || [''])[0].length;
    const insertAt = (ta, ins) => {
        ta._base = null;
        const v = ta.value;
        let [a, b] = ta._sel || [null, null];
        if (a == null) { a = b = /^\[/.test(ins) ? 0 : leadEnd(v); }
        // 标签和后面的字之间留一个空格；前面紧贴的字后面也补空格
        let text = ins;
        if (/^\[/.test(ins) && a > 0 && !/\s|\]/.test(v[a - 1])) text = ` ${text}`;
        ta.value = v.slice(0, a) + text + v.slice(b);
        const at = a + text.length;
        ta._sel = [at, at];
        ta.focus();
        try { ta.setSelectionRange(at, at); } catch (err) { /* 忽略 */ }
    };
    // 叠字 / 结巴 / 拖长
    const SMALL = 'っッぁぃぅぇぉゃゅょゎァィゥェォャュョヮー';
    const firstWordAt = (v) => { const s0 = leadEnd(v); for (let i = s0; i < v.length; i++) if (isWordCh(v[i]) && !SMALL.includes(v[i])) return i; return -1; };
    const transform = (ta, kind, fromPreset = false) => {
        if (!fromPreset) ta._base = null;
        let v = ta.value;
        if (kind === 'stutter-first') {
            const i = firstWordAt(v);
            if (i >= 0) v = v.slice(0, i) + v[i] + '、' + v.slice(i);
        } else if (kind === 'stutter-cursor') {
            const a = (ta._sel || [v.length])[0];
            let i = a - 1;
            while (i >= 0 && !isWordCh(v[i])) i -= 1;
            if (i >= 0) v = v.slice(0, i + 1) + '、' + v[i] + v.slice(i + 1);
        } else if (kind === 'drag-first') {
            const i = firstWordAt(v);
            if (i >= 0) v = v.slice(0, i + 1) + '……' + v.slice(i + 1);
        } else if (kind === 'drag-tail') {
            v = v.replace(/[。．.！!？?~～…]*\s*$/, '') + '~……';
        } else if (kind === 'shatter') {
            // 逗号、顿号处变成省略号，长句碎成短片段（适合哭、崩溃、喘）
            const lead = v.slice(0, leadEnd(v));
            v = lead + v.slice(lead.length).replace(/[，,、]\s*/g, '……').replace(/(……){2,}/g, '……');
        }
        ta.value = v;
        ta._sel = null;
    };
    const applyPreset = (row, ta, p) => {
        if (!p) return;
        // 连着点几个一键演法：都在同一个底稿上套，不会把上一个的 ~ 、叠字累积起来
        if (!ta._base) ta._base = ta.value.replace(/^\s*(?:\[[^\]\n]{1,40}\]\s*)*/, '').trim() || row.dataset.text;
        const body = ta._base;
        const tags = fitTags(p.tags, row._prof || {}).map(x => `[${x}]`).join('');
        let v = `${tags}${tags ? ' ' : ''}${body}`;
        ta.value = v;
        if (p.stutter) {
            const i = firstWordAt(v);
            if (i >= 0 && !(v[i + 1] === '、' && v[i + 2] === v[i])) transform(ta, 'stutter-first', true);
        }
        if (p.tail) ta.value = ta.value.replace(/[。．.！!~～]*\s*$/, '') + p.tail;
        if (p.shatter) transform(ta, 'shatter', true);
        if (p.pre) {
            const pre = /[\u3040-\u30ff]/.test(row.dataset.text || '') ? p.pre[1] : p.pre[0];
            const v2 = ta.value;
            const at = leadEnd(v2);
            ta.value = v2.slice(0, at) + pre + v2.slice(at);
        }
        const setSeg = (k, val) => row.querySelectorAll(`.yzsv-ed-seg[data-k="${k}"] button`).forEach(b => b.classList.toggle('is-on', String(b.dataset.v) === String(val)));
        setSeg('t', p.t);
        setSeg('pace', p.p);
        ta._sel = null;
    };

    mask.querySelector('.yzsv-ed-tone')?.addEventListener('change', (ev) => {
        const b = mask.querySelector('.yzsv-ed-nsfw');
        if (b) b.hidden = ev.target.value !== '亲密';
    });
    let trial = null;
    const close = () => { trial?.stop(); sv.stop(); dropTakes(); mask.remove(); };
    mask.addEventListener('click', async (e) => {
        if (e.target === mask || e.target.closest('.yzsv-ed-close, .yzsv-ed-cancel')) {
            const rows = Array.from(mask.querySelectorAll('.yzsv-ed-line'));
            const pending = rows.some(r => r._dirty || (r._takes || []).some(Boolean));
            if (pending && !window.confirm('这次改的还没保存。\n确定 = 保存（试听只留选中的那版）\n取消 = 不保存，改动和试听都丢掉')) { close(); return; }
            saveAll();
            close();
            return;
        }
        if (e.target.closest('.yzsv-ed-save')) {
            const n = saveAll();
            const total = mask._saved || 0;
            sv._toast('已保存', total ? `改了 ${total} 句，点 ▶ 会按新的演法生成` : '没有改动', 'success');
            close();
            return;
        }
        if (e.target.closest('.yzsv-ed-ambtry')) {
            const b = e.target.closest('.yzsv-ed-ambtry');
            if (trial) { trial.stop(); trial = null; b.textContent = '试听'; return; }
            const kind = mask.querySelector('.yzsv-ed-ambsel').value;
            if (kind === 'none') return;
            trial = startAmbience(kind, (Number(settings.ambienceVol) || 30) / 100);
            b.textContent = '停止';
            setTimeout(() => { if (trial) { trial.stop(); trial = null; b.textContent = '试听'; } }, 6000);
            return;
        }
        const row = e.target.closest('.yzsv-ed-line');
        if (!row) return;
        const segBtn = e.target.closest('.yzsv-ed-seg button');
        if (segBtn) {
            segBtn.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b === segBtn));
            refreshPrev(row);
            return;
        }
        const tab = e.target.closest('.yzsv-ed-tabs button');
        if (tab) {
            row.querySelectorAll('.yzsv-ed-tabs button').forEach(b => b.classList.toggle('is-on', b === tab));
            row.querySelectorAll('.yzsv-ed-chips').forEach(p => { p.hidden = p.dataset.pane !== tab.dataset.tab; });
            return;
        }
        const ta = row.querySelector('.yzsv-ed-script');
        const presetBtn = e.target.closest('[data-preset]');
        const toNsfw = () => {
            const sel = mask.querySelector('.yzsv-ed-tone');
            if (!sel || sel.value === '亲密') return;
            sel.value = '亲密';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            const box = sel.closest('.yzsv-ed-amb');
            box?.classList.add('is-flash');
            setTimeout(() => box?.classList.remove('is-flash'), 1200);
            sv._toast('情节已标成「亲密」', '用了 🔞 标签；不对的话在面板顶部改回去');
        };
        if (presetBtn) {
            const p = presets[Number(presetBtn.dataset.preset)];
            applyPreset(row, ta, p);
            // 选中的一键演法标蓝；之后改张力、语速都不会取消选中
            row.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('is-sel', b === presetBtn));
            row._preset = p?.label || '';
            if (p?.nsfw) toNsfw();
            refreshPrev(row);
            return;
        }
        if (e.target.closest('.yzsv-ed-chips.is-nsfw [data-ins]')) toNsfw();
        const insBtn = e.target.closest('[data-ins]');
        if (insBtn) {
            const v = insBtn.dataset.ins;
            if (v.startsWith('@')) { transform(ta, v.slice(1)); refreshPrev(row); return; }
            const kind = row._prof?.kind;
            const grp = insBtn.dataset.group;
            if (/^\[.*\]$/.test(v) && ['mm', 'mm28', 'sentence'].includes(kind) && (grp === 'emo' || (kind === 'sentence' && grp === 'voice'))) {
                // 整句生效的渠道：情绪放句首；MiniMax 只认一个情绪，换掉原来的
                let body = ta.value;
                if (kind !== 'sentence') {
                    const emo = new Set(MM_EMOTION_TAGS.map(([, t]) => t));
                    body = body.replace(/\[([^\]\n]{1,40})\]\s*/g, (all, w) => (emo.has(w.trim().toLowerCase()) ? '' : all));
                }
                const lead = (body.match(/^\s*(?:\[[^\]\n]{1,40}\]\s*)*/) || [''])[0];
                const leadTags = (lead.match(/\[[^\]]+\]/g) || []).filter(x => x !== v);
                const keep = kind === 'sentence' ? leadTags.slice(-1) : leadTags;
                ta.value = `${[...keep, v].join('')} ${body.slice(lead.length).trim()}`;
                ta._sel = null;
                refreshPrev(row);
                return;
            }
            insertAt(ta, /^\[.*\]$/.test(v) ? `${v} ` : v);
            refreshPrev(row);
            return;
        }
        if (e.target.closest('.yzsv-ed-reset')) {
            row.querySelectorAll('[data-preset].is-sel').forEach(b => b.classList.remove('is-sel'));
            row._preset = '';
            const ta = row.querySelector('.yzsv-ed-script');
            ta.value = ta.value.replace(/\[[^\]\n]{1,40}\]\s*/g, '').trim() || row.dataset.text;
            refreshPrev(row);
            return;
        }
        const tp = e.target.closest('[data-take-play]');
        if (tp) {
            const key = tp.dataset.takePlay;
            if (tp.classList.contains('is-playing')) { sv.stop(); tp.classList.remove('is-playing'); return; }
            mask.querySelectorAll('[data-take-play].is-playing').forEach(x => x.classList.remove('is-playing'));
            tp.classList.add('is-playing');
            try {
                if (key === 'orig') {
                    const bar = document.querySelector(`#chat .mes[mesid="${mesid}"] .mes_text .yzsv-bar[data-line="${CSS.escape(row.dataset.line)}"]`);
                    if (bar) await sv.playBars([bar], { noDeep: true }); // 播保存着的那版（有缓存就不重新请求）
                } else {
                    const tk = row._takes[Number(key)];
                    if (tk) await sv.playTake(tk.urls, tk.rate);
                }
            } catch (err) { sv._toast('播放失败', String(err?.message || err).slice(0, 120), 'error'); }
            finally { tp.classList.remove('is-playing'); }
            return;
        }
        const tf = e.target.closest('[data-take-fav]');
        if (tf) {
            const key = tf.dataset.takeFav;
            const r = read(row);
            try {
                if (key === 'orig') {
                    const bar = document.querySelector(`#chat .mes[mesid="${mesid}"] .mes_text .yzsv-bar[data-line="${CSS.escape(row.dataset.line)}"]`);
                    if (bar) await sv.favoriteBar(bar);
                } else {
                    const tk = row._takes[Number(key)];
                    if (!tk) return;
                    const blobs = await Promise.all(tk.urls.map(u => fetch(u).then(x => x.blob())));
                    const blob = blobs.length === 1 ? blobs[0] : new Blob(blobs, { type: blobs[0]?.type || 'audio/mpeg' });
                    await sv.saveFavorite({ text: row.dataset.text, speaker: tk.speaker || r.speaker, blob, rate: tk.rate, sig: `take\u0001${tk.sig}\u0001${tk.urls.join('|')}` });
                    tk.fav = true;
                    renderTakes(row);
                }
            } catch (err) { sv._toast('收藏失败', String(err?.message || err).slice(0, 120), 'error'); }
            return;
        }
        const tu = e.target.closest('[data-take-use]');
        if (tu) {
            const key = tu.dataset.takeUse;
            if (key === 'orig') { setRow(row, row._orig); row._chosen = 'orig'; row._dirty = false; }
            else { const tk = row._takes[Number(key)]; if (!tk) return; setRow(row, tk); row._chosen = Number(key); row._dirty = true; }
            renderTakes(row);
            return;
        }
        const td = e.target.closest('[data-take-del]');
        if (td) {
            const i = Number(td.dataset.takeDel);
            const tk = row._takes[i];
            if (tk) tk.urls.forEach(u => sv._safeRevoke(u));
            row._takes[i] = null; // 留空位，编号不变
            if (row._chosen === i) row._chosen = null;
            if (!row._takes.some(Boolean)) row._takes = [];
            renderTakes(row);
            return;
        }
        const play = e.target.closest('.yzsv-ed-play');
        if (play) {
            // 生成中再点一下 = 取消
            if (play.classList.contains('is-busy')) {
                play._abort?.abort();
                return;
            }
            sv._unlockAudio();
            const bar = document.querySelector(`#chat .mes[mesid="${mesid}"] .mes_text .yzsv-bar[data-line="${CSS.escape(row.dataset.line)}"]`);
            if (!bar) { sv._toast('找不到这一句', '正文可能刷新了，关掉再打开试试'); return; }
            const r = read(row);
            const draft = { speaker: r.speaker, script: r.script, t: r.t, pace: r.pace };
            const ctl = new AbortController();
            play._abort = ctl;
            play.classList.add('is-busy');
            const t0 = Date.now();
            const tick = setInterval(() => { play.textContent = `■ 生成中 ${Math.floor((Date.now() - t0) / 1000)}s（点一下取消）`; }, 250);
            try {
                const res = await sv.synthDraft(bar, draft, { signal: ctl.signal });
                if (ctl.signal.aborted) return;
                row._takes.push({ ...draft, ...res, script: draft.script && draft.script !== row.dataset.text ? draft.script : '' });
                row._chosen = row._takes.length - 1; // 新生成的这版默认选中
                row._dirty = true;
                renderTakes(row);
                // 实际发给语音接口的内容
                const box = row.querySelector('.yzsv-ed-sent');
                const log = (sv._sentLog || []).filter(x => x.at >= t0);
                if (box && log.length) { box.hidden = false; box.innerHTML = log.map(x => `<div><b>实际发送</b> · ${esc(x.provider || '?')}${x.model ? ` / ${esc(x.model)}` : ''}${x.fish?.temperature ? ` · 温度 ${x.fish.temperature}` : ''}${x.extra ? ` · ${esc(JSON.stringify(x.extra))}` : ''}</div><div>${esc(x.text)}</div>`).join(''); }
                clearInterval(tick);
                play.textContent = '▶ 再生成一版';
                play.classList.remove('is-busy');
                const tp2 = row.querySelector(`[data-take-play="${row._chosen}"]`);
                tp2?.classList.add('is-playing');
                await sv.playTake(res.urls, res.rate).catch(() => null);
                tp2?.classList.remove('is-playing');
            } catch (err) {
                if (!ctl.signal.aborted && err?.name !== 'AbortError') sv._toast('生成失败', String(err?.message || err).slice(0, 140), 'error');
                else sv._toast('已取消', '这一版没有生成');
            } finally {
                clearInterval(tick);
                if (play.classList.contains('is-busy')) { play.classList.remove('is-busy'); play.textContent = row._takes.length ? '▶ 再生成一版' : '▶ 生成一版试听'; }
            }
        }
    });

    if (focusLine !== null && focusLine !== undefined) {
        const row = mask.querySelector(`.yzsv-ed-line[data-line="${CSS.escape(String(focusLine))}"]`);
        if (row) { row.classList.add('is-focus'); setTimeout(() => row.scrollIntoView({ block: 'center' }), 30); }
    }
}
