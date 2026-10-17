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

// 魔法棒菜单
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

const tryMount = () => { const a = addWandItem(); const b = addSettingsEntry(); return a && b; };
if (!tryMount()) {
    let n = 0;
    const t = setInterval(() => { if (tryMount() || ++n > 60) clearInterval(t); }, 500);
}


