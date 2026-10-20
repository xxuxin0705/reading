import { pinFullscreen } from './pin.js';
// 正文朗读 · 页面内的确认框 / 输入框
// 有的安卓壳（Silly 等 App 的 WebView）不支持 window.confirm / prompt：直接返回取消，按钮就像没反应。
// 这里自己画一个，样式全写在行内，不依赖新版浏览器的 CSS（inset、min() 等）。

function el(tag, css, text) {
    const n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text !== undefined) n.textContent = text;
    return n;
}

const BTN = 'flex:1;height:40px;border:0;border-radius:11px;font-size:14px;font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;';

function open({ title = '', message = '', input = null, okText = '确定', cancelText = '取消', danger = false } = {}) {
    return new Promise((resolve) => {
        const mask = el('div', 'position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;');
        const box = el('div', 'width:100%;max-width:360px;background:#fff;color:#222;border-radius:16px;box-shadow:0 10px 36px rgba(0,0,0,.3);padding:18px 16px 14px;box-sizing:border-box;font-size:14px;line-height:1.6;font-family:inherit;');
        if (title) box.appendChild(el('div', 'font-weight:600;font-size:15.5px;margin-bottom:6px;', title));
        if (message) box.appendChild(el('div', 'white-space:pre-wrap;color:#444;max-height:50vh;overflow:auto;', message));
        let inp = null;
        if (input !== null) {
            const multi = input.multiline;
            inp = el(multi ? 'textarea' : 'input', `display:block;width:100%;box-sizing:border-box;margin-top:10px;border:1px solid #ddd;border-radius:10px;padding:9px 10px;font-size:14px;font-family:inherit;color:#222;background:#f8f8fb;${multi ? 'min-height:96px;resize:vertical;line-height:1.6;' : 'height:40px;'}`);
            if (!multi) inp.type = 'text';
            inp.value = input.value || '';
            if (input.placeholder) inp.placeholder = input.placeholder;
            box.appendChild(inp);
        }
        const row = el('div', 'display:flex;margin-top:14px;');
        const cancel = el('button', `${BTN}background:#f0f0f4;color:#555;margin-right:8px;`, cancelText);
        const ok = el('button', `${BTN}background:${danger ? '#e5484d' : '#7b62c9'};color:#fff;`, okText);
        cancel.type = 'button';
        ok.type = 'button';
        if (cancelText) row.appendChild(cancel);
        row.appendChild(ok);
        box.appendChild(row);
        mask.appendChild(box);
        (document.documentElement || document.body).appendChild(mask);
        pinFullscreen(mask, 'z-index:2147483000;');
        let done = false;
        const finish = (v) => { if (done) return; done = true; mask.remove(); resolve(v); };
        ok.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); finish(inp ? inp.value : true); });
        cancel.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); finish(inp ? null : false); });
        mask.addEventListener('click', (e) => { if (e.target === mask) { e.stopPropagation(); finish(inp ? null : false); } });
        box.addEventListener('click', (e) => e.stopPropagation());
        if (inp) {
            setTimeout(() => { try { inp.focus(); if (!input.multiline) inp.select(); } catch (err) { /* 忽略 */ } }, 60);
            if (!input.multiline) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(inp.value); } });
        }
    });
}

// 返回 true / false
export function uiConfirm(message, opts = {}) { return open({ message, ...opts }); }
// 返回输入的文字；取消返回 null
export function uiPrompt(message, value = '', opts = {}) { return open({ message, input: { value, multiline: !!opts.multiline, placeholder: opts.placeholder || '' }, ...opts }); }
