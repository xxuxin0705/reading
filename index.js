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


// 点击：click 和 touchend 都接（有的 WebView 吃掉 click），滑动不算点，一次点击只触发一次
function onTap(el, fn) {
    let last = 0, sx = 0, sy = 0, moved = false;
    const fire = (e) => { if (Date.now() - last < 600) return; last = Date.now(); fn(e); };
    el.addEventListener('touchstart', (e) => { const t = e.touches?.[0]; sx = t ? t.clientX : 0; sy = t ? t.clientY : 0; moved = false; }, { passive: true });
    el.addEventListener('touchmove', (e) => { const t = e.touches?.[0]; if (t && Math.abs(t.clientX - sx) + Math.abs(t.clientY - sy) > 10) moved = true; }, { passive: true });
    el.addEventListener('touchend', (e) => { if (moved) return; if (e.cancelable) e.preventDefault(); fire(e); });
    el.addEventListener('click', fire);
}

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

// 窗口的尺寸直接写在行内：有的安卓 App（Silly 等）的 WebView 比较旧，不认 inset、min()，
// 只靠 style.css 的话遮罩是 0 大小、面板跑到屏幕外面，看起来就是「点了没反应」
function sizeOverlay() {
    if (!overlay) return;
    const small = window.innerWidth <= 520;
    overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:30000;background:rgba(0,0,0,.45);display:flex;align-items:${small ? 'stretch' : 'center'};justify-content:center;box-sizing:border-box;`;
    const panel = overlay.querySelector('.yzr-panel');
    if (panel) {
        panel.style.cssText = small
            ? `width:100%;height:100%;border-radius:0;overflow:hidden;background:#f6f6fa;position:relative;`
            : `width:100%;max-width:440px;height:92vh;max-height:860px;border-radius:22px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.35);background:#f6f6fa;position:relative;`;
    }
}

function openPanel() {
    try {
        if (!overlay || !document.body.contains(overlay)) {
            overlay = document.createElement('div');
            overlay.className = 'yzr-overlay';
            overlay.innerHTML = '<div class="yzr-panel" role="dialog" aria-label="正文朗读"></div>';
            overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });
            document.body.appendChild(overlay);
            window.addEventListener('resize', () => { if (overlay && !overlay.hidden) sizeOverlay(); });
        }
        overlay.hidden = false;
        sizeOverlay();
        shell.rootEl = overlay.querySelector('.yzr-panel');
        app.render('main');
    } catch (e) {
        console.error('[正文朗读] 打开设置失败:', e);
        // 即使酒馆没有 toastr，也必须让用户看见实际错误，而不是表现为点击无效。
        window.storyvoiceReader.lastOpenError = String(e?.stack || e?.message || e);
        try {
            const panel = overlay?.querySelector('.yzr-panel');
            if (panel) {
                panel.replaceChildren();
                const card = document.createElement('div');
                card.style.cssText = 'padding:24px 18px;color:#222;font:14px/1.65 sans-serif;overflow:auto;height:100%;box-sizing:border-box;';
                const title = document.createElement('strong');
                title.textContent = '正文朗读打开时出错';
                const detail = document.createElement('pre');
                detail.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;background:#eee;padding:12px;border-radius:8px;';
                detail.textContent = String(e?.stack || e?.message || e).slice(0, 1800);
                const close = document.createElement('button');
                close.textContent = '关闭';
                close.type = 'button';
                close.style.cssText = 'margin-top:12px;padding:8px 20px;';
                close.addEventListener('click', closePanel);
                card.append(title, detail, close);
                panel.appendChild(card);
            }
        } catch (_) { /* 展示错误失败，控制台仍留记录 */ }
        try { window.toastr?.error?.(String(e?.message || e).slice(0, 200), '正文朗读打不开'); } catch (err) { /* 忽略 */ }
    }
}

function closePanel() {
    if (overlay) { overlay.hidden = true; overlay.style.display = 'none'; }
    try { app?._favAudio?.pause?.(); } catch (e) { /* 忽略 */ }
}

// ---------- 启动 ----------
const engine = new TtsEngine(storage);
const library = new VoiceLibrary(storage);
const sv = installStoryVoice({ storage, ttsManager: engine, phoneShell: shell, voiceSource: library });
library.onChange = () => sv.onVoicesChanged();
const app = new StoryVoiceApp(shell, sv);
window.storyvoiceReader = Object.assign(window.storyvoiceReader || {}, { storyVoice: sv, app, library, engine, open: openPanel });

// 版本重装/切换后，DOM 元素可能还在但事件监听器已失效。
// 不用 dataset 或 id 的存在表示「已绑定」：只认本次加载真正绑定过的对象。
const liveWandItems = new WeakSet();
const liveFloatButtons = new WeakSet();
const liveSettingsEntries = new WeakSet();

// ---------- 入口：魔法棒菜单 / 悬浮按钮（朗读设置 → 基础 → 入口 里选）----------
const entryMode = () => { try { const m = sv.getSettings().entryMode; return ['wand', 'float', 'both'].includes(m) ? m : 'wand'; } catch (e) { return 'wand'; } };

function addWandItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return false;
    const old = document.getElementById('yzr-wand-item');
    if (old && liveWandItems.has(old)) return true;
    const item = document.createElement('div');
    item.id = 'yzr-wand-item';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-volume-high extensionsMenuExtensionButton"></div><span>正文朗读</span>';
    const go = () => {
        const menu2 = document.getElementById('extensionsMenu');
        try { if (window.jQuery) window.jQuery(menu2).fadeOut?.(150); else if (menu2) menu2.style.display = 'none'; } catch (err) { if (menu2) menu2.style.display = 'none'; }
        setTimeout(openPanel, 30);
    };
    onTap(item, go);
    liveWandItems.add(item);
    if (old) old.replaceWith(item); else menu.appendChild(item);
    return true;
}

// 悬浮按钮：可以拖到任意位置，松手贴到左右边，位置记在这台设备上
const FLOAT_POS_KEY = 'yzr-float-pos';
function addFloatButton() {
    const old = document.getElementById('yzr-float');
    if (old && liveFloatButtons.has(old)) return;
    const btn = document.createElement('button');
    btn.id = 'yzr-float';
    btn.type = 'button';
    btn.title = '正文朗读';
    btn.setAttribute('aria-label', '打开正文朗读');
    btn.innerHTML = '<i class="fa-solid fa-volume-high" aria-hidden="true"></i>';
    if (old) old.replaceWith(btn); else document.body.appendChild(btn);
    liveFloatButtons.add(btn);
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
    let pointerOpenAt = 0;
    btn.addEventListener('pointerup', (e) => { pointerOpenAt = Date.now(); end(e); });
    // 一些 Android WebView 不提供可用的 pointerup，仍需支持普通 click；
    // 如果 pointerup 已经处理了，则 click 不得再打开第二次。
    btn.addEventListener('click', (e) => {
        if (Date.now() - pointerOpenAt < 650) return;
        e.preventDefault();
        openPanel();
    });
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
window.storyvoiceReader.diagnose = () => ({
    pluginReady: !!window.storyvoiceReader?.app,
    wandPresent: !!document.getElementById('yzr-wand-item'),
    wandBound: liveWandItems.has(document.getElementById('yzr-wand-item')),
    floatPresent: !!document.getElementById('yzr-float'),
    floatBound: liveFloatButtons.has(document.getElementById('yzr-float')),
    overlayVisible: !!overlay && !overlay.hidden,
    lastOpenError: window.storyvoiceReader.lastOpenError || null,
});

// 扩展设置面板里也放一个入口
function addSettingsEntry() {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return false;
    const old = document.getElementById('yzr-settings-entry');
    if (old && liveSettingsEntries.has(old)) return true;
    const box = document.createElement('div');
    box.id = 'yzr-settings-entry';
    box.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header"><b>🔊 正文朗读</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>
            <div class="inline-drawer-content">
                <div style="padding:6px 0;line-height:1.6;font-size:13px;opacity:.85">正文台词按情绪朗读：简单 / 深度 / 手动三种分析，Fish、MiniMax、OpenAI、豆包等渠道，逐句调演法、环境声、语音收藏。</div>
                <div class="menu_button" id="yzr-open-btn" role="button" tabindex="0" style="display:inline-flex;align-items:center;justify-content:center;width:auto;max-width:100%;white-space:nowrap;padding:6px 14px;margin:4px 0;"><i class="fa-solid fa-volume-high" style="margin-right:6px;"></i>打开正文朗读设置</div>
            </div>
        </div>`;
    if (old) old.replaceWith(box); else host.appendChild(box);
    liveSettingsEntries.add(box);
    const open = box.querySelector('#yzr-open-btn');
    onTap(open, (e) => { e?.stopPropagation?.(); openPanel(); });
    return true;
}

const tryMount = () => { const a = applyEntry(); const b = addSettingsEntry(); return a && b; };
if (!tryMount()) {
    let n = 0;
    const t = setInterval(() => { if (tryMount() || ++n > 60) clearInterval(t); }, 500);
}


