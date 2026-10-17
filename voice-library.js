// 正文朗读 · 角色音色库
// 所有聊天共用（存在插件设置里），换聊天、换回来都还在；
// 同名但不同作品的角色，可以设成「只在某个角色卡用」。

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

export function currentChatKey() {
    const c = ctx();
    return String(c.chatId || c.chatMetadata?.main_chat || currentCardKey() || 'default');
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

    // 聊天独立角色库。默认角色若被删除，记录删除状态，避免下次打开又出现。
    ensureChat() {
        const key = currentChatKey();
        const done = this.store.get('yzr-chat-initialized', {});
        if (done[key]) return;
        const c = ctx();
        const legacy = this.list().filter(x => !x.chatKey && (!x.cardKey || x.cardKey === currentCardKey()));
        const entries = legacy.map(x => ({ ...x, id: `chat_${key}_${x.id}`, chatKey: key, cardKey: '' }));
        const names = [[String(c.name2 || '').trim(), false], [String(c.name1 || '').trim(), true]];
        for (const [name, isUser] of names) {
            if (name && !entries.some(x => x.name === name || (isUser && x.isUser))) {
                entries.push({ id: `chat_${key}_${isUser ? 'user' : 'char'}`, name, aliases: [], gender: '', voices: {}, provider: '', readings: [], isUser, chatKey: key, cardKey: '' });
            }
        }
        this.store.set('yzr-library', [...this.list(), ...entries]);
        this.store.set('yzr-chat-initialized', { ...done, [key]: true });
    }

    active() {
        this.ensureChat();
        const key = currentChatKey();
        return this.list().filter(x => x.chatKey === key);
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
        return `${chLabel(main)} · ${String(x.voices[main]).slice(0, 24)}${more}`;
    };
    const tagsInUse = [...new Set(all.flatMap(x => x.tags || []))];
    if (libState.tag && !tagsInUse.includes(libState.tag)) libState.tag = '';
    const byTag = (x) => !libState.tag || (x.tags || []).includes(libState.tag);
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

    const html = `
        <div class="yzsv-page">
            <div class="yzsv-head">
                <button class="yzsv-back" id="yzr-lib-back" type="button" aria-label="返回"><i class="fa-solid fa-chevron-left"></i></button>
                <div class="yzsv-head-title">角色库 <small style="font-weight:400;color:#999;font-size:12px">${all.length}</small></div>
            </div>
            <div class="yzsv-body app-body">
                <button type="button" class="yzsv-mini is-primary yzr-add-main" data-lib-new>＋ 添加说话人</button>
                ${charName && !all.some(x => x.name === charName) ? `<button type="button" class="yzsv-mini is-wide yzr-add" data-lib-new data-name="${esc(charName)}">＋ 把当前角色「${esc(charName)}」加进来</button>` : ''}
                ${tagsInUse.length ? `<div class="yzsv-frow" style="margin:0 0 10px"><span>标签</span><button type="button" class="yzsv-fchip${!libState.tag ? ' is-on' : ''}" data-tag="">全部</button>${tagsInUse.map(t => `<button type="button" class="yzsv-fchip${libState.tag === t ? ' is-on' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
                ${meList.length ? `<div class="yzsv-sec">我</div>${meList.map(card).join('')}` : ''}
                ${charList.length ? `<div class="yzsv-sec">角色 <small style="font-weight:400">${charList.length}</small></div>${charList.map(card).join('')}` : ''}
                ${!meList.length && !charList.length ? `<div class="yzsv-note" style="text-align:center;padding:18px 10px 22px;">${libState.tag ? `没有带 #${esc(libState.tag)} 的说话人` : '还没有说话人。点「添加说话人」，填名字和音色 ID；<br>名字和正文里 [[名字]] 标的对上就会用这个音色。'}</div>` : ''}

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
                    <div class="yzsv-field"><label>男 NPC 音色</label><input class="yzsv-input" data-npc-k="npcMale" value="${esc(st.npcMale)}" placeholder="男性配角、路人用这个" spellcheck="false"></div>
                    <div class="yzsv-field"><label>女 NPC 音色</label><input class="yzsv-input" data-npc-k="npcFemale" value="${esc(st.npcFemale)}" placeholder="女性配角、路人用这个" spellcheck="false"></div>
                    <div class="yzsv-field"><label>默认音色</label><input class="yzsv-input" data-npc-k="voice" value="${esc(st.voice)}" placeholder="分不出男女时用；留空用渠道的默认音色" spellcheck="false"></div>
                    <div class="yzsv-note">男女怎么判断：模型标的 [[名字/男]] [[名字/女]]；分不出就用默认音色。正文里长按 ↻ 也可以手动指定按男声或女声读。</div>` : ''}
                </div>
                <div class="yzsv-note" style="margin:0 6px">角色库只属于当前聊天，换别的聊天不受影响；NPC 设置所有聊天共用。</div>
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
    root.querySelectorAll('[data-npc-k]').forEach(inp => inp.addEventListener('change', () => {
        sv.saveSettings({ [inp.dataset.npcK]: String(inp.value || '').trim() });
        toast('已保存', 'NPC 音色已更新');
    }));
    root.querySelectorAll('.yzr-lib-item').forEach(cardEl => {
        const x = all.find(e => e.id === cardEl.dataset.id);
        cardEl.querySelector('[data-lib-edit]')?.addEventListener('click', () => editEntry(app, lib, x));
        cardEl.querySelector('[data-lib-del]')?.addEventListener('click', () => {
            if (!window.confirm(`删除「${x.name}」的音色设置？`)) return;
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
    let kind = kindOf(e);
    const st = app.sv.getSettings();
    const defCh = VOICE_CHANNELS.some(([k]) => k === st.ttsProvider) ? st.ttsProvider : 'fish';
    const chLabel = (k) => (VOICE_CHANNELS.find(([id]) => id === k) || [k, k])[1];
    const mainCh = () => (st.channelMode === 'unified' ? defCh : (e.provider || defCh));
    const vField = ([k, label, ph]) => `<div class="yzsv-field yzr-vfield" data-vch="${k}"><label>${esc(label)} 音色</label><input class="yzsv-input" data-voice="${k}" value="${esc(e.voices[k] || '')}" placeholder="${esc(ph)}" spellcheck="false" autocomplete="off"></div>`;
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
                        <div class="yzsv-seg">${KINDS.map(([k, l]) => `<button type="button" data-kind="${k}" class="${kind === k ? 'is-on' : ''}">${l}</button>`).join('')}</div>
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
        user: `你自己的台词用这个音色；酒馆里的用户名${userName ? `「${userName}」` : ''}会自动当成别名。每个聊天只有一个「我」。`,
        char: '专门配一个音色：正文里标了这个名字（或别名）的台词都用它读。'
    };
    const applyKind = () => {
        root.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('is-on', b.dataset.kind === kind));
        root.querySelector('[data-kind-note]').textContent = kindNote[kind];
    };
    applyKind();
    root.querySelector('#yzr-ed-back')?.addEventListener('click', () => renderLibrary(app, lib));
    root.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
        kind = b.dataset.kind;
        const nameInp = root.querySelector('[data-f="name"]');
        if (kind === 'user' && !nameInp.value.trim() && userName) nameInp.value = userName;
        applyKind();
    }));
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
        e.tags = [...new Set(e.tags)];
        if (e.isUser) {
            // 每个聊天只能有一个「我」：原来的「我」改成普通角色
            const list = lib.list().map(y => (y.id !== e.id && y.isUser && y.chatKey === currentChatKey()) ? { ...y, isUser: false } : y);
            lib.store.set('yzr-library', list);
        }
        e.chatKey = currentChatKey();
        lib.upsert(e);
        toast('已保存', `${e.name} 的音色设置好了`);
        renderLibrary(app, lib);
    });
}
