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
export function renderLibrary(app, lib, { editId = null } = {}) {
    const root = app.phoneShell.rootEl;
    const all = lib.active();
    const key = currentChatKey();
    const c = ctx();
    const charName = String(c.name2 || '').trim();
    const userName = String(c.name1 || '').trim();
    const voiceSummary = (x) => VOICE_CHANNELS.filter(([k]) => String(x.voices?.[k] || '').trim()).map(([, l]) => l).join('、') || '还没填音色';
    const html = `
        <div class="yzsv-page">
            <div class="yzsv-head">
                <button class="yzsv-back" id="yzr-lib-back" type="button" aria-label="返回"><i class="fa-solid fa-chevron-left"></i></button>
                <div class="yzsv-head-title">本聊天角色库 <small style="font-weight:400;color:#999;font-size:12px">${all.length}</small></div>
            </div>
            <div class="yzsv-body app-body">
                <div class="yzsv-btns" style="margin:4px 0 10px;flex-wrap:wrap;">
                    <button type="button" class="yzsv-mini is-primary" data-lib-new>＋ 添加角色</button>
                    ${charName && !all.some(x => x.name === charName) ? `<button type="button" class="yzsv-mini" data-lib-new-name="${esc(charName)}">＋ 当前角色「${esc(charName)}」</button>` : ''}
                    ${userName && !all.some(x => x.isUser) ? `<button type="button" class="yzsv-mini" data-lib-new-user="${esc(userName)}">＋ 我（${esc(userName)}）</button>` : ''}
                </div>
                ${all.length ? '' : '<div class="yzsv-note" style="text-align:center;padding:30px 10px;">还没有角色<br>点「添加角色」，填名字和音色 ID 就能用；名字和正文里 [[名字]] 标的对上就会用这个音色。</div>'}
                ${all.map(x => `
                    <div class="yzsv-fav yzr-lib-item" data-id="${esc(x.id)}">
                        <div class="yzsv-fav-top"><b>${esc(x.name)}</b>${x.isUser ? '<span class="yzr-badge">我</span>' : ''}${(x.isNpc ?? !!x.gender) ? `<span>NPC${x.gender ? ` · ${x.gender === 'm' ? '男' : '女'}` : ''}</span>` : ''}<span>当前聊天</span></div>
                        ${(x.aliases || []).length ? `<div class="yzsv-fav-text" style="font-size:12.5px;color:#888">别名：${esc(x.aliases.join('、'))}</div>` : ''}
                        <div class="yzsv-fav-text" style="font-size:12.5px;color:#6b54a8">🎙 ${esc(voiceSummary(x))}</div>
                        <div class="yzsv-fav-acts"><button type="button" data-lib-edit>编辑</button><button type="button" data-lib-test>▶ 试听</button><button type="button" class="danger" data-lib-del>删除</button></div>
                    </div>`).join('')}
            </div>
        </div>`;
    app.phoneShell.setContent(html, 'story-voice');
    app._fixScroll?.(root);
    const toast = (t, m) => app.phoneShell.showNotification(t, m);
    root.querySelector('#yzr-lib-back')?.addEventListener('click', () => app.render());
    root.querySelector('[data-lib-new]')?.addEventListener('click', () => editEntry(app, lib, null));
    root.querySelector('[data-lib-new-name]')?.addEventListener('click', (e) => editEntry(app, lib, null, { name: e.currentTarget.dataset.libNewName }));
    root.querySelector('[data-lib-new-user]')?.addEventListener('click', (e) => editEntry(app, lib, null, { name: e.currentTarget.dataset.libNewUser, isUser: true }));
    root.querySelectorAll('.yzr-lib-item').forEach(card => {
        const x = all.find(e => e.id === card.dataset.id);
        card.querySelector('[data-lib-edit]')?.addEventListener('click', () => editEntry(app, lib, x));
        card.querySelector('[data-lib-del]')?.addEventListener('click', () => {
            if (!window.confirm(`删除「${x.name}」的音色设置？`)) return;
            lib.remove(x.id);
            renderLibrary(app, lib);
        });
        card.querySelector('[data-lib-test]')?.addEventListener('click', async () => {
            try {
                toast('试听', '正在生成…');
                const sv = app.sv;
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
    const e = x ? JSON.parse(JSON.stringify(x)) : { id: `v_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, name: '', aliases: [], gender: '', isNpc: false, voices: {}, provider: '', readings: [], isUser: false, chatKey: currentChatKey(), cardKey: '', ...preset };
    const key = currentChatKey();
    const readRow = (r = {}) => `<div class="yzrd-row"><input class="yzsv-input" data-rd="text" placeholder="写法" value="${esc(r.text || '')}"><i>读作</i><input class="yzsv-input" data-rd="reading" placeholder="读音（假名）" value="${esc(r.reading || '')}"><button type="button" class="yzrd-del">×</button></div>`;
    const html = `
        <div class="yzsv-page">
            <div class="yzsv-head">
                <button class="yzsv-back" id="yzr-ed-back" type="button" aria-label="返回"><i class="fa-solid fa-chevron-left"></i></button>
                <div class="yzsv-head-title">${x ? '编辑角色' : '添加角色'}</div>
            </div>
            <div class="yzsv-body app-body">
                <div class="yzsv-card pad">
                    <div class="yzsv-field"><label>名字（和正文 [[名字]] 标的一样）</label><input class="yzsv-input" data-f="name" value="${esc(e.name)}" placeholder="填写角色名称"></div>
                    <div class="yzsv-field"><label>别名（逗号隔开，昵称、姓、称呼都行）</label><input class="yzsv-input" data-f="aliases" value="${esc((e.aliases || []).join('，'))}" placeholder="填写其他称呼，多个用逗号隔开"></div>
                    <div class="yzsv-row" data-npc-row style="padding:4px 0 12px"><span>这是 NPC<small>开启后可以选择性别，用于匹配 NPC 音色</small></span><span class="yzsv-switch${(e.isNpc ?? !!e.gender) ? ' is-on' : ''}" data-f="isNpc"><i></i></span></div>
                    <div class="yzsv-field" data-npc-gender style="${(e.isNpc ?? !!e.gender) ? '' : 'display:none;'}"><label>NPC 性别</label>
                        <div class="yzsv-seg">${[['', '不设'], ['m', '男'], ['f', '女']].map(([v, l]) => `<button type="button" data-g="${v}" class="${(e.gender || '') === v ? 'is-on' : ''}">${l}</button>`).join('')}</div>
                    </div>
                    <div class="yzsv-row" data-sw-row style="padding:4px 0 12px"><span>这是我（用户）<small>你自己的台词用这个音色；酒馆里的用户名会自动当成别名</small></span><span class="yzsv-switch${e.isUser ? ' is-on' : ''}" data-f="isUser"><i></i></span></div>
                    <div class="yzsv-note">此角色及音色配置只属于当前聊天，其他聊天不会受影响。</div>
                    <div class="yzsv-note">朗读设置里「每个人用哪个渠道」选「按每个人自己配的」时：这个人填了当前渠道的音色就用它，没填就用他填过的别的渠道。选「统一用这个渠道」时只看当前渠道那一栏。</div>
                </div>
                <div class="yzsv-sec">名字读音（可选，适配日文读音）</div>
                <div class="yzsv-card pad">
                    <div class="yzrd" id="yzr-rd">${(e.readings || []).map(readRow).join('')}<button type="button" class="yzrd-add">＋ 添加读音</button></div>
                    <div class="yzsv-note">当日文朗读中的汉字姓名发音不准确时，可在这里指定对应的假名读音。</div>
                </div>
                <div class="yzsv-btns" style="margin:12px 0 30px"><button type="button" class="yzsv-mini is-primary" id="yzr-ed-save">保存</button></div>
            </div>
        </div>`;
    app.phoneShell.setContent(html, 'story-voice');
    app._fixScroll?.(root);
    const toast = (t, m) => app.phoneShell.showNotification(t, m);
    root.querySelector('#yzr-ed-back')?.addEventListener('click', () => renderLibrary(app, lib));
    root.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => { root.querySelectorAll('[data-g]').forEach(y => y.classList.toggle('is-on', y === b)); e.gender = b.dataset.g; }));

    root.querySelector('[data-npc-row]')?.addEventListener('click', () => {
        const sw = root.querySelector('.yzsv-switch[data-f="isNpc"]');
        sw.classList.toggle('is-on');
        e.isNpc = sw.classList.contains('is-on');
        root.querySelector('[data-npc-gender]').style.display = e.isNpc ? '' : 'none';
        if (!e.isNpc) {
            e.gender = '';
            root.querySelectorAll('[data-g]').forEach(b => b.classList.toggle('is-on', b.dataset.g === ''));
        }
    });
    root.querySelector('[data-sw-row]')?.addEventListener('click', () => { const sw = root.querySelector('.yzsv-switch[data-f="isUser"]'); sw.classList.toggle('is-on'); e.isUser = sw.classList.contains('is-on'); });
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
        e.isNpc = !!(e.isNpc ?? !!e.gender);
        if (!e.isNpc) e.gender = '';
        e.voices = {};
        root.querySelectorAll('[data-voice]').forEach(inp => { const v = String(inp.value || '').trim(); if (v) e.voices[inp.dataset.voice] = v; });
        e.provider = root.querySelector('[data-f="provider"]').value;
        e.readings = Array.from(root.querySelectorAll('.yzrd-row')).map(r => ({ text: r.querySelector('[data-rd="text"]').value.trim(), reading: r.querySelector('[data-rd="reading"]').value.trim() })).filter(r => r.text && r.reading);
        if (e.isUser) {
            // 只能有一个「我」（同一范围内）
            const list = lib.list().map(y => (y.id !== e.id && y.isUser && y.chatKey === currentChatKey()) ? { ...y, isUser: false } : y);
            lib.store.set('yzr-library', list);
        }
        e.chatKey = currentChatKey();
        lib.upsert(e);
        toast('已保存', `${e.name} 的音色设置好了`);
        renderLibrary(app, lib);
    });
}
