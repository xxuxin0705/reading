// 原有手机插件 · 语音收藏：存在浏览器本地的 IndexedDB（音频本身也存，刷新后还能听）

const DB_NAME = 'yzr-favorites';
const STORE = 'favs';
let DB = null;

function open() {
    if (DB) return Promise.resolve(DB);
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('这个浏览器不支持本地存储（IndexedDB）')); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const os = db.createObjectStore(STORE, { keyPath: 'id' });
                os.createIndex('at', 'at');
            }
        };
        req.onsuccess = () => { DB = req.result; resolve(DB); };
        req.onerror = () => reject(req.error || new Error('打开收藏失败'));
    });
}

function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const os = t.objectStore(STORE);
        let out;
        Promise.resolve(fn(os)).then(v => { out = v; });
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    }));
}

const req2p = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const favStore = {
    async add(rec) {
        const item = { id: `fav_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), ...rec };
        await tx('readwrite', os => req2p(os.put(item)));
        return item;
    },
    async update(id, patch) {
        return tx('readwrite', async os => {
            const cur = await req2p(os.get(id));
            if (!cur) return null;
            const next = { ...cur, ...patch };
            await req2p(os.put(next));
            return next;
        });
    },
    async remove(id) { return tx('readwrite', os => req2p(os.delete(id))); },
    async all() {
        const list = await tx('readonly', os => req2p(os.getAll()));
        return (list || []).sort((a, b) => (b.at || 0) - (a.at || 0));
    },
    // 同一句（同一个人、同样的文字、同一来源）收藏过没有
    async find(text, speaker, source) {
        const list = await this.all();
        return list.find(x => x.text === text && x.speaker === speaker && x.source === source) || null;
    }
};

// 不是中文（有假名、韩文，或者基本是拉丁字母）才需要翻译
export function needsTranslation(text = '') {
    const t = String(text || '');
    if (/[぀-ヿ가-힯]/.test(t)) return true;
    const han = (t.match(/[一-鿿]/g) || []).length;
    const latin = (t.match(/[A-Za-zÀ-ɏЀ-ӿ]/g) || []).length;
    return han === 0 && latin >= 3;
}

// ---------- 🎭 里选定的那版语音：存在本地，刷新、换聊天、切换回复后再回来还是那版 ----------
const PIN_DB = 'yzr-pins';
const PIN_STORE = 'pins';
const PIN_MAX = 400;
let PDB = null;
function openPins() {
    if (PDB) return Promise.resolve(PDB);
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
        const req = indexedDB.open(PIN_DB, 1);
        req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(PIN_STORE)) db.createObjectStore(PIN_STORE, { keyPath: 'key' }).createIndex('at', 'at'); };
        req.onsuccess = () => { PDB = req.result; resolve(PDB); };
        req.onerror = () => reject(req.error);
    });
}
function ptx(mode, fn) {
    return openPins().then(db => new Promise((resolve, reject) => {
        const t = db.transaction(PIN_STORE, mode);
        let out;
        Promise.resolve(fn(t.objectStore(PIN_STORE))).then(v => { out = v; });
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    }));
}
export const pinStore = {
    async put(key, sig, blobs, rate = 1) {
        await ptx('readwrite', os => req2p(os.put({ key, sig, blobs, rate, at: Date.now() })));
        const all = await this.all();
        if (all.length > PIN_MAX) {
            const old = all.sort((a, b) => a.at - b.at).slice(0, all.length - PIN_MAX);
            await ptx('readwrite', os => Promise.all(old.map(x => req2p(os.delete(x.key)))));
        }
    },
    async all() { return (await ptx('readonly', os => req2p(os.getAll()))) || []; }
};
