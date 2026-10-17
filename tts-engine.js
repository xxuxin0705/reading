// 正文朗读 · 语音引擎（独立插件自己的，不依赖小手机）
// 支持：Fish Audio、MiniMax（国内 / 国际）、OpenAI 及兼容接口、豆包（火山引擎 V3）、IndexTTS（本地 OpenAI 格式）
// 配置按渠道分开存：phone-tts-<渠道>-url / key / model / voice（和朗读设置页的字段一一对应）

const DEFAULTS = {
    fish: { url: 'https://api.fish.audio/v1/tts', model: 's2.1-pro', voice: '' },
    minimax_cn: { url: 'https://api.minimaxi.com/v1/t2a_v2', model: 'speech-2.8-hd', voice: 'female-shaonv' },
    minimax_intl: { url: 'https://api.minimax.io/v1/t2a_v2', model: 'speech-2.8-hd', voice: 'English_Graceful_Lady' },
    openai: { url: 'https://api.openai.com/v1/audio/speech', model: 'gpt-4o-mini-tts', voice: 'alloy' },
    volcengine: { url: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', model: '', voice: 'zh_female_vv_uranus_bigtts', resourceId: 'seed-tts-2.0' },
    indextts: { url: 'http://127.0.0.1:7880/v1/audio/speech', model: 'index-tts2', voice: 'default.wav' }
};

// Fish 兼容接口能直接从网页调用的模型；其他模型走酒馆转发（需要 enableCorsProxy: true）
const FISH_COMPAT_MODELS = ['s2.1-pro', 's2.1-pro-free', 's2-pro', 's1'];

export class TtsEngine {
    constructor(storage) {
        this.storage = storage;
    }

    _getProviderConfigKey(provider, field) {
        return `phone-tts-${provider}-${field}`;
    }

    _get(provider, field) {
        return String(this.storage?.get?.(this._getProviderConfigKey(provider, field)) || '').trim();
    }

    _resolveConfig(options = {}) {
        const provider = String(options.provider || this.storage?.get?.('phone-tts-provider') || 'fish').trim() || 'fish';
        const d = DEFAULTS[provider] || DEFAULTS.openai;
        return {
            provider,
            apiUrl: String(options.apiUrl || '').trim() || this._get(provider, 'url') || d.url,
            apiKey: String(options.apiKey || '').trim() || this._get(provider, 'key'),
            model: String(options.model || '').trim() || this._get(provider, 'model') || d.model,
            voice: String(options.voice || '').trim() || this._get(provider, 'voice') || d.voice,
            appId: this._get(provider, 'app-id'),
            resourceId: this._get(provider, 'resource-id') || d.resourceId || ''
        };
    }

    _headers() {
        try { return window.SillyTavern?.getContext?.()?.getRequestHeaders?.() || {}; } catch (e) { return {}; }
    }

    // 网页直连被跨域挡住时，改走酒馆自带的转发
    async _fetch(url, init) {
        try { return await fetch(url, init); }
        catch (e) {
            if (init?.signal?.aborted || e?.name === 'AbortError' || !(e instanceof TypeError)) throw e;
            const res = await fetch(`/proxy/${url}`, { ...init, headers: { ...this._headers(), ...(init.headers || {}) } });
            if (res.status === 404) throw new Error('浏览器不能直接访问这个语音接口（跨域），酒馆转发也没开：在酒馆 config.yaml 里把 enableCorsProxy 改成 true 并重启');
            return res;
        }
    }

    async _errorText(res) {
        const t = await res.text().catch(() => '');
        try { const j = JSON.parse(t); return j?.detail || j?.error?.message || j?.message || j?.base_resp?.status_msg || t; } catch (e) { return t; }
    }

    async requestTTS(text, options = {}) {
        const input = String(text || '').trim();
        if (!input) throw new Error('要读的文字是空的');
        const c = this._resolveConfig(options);
        if (!c.apiKey && c.provider !== 'indextts') throw new Error(`还没填 ${c.provider} 的 API Key（朗读设置 → 语音渠道）`);
        if (!c.voice && c.provider !== 'openai') throw new Error('没有音色 ID：在「角色音色库」里给这个人填，或者填渠道的默认音色');
        const run = {
            fish: () => this._fish(input, c, options),
            minimax_cn: () => this._minimax(input, c, options),
            minimax_intl: () => this._minimax(input, c, options),
            volcengine: () => this._volc(input, c, options)
        }[c.provider] || (() => this._openai(input, c, options));
        return run();
    }

    // ---------- Fish Audio ----------
    async _fish(input, c, o) {
        const model = c.model || 's2.1-pro';
        const temp = Number(o.fish?.temperature);
        const hasTemp = Number.isFinite(temp) && temp > 0;
        const official = /api\.fish\.audio/i.test(c.apiUrl);
        if (official && FISH_COMPAT_MODELS.includes(model)) {
            const body = (withTemp) => JSON.stringify({
                model: `fish-audio/${model}`,
                input,
                voice: c.voice,
                response_format: 'mp3',
                provider: { options: { 'fish-audio': { latency: 'normal', ...(withTemp && hasTemp ? { temperature: temp } : {}) } } }
            });
            const send = (withTemp) => fetch('https://api.fish.audio/compat/v1/audio/speech', {
                method: 'POST', signal: o.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
                body: body(withTemp)
            });
            let res = await send(!this._fishNoTemp);
            if (hasTemp && !this._fishNoTemp && (res.status === 400 || res.status === 422)) { this._fishNoTemp = true; res = await send(false); }
            if (!res.ok) throw new Error(`Fish Audio HTTP ${res.status}：${String(await this._errorText(res)).slice(0, 200)}`);
            return URL.createObjectURL(await res.blob());
        }
        // 原生接口（drama 等模型、自建中转）
        const url = official ? 'https://api.fish.audio/v1/tts' : c.apiUrl;
        const res = await this._fetch(url, {
            method: 'POST', signal: o.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}`, model },
            body: JSON.stringify({ text: input, reference_id: c.voice, format: 'mp3', latency: 'normal', ...(hasTemp ? { temperature: temp } : {}) })
        });
        if (!res.ok) throw new Error(`Fish Audio HTTP ${res.status}：${String(await this._errorText(res)).slice(0, 200)}`);
        return URL.createObjectURL(await res.blob());
    }

    // ---------- MiniMax ----------
    async _minimax(input, c, o) {
        const emotion = String(o.minimax?.emotion || '').trim();
        const lang = String(o.languageBoost || 'auto');
        const send = (withEmotion) => this._fetch(c.apiUrl, {
            method: 'POST', signal: o.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
            body: JSON.stringify({
                model: c.model, text: input, stream: false, output_format: 'hex',
                language_boost: lang === 'auto' ? 'auto' : lang,
                voice_setting: { voice_id: c.voice, speed: 1, vol: 1, pitch: 0, ...(withEmotion && emotion ? { emotion } : {}) },
                audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 }
            })
        });
        const read = async (res) => { const t = await res.text().catch(() => ''); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; } return { res, t, j }; };
        let r = await read(await send(true));
        if (emotion && (!r.res.ok || r.j?.base_resp?.status_code !== 0)) r = await read(await send(false)); // 这个模型不认情绪参数：去掉再来
        if (!r.res.ok || r.j?.base_resp?.status_code !== 0) throw new Error(`MiniMax：${String(r.j?.base_resp?.status_msg || r.j?.message || r.t || r.res.status).slice(0, 200)}`);
        const hex = String(r.j?.data?.audio || '');
        if (!hex) throw new Error('MiniMax 没有返回音频');
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    }

    // ---------- OpenAI 及兼容（IndexTTS 本地、第三方中转）----------
    async _openai(input, c, o) {
        let url = c.apiUrl.replace(/\/+$/, '');
        if (!/\/audio\/speech$/i.test(url)) url = `${url.replace(/\/(?:v\d+)?$/i, '')}/v1/audio/speech`;
        // IndexTTS2：情绪描述用 emo_text 传（服务端不认这两个字段就去掉重试一次）
        const emo = c.provider === 'indextts' && o.emoText && !this._idxNoEmo ? { emo_text: String(o.emoText).slice(0, 200), use_emo_text: true } : null;
        const send = (withEmo) => this._fetch(url, {
            method: 'POST', signal: o.signal,
            headers: { 'Content-Type': 'application/json', ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) },
            body: JSON.stringify({
                model: c.model, input, voice: c.voice || 'alloy', response_format: 'mp3',
                ...(o.instructions && /gpt-4o|mini-tts/i.test(c.model) ? { instructions: String(o.instructions).slice(0, 600) } : {}),
                ...(withEmo && emo ? emo : {})
            })
        });
        let res = await send(true);
        if (emo && (res.status === 400 || res.status === 422)) { this._idxNoEmo = true; res = await send(false); }
        if (!res.ok) throw new Error(`语音接口 HTTP ${res.status}：${String(await this._errorText(res)).slice(0, 200)}`);
        return URL.createObjectURL(await res.blob());
    }

    // ---------- 豆包 / 火山引擎 V3 单向流式 ----------
    async _volc(input, c, o) {
        if (!c.appId) throw new Error('豆包要填 APP ID（朗读设置 → 语音渠道）');
        const v2 = /2\.0|tts-2|icl-2/i.test(c.resourceId);
        const res = await this._fetch(c.apiUrl, {
            method: 'POST', signal: o.signal,
            headers: { 'Content-Type': 'application/json', 'X-Api-App-Key': c.appId, 'X-Api-Access-Key': c.apiKey, 'X-Api-Resource-Id': c.resourceId },
            body: JSON.stringify({
                user: { uid: 'storyvoice_reader' },
                req_params: {
                    text: input, speaker: c.voice,
                    audio_params: { format: 'mp3', sample_rate: 24000 },
                    additions: JSON.stringify({ context_texts: v2 && Array.isArray(o.contextTexts) ? o.contextTexts.slice(0, 3) : [] })
                }
            })
        });
        if (!res.ok) throw new Error(`豆包 HTTP ${res.status}：${String(await this._errorText(res)).slice(0, 200)}`);
        const raw = await res.text();
        const chunks = [];
        raw.split(/\n+/).forEach(line => {
            const t = line.trim();
            if (!t) return;
            let j = null;
            try { j = JSON.parse(t); } catch (e) { return; }
            if (j?.code && j.code !== 0 && j.code !== 20000000) throw new Error(`豆包：${j.message || j.code}`);
            if (typeof j?.data === 'string' && j.data) {
                const bin = atob(j.data);
                const u = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                chunks.push(u);
            }
        });
        if (!chunks.length) throw new Error('豆包没有返回音频');
        return URL.createObjectURL(new Blob(chunks, { type: 'audio/mpeg' }));
    }
}
