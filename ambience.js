// 正文朗读 · 环境声：9 种原有 WebAudio 合成音效，37 种本地 MP3 现场录音；保留原有音量控制。
// 人声嘈杂、掌声、脚步这类「很多细小事件叠在一起」的声音，先在 JS 里逐个采样算出一段可以无缝循环的音频（只算一次，之后复用），
// 钟表、火车、脚步这类有节奏的声音按音频时钟排，不会忽快忽慢。

export const AMBIENCE_LABELS = Object.freeze({
    none: "无",
    storm: "暴雨雷声",
    waves: "海浪",
    night: "夜晚虫鸣",
    fire: "篝火噼啪",
    drizzle: "细雨",
    forest: "森林鸟鸣",
    birds: "清晨鸟鸣",
    waterfall: "瀑布",
    seaside: "海边海鸥",
    icewalk: "踩冰",
    cheering: "欢呼人群",
    steadyrain: "连绵不断的雨声",
    scifi: "未来科技系统",
    thunderclip: "打雷声",
    heartbeat: "低沉心跳声",
    outdoors: "户外声",
    windclip: "风声",
    drops: "水滴声",
    leaves: "踩树叶声",
    strolling: "闲逛脚步声",
    newspaper: "报纸翻页声",
    snowstorm: "暴风雪",
    briskwalk: "急促走路",
    cicadas: "夏天蝉鸣",
    cat: "猫叫声",
    horse: "马蹄声",
    stream: "溪流",
    bell: "钟声",
    writing: "写字声",
    techdata: "科技数据",
    applause: "掌声",
    pouring: "倒水",
    fingersnap: "打响指",
    office: "办公室",
    typing: "打字声",
    camera: "相机咔嚓",
    running: "跑步",
    fireworksclip: "烟花",
    busycity: "繁华城市",
    citytraffic: "城市车流",
    breathing: "喘息",
    fastheartbeat: "心脏加快",
    dog: "狗叫",
    bicycle: "骑自行车",
    basketball: "篮球入网",
    swimming: "游泳"
});

let CTX = null;
let REG = null; // 正在搭建的这一层用到的音源，停的时候一起关掉
const BUF = {};

function ctx() {
    if (!CTX) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        CTX = new AC();
    }
    if (CTX.state === 'suspended') CTX.resume().catch(() => {});
    return CTX;
}

const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- 基础音源 ----------
// 4 秒循环的噪声：white / pink / brown
function noise(type) {
    const c = ctx();
    if (BUF[type]) return BUF[type];
    const len = c.sampleRate * 4;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'pink') {
            b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
            b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
            d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else if (type === 'brown') {
            last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5;
        } else d[i] = w;
    }
    BUF[type] = buf;
    return buf;
}

function src(type) {
    const c = ctx();
    const s = c.createBufferSource();
    s.buffer = noise(type);
    s.loop = true;
    s.start(0, Math.random() * 3);
    REG?.push(s);
    return s;
}

// 播一段循环的合成音频（人声、掌声……）
function loopBuf(buf) {
    const c = ctx();
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * buf.duration);
    REG?.push(s);
    return s;
}

function filter(type, freq, q = 0.7) {
    const f = ctx().createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
}

function gain(v) {
    const g = ctx().createGain();
    g.gain.value = v;
    return g;
}

// 慢慢起伏：LFO → 目标参数
function lfo(param, rate, depth) {
    const c = ctx();
    const o = c.createOscillator();
    o.frequency.value = rate;
    const g = gain(depth);
    o.connect(g).connect(param);
    o.start();
    REG?.push(o);
    return o;
}

function chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
}

// 空间感：简单的反馈回声（走廊、洞穴、剧场）
function echo(out, { time = 0.12, fb = 0.35, mix = 0.35, lp = 3000 } = {}) {
    const c = ctx();
    const input = gain(1);
    const d = c.createDelay(2);
    d.delayTime.value = time;
    const f = gain(fb);
    const tone = filter('lowpass', lp);
    input.connect(out);
    input.connect(d); d.connect(tone); tone.connect(f); f.connect(d);
    tone.connect(gain(mix)).connect(out);
    return input;
}

// 短促的一下（雨滴、柴火噼啪、碰杯、脚步……）；at = 在音频时钟的哪一刻响（不写就是现在）
function burst(out, { type = 'white', hp = 2000, lp = 9000, bp = 0, q = 1, peak = 0.3, attack = 0.004, decay = 0.04, tone = 0, wave = 'sine', glide = 0, at = 0 } = {}) {
    const c = ctx();
    const t = Math.max(c.currentTime, at || c.currentTime);
    const g = gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    let s;
    if (tone) {
        s = c.createOscillator();
        s.type = wave;
        s.frequency.setValueAtTime(tone, t);
        if (glide) s.frequency.exponentialRampToValueAtTime(Math.max(30, glide), t + attack + decay);
        s.connect(g);
    } else {
        s = c.createBufferSource();
        s.buffer = noise(type);
        if (bp) chain(s, filter('bandpass', bp, q), g);
        else chain(s, filter('highpass', hp), filter('lowpass', lp), g);
    }
    g.connect(out);
    s.start(t, tone ? 0 : Math.random() * 3);
    s.stop(t + attack + decay + 0.1);
}

// 一个音高按曲线滑的叫声（鸟、海鸥）：points = [[秒, 频率], ...]
function call(out, { points, peak = 0.06, wave = 'sine', bp = 0, at = 0 }) {
    const c = ctx();
    const t = Math.max(c.currentTime, at || c.currentTime);
    const dur = points[points.length - 1][0];
    const o = c.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(points[0][1], t);
    points.slice(1).forEach(([s, f]) => o.frequency.linearRampToValueAtTime(f, t + s));
    const g = gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(0.02, dur / 4));
    g.gain.setValueAtTime(peak, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    if (bp) chain(o, filter('bandpass', bp, 2), g, out); else chain(o, g, out);
    o.start(t);
    o.stop(t + dur + 0.05);
}

// 隔一阵来一下（随机间隔）
function every(min, max, fn, timers) {
    const go = () => { try { fn(); } catch (e) { /* 忽略 */ } timers.t = setTimeout(go, min + Math.random() * (max - min)); };
    timers.t = setTimeout(go, Math.random() * max);
}

// 按音频时钟排的节奏（钟表、火车、脚步）：period() 返回下一下隔多少秒，fn(t) 在 t 时刻响
function rhythm(period, fn) {
    const c = ctx();
    const timers = {};
    RHY?.push(timers);
    let next = c.currentTime + 0.2;
    const go = () => {
        const until = c.currentTime + 0.5;
        while (next < until) { try { fn(next); } catch (e) { /* 忽略 */ } next += Math.max(0.05, period()); }
        timers.t = setTimeout(go, 150);
    };
    go();
}

// ---------- 逐个采样合成的循环音频（只算一次） ----------
// 二阶带通（共振峰）
function bandpass(sr, f, q) {
    const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    return { b0: al / a0, b2: -al / a0, a1: -2 * Math.cos(w) / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
function bpStep(st, x) {
    const y = st.b0 * x + st.b2 * st.x2 - st.a1 * st.y1 - st.a2 * st.y2;
    st.x2 = st.x1; st.x1 = x; st.y2 = st.y1; st.y1 = y;
    return y;
}
// 首尾交叉淡化，循环时听不出接缝
function loopify(data, sr, fade = 0.5) {
    const n = Math.floor(sr * fade), len = data.length - n;
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = data[i];
    for (let i = 0; i < n; i++) { const a = i / n; out[i] = data[len + i] * (1 - a) + data[i] * a; }
    return out;
}
function normalize(d, to = 0.9) {
    let m = 0;
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= to / m;
    return d;
}
function toBuffer(d, sr) {
    const buf = ctx().createBuffer(1, d.length, sr);
    buf.getChannelData(0).set(d);
    return buf;
}

// 很多人在说话（听不清内容的嗡嗡人声）：每个人是有音高的声带脉冲，按音节换元音共振峰，有停顿、有轻重
const VOWELS = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480], [570, 840, 2410], [440, 1020, 2240], [660, 1720, 2410]];
// 一群人：同一段 8 人的人声从不同位置叠几层，听起来是 8×层数 个人，计算量只有 8 个人的
function crowdOf(out, layers, { lp = 3200, level = 0.5 } = {}) {
    for (let i = 0; i < layers; i++) chain(loopBuf(babble(8)), filter('lowpass', lp * rnd(0.85, 1.1)), gain(level / Math.sqrt(layers)), out);
}

const DATA = {};
function babble(voices = 8, opts = {}) {
    const key = `babble:${voices}:${opts.bright || 1}`;
    if (!BUF[key]) { const d = babbleData(voices, opts); BUF[key] = toBuffer(d.data, d.sr); }
    return BUF[key];
}
function babbleData(voices = 8, { seconds = 9, bright = 1 } = {}) {
    const key = `babble:${voices}:${bright}`;
    if (DATA[key]) return DATA[key];
    const sr = 22050, len = Math.floor(sr * (seconds + 0.5));
    const mix = new Float32Array(len);
    for (let v = 0; v < voices; v++) {
        const female = Math.random() < 0.5;
        const base = female ? rnd(175, 245) : rnd(95, 140);
        const level = rnd(0.35, 1);              // 远近不同
        const fs = VOWELS[0].map(() => bandpass(sr, 500, 6));
        let i = Math.floor(rnd(0, sr * 0.6)), phase = 0;
        while (i < len) {
            // 一句话：3~9 个音节，然后停一下
            const syl = 3 + Math.floor(Math.random() * 7);
            let pitch = base * rnd(0.95, 1.12);
            for (let k = 0; k < syl && i < len; k++) {
                const dur = Math.floor(sr * rnd(0.09, 0.22));
                const vw = VOWELS[Math.floor(Math.random() * VOWELS.length)];
                const shift = female ? 1.15 : 1;
                vw.forEach((f, j) => Object.assign(fs[j], bandpass(sr, f * shift, [5, 7, 9][j]), { x1: fs[j].x1, x2: fs[j].x2, y1: fs[j].y1, y2: fs[j].y2 }));
                const stress = rnd(0.55, 1);
                const cons = Math.random() < 0.6 ? Math.floor(sr * rnd(0.015, 0.045)) : 0; // 辅音的气流声
                for (let s = 0; s < dur && i < len; s++, i++) {
                    const p = s / dur;
                    const env = Math.min(1, p / 0.15) * Math.min(1, (1 - p) / 0.25) * stress;
                    const f0 = pitch * (1 + 0.04 * Math.sin(2 * Math.PI * 5 * i / sr)) * (1 - 0.08 * p);
                    phase += f0 / sr; if (phase >= 1) phase -= 1;
                    const glottal = (phase < 0.6 ? phase / 0.6 : (1 - phase) / 0.4) - 0.5; // 声带脉冲（带谐波）
                    let x = glottal + (Math.random() * 2 - 1) * 0.08;
                    if (s < cons) x = (Math.random() * 2 - 1) * 0.6 * (1 - s / cons);
                    const y = bpStep(fs[0], x) * 1.0 + bpStep(fs[1], x) * 0.6 * bright + bpStep(fs[2], x) * 0.25 * bright;
                    mix[i] += y * env * level;
                }
                pitch *= rnd(0.97, 1.03);
            }
            i += Math.floor(sr * (Math.random() < 0.25 ? rnd(0.4, 1.2) : rnd(0.05, 0.25))); // 换气、停顿
        }
    }
    // 远处听：高频稍微收一点
    let lp = 0;
    for (let i = 0; i < len; i++) { lp += (mix[i] - lp) * 0.45; mix[i] = lp; }
    DATA[key] = { data: normalize(loopify(mix, sr)), sr };
    return DATA[key];
}

// 很多人一起鼓掌：每个人以自己的节奏拍，每一下是很短的噼啪声，音色各不相同
function clapping(people = 34, opts = {}) {
    const key = `clap:${people}`;
    if (!BUF[key]) { const d = clappingData(people, opts); BUF[key] = toBuffer(d.data, d.sr); }
    return BUF[key];
}
function clappingData(people = 34, { seconds = 6 } = {}) {
    const key = `clap:${people}`;
    if (DATA[key]) return DATA[key];
    const sr = 32000, len = Math.floor(sr * (seconds + 0.5));
    const mix = new Float32Array(len);
    for (let p = 0; p < people; p++) {
        const rate = rnd(0.2, 0.32);               // 一秒 3~5 下
        const center = rnd(900, 2600);
        const level = rnd(0.3, 1);
        let t = rnd(0, rate);
        while (t < seconds + 0.5) {
            const st = bandpass(sr, center * rnd(0.85, 1.15), rnd(1.2, 2.2));
            const start = Math.floor(t * sr), n = Math.floor(sr * rnd(0.03, 0.06));
            const amp = level * rnd(0.7, 1);
            for (let s = 0; s < n && start + s < len; s++) {
                const env = s < sr * 0.002 ? s / (sr * 0.002) : Math.exp(-(s - sr * 0.002) / (sr * 0.008));
                mix[start + s] += bpStep(st, Math.random() * 2 - 1) * env * amp * 2.5;
            }
            t += rate * rnd(0.88, 1.12);
        }
    }
    DATA[key] = { data: normalize(loopify(mix, sr, 0.4)), sr };
    return DATA[key];
}

// 插件加载后空闲时先把人声、掌声算好：第一次用到时不会卡一下
(() => {
    if (typeof window === 'undefined') return;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 50));
    const jobs = [() => babbleData(8), () => babbleData(6), () => babbleData(4), () => clappingData(34), () => clappingData(10)];
    const next = () => { const j = jobs.shift(); if (!j) return; idle(() => { try { j(); } catch (e) { /* 忽略 */ } setTimeout(next, 300); }); };
    setTimeout(next, 6000);
})();

// ---------- 常用的小部件 ----------
// 鸟叫：几下快速的上滑 / 下滑啁啾
function chirp(out, { base = 3200, peak = 0.05, at = 0 } = {}) {
    const c = ctx();
    let t = Math.max(c.currentTime, at || c.currentTime);
    const n = 2 + Math.floor(Math.random() * 5);
    const up = Math.random() < 0.5;
    for (let i = 0; i < n; i++) {
        const f = base * rnd(0.9, 1.2);
        const d = rnd(0.05, 0.11);
        call(out, { points: up ? [[0, f * 0.75], [d, f * 1.25]] : [[0, f * 1.3], [d, f * 0.8]], peak: peak * rnd(0.6, 1), at: t });
        t += d + rnd(0.02, 0.07);
    }
}
// 海鸥：「啊——」往下滑的叫声，带一点沙哑
function gull(out, { peak = 0.05, at = 0 } = {}) {
    const c = ctx();
    let t = Math.max(c.currentTime, at || c.currentTime);
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
        const f = rnd(1300, 1700), d = rnd(0.25, 0.45);
        call(out, { points: [[0, f * 0.85], [d * 0.25, f * 1.08], [d, f * 0.7]], peak, wave: 'sawtooth', bp: 1800, at: t });
        t += d + rnd(0.08, 0.2);
    }
}
// 一步：脚跟先落（闷响 + 一点硬底的咔），脚尖跟上
function step(out, at, { peak = 0.7, hard = 1 } = {}) {
    burst(out, { type: 'brown', hp: 50, lp: 320, peak: peak * 0.9, attack: 0.003, decay: 0.09, at });
    burst(out, { bp: rnd(1600, 2400), q: 1.4, peak: peak * 0.35 * hard, attack: 0.001, decay: 0.03, at });
    burst(out, { type: 'brown', hp: 80, lp: 600, peak: peak * 0.35, attack: 0.003, decay: 0.05, at: at + rnd(0.06, 0.09) });
}
// 远处的雷：慢慢涌上来，滚很久
function rumble(out, { peak = 1.2, at = 0 } = {}) {
    burst(out, { type: 'brown', hp: 20, lp: 260, peak, attack: rnd(0.15, 0.5), decay: rnd(2.5, 4.5), at });
    if (Math.random() < 0.5) burst(out, { type: 'brown', hp: 30, lp: 200, peak: peak * 0.6, attack: 0.3, decay: 2.5, at: (at || ctx().currentTime) + rnd(0.6, 1.4) });
}
// 车开过去：由远到近再远，带一点胎噪
function passby(out, { peak = 0.35, dur = 3.5 } = {}) {
    const c = ctx(), t = c.currentTime;
    const s = c.createBufferSource();
    s.buffer = noise('pink');
    const f = filter('bandpass', 350, 0.8);
    const g = gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    f.frequency.setValueAtTime(260, t);
    f.frequency.linearRampToValueAtTime(700, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(240, t + dur);
    chain(s, f, g, out);
    s.start(t, Math.random() * 3);
    s.stop(t + dur + 0.1);
}

const BUILD = {
    // ---- 雨 / 天气 ----
    rain(out, add) {
        chain(src('pink'), filter('highpass', 500), filter('lowpass', 7000), gain(0.55), out);
        add(250, 900, () => burst(out, { hp: 2500, lp: 7000, peak: 0.12 + Math.random() * 0.15, decay: 0.03 }));
    },
    storm(out, add) {
        chain(src('pink'), filter('highpass', 300), filter('lowpass', 8000), gain(0.8), out);
        chain(src('brown'), filter('lowpass', 180), gain(0.6), out);
        add(60, 220, () => burst(out, { hp: 2000, lp: 8000, peak: 0.12 + Math.random() * 0.15, decay: 0.03 }));
        add(9000, 20000, () => { burst(out, { hp: 800, lp: 6000, peak: 0.5, attack: 0.002, decay: 0.25 }); rumble(out, { peak: 1.4 }); }); // 近处的雷：先一声炸裂再滚
    },
    drizzle(out, add) { chain(src('pink'), filter('highpass', 1200), filter('lowpass', 7500), gain(0.20), out); add(600, 1800, () => burst(out, { hp: 2800, peak: 0.09, decay: 0.03 })); },
    roofrain(out, add) {
        BUILD.rain(out, add);
        // 屋檐滴水：「嘀嗒」带一点往下滑的音高
        add(450, 1300, () => burst(out, { tone: rnd(900, 1500), glide: rnd(500, 800), peak: 0.07, attack: 0.002, decay: 0.06 }));
    },
    thunder(out, add) { chain(src('brown'), filter('lowpass', 260), gain(.18), out); chain(src('pink'), filter('highpass', 900), gain(.05), out); add(8000, 20000, () => rumble(out, { peak: 1.3 })); },
    wind(out) {
        const bp = filter('bandpass', 500, 0.9);
        const g = gain(0.6);
        chain(src('pink'), bp, g, out);
        lfo(bp.frequency, 0.09, 260);
        lfo(g.gain, 0.06, 0.35);
    },
    snow(out) { chain(src('brown'), filter('lowpass', 500), gain(0.22), out); const g = gain(0.11); chain(src('pink'), filter('bandpass', 800, .7), g, out); lfo(g.gain, .06, .08); },
    blizzard(out) { BUILD.wind(out); const g = gain(0.12); chain(src('white'), filter('highpass', 1500), g, out); lfo(g.gain, .2, .06); },

    // ---- 水 ----
    waves(out) {
        const g = gain(0.5);
        chain(src('brown'), filter('lowpass', 1100), g, out);
        lfo(g.gain, 0.085, 0.45);
        const g2 = gain(0.08);
        chain(src('pink'), filter('highpass', 2500), g2, out);
        lfo(g2.gain, 0.085, 0.07);
    },
    river(out, add) { chain(src('pink'), filter('bandpass', 1300, .6), gain(.42), out); chain(src('white'), filter('highpass', 2800), gain(.06), out); add(150, 500, () => burst(out, { tone: rnd(600, 1400), glide: rnd(1500, 2500), peak: .025, attack: .003, decay: .04 })); },
    waterfall(out) { chain(src('pink'), filter('lowpass', 4600), gain(.52), out); chain(src('brown'), filter('lowpass', 450), gain(.26), out); },
    lake(out, add) { const g = gain(.18); chain(src('brown'), filter('lowpass', 700), g, out); lfo(g.gain, .12, .14); chain(src('pink'), filter('bandpass', 500, .8), gain(.08), out); add(4000, 9000, () => chirp(out, { base: rnd(2600, 3600), peak: .03 })); },
    harbor(out, add) {
        BUILD.waves(out);
        // 船的汽笛：低沉、长
        add(12000, 26000, () => {
            const c = ctx(), t = c.currentTime;
            [110, 165].forEach(f => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const g = gain(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.06, t + .3); g.gain.setValueAtTime(.06, t + 2.2); g.gain.linearRampToValueAtTime(0, t + 2.8); chain(o, filter('lowpass', 700), g, out); o.start(t); o.stop(t + 3); });
        });
        add(5000, 12000, () => gull(out, { peak: .035 }));
    },
    seaside(out, add) { BUILD.waves(out); add(2500, 7000, () => gull(out, { peak: .05 })); },

    // ---- 自然 ----
    night(out, add) {
        chain(src('pink'), filter('lowpass', 900), gain(0.08), out);
        // 蟋蟀：三下一组的高频短鸣
        add(700, 1600, () => {
            const f = 4300 + Math.random() * 600, t = ctx().currentTime;
            for (let i = 0; i < 3; i++) burst(out, { tone: f, peak: 0.05, decay: 0.035, at: t + i * 0.055 });
        });
    },
    forest(out, add) { chain(src('pink'), filter('lowpass', 850), gain(.14), out); const g = gain(.05); chain(src('pink'), filter('bandpass', 400, .5), g, out); lfo(g.gain, .07, .04); add(1300, 3800, () => chirp(out, { base: rnd(2400, 4200), peak: .05 })); },
    birds(out, add) { chain(src('pink'), filter('lowpass', 700), gain(.06), out); add(500, 1700, () => chirp(out, { base: rnd(2800, 5000), peak: .06 })); },
    fire(out, add) {
        chain(src('brown'), filter('lowpass', 700), gain(0.45), out);
        add(60, 420, () => burst(out, { hp: 1800, lp: 9000, peak: 0.08 + Math.random() * 0.35, decay: 0.012 + Math.random() * 0.03 }));
    },
    cave(out, add) {
        chain(src('brown'), filter('lowpass', 500), gain(0.2), out);
        const wet = echo(out, { time: 0.23, fb: 0.5, mix: 0.6, lp: 2500 });
        add(1200, 3500, () => burst(wet, { tone: rnd(1100, 1900), glide: rnd(1900, 2800), peak: .06, attack: .002, decay: .05 })); // 水滴 + 回声
    },

    // ---- 室内 ----
    room(out) {
        chain(src('brown'), filter('lowpass', 260), gain(0.35), out);
        chain(src('pink'), filter('bandpass', 1200, 0.5), gain(0.025), out);
    },
    library(out, add) { chain(src('brown'), filter('lowpass', 220), gain(.14), out); add(5000, 12000, () => burst(out, { bp: rnd(2500, 4000), q: .8, peak: .03, attack: .02, decay: .12 })); }, // 很安静，偶尔翻书
    classroom(out, add) {
        chain(src('brown'), filter('lowpass', 260), gain(0.25), out);
        chain(loopBuf(babble(4)), filter('lowpass', 2600), gain(0.2), out); // 小声说话
        add(3000, 7000, () => burst(out, { type: 'pink', bp: rnd(500, 900), q: 3, peak: .05, attack: .05, decay: .25 })); // 挪椅子
        add(2000, 5000, () => burst(out, { hp: 2000, lp: 6000, peak: .03, decay: .02 }));
    },
    office(out, add) {
        chain(src('brown'), filter('lowpass', 260), gain(0.25), out);
        chain(src('pink'), filter('lowpass', 1400), gain(.04), out);
        add(1500, 4500, () => { const t = ctx().currentTime; for (let i = 0; i < 4 + Math.random() * 10; i++) burst(out, { hp: 1500, lp: 4500, peak: .04, decay: .018, at: t + i * rnd(.09, .18) }); });
    },
    hospital(out, add) {
        chain(src('brown'), filter('lowpass', 350), gain(.12), out);
        chain(src('pink'), filter('bandpass', 1200, .6), gain(.04), out);
        const hall = echo(out, { time: .14, fb: .35, mix: .45, lp: 2500 });
        add(6000, 14000, () => { const t = ctx().currentTime + .1; const n = 3 + Math.floor(Math.random() * 5); for (let i = 0; i < n; i++) step(hall, t + i * rnd(.5, .6), { peak: .25 }); }); // 远处有人走过
        add(3000, 8000, () => burst(out, { tone: 880, peak: .02, attack: .01, decay: .15 })); // 远处仪器提示音
    },
    footsteps(out) {
        chain(src('brown'), filter('lowpass', 220), gain(0.1), out);
        const hall = echo(out, { time: 0.13, fb: 0.4, mix: 0.5, lp: 3500 });
        // 走过来、走过去：一段路走一会儿，停一下
        let n = 0, walk = 8 + Math.floor(Math.random() * 10), level = .9;
        rhythm(() => {
            n += 1;
            if (n >= walk) { n = 0; walk = 8 + Math.floor(Math.random() * 12); level = rnd(.6, 1); return rnd(1.5, 4); }
            return rnd(0.52, 0.6);
        }, (t) => { step(hall, t, { peak: level }); });
    },
    keyboard(out, add) {
        chain(src('brown'), filter('lowpass', 260), gain(0.2), out);
        // 一阵一阵地打字，中间停顿
        add(1200, 3500, () => {
            const t = ctx().currentTime; let at = t;
            const n = 5 + Math.floor(Math.random() * 25);
            for (let i = 0; i < n; i++) { at += rnd(.06, .2); burst(out, { bp: rnd(1800, 3200), q: 1.5, peak: rnd(.05, .09), attack: .001, decay: .02, at }); }
            if (Math.random() < .4) burst(out, { type: 'pink', bp: 900, q: 1.5, peak: .1, attack: .001, decay: .05, at: at + .15 }); // 空格 / 回车
        });
    },
    clock(out) {
        // 安静的房间 + 一秒一下的「滴、答」：木头壳子里的清脆咔哒，两下音色略不同
        chain(src('brown'), filter('lowpass', 180), gain(0.05), out);
        let tick = true;
        rhythm(() => 1.0, (t) => {
            const f = tick ? 3200 : 2500;
            burst(out, { bp: f, q: 3, peak: 1.4, attack: .0008, decay: .012, at: t });
            burst(out, { hp: 1500, lp: 9000, peak: .35, attack: .0005, decay: .006, at: t });
            burst(out, { bp: f / 2.6, q: 6, peak: .35, attack: .001, decay: .03, at: t });
            tick = !tick;
        });
    },
    fan(out) { chain(src('brown'), filter('lowpass', 400), gain(.3), out); const g = gain(.1); chain(src('pink'), filter('bandpass', 750, .5), g, out); lfo(g.gain, 4, .02); },
    aircon(out) { chain(src('pink'), filter('lowpass', 1400), gain(.17), out); chain(src('brown'), filter('lowpass', 230), gain(.24), out); },
    computer(out) { BUILD.aircon(out); chain(src('pink'), filter('bandpass', 2800, 2), gain(.035), out); },
    space(out) { chain(src('brown'), filter('lowpass', 140), gain(.20), out); const g = gain(.04); chain(src('pink'), filter('bandpass', 550, 3), g, out); lfo(g.gain, .05, .02); },

    // ---- 人多的地方 ----
    crowd(out) {
        crowdOf(out, 2, { lp: 3200, level: 0.7 });
        chain(src('pink'), filter('lowpass', 900), gain(0.06), out);
    },
    cafe(out, add) {
        chain(loopBuf(babble(6)), filter('lowpass', 2800), gain(0.35), out);
        chain(src('brown'), filter('lowpass', 300), gain(0.12), out);
        // 杯碟轻碰：两个高音一起
        add(2500, 7000, () => { const f = rnd(2600, 4200); burst(out, { tone: f, peak: .04, attack: .001, decay: .35 }); burst(out, { tone: f * 1.48, peak: .025, attack: .001, decay: .25 }); });
        add(9000, 20000, () => burst(out, { type: 'pink', bp: 1500, q: 2, peak: .05, attack: .3, decay: 1.2 })); // 咖啡机蒸汽
    },
    restaurant(out, add) {
        crowdOf(out, 1, { lp: 3000, level: 0.45 });
        chain(src('brown'), filter('lowpass', 300), gain(0.1), out);
        add(900, 3000, () => { const f = rnd(3000, 5200); burst(out, { tone: f, peak: .035, attack: .001, decay: .2 }); burst(out, { tone: f * 1.33, peak: .02, attack: .001, decay: .15 }); }); // 刀叉碰盘子
    },
    market(out, add) {
        crowdOf(out, 2, { lp: 3400, level: 0.75 });
        chain(src('pink'), filter('lowpass', 1200), gain(0.06), out);
        add(3000, 8000, () => burst(out, { tone: 1450, peak: .05, attack: .002, decay: .4 })); // 小铃铛
        add(4000, 10000, () => { const t = ctx().currentTime; for (let i = 0; i < 3; i++) burst(out, { type: 'pink', bp: rnd(500, 900), q: 4, peak: .14, attack: .04, decay: .2, at: t + i * .28 }); }); // 吆喝
    },
    street(out, add) {
        chain(src('brown'), filter('lowpass', 500), gain(.3), out);
        chain(loopBuf(babble(6)), filter('lowpass', 2600), gain(0.18), out);
        add(2500, 6000, () => passby(out, { peak: .3, dur: rnd(2.5, 4.5) }));
        add(15000, 40000, () => { const t = ctx().currentTime; [0, .22].forEach(d => burst(out, { tone: 420, wave: 'square', peak: .025, attack: .01, decay: .15, at: t + d })); }); // 远处喇叭
    },
    traffic(out, add) {
        chain(src('brown'), filter('lowpass', 500), gain(.4), out);
        add(1500, 4000, () => passby(out, { peak: .4, dur: rnd(2.5, 5) }));
        add(20000, 45000, () => burst(out, { tone: 380, wave: 'square', peak: .025, attack: .01, decay: .35 }));
    },
    train(out) {
        chain(src('brown'), filter('lowpass', 420), gain(.45), out);
        chain(src('pink'), filter('bandpass', 1000, 1.1), gain(.1), out);
        // 铁轨接缝：「咣当-咣当」两下一组，节奏稳
        rhythm(() => rnd(1.05, 1.15), (t) => {
            [0, 0.13].forEach((d, i) => {
                burst(out, { type: 'brown', hp: 60, lp: 600, peak: i ? 1.1 : 1.4, attack: .003, decay: .1, at: t + d });
                burst(out, { bp: rnd(800, 1100), q: 1.2, peak: i ? .38 : .5, attack: .002, decay: .06, at: t + d });
                burst(out, { bp: 2600, q: 3, peak: .08, attack: .001, decay: .04, at: t + d });
            });
        });
    },
    subway(out, add) { chain(src('pink'), filter('bandpass', 700, .6), gain(.36), out); chain(src('brown'), filter('lowpass', 260), gain(.40), out); add(5000, 10000, () => burst(out, { tone: 1100, glide: 1300, peak: .03, attack: .2, decay: 1.2 })); },
    applause(out) {
        // 剧场里一片密集的掌声，带一点大厅混响，时强时弱
        const hall = echo(out, { time: 0.09, fb: 0.3, mix: 0.4, lp: 4000 });
        const g = gain(0.75);
        chain(loopBuf(clapping(34)), filter('highpass', 300), g, hall);
        lfo(g.gain, 0.11, 0.2);
        chain(src('pink'), filter('lowpass', 1200), gain(0.05), out);
    },
    festival(out, add) {
        // 人很多、很热闹：大片人声 + 欢呼 + 零星掌声和笑声
        crowdOf(out, 3, { lp: 3600, level: 0.85 });
        const cl = gain(0.1); chain(loopBuf(clapping(10)), filter('highpass', 400), cl, out); lfo(cl.gain, 0.05, 0.08);
        add(3500, 9000, () => {
            // 欢呼：一群人一起「哦——」往上扬
            const c = ctx(), t = c.currentTime;
            for (let i = 0; i < 6; i++) {
                const f = rnd(220, 420);
                call(out, { points: [[0, f], [rnd(.4, .7), f * rnd(1.3, 1.7)], [rnd(.9, 1.3), f * 1.2]], peak: .02, wave: 'sawtooth', bp: rnd(700, 1200), at: t + rnd(0, .25) });
            }
        });
        add(6000, 15000, () => { const t = ctx().currentTime; for (let i = 0; i < 6; i++) burst(out, { hp: 1500, lp: 6000, peak: .12, attack: .001, decay: .03, at: t + i * rnd(.05, .12) }); }); // 远处小鞭炮
    },
    fireworks(out, add) {
        // 夜空里放烟花：咻——（上升的哨音）→ 砰（低沉的炸响 + 回声）→ 噼里啪啦（碎火花），底下有人群
        crowdOf(out, 1, { lp: 2400, level: 0.22 });
        const sky = echo(out, { time: 0.32, fb: 0.35, mix: 0.45, lp: 1500 });
        add(2500, 7000, () => {
            const c = ctx(), t = c.currentTime;
            const rise = Math.random() < 0.65 ? rnd(1.0, 1.6) : 0;
            if (rise) {
                const o = c.createOscillator(); o.type = 'sine';
                const f0 = rnd(700, 1000);
                o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * rnd(2.2, 3), t + rise);
                const g = gain(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t + .15); g.gain.linearRampToValueAtTime(.015, t + rise);
                chain(o, g, out); o.start(t); o.stop(t + rise + .05);
                burst(out, { hp: 2500, lp: 7000, peak: .012, attack: rise * .8, decay: .1, at: t });
            }
            const bang = t + (rise || 0.05);
            const big = rnd(0.7, 1.2);
            burst(sky, { type: 'brown', hp: 25, lp: rnd(220, 380), peak: 1.6 * big, attack: .004, decay: rnd(1.2, 2), at: bang });
            burst(sky, { bp: rnd(500, 900), q: .8, peak: .5 * big, attack: .002, decay: .18, at: bang });
            if (Math.random() < .75) {
                const n = 25 + Math.floor(Math.random() * 45), span = rnd(.8, 2);
                for (let i = 0; i < n; i++) burst(out, { hp: 2500, lp: 9000, peak: rnd(.03, .12), attack: .0008, decay: rnd(.004, .015), at: bang + .2 + Math.pow(Math.random(), .7) * span });
            }
        });
    }
};
// 正在搭建的这一层里节奏声音的定时器，停的时候一起清掉
let RHY = null;

// 每种环境声的响度校准（dB）：实际录下来量过，让切换场景时音量差不多；
// 本来就安静的（夜晚、图书馆、细雨…）稍轻，本来就吵的（暴雨、瀑布、人群…）稍响
const TRIM = { aircon: 3.1, applause: -0.9, birds: 8.9, blizzard: -2.0, cafe: -0.9, cave: 0.9, classroom: 1.5, clock: 8, computer: 2.9, crowd: -4.9, drizzle: 6.7, fan: 2.6, festival: -3.6, fire: -1.3, fireworks: 1.0, footsteps: 6.5, forest: 8.5, harbor: -4.5, hospital: 5.4, keyboard: 6.4, lake: 2.5, library: 4.5, market: -2.0, night: 9.3, office: 4.1, rain: 2.0, restaurant: -0.7, river: 5.3, roofrain: 2.0, room: 1.0, seaside: -4.8, snow: -0.2, space: 1.8, storm: -4.2, street: 0.8, subway: -0.6, thunder: -0.9, traffic: 0.2, train: -2.1, waterfall: -1.7, waves: -4.5, wind: 2.4 };

/**
 * 开始一层环境声。返回 { stop() }，stop 会淡出。
 * @param {string} kind  AMBIENCE_LABELS 里的 key
 * @param {number} volume 0~1
 */
function startSynthAmbience(kind, volume = 0.3) {
    const build = BUILD[kind];
    const c = build ? ctx() : null;
    if (!build || !c) return { stop() {} };
    const master = c.createGain();
    master.gain.value = 0;
    // 限幅：校准后再大的音量也不会爆音
    const limit = c.createDynamicsCompressor();
    limit.threshold.value = -6; limit.knee.value = 6; limit.ratio.value = 12; limit.attack.value = 0.002; limit.release.value = 0.2;
    master.connect(limit).connect(c.destination);
    const v = Math.max(0, Math.min(1, Number(volume) || 0)) * 0.6 * Math.pow(10, (TRIM[kind] || 0) / 20);
    master.gain.linearRampToValueAtTime(v, c.currentTime + 1.2);
    const timers = [];
    const add = (min, max, fn) => { const t = {}; timers.push(t); every(min, max, fn, t); };
    REG = [];
    RHY = timers;
    try { build(master, add); } catch (e) { console.warn('[环境声] 失败', e); }
    const nodes = REG;
    REG = null;
    RHY = null;
    let stopped = false;
    return {
        kind,
        stop(fade = 0.8) {
            if (stopped) return;
            stopped = true;
            timers.forEach(t => clearTimeout(t.t));
            try {
                const now = c.currentTime;
                master.gain.cancelScheduledValues(now);
                master.gain.setValueAtTime(master.gain.value, now);
                master.gain.linearRampToValueAtTime(0, now + fade);
            } catch (e) { /* 忽略 */ }
            setTimeout(() => {
                nodes.forEach(n => { try { n.stop(); } catch (e) { /* 忽略 */ } });
                try { master.disconnect(); limit.disconnect(); } catch (e) { /* 忽略 */ }
            }, (fade + 0.3) * 1000);
        }
    };
}


// 用户提供的 MP3：直接播放真实录音，不经过 WebAudio 拟声合成。
// URL 以本模块为基准，兼容扩展安装在不同目录或域名的情况。
const RECORDED = new Set(["icewalk", "cheering", "steadyrain", "scifi", "thunderclip", "heartbeat", "outdoors", "windclip", "drops", "leaves", "strolling", "newspaper", "snowstorm", "briskwalk", "cicadas", "cat", "horse", "stream", "bell", "writing", "techdata", "applause", "pouring", "fingersnap", "office", "typing", "camera", "running", "fireworksclip", "busycity", "citytraffic", "breathing", "fastheartbeat", "dog", "bicycle", "basketball", "swimming"]);
const AUDIO_BASE = new URL('./audio/', import.meta.url);

function startRecordedAmbience(kind, volume = 0.3) {
    const audio = new Audio(new URL(`${kind}.mp3`, AUDIO_BASE).href);
    audio.preload = 'auto';
    audio.loop = true;
    // 录音本身的瞬态较多，默认比合成环境声轻，尽量不遮住正文朗读。
    const target = Math.max(0, Math.min(1, Number(volume) || 0)) * 0.52;
    audio.volume = 0;
    let stopped = false;
    let frame = 0;
    let delayed = 0;
    const animate = (from, to, millis, done) => {
        cancelAnimationFrame(frame);
        const start = performance.now();
        function tick(now) {
            if (stopped && to > 0) return;
            const t = Math.min(1, (now - start) / Math.max(1, millis));
            audio.volume = Math.max(0, Math.min(1, from + (to - from) * t));
            if (t < 1) frame = requestAnimationFrame(tick);
            else done?.();
        }
        frame = requestAnimationFrame(tick);
    };
    const onError = () => console.warn('[环境声] 音频加载失败：', kind, audio.error);
    audio.addEventListener('error', onError);
    const begin = audio.play();
    if (begin?.then) begin.then(() => { if (!stopped) animate(0, target, 1100); })
        .catch(err => console.warn('[环境声] 无法播放录音：', kind, err));
    return {
        kind,
        stop(fade = 0.8) {
            if (stopped) return;
            stopped = true;
            clearTimeout(delayed);
            cancelAnimationFrame(frame);
            const from = audio.volume;
            // 这里用独立的淡出帧，不受已停止标志影响。
            const start = performance.now();
            const duration = Math.max(0, Number(fade) || 0) * 1000;
            const fadeOut = now => {
                const t = duration ? Math.min(1, (now - start) / duration) : 1;
                audio.volume = Math.max(0, from * (1 - t));
                if (t < 1) frame = requestAnimationFrame(fadeOut);
                else { audio.pause(); audio.removeAttribute('src'); audio.load(); audio.removeEventListener('error', onError); }
            };
            frame = requestAnimationFrame(fadeOut);
        }
    };
}

export function startAmbience(kind, volume = 0.3) {
    if (RECORDED.has(kind)) return startRecordedAmbience(kind, volume);
    if (kind === 'none' || !Object.prototype.hasOwnProperty.call(AMBIENCE_LABELS, kind)) return { stop() {} };
    return startSynthAmbience(kind, volume);
}
