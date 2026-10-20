// 正文朗读 · 角色音色库
// 所有聊天共用（存在插件设置里），换聊天、换回来都还在；
// 同名但不同作品的角色，可以设成「只在某个角色卡用」。

import { uiConfirm, uiPrompt } from './ui-dialog.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const splitList = (v) => [...new Set(String(v || '').split(/[,，、;；\n]/).map(x => x.trim()).filter(Boolean))];

export const VOICE_CHANNELS = [
    ['fish', 'Fish Audio', '32 位音色 ID'],
    ['minimax_cn', 'MiniMax 国内', '例如 female-shaonv'],
    ['minimax_intl', 'MiniMax 国际', '例如 English_Graceful_Lady'],
    ['openai', 'OpenAI / 第三方兼容', '例如 alloy、nova'],
    ['volcengine', '豆包 / 火山', '例如 zh_female_vv_uranus_bigtts'],
    ['indextts', 'IndexTTS 本地', '例如 default.wav'],
    ['custom_openai', '第三方 OpenAI 兼容', '例如 alloy、nova']
];

function ctx() { return window.SillyTavern?.getContext?.() || {}; }

// 当前角色卡的标识（头像文件名最稳定，没有就用名字）
export function currentCardKey() {
    const c = ctx();
    const ch = c.characters?.[c.characterId];
    return String(ch?.avatar || c.name2 || '').trim();
}

// 有没有打开具体的聊天（聊天列表 / 首页时没有）
export function isChatOpen() {
    const c = ctx();
    return !!String(c.chatId || '').trim() && (c.characterId !== undefined || !!c.groupId);
}

// 角色跟着聊天文件走；没打开聊天时为空
export function currentChatKey() {
    return isChatOpen() ? String(ctx().chatId) : '';
}

// 「我」跟着酒馆当前的用户人设走（所有聊天共用）
export function currentPersonaKey() {
    return String(ctx().name1 || '').trim();
}

export class VoiceLibrary {
    constructor(store) {
        this.store = store; // { get(k), set(k, v) }
    }

    list() {
        const v = this.store.get('yzr-library', []);
        return Array.isArray(v) ? v.filter(x => x && x.id) : [];
    }

    save(list) {
        this.store.set('yzr-library', list);
        this.onChange?.();
    }

    upsert(entry) {
        const list = this.list();
        const i = list.findIndex(x => x.id === entry.id);
        if (i >= 0) list[i] = entry; else list.push(entry);
        this.save(list);
    }

    remove(id) { this.save(this.list().filter(x => x.id !== id)); }

    // 聊天独立角色库：第一次打开这个聊天时，把角色卡的角色放进来（删掉后不会再自动加回来）
    ensureChat() {
        const key = currentChatKey();
        if (!key) return;
        const done = this.store.get('yzr-chat-initialized', {});
        if (done[key]) return;
        const c = ctx();
        const legacy = this.list().filter(x => !x.chatKey && !x.personaKey && !x.isUser && (!x.cardKey || x.cardKey === currentCardKey()));
        const entries = legacy.map(x => ({ ...x, id: `chat_${key}_${x.id}`, chatKey: key, cardKey: '' }));
        const name = String(c.name2 || '').trim();
        if (name && !c.groupId && !entries.some(x => x.name === name)) {
            entries.push({ id: `chat_${key}_char`, name, aliases: [], gender: '', voices: {}, provider: '', readings: [], tags: [], isUser: false, chatKey: key, cardKey: '' });
        }
        this.store.set('yzr-library', [...this.list(), ...entries]);
        this.store.set('yzr-chat-initialized', { ...done, [key]: true });
    }

    // 当前用户人设的「我」：没有就从旧版（每个聊天各存一个）搬过来，再没有就新建一个空的
    ensurePersona() {
        const pk = currentPersonaKey();
        if (!pk) return null;
        const list = this.list();
        const hit = list.find(x => x.isUser && x.personaKey === pk);
        if (hit) return hit;
        const key = currentChatKey();
        const old = list.find(x => x.isUser && !x.personaKey && key && x.chatKey === key && (x.name === pk || (x.aliases || []).includes(pk)))
            || list.filter(x => x.isUser && !x.personaKey && (x.name === pk || (x.aliases || []).includes(pk)))
                .sort((m, n) => Object.keys(n.voices || {}).length - Object.keys(m.voices || {}).length)[0];
        const me = old
            ? { ...old, id: `me_${Date.now()}`, personaKey: pk, chatKey: '' }
            : { id: `me_${Date.now()}`, name: pk, aliases: [], gender: '', voices: {}, provider: '', readings: [], tags: [], isUser: true, personaKey: pk, chatKey: '', cardKey: '' };
        this.store.set('yzr-library', [...list, me]);
        return me;
    }

    active() {
        this.ensureChat();
        const me = this.ensurePersona();
        const key = currentChatKey();
        const chars = key ? this.list().filter(x => x.chatKey === key && !x.isUser) : [];
        const pk = currentPersonaKey();
        const mine = me ? this.list().find(x => x.isUser && x.personaKey === pk) : null;
        return mine ? [mine, ...chars] : chars;
    }

    count() { return this.active().length; }

    // 给正文朗读用：做成和小手机联系人一样的形状
    _toContact(x) {
        return {
            id: x.id,
            name: x.name,
            realName: x.name,
            voiceAliases: x.aliases || [],
            ttsVoices: x.voices || {},
            ttsProvider: x.provider || '',
            fixedSpeedEnabled: !!x.fixedSpeedEnabled,
            fixedSpeed: x.fixedSpeed || 'normal',
            ttsLanguageBoost: x.lang || 'auto',
            gender: (x.isNpc ?? !!x.gender) ? (x.gender === 'm' ? 'male' : x.gender === 'f' ? 'female' : '') : '',
            nameReadings: x.readings || []
        };
    }

    getContacts() { return this.active().filter(x => !x.isUser).map(x => this._toContact(x)); }

    getContactGender(id) {
        const x = this.list().find(e => e.id === id);
        return (x?.isNpc ?? !!x?.gender) ? (x?.gender === 'm' ? 'male' : x?.gender === 'f' ? 'female' : '') : '';
    }

    get data() {
        const me = this.active().find(x => x.isUser);
        return { userInfo: me ? this._toContact(me) : null };
    }
}

// ---------- 音色库页面（画在朗读设置的窗口里）----------
// 说话人分两类：我（用户自己的台词）/ 角色（专门配音色的人）。
// NPC 不进角色库：库里没有的人统一按性别用 NPC 的男 / 女 / 默认音色（在本页最下面设置）。
const KINDS = [['char', '角色'], ['user', '我']];
const PRESET_TAGS = ['主角', '配角', '家人', '朋友', '恋人', '反派', '长辈', '小孩'];
export const kindOf = (x) => x?.isUser ? 'user' : 'char';
const libState = { tag: '' };

function allTags(lib) {
    const used = lib.list().flatMap(x => Array.isArray(x.tags) ? x.tags : []);
    return [...new Set([...PRESET_TAGS, ...used])];
}

// ---------- 音色收藏夹：每个渠道存一组「名字 → 音色 ID」，所有人、所有聊天共用，点一下切换 ----------
const BANK_KEY = 'yzr-voice-bank';
function bankAll(lib) { const v = lib.store.get(BANK_KEY, {}); return v && typeof v === 'object' ? v : {}; }
function bankOf(lib, ch) { const l = bankAll(lib)[ch]; return Array.isArray(l) ? l.filter(x => x && x.id) : []; }
function bankSet(lib, ch, list) { lib.store.set(BANK_KEY, { ...bankAll(lib), [ch]: list }); }
export function bankName(lib, ch, id) { const v = String(id || '').trim(); return v ? (bankOf(lib, ch).find(x => x.id === v)?.name || '') : ''; }
const shortId = (id) => (String(id).length > 14 ? `${String(id).slice(0, 6)}…${String(id).slice(-4)}` : String(id));

// 一个音色选择：要么用收藏夹里存的，要么自己填，只有一个是生效的（attrs 是真正存值的输入框的属性）
function voiceBox(lib, ch, value, attrs, placeholder, { custom = null } = {}) {
    const list = bankOf(lib, ch);
    const cur = String(value || '').trim();
    const saved = list.find(x => x.id === cur);
    // 自己填：收藏夹是空的、现在的 ID 不在收藏夹里、或者刚点了「自己填写」
    const isCustom = custom ?? (!list.length || !saved);
    const using = saved ? `正在用：<b>${esc(saved.name)}</b>（${esc(shortId(saved.id))}）`
        : cur ? `正在用：自己填的 <b>${esc(shortId(cur))}</b>${list.length ? '（点「存」起个名字，以后在下拉里切换）' : ''}`
            : `还没选音色${placeholder ? `（${esc(placeholder)}）` : ''}`;
    return `<div class="yzr-vbox" data-bank-ch="${esc(ch)}" data-custom="${isCustom ? '1' : '0'}">
        ${list.length ? `<div class="yzsv-key"><select class="yzsv-input" data-bank-sel>
            ${list.map(x => `<option value="${esc(x.id)}" ${!isCustom && x.id === cur ? 'selected' : ''}>${esc(x.name)} · ${esc(shortId(x.id))}</option>`).join('')}
            <option value="__custom__" ${isCustom ? 'selected' : ''}>✎ 自己填写音色 ID</option>
        </select>${!isCustom ? '<button type="button" class="yzsv-mini yzsv-fetch" data-bank-del title="从收藏夹删掉这个音色">删</button>' : ''}</div>` : ''}
        <div class="yzsv-key yzr-custom-row" ${isCustom ? '' : 'hidden'} style="${list.length ? 'margin-top:6px' : ''}"><input class="yzsv-input" ${attrs} value="${esc(cur)}" placeholder="${esc(placeholder)}" spellcheck="false" autocomplete="off"><button type="button" class="yzsv-mini yzsv-fetch" data-bank-save title="起个名字存进收藏夹">存</button></div>
        <div class="yzsv-note yzr-using">${using}</div>
    </div>`;
}

// 收藏夹的按钮：选 / 存 / 删（事件委托，页面重画也不用重新绑）
function bindBank(root, lib, toast) {
    if (root.__yzrBank) return;
    root.__yzrBank = true;
    const redraw = (box, opts = {}) => {
        const inp = box.querySelector('input.yzsv-input');
        const attrs = Array.from(inp.attributes).filter(a => !['class', 'value', 'placeholder', 'spellcheck', 'autocomplete'].includes(a.name)).map(a => `${a.name}="${esc(a.value)}"`).join(' ');
        const tmp = document.createElement('div');
        tmp.innerHTML = voiceBox(lib, box.dataset.bankCh, inp.value, attrs, inp.placeholder, opts);
        const next = tmp.firstElementChild;
        box.replaceWith(next);
        return next;
    };
    const commit = (inp) => inp.dispatchEvent(new Event('change', { bubbles: true })); // NPC 音色：改了就保存
    root.addEventListener('change', (ev) => {
        const sel = ev.target.closest('[data-bank-sel]');
        if (sel) {
            const box = sel.closest('.yzr-vbox');
            const inp = box.querySelector('input.yzsv-input');
            if (sel.value === '__custom__') {
                inp.value = '';
                const nb = redraw(box, { custom: true });
                nb.querySelector('input.yzsv-input')?.focus();
                return;
            }
            inp.value = sel.value;
            const nb = redraw(box, { custom: false });
            commit(nb.querySelector('input.yzsv-input'));
            toast('已切换', `${bankName(lib, box.dataset.bankCh, sel.value)}（${shortId(sel.value)}）`);
            return;
        }
        // 自己填的 ID 正好是收藏夹里的：直接显示成那个名字
        const inp = ev.target.closest('.yzr-vbox input.yzsv-input');
        if (inp && ev.isTrusted) {
            const box = inp.closest('.yzr-vbox');
            const id = String(inp.value || '').trim();
            const hit = bankOf(lib, box.dataset.bankCh).some(x => x.id === id);
            if (hit) { redraw(box, { custom: false }); return; }
            // 只更新「正在用」那一行，不重画（不然紧接着点「存」会点空）
            const using = box.querySelector('.yzr-using');
            if (using) using.innerHTML = id ? `正在用：自己填的 <b>${esc(shortId(id))}</b>${bankOf(lib, box.dataset.bankCh).length ? '（点「存」起个名字，以后在下拉里切换）' : ''}` : '还没选音色';
        }
    });
    root.addEventListener('click', async (ev) => {
        const save = ev.target.closest('[data-bank-save]');
        const del = ev.target.closest('[data-bank-del]');
        if (!save && !del) return;
        const box = (save || del).closest('.yzr-vbox');
        const ch = box.dataset.bankCh;
        const list = bankOf(lib, ch);
        const inp = box.querySelector('input.yzsv-input');
        if (save) {
            const id = String(inp.value || '').trim();
            if (!id) { toast('还没填', '先填好音色 ID 再存'); return; }
            const old = list.find(x => x.id === id);
            const name = String(await uiPrompt('给这个音色起个名字（比如：活泼、少年清亮、温柔御姐）', old?.name || `音色 ${list.length + 1}`) || '').trim();
            if (!name) return;
            bankSet(lib, ch, [...list.filter(x => x.id !== id), { name: name.slice(0, 20), id }]);
            toast('已存', `「${name}」以后在下拉里一点就能切换`);
            commit(redraw(box, { custom: false }).querySelector('input.yzsv-input'));
            return;
        }
        const id = String(inp.value || '').trim();
        const hit = list.find(x => x.id === id);
        if (!hit) return;
        if (!(await uiConfirm(`从收藏夹删掉「${hit.name}」？\n现在这里还是用这个音色 ID，只是不再显示名字；已经用着它的别人也不受影响。`, { okText: '删掉', danger: true }))) return;
        bankSet(lib, ch, list.filter(x => x.id !== id));
        redraw(box, { custom: true });
    });
}

export function renderLibrary(app, lib, { editId = null } = {}) {
    const root = app.phoneShell.rootEl;
    const all = lib.active();
    const c = ctx();
    const sv = app.sv;
    const st = sv.getSettings();
    const charName = String(c.name2 || '').trim();
    const chLabel = (k) => (VOICE_CHANNELS.find(([id]) => id === k) || [k, k])[1];
    const defCh = VOICE_CHANNELS.some(([k]) => k === st.ttsProvider) ? st.ttsProvider : 'fish';
    const voiceSummary = (x) => {
        const filled = VOICE_CHANNELS.filter(([k]) => String(x.voices?.[k] || '').trim());
        if (!filled.length) return '还没填音色（不会读）';
        const main = (x.provider && x.voices?.[x.provider]) ? x.provider : filled[0][0];
        const more = filled.length > 1 ? ` 等 ${filled.length} 个渠道` : '';
        const nm = bankName(lib, main, x.voices[main]);
        return `${chLabel(main)} · ${nm || String(x.voices[main]).slice(0, 24)}${more}`;
    };
    const tagsInUse = [...new Set(all.flatMap(x => x.tags || []))];
    if (libState.tag && !tagsInUse.includes(libState.tag)) libState.tag = '';
    const byTag = (x) => !libState.tag || (x.tags || []).includes(libState.tag);
    const chatOpen = isChatOpen();
    const me = all.filter(x => x.isUser);
    const chars = all.filter(x => !x.isUser);

    const card = (x) => {
        const k = kindOf(x);
        return `
        <div class="yzsv-fav yzr-lib-item" data-id="${esc(x.id)}">
            <div class="yzsv-fav-top"><span class="yzr-av is-${k}">${esc(x.name.slice(0, 1))}</span><b>${esc(x.name)}</b><span class="yzr-kind is-${k}">${k === 'user' ? '我' : '角色'}</span></div>
            ${(x.aliases || []).length ? `<div class="yzsv-fav-text" style="font-size:12.5px;color:#888">别名：${esc(x.aliases.join('、'))}</div>` : ''}
            <div class="yzsv-fav-text" style="font-size:12.5px;color:#6b54a8">🎙 ${esc(voiceSummary(x))}</div>
            ${(x.tags || []).length ? `<div class="yzr-tagline">${x.tags.map(t => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
            <div class="yzsv-fav-acts"><button type="button" data-lib-edit>编辑</button><button type="button" data-lib-test>▶ 试听</button><button type="button" class="danger" data-lib-del>删除</button></div>
        </div>`;
    };
    const meList = me.filter(byTag);
    const charList = chars.filter(byTag);
    const npcOn = st.npcMode === 'npc';
    const perPerson = st.channelMode !== 'unified';
    const npcCh = perPerson && st.npcProvider ? st.npcProvider : defCh; // NPC 音色属于哪个渠道（收藏夹按渠道分）

    const html = `
        <div class="yzsv-page">
            <div class="yzsv-head">
                <button class="yzsv-back" id="yzr-lib-back" type="button" aria-label="返回"><i class="fa-solid fa-chevron-left"></i></button>
                <div class="yzsv-head-title">角色库 <small style="font-weight:400;color:#999;font-size:12px">${all.length}</small></div>
            </div>
            <div class="yzsv-body app-body">
                ${chatOpen ? '<button type="button" class="yzsv-mini is-primary yzr-add-main" data-lib-new>＋ 添加说话人</button>' : '<div class="yzsv-note" style="text-align:center;padding:4px 10px 12px;">现在没有打开聊天：这里只显示你当前的用户人设。角色跟着每个聊天文件单独保存，进到具体的聊天里才能看到和添加。</div>'}
                ${chatOpen && charName && !all.some(x => x.name === charName) ? `<button type="button" class="yzsv-mini is-wide yzr-add" data-lib-new data-name="${esc(charName)}">＋ 把当前角色「${esc(charName)}」加进来</button>` : ''}
                ${tagsInUse.length ? `<div class="yzsv-frow" style="margin:0 0 10px"><span>标签</span><button type="button" class="yzsv-fchip${!libState.tag ? ' is-on' : ''}" data-tag="">全部</button>${tagsInUse.map(t => `<button type="button" class="yzsv-fchip${libState.tag === t ? ' is-on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
                ${meList.length ? `<div class="yzsv-sec">我</div>${meList.map(card).join('')}` : ''}
                ${charList.length ? `<div class="yzsv-sec">角色 <small style="font-weight:400">${charList.length}</small></div>${charList.map(card).join('')}` : ''}
                ${chatOpen && !meList.length && !charList.length ? `<div class="yzsv-note" style="text-align:center;padding:18px 10px 22px;">${libState.tag ? `没有带 #${esc(libState.tag)} 的说话人` : '还没有说话人。点「添加说话人」，填名字和音色 ID；<br>名字和正文里 [[名字]] 标的对上就会用这个音色。'}</div>` : ''}

                <div class="yzsv-sec" style="margin-top:6px">NPC · 角色库里没有的人</div>
                <div class="yzsv-card pad">
                    <div class="yzsv-field"><label>正文里还有别人说话时</label>
                        <div class="yzsv-seg">
                            <button type="button" data-npc="only" class="${!npcOn ? 'is-on' : ''}">只读配了音色的人</button>
                            <button type="button" data-npc="npc" class="${npcOn ? 'is-on' : ''}">所有说话的都读</button>
                        </div>
                        <div class="yzsv-note">${npcOn ? '角色库里没有的人（配角、路人）按性别用下面的 NPC 音色读。' : '只读角色库里配了音色的人，其他人的台词不挂 ▶。'}</div>
                    </div>
                    ${npcOn ? `
                    ${perPerson ? `<div class="yzsv-field"><label>NPC 用哪个渠道</label>
                        <select class="yzsv-input" data-npc-k="npcProvider">
                            <option value="" ${!st.npcProvider ? 'selected' : ''}>跟随默认（${esc(chLabel(defCh))}）</option>
                            ${VOICE_CHANNELS.map(([k, l]) => `<option value="${k}" ${st.npcProvider === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}
                        </select>
                        <div class="yzsv-note">下面三个音色 ID 要是这个渠道的。</div>
                    </div>` : `<div class="yzsv-note" style="margin:-4px 0 12px">现在是「统一用一个渠道」，NPC 也用 ${esc(chLabel(defCh))}；下面填这个渠道的音色 ID。</div>`}
                    <div class="yzsv-field"><label>男 NPC 音色</label>${voiceBox(lib, npcCh, st.npcMale, 'data-npc-k="npcMale"', '男性配角、路人用这个')}</div>
                    <div class="yzsv-field"><label>女 NPC 音色</label>${voiceBox(lib, npcCh, st.npcFemale, 'data-npc-k="npcFemale"', '女性配角、路人用这个')}</div>
                    <div class="yzsv-field"><label>默认音色</label>${voiceBox(lib, npcCh, st.voice, 'data-npc-k="voice"', '分不出男女时用；留空用渠道的默认音色')}</div>
                    <div class="yzsv-note">男女怎么判断：模型标的 [[名字/男]] [[名字/女]]；分不出就用默认音色。正文里长按 ↻ 也可以手动指定按男声或女声读。</div>` : ''}
                </div>
                <div class="yzsv-note" style="margin:0 6px">角色跟着每个聊天文件单独保存；「我」跟着酒馆的用户人设走，换人设就换音色；NPC 设置和音色收藏夹所有聊天共用。</div>
            </div>
        </div>`;
    app.phoneShell.setContent(html, 'story-voice');
    app._fixScroll?.(root);
    const toast = (t, m) => app.phoneShell.showNotification(t, m);
    const keepScroll = () => { const top = root.querySelector('.yzsv-body')?.scrollTop || 0; renderLibrary(app, lib); const nb = root.querySelector('.yzsv-body'); if (nb) nb.scrollTop = top; };
    root.querySelector('#yzr-lib-back')?.addEventListener('click', () => app.render('main'));
    root.querySelectorAll('[data-tag]').forEach(b => b.addEventListener('click', () => { libState.tag = b.dataset.tag; keepScroll(); }));
    root.querySelectorAll('[data-lib-new]').forEach(b => b.addEventListener('click', () => editEntry(app, lib, null, b.dataset.name ? { name: b.dataset.name } : {})));
    root.querySelectorAll('[data-npc]').forEach(b => b.addEventListener('click', () => {
        sv.saveSettings({ npcMode: b.dataset.npc === 'npc' ? 'npc' : 'only' });
        toast('已保存', b.dataset.npc === 'npc' ? '所有说话的人都读，库里没有的用 NPC 音色' : '只读角色库里配了音色的人');
        keepScroll();
    }));
    // 事件委托：收藏夹切换后输入框会重画，也能保存
    root.querySelector('.yzsv-body')?.addEventListener('change', (ev) => {
        const inp = ev.target.closest('[data-npc-k]');
        if (!inp) return;
        sv.saveSettings({ [inp.dataset.npcK]: String(inp.value || '').trim() });
        if (inp.dataset.npcK === 'npcProvider') { toast('已保存', 'NPC 改用这个渠道'); keepScroll(); return; }
        if (!ev.isTrusted) return; // 从收藏夹选的：上面已经提示过「已切换」
        toast('已保存', 'NPC 音色已更新');
    });
    bindBank(root, lib, toast);
    root.querySelectorAll('.yzr-lib-item').forEach(cardEl => {
        const x = all.find(e => e.id === cardEl.dataset.id);
        cardEl.querySelector('[data-lib-edit]')?.addEventListener('click', () => editEntry(app, lib, x));
        cardEl.querySelector('[data-lib-del]')?.addEventListener('click', async () => {
            if (!(await uiConfirm(`删除「${x.name}」的音色设置？`, { okText: '删除', danger: true }))) return;
            lib.remove(x.id);
            keepScroll();
        });
        cardEl.querySelector('[data-lib-test]')?.addEventListener('click', async () => {
            try {
                toast('试听', '正在生成…');
                const vi = await sv._voiceFor(x.name);
                const url = await sv._synth(`你好，我是${x.name}。`, vi, { regen: true });
                sv.stop();
                sv.audio.src = url;
                sv._resetRate?.();
                await sv.audio.play();
            } catch (err) { toast('试听失败', String(err?.message || err).slice(0, 140)); }
        });
    });
    if (editId) { const x = all.find(e => e.id === editId); if (x) editEntry(app, lib, x); }
}

function editEntry(app, lib, x, preset = {}) {
    const root = app.phoneShell.rootEl;
    const e = x ? JSON.parse(JSON.stringify(x)) : { id: `v_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, name: '', aliases: [], gender: '', isNpc: false, voices: {}, provider: '', readings: [], tags: [], isUser: false, chatKey: currentChatKey(), cardKey: '', ...preset };
    e.tags = Array.isArray(e.tags) ? e.tags : [];
    e.voices = e.voices && typeof e.voices === 'object' ? e.voices : {};
    const chatOpen = isChatOpen();
    let kind = chatOpen ? kindOf(e) : 'user';
    const st = app.sv.getSettings();
    const defCh = VOICE_CHANNELS.some(([k]) => k === st.ttsProvider) ? st.ttsProvider : 'fish';
    const chLabel = (k) => (VOICE_CHANNELS.find(([id]) => id === k) || [k, k])[1];
    const mainCh = () => (st.channelMode === 'unified' ? defCh : (e.provider || defCh));
    const vField = ([k, label, ph]) => `<div class="yzsv-field yzr-vfield" data-vch="${k}"><label>${esc(label)} 音色</label>${voiceBox(lib, k, e.voices[k], `data-voice="${k}"`, ph)}</div>`;
    const readRow = (r = {}) => `<div class="yzrd-row"><input class="yzsv-input" data-rd="text" placeholder="写法" value="${esc(r.text || '')}"><i>读作</i><input class="yzsv-input" data-rd="reading" placeholder="读音（假名）" value="${esc(r.reading || '')}"><button type="button" class="yzrd-del">×</button></div>`;
    const tagChips = () => { const base = allTags(lib); return base.concat(e.tags.filter(t => !base.includes(t))).map(t => `<button type="button" data-tagpick="${esc(t)}" class="${e.tags.includes(t) ? 'is-on' : ''}">#${esc(t)}</button>`).join(''); };
    const otherFilled = VOICE_CHANNELS.filter(([k]) => k !== mainCh() && String(e.voices[k] || '').trim()).length;
    const userName = String(ctx().name1 || '').trim();
    const html = `
        <div class="yzsv-page">
            <div class="yzsv-head">
                <button class="yzsv-back" id="yzr-ed-back" type="button" aria-label="返回"><i class="fa-solid fa-chevron-left"></i></button>
                <div class="yzsv-head-title">${x ? '编辑说话人' : '添加说话人'}</div>
            </div>
            <div class="yzsv-body app-body">
                <div class="yzsv-card pad">
                    <div class="yzsv-field"><label>这是</label>
                        <div class="yzsv-seg">${KINDS.filter(([k]) => chatOpen || k === 'user').map(([k, l]) => `<button type="button" data-kind="${k}" class="${kind === k ? 'is-on' : ''}">${l}</button>`).join('')}</div>
                        <div class="yzsv-note" data-kind-note></div>
                    </div>
                    <div class="yzsv-field"><label>名字（和正文 [[名字]] 标的一样）</label><input class="yzsv-input" data-f="name" value="${esc(e.name)}" placeholder="填写名字"></div>
                    <div class="yzsv-field"><label>别名（逗号隔开，昵称、姓、称呼都行）</label><input class="yzsv-input" data-f="aliases" value="${esc((e.aliases || []).join('，'))}" placeholder="填写其他称呼，多个用逗号隔开"></div>
                </div>

                <div class="yzsv-sec">音色</div>
                <div class="yzsv-card pad">
                    ${st.channelMode === 'unified' ? `<div class="yzsv-note" style="margin:0 0 12px">现在是「统一用一个渠道」：所有人都用 ${esc(chLabel(defCh))}，这里填它的音色 ID 就行。</div>` : `
                    <div class="yzsv-field"><label>这个人用哪个渠道</label>
                        <select class="yzsv-input" data-f="provider">
                            <option value="" ${!e.provider ? 'selected' : ''}>跟随默认（${esc(chLabel(defCh))}）</option>
                            ${VOICE_CHANNELS.map(([k, l]) => `<option value="${k}" ${e.provider === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}
                        </select>
                        <div class="yzsv-note">不同渠道认的语气写法不一样，🎭 逐句调整和深度分析会按这个人的渠道来。</div>
                    </div>`}
                    <div data-vmain>${VOICE_CHANNELS.filter(([k]) => k === mainCh()).map(vField).join('')}</div>
                    <details class="yzr-more" ${otherFilled ? 'open' : ''}><summary>其他渠道的音色（可选${otherFilled ? `，已填 ${otherFilled} 个` : ''}）</summary>
                        <div data-vrest>${VOICE_CHANNELS.filter(([k]) => k !== mainCh()).map(vField).join('')}</div>
                    </details>
                </div>

                <div class="yzsv-sec">常驻语速</div>
                <div class="yzsv-card pad">
                    <label style="display:flex;align-items:center;gap:9px;font-size:14px"><input type="checkbox" data-f="fixedSpeedEnabled" ${e.fixedSpeedEnabled ? 'checked' : ''}> 启用固定语速</label>
                    <div class="yzsv-field" data-fixed-speed-box style="margin-top:12px;${e.fixedSpeedEnabled ? '' : 'display:none;'}">
                        <label>这个人的默认语速</label>
                        <select class="yzsv-input" data-f="fixedSpeed">
                            ${[['very_slow','非常慢 · 0.72×'],['slow','慢 · 0.86×'],['normal','正常 · 1.00×'],['fast','快 · 1.18×'],['very_fast','非常快 · 1.38×']].map(([k,l]) => `<option value="${k}" ${(e.fixedSpeed || 'normal') === k ? 'selected' : ''}>${l}</option>`).join('')}
                        </select>
                    </div>
                    <div class="yzsv-note" style="margin-top:8px">开启后，普通朗读、深度分析和一键演法都按这里的语速播放；在 🎭 调试中手动选择其他语速时，仅覆盖那一句。</div>
                </div>

                <div class="yzsv-sec">标签</div>
                <div class="yzsv-card pad">
                    <div class="yzsv-chips-mini" id="yzr-tags" style="margin-top:0">${tagChips()}</div>
                    <div class="yzsv-tagrow"><input data-newtag placeholder="自定义标签"><button type="button" data-addtag>添加</button></div>
                    <div class="yzsv-note">点一下选中 / 取消；角色库里可以按标签筛选。</div>
                </div>

                <div class="yzsv-sec">名字读音（可选，适配日文读音）</div>
                <div class="yzsv-card pad">
                    <div class="yzrd" id="yzr-rd">${(e.readings || []).map(readRow).join('')}<button type="button" class="yzrd-add">＋ 添加读音</button></div>
                    <div class="yzsv-note">当日文朗读中的汉字姓名发音不准确时，可在这里指定对应的假名读音。</div>
                </div>
                <div class="yzsv-btns" style="grid-template-columns:1fr;margin:4px 0 30px"><button type="button" class="yzsv-mini is-primary" id="yzr-ed-save">保存</button></div>
            </div>
        </div>`;
    app.phoneShell.setContent(html, 'story-voice');
    app._fixScroll?.(root);
    const toast = (t, m) => app.phoneShell.showNotification(t, m);
    const kindNote = {
        user: `你自己的台词用这个音色。跟着酒馆当前的用户人设${userName ? `「${userName}」` : ''}走，所有聊天共用；换了人设就是另一个「我」。`,
        char: '专门配一个音色：正文里标了这个名字（或别名）的台词都用它读。'
    };
    const applyKind = () => {
        root.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('is-on', b.dataset.kind === kind));
        root.querySelector('[data-kind-note]').textContent = kindNote[kind];
    };
    applyKind();
    root.querySelector('#yzr-ed-back')?.addEventListener('click', () => renderLibrary(app, lib));
    bindBank(root, lib, toast);
    root.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
        kind = b.dataset.kind;
        const nameInp = root.querySelector('[data-f="name"]');
        if (kind === 'user' && !nameInp.value.trim() && userName) nameInp.value = userName;
        applyKind();
    }));
    root.querySelector('[data-f="fixedSpeedEnabled"]')?.addEventListener('change', ev => {
        root.querySelector('[data-fixed-speed-box]').style.display = ev.target.checked ? '' : 'none';
    });
    // 标签
    const tagBox = root.querySelector('#yzr-tags');
    tagBox?.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-tagpick]');
        if (!b) return;
        const t = b.dataset.tagpick;
        e.tags = e.tags.includes(t) ? e.tags.filter(y => y !== t) : [...e.tags, t];
        b.classList.toggle('is-on', e.tags.includes(t));
    });
    const addTag = () => {
        const inp = root.querySelector('[data-newtag]');
        const ts = splitList(inp.value).map(t => t.replace(/^#/, '').slice(0, 12)).filter(Boolean);
        if (!ts.length) return;
        ts.forEach(t => { if (!e.tags.includes(t)) e.tags.push(t); });
        inp.value = '';
        tagBox.innerHTML = tagChips();
    };
    root.querySelector('[data-addtag]')?.addEventListener('click', addTag);
    root.querySelector('[data-newtag]')?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addTag(); } });
    // 换渠道：把那个渠道的音色框挪到最上面
    root.querySelector('[data-f="provider"]')?.addEventListener('change', (ev) => {
        const ch = ev.target.value || defCh;
        const main = root.querySelector('[data-vmain]');
        const rest = root.querySelector('[data-vrest]');
        const cur = main.querySelector('.yzr-vfield');
        const next = rest.querySelector(`.yzr-vfield[data-vch="${ch}"]`);
        if (!next) return;
        const order = VOICE_CHANNELS.map(([k]) => k);
        if (cur) {
            const after = Array.from(rest.children).find(el => order.indexOf(el.dataset.vch) > order.indexOf(cur.dataset.vch));
            rest.insertBefore(cur, after || null);
        }
        main.appendChild(next);
        next.querySelector('input')?.focus();
    });
    const rd = root.querySelector('#yzr-rd');
    rd?.addEventListener('click', (ev) => {
        if (ev.target.closest('.yzrd-add')) { ev.target.closest('.yzrd-add').insertAdjacentHTML('beforebegin', readRow()); return; }
        const del = ev.target.closest('.yzrd-del');
        if (del) del.closest('.yzrd-row')?.remove();
    });
    root.querySelector('#yzr-ed-save')?.addEventListener('click', () => {
        e.name = String(root.querySelector('[data-f="name"]').value || '').trim();
        if (!e.name) { toast('还没填名字', '名字要和正文里标的说话人一样'); return; }
        e.aliases = splitList(root.querySelector('[data-f="aliases"]').value).filter(a => a !== e.name);
        e.isUser = kind === 'user';
        e.isNpc = false;          // 角色库里的都是配了专属音色的人；NPC 走统一的 NPC 音色
        e.gender = '';
        e.voices = {};
        root.querySelectorAll('[data-voice]').forEach(inp => { const v = String(inp.value || '').trim(); if (v) e.voices[inp.dataset.voice] = v; });
        const provSel = root.querySelector('[data-f="provider"]');
        if (provSel) e.provider = provSel.value || '';
        e.readings = Array.from(root.querySelectorAll('.yzrd-row')).map(r => ({ text: r.querySelector('[data-rd="text"]').value.trim(), reading: r.querySelector('[data-rd="reading"]').value.trim() })).filter(r => r.text && r.reading);
        e.fixedSpeedEnabled = !!root.querySelector('[data-f="fixedSpeedEnabled"]')?.checked;
        e.fixedSpeed = root.querySelector('[data-f="fixedSpeed"]')?.value || 'normal';
        e.tags = [...new Set(e.tags)];
        if (e.isUser) {
            // 一个用户人设只有一个「我」：换成这次保存的
            const pk = currentPersonaKey();
            lib.store.set('yzr-library', lib.list().filter(y => y.id === e.id || !(y.isUser && y.personaKey === pk)));
            e.personaKey = pk;
            e.chatKey = '';
        } else {
            if (!currentChatKey()) { toast('没有打开聊天', '角色跟着聊天保存，先进到具体的聊天里'); return; }
            e.personaKey = '';
            e.chatKey = currentChatKey();
        }
        lib.upsert(e);
        toast('已保存', `${e.name} 的音色设置好了`);
        renderLibrary(app, lib);
    });
}
