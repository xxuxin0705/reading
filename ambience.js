// 原有手机插件 · 正文朗读：环境声（雨、风、海浪、虫鸣、室内、篝火、人群、咖啡馆）
// 全部用 WebAudio 现场合成，不用下载音频文件；播台词时在底下轻轻垫一层，停了就淡出。

export const AMBIENCE_LABELS = Object.freeze({
    none: '无', rain: '雨声', storm: '暴雨雷声', wind: '风声', waves: '海浪', night: '夜晚虫鸣',
    room: '安静室内', fire: '篝火噼啪', crowd: '人声嘈杂', cafe: '咖啡馆',
    drizzle: '细雨', roofrain: '屋檐雨声', snow: '雪夜寒风', blizzard: '暴风雪', forest: '森林鸟鸣', birds: '清晨鸟鸣', river: '溪流', waterfall: '瀑布', lake: '湖畔微风', harbor: '港口', train: '火车车厢', subway: '地铁车厢', traffic: '城市车流', street: '城市街道', classroom: '教室', library: '图书馆', hospital: '医院走廊', office: '办公室', restaurant: '餐厅', market: '热闹集市', festival: '节日人群', applause: '剧场掌声', clock: '钟表滴答', fan: '风扇', aircon: '空调', computer: '电脑机房', space: '科幻舱室', cave: '洞穴回声', footsteps: '走廊脚步', keyboard: '键盘敲击', seaside: '海边海鸥', thunder: '远处雷声'
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
    s.loopStart = Math.random() * 3;
    s.start(0, Math.random() * 3);
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

// 短促的一下（雨滴、柴火噼啪、碰杯）
function burst(out, { type = 'white', hp = 2000, lp = 9000, peak = 0.3, decay = 0.04, tone = 0 } = {}) {
    const c = ctx();
    const t = c.currentTime;
    const g = gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    let s;
    if (tone) {
        s = c.createOscillator();
        s.frequency.value = tone;
        s.connect(g);
    } else {
        s = c.createBufferSource();
        s.buffer = noise(type);
        chain(s, filter('highpass', hp), filter('lowpass', lp), g);
    }
    g.connect(out);
    s.start(t, tone ? 0 : Math.random() * 3);
    s.stop(t + decay + 0.05);
}

function every(min, max, fn, timers) {
    const go = () => { try { fn(); } catch (e) { /* 忽略 */ } timers.t = setTimeout(go, min + Math.random() * (max - min)); };
    timers.t = setTimeout(go, Math.random() * max);
}

const BUILD = {
    rain(out, add) {
        chain(src('pink'), filter('highpass', 500), filter('lowpass', 7000), gain(0.55), out);
        add(250, 900, () => burst(out, { hp: 2500, lp: 7000, peak: 0.12 + Math.random() * 0.15, decay: 0.03 }));
    },
    storm(out, add) {
        chain(src('pink'), filter('highpass', 300), filter('lowpass', 8000), gain(0.8), out);
        chain(src('brown'), filter('lowpass', 180), gain(0.6), out);
        add(60, 220, () => burst(out, { hp: 2000, lp: 8000, peak: 0.12 + Math.random() * 0.15, decay: 0.03 }));
        add(9000, 20000, () => burst(out, { type: 'brown', hp: 20, lp: 300, peak: 1.4, decay: 3.5 })); // 远处的雷
    },
    wind(out) {
        const bp = filter('bandpass', 500, 0.9);
        const g = gain(0.6);
        chain(src('pink'), bp, g, out);
        lfo(bp.frequency, 0.09, 260);
        lfo(g.gain, 0.06, 0.35);
    },
    waves(out) {
        const g = gain(0.5);
        chain(src('brown'), filter('lowpass', 1100), g, out);
        lfo(g.gain, 0.085, 0.45);
        const g2 = gain(0.08);
        chain(src('pink'), filter('highpass', 2500), g2, out);
        lfo(g2.gain, 0.085, 0.07);
    },
    night(out, add) {
        chain(src('pink'), filter('lowpass', 900), gain(0.08), out);
        // 蟋蟀：三下一组的高频短鸣
        add(700, 1600, () => {
            const f = 4300 + Math.random() * 600;
            for (let i = 0; i < 3; i++) setTimeout(() => burst(out, { tone: f, peak: 0.05, decay: 0.035 }), i * 55);
        });
    },
    room(out) {
        chain(src('brown'), filter('lowpass', 260), gain(0.35), out);
        chain(src('pink'), filter('bandpass', 1200, 0.5), gain(0.025), out);
    },
    fire(out, add) {
        chain(src('brown'), filter('lowpass', 700), gain(0.45), out);
        add(60, 420, () => burst(out, { hp: 1800, lp: 9000, peak: 0.08 + Math.random() * 0.35, decay: 0.012 + Math.random() * 0.03 }));
    },
    crowd(out) {
        // 远处很多人在说话：几条不同共振峰的噪声，各自按说话的节奏起伏
        [320, 520, 800, 1150, 1700, 2400].forEach((f, i) => {
            const g = gain(0.13);
            chain(src(i % 2 ? 'pink' : 'brown'), filter('bandpass', f, 3.5), g, out);
            lfo(g.gain, 2 + Math.random() * 4, 0.1);
        });
        chain(src('pink'), filter('lowpass', 2500), gain(0.08), out);
    },
    cafe(out, add) {
        [380, 650, 1000, 1500, 2200].forEach((f, i) => {
            const g = gain(0.07);
            chain(src(i % 2 ? 'pink' : 'brown'), filter('bandpass', f, 3.5), g, out);
            lfo(g.gain, 2 + Math.random() * 3, 0.055);
        });
        chain(src('brown'), filter('lowpass', 300), gain(0.15), out);
        add(2500, 7000, () => burst(out, { tone: 2600 + Math.random() * 2400, peak: 0.05, decay: 0.35 })); // 杯碟轻碰
    },

    drizzle(out, add) { chain(src('pink'), filter('highpass', 1200), filter('lowpass', 7500), gain(0.20), out); add(600, 1800, () => burst(out, { hp: 2800, peak: 0.09, decay: 0.03 })); },
    roofrain(out, add) { BUILD.rain(out, add); add(450, 1200, () => burst(out, { tone: 600 + Math.random()*500, peak: 0.10, decay: 0.05 })); },
    snow(out) { chain(src('brown'), filter('lowpass', 500), gain(0.22), out); const g=gain(0.11); chain(src('pink'), filter('bandpass', 800, .7), g, out); lfo(g.gain, .06, .08); },
    blizzard(out) { BUILD.wind(out); chain(src('white'), filter('highpass', 1500), gain(0.10), out); },
    forest(out, add) { chain(src('pink'), filter('lowpass', 850), gain(.14), out); add(1100, 3300, () => burst(out, { tone: 1700 + Math.random()*1600, peak: .065, decay: .16 })); },
    birds(out, add) { chain(src('pink'), filter('lowpass', 700), gain(.065), out); add(600, 2000, () => burst(out, { tone: 2100 + Math.random()*2500, peak:.09, decay:.12 })); },
    river(out) { chain(src('pink'), filter('bandpass', 1300, .6), gain(.42), out); chain(src('white'), filter('highpass', 2800), gain(.06), out); },
    waterfall(out) { chain(src('pink'), filter('lowpass', 4600), gain(.52), out); chain(src('brown'), filter('lowpass', 450), gain(.26), out); },
    lake(out) { BUILD.waves(out); chain(src('pink'), filter('lowpass', 600), gain(.04), out); },
    harbor(out, add) { BUILD.waves(out); add(7000, 18000, () => burst(out, { tone: 420, peak:.12, decay:1.0 })); },
    train(out, add) { chain(src('brown'), filter('lowpass', 420), gain(.45), out); chain(src('pink'), filter('bandpass', 1000, 1.1), gain(.11), out); add(210, 470, () => burst(out, { tone: 400, peak:.05, decay:.06 })); },
    subway(out, add) { chain(src('pink'), filter('bandpass', 700, .6), gain(.36), out); chain(src('brown'), filter('lowpass', 260), gain(.40), out); add(3200, 7500, () => burst(out, { tone: 1100, peak:.045, decay:.7 })); },
    traffic(out, add) { chain(src('brown'), filter('lowpass', 500), gain(.4), out); add(1800, 4500, () => burst(out, { tone: 280 + Math.random()*140, peak:.075, decay:.35 })); },
    street(out, add) { BUILD.traffic(out, add); chain(src('pink'), filter('bandpass', 1200, 2), gain(.05), out); },
    classroom(out, add) { BUILD.room(out); add(2200, 5000, () => burst(out, { hp: 900, lp:2200, peak:.12, decay:.055 })); },
    library(out) { BUILD.room(out); chain(src('pink'), filter('lowpass', 1500), gain(.025), out); },
    hospital(out) { chain(src('brown'), filter('lowpass', 350), gain(.12), out); chain(src('pink'), filter('bandpass', 1200, .6), gain(.045), out); },
    office(out, add) { BUILD.room(out); add(900, 3000, () => burst(out, { hp: 1600, lp: 4400, peak:.035, decay:.018 })); },
    restaurant(out, add) { BUILD.cafe(out, add); },
    market(out, add) { BUILD.crowd(out); add(2400, 6800, () => burst(out, { tone: 1450, peak:.07, decay:.1 })); },
    festival(out, add) { BUILD.crowd(out); add(1100, 3600, () => burst(out, { hp: 1500, lp: 5700, peak:.08, decay:.1 })); },
    applause(out, add) { chain(src('pink'), filter('lowpass', 1800), gain(.10), out); add(95, 240, () => burst(out, { hp: 550, lp: 3300, peak:.15, decay:.065 })); },
    clock(out, add) { BUILD.room(out); add(900, 1100, () => burst(out, { tone: 900, peak:.07, decay:.035 })); },
    fan(out) { chain(src('brown'), filter('lowpass', 400), gain(.3), out); chain(src('pink'), filter('bandpass', 750, .5), gain(.1), out); },
    aircon(out) { chain(src('pink'), filter('lowpass', 1400), gain(.17), out); chain(src('brown'), filter('lowpass', 230), gain(.24), out); },
    computer(out) { BUILD.aircon(out); chain(src('pink'), filter('bandpass', 2800, 2), gain(.035), out); },
    space(out) { chain(src('brown'), filter('lowpass', 140), gain(.20), out); chain(src('pink'), filter('bandpass', 550, 3), gain(.04), out); },
    cave(out) { chain(src('brown'), filter('lowpass', 600), gain(.22), out); },
    footsteps(out, add) { BUILD.room(out); add(450, 850, () => burst(out, { type:'brown', hp:100, lp:900, peak:.24, decay:.09 })); },
    keyboard(out, add) { BUILD.room(out); add(110, 600, () => burst(out, { hp: 850, lp:3800, peak:.075, decay:.018 })); },
    seaside(out, add) { BUILD.waves(out); add(1800, 5700, () => burst(out, { tone: 1300 + Math.random()*1000, peak:.045, decay:.2 })); },
    thunder(out, add) { chain(src('brown'), filter('lowpass', 260), gain(.22), out); add(8000, 21000, () => burst(out, { type:'brown', hp:20, lp:260, peak:1.2, decay:2.8 })); }
};

/**
 * 开始一层环境声。返回 { stop() }，stop 会淡出。
 * @param {string} kind  AMBIENCE_LABELS 里的 key
 * @param {number} volume 0~1
 */
export function startAmbience(kind, volume = 0.3) {
    const build = BUILD[kind];
    const c = build ? ctx() : null;
    if (!build || !c) return { stop() {} };
    const master = c.createGain();
    master.gain.value = 0;
    master.connect(c.destination);
    const v = Math.max(0, Math.min(1, Number(volume) || 0)) * 0.6;
    master.gain.linearRampToValueAtTime(v, c.currentTime + 1.2);
    const timers = [];
    const add = (min, max, fn) => { const t = {}; timers.push(t); every(min, max, fn, t); };
    REG = [];
    try { build(master, add); } catch (e) { console.warn('[环境声] 失败', e); }
    const nodes = REG;
    REG = null;
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
                try { master.disconnect(); } catch (e) { /* 忽略 */ }
            }, (fade + 0.3) * 1000);
        }
    };
}
