// 正文朗读 · 全屏遮罩“钉住”屏幕
// 有些主题 / 美化插件会给 <html> 或 <body> 加 transform、filter、固定高度，
// 这时 position:fixed + height:100% 的遮罩会被压成几像素高，看起来就是「点了没反应」。
// 这里直接用屏幕像素写死位置和大小，并在转屏 / 键盘弹出时跟着更新。

export function pinFullscreen(el, extraCss = '') {
    if (!el) return el;
    const apply = () => {
        if (!el.isConnected) {
            window.removeEventListener('resize', apply);
            window.visualViewport?.removeEventListener?.('resize', apply);
            return;
        }
        const vw = window.innerWidth || document.documentElement.clientWidth || 360;
        const vh = window.innerHeight || document.documentElement.clientHeight || 640;
        el.style.position = 'fixed';
        el.style.top = '0px';
        el.style.left = '0px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.width = `${vw}px`;
        el.style.height = `${vh}px`;
        el.style.margin = '0';
        el.style.transform = 'none';
        el.style.boxSizing = 'border-box';
        if (extraCss) el.style.cssText += `;${extraCss}`;
    };
    apply();
    window.addEventListener('resize', apply);
    window.visualViewport?.addEventListener?.('resize', apply);
    return el;
}

// 打开后检查一下：还是被压扁 / 挡住就直接告诉用户，而不是没有任何反应
export function reportIfHidden(el, name = '窗口') {
    setTimeout(() => {
        try {
            if (!el?.isConnected) return;
            const r = el.getBoundingClientRect();
            const top = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
            if (r.height >= window.innerHeight * 0.6 && (!top || el.contains(top))) return;
            const who = top ? `${top.tagName.toLowerCase()}${top.id ? '#' + top.id : ''}` : '未知元素';
            const msg = r.height < window.innerHeight * 0.6
                ? `${name}被压扁了（高 ${Math.round(r.height)}px），通常是主题或美化插件改了页面布局`
                : `${name}被「${who}」挡住了，可能是别的插件的遮罩`;
            console.warn('[正文朗读]', msg, top);
            window.toastr?.warning?.(msg, '正文朗读', { timeOut: 8000 });
        } catch (e) { /* 忽略 */ }
    }, 350);
}
