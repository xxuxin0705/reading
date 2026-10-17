// 正文朗读 · 酒馆插件入口
// 魔法棒菜单里点「🔊 正文朗读」打开设置；正文台词后面挂 ▶ ↻ 🎭，按情绪朗读。

import { installStoryVoice, StoryVoiceApp } from './story-voice.js';
import { TtsEngine } from './tts-engine.js';
import { VoiceLibrary, renderLibrary } from './voice-library.js';

const NS = 'storyvoice-reader';
const ctx = () => window.SillyTavern?.getContext?.() || {};

// ---------- 设置存储：放在酒馆的插件设置里（跟着酒馆走，所有聊天共用）----------
function root() {
    const c = ctx();
    const es = c.extensionSettings || (window.extension_settings = window.extension_settings || {});
    if (!es[NS] || typeof es[NS] !== 'object') es[NS] = { kv: {} };
    if (!es[NS].kv || typeof es[NS].kv !== 'object') es[NS].kv = {};
    return es[NS];
}
let saveTimer = null;
const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { ctx().saveSettingsDebounced?.(); } catch (e) { /* 忽略 */ } }, 50);
};
const storage = {
    get(key, def = null) { const kv = root().kv; return Object.prototype.hasOwnProperty.call(kv, key) ? kv[key] : def; },
    set(key, val) { root().kv[key] = val; persist(); },
    remove(key) { delete root().kv[key]; persist(); },
    getContextKey() { return String(ctx().chatId || ''); }
};

// ---------- 设置窗口（朗读设置、角色音色库、收藏都画在这里）----------
let overlay = null;
const shell = {
    rootEl: null,
    setContent(html) {
        if (!this.rootEl) return;
        this.rootEl.innerHTML = html;
        const head = this.rootEl.querySelector('.yzsv-head');
        if (!head) return;
        // 每个子页面共用同一个关闭入口：放进标题栏最右边（不再悬浮叠在别的按钮上）
        head.classList.add('yzr-head');
        if (!head.querySelector('.yzsv-back:not(.yzr-close-panel)')) head.insertAdjacentHTML('afterbegin', '<span class="yzr-head-spacer" aria-hidden="true"></span>');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'yzsv-back yzr-close-panel';
        btn.setAttribute('aria-label', '关闭正文朗读');
        btn.title = '关闭';
        btn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            closePanel();
        });
        head.appendChild(btn);
    },
    showNotification(title, msg) { try { window.toastr?.info?.(msg || '', title || ''); } catch (e) { /* 忽略 */ } },
    goHome() { closePanel(); },
    openLibrary(app) { renderLibrary(app, library); }
};

function openPanel() {
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'yzr-overlay';
        overlay.innerHTML = '<div class="yzr-panel" role="dialog" aria-label="正文朗读"></div>';
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });
        document.body.appendChild(overlay);
    }
    overlay.hidden = false;
    shell.rootEl = overlay.querySelector('.yzr-panel');
    app.render('main');
}

function closePanel() {
    if (overlay) overlay.hidden = true;
    try { app?._favAudio?.pause?.(); } catch (e) { /* 忽略 */ }
}

// ---------- 启动 ----------
const engine = new TtsEngine(storage);
const library = new VoiceLibrary(storage);
const sv = installStoryVoice({ storage, ttsManager: engine, phoneShell: shell, voiceSource: library });
library.onChange = () => sv.onVoicesChanged();
const app = new StoryVoiceApp(shell, sv);
window.storyvoiceReader = Object.assign(window.storyvoiceReader || {}, { storyVoice: sv, app, library, engine, open: openPanel });

// ---------- 入口：魔法棒菜单 / 悬浮按钮（朗读设置 → 基础 → 入口 里选）----------
const entryMode = () => { try { const m = sv.getSettings().entryMode; return ['wand', 'float', 'both'].includes(m) ? m : 'wand'; } catch (e) { return 'wand'; } };

function addWandItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    if (document.getElementById('yzr-wand-item')) return true;
    const item = document.createElement('div');
    item.id = 'yzr-wand-item';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-volume-high extensionsMenuExtensionButton"></div><span>正文朗读</span>';
    item.addEventListener('click', () => {
        openPanel();
        document.getElementById('extensionsMenu')?.style && (document.getElementById('extensionsMenu').style.display = 'none');
    });
    menu.appendChild(item);
    return true;
}

// 悬浮按钮：可以拖到任意位置，松手贴到左右边，位置记在这台设备上
const FLOAT_POS_KEY = 'yzr-float-pos';
function addFloatButton() {
    if (document.getElementById('yzr-float')) return;
    const btn = document.createElement('button');
    btn.id = 'yzr-float';
    btn.type = 'button';
    btn.title = '正文朗读';
    btn.setAttribute('aria-label', '打开正文朗读');
    btn.innerHTML = '<i class="fa-solid fa-volume-high" aria-hidden="true"></i>';
    document.body.appendChild(btn);
    const size = 36;
    const clamp = (x, y) => [Math.max(4, Math.min(window.innerWidth - size - 4, x)), Math.max(4, Math.min(window.innerHeight - size - 4, y))];
    const place = (x, y) => { const [cx, cy] = clamp(x, y); btn.style.left = `${cx}px`; btn.style.top = `${cy}px`; };
    let pos = null;
    try { pos = JSON.parse(localStorage.getItem(FLOAT_POS_KEY) || 'null'); } catch (e) { pos = null; }
    // 存的是比例，横竖屏切换后位置也合理
    const fromSaved = () => pos && Number.isFinite(pos.x) ? place(pos.x * window.innerWidth, pos.y * window.innerHeight) : place(window.innerWidth - size - 10, window.innerHeight * 0.62);
    fromSaved();
    let drag = null;
    btn.addEventListener('pointerdown', (e) => {
        const r = btn.getBoundingClientRect();
        drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });
    btn.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
        drag.moved = true;
        btn.classList.add('is-drag');
        place(e.clientX - drag.dx, e.clientY - drag.dy);
    });
    const end = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const moved = drag.moved;
        drag = null;
        btn.classList.remove('is-drag');
        if (!moved) { openPanel(); return; }
        // 贴边
        const r = btn.getBoundingClientRect();
        const x = r.left + size / 2 < window.innerWidth / 2 ? 6 : window.innerWidth - size - 6;
        place(x, r.top);
        pos = { x: parseFloat(btn.style.left) / window.innerWidth, y: parseFloat(btn.style.top) / window.innerHeight };
        try { localStorage.setItem(FLOAT_POS_KEY, JSON.stringify(pos)); } catch (err) { /* 忽略 */ }
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) { drag = null; btn.classList.remove('is-drag'); } });
    window.addEventListener('resize', fromSaved);
}

function applyEntry() {
    const m = entryMode();
    const wantWand = m === 'wand' || m === 'both';
    const wantFloat = m === 'float' || m === 'both';
    let ok = true;
    if (wantWand) ok = addWandItem() && ok;
    else document.getElementById('yzr-wand-item')?.remove();
    if (wantFloat) addFloatButton();
    else document.getElementById('yzr-float')?.remove();
    return ok;
}
window.storyvoiceReader.applyEntry = applyEntry;

// 扩展设置面板里也放一个入口
function addSettingsEntry() {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('yzr-settings-entry')) return !!host;
    const box = document.createElement('div');
    box.id = 'yzr-settings-entry';
    box.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header"><b>🔊 正文朗读</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
            <div class="inline-drawer-content">
                <div style="padding:6px 0;line-height:1.6;font-size:13px;opacity:.85">正文台词按情绪朗读：简单 / 深度 / 手动三种分析，Fish、MiniMax、OpenAI、豆包等渠道，逐句调演法、环境声、语音收藏。</div>
                <div class="menu_button" id="yzr-open-btn"><i class="fa-solid fa-volume-high"></i> 打开正文朗读设置</div>
            </div>
        </div>`;
    host.appendChild(box);
    box.querySelector('#yzr-open-btn').addEventListener('click', openPanel);
    return true;
}

const tryMount = () => { const a = applyEntry(); const b = addSettingsEntry(); return a && b; };
if (!tryMount()) {
    let n = 0;
    const t = setInterval(() => { if (tryMount() || ++n > 60) clearInterval(t); }, 500);
}


