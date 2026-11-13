// ST Reader — AGPL-3.0
// 按智库保存的数据协议读取图片副本，不加载智库运行时。
const IMAGE_TYPE = /^image\/(?:png|jpe?g|webp|gif|avif|bmp)$/i;

/** 智库漫画页键使用规范化文本的 FNV-1a，按 Unicode 码点累积。 */
function comicKey(text) {
    let value = 2166136261;
    for (const character of text.replace(/\s+/g, ' ').trim()) value = Math.imul(value ^ character.codePointAt(0), 16777619);
    return (value >>> 0).toString(36);
}
function comicBlocks(text) {
    return [...String(text ?? '').matchAll(/<image\b[^>]*>([\s\S]*?)<\/image>/gi)]
        .map(match => match[1].trim()).filter(inner => /^@(?:page|position)\b/i.test(inner) || /^\{[\s\S]*"format"\s*:\s*"nai5-comic"/.test(inner));
}

/** 画师库的“插入聊天”会直接保存 img 标签。这里只解析属性文本，不构建或执行 HTML。 */
function insertedImages(text) {
    const images = [];
    for (const match of text.matchAll(/<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
        const attributes = new Map();
        for (const attribute of match[0].matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
            const name = attribute[1].toLowerCase();
            if (!attributes.has(name)) attributes.set(name, attribute[2] ?? attribute[3] ?? attribute[4]);
        }
        const classes = (attributes.get('class') ?? '').split(/\s+/);
        if (!classes.some(name => ['pc-chat-img', 'custom-pc-chat-img'].includes(name)) && attributes.get('alt') !== '画师库生成') continue;
        const source = attributes.get('src');
        if (!source) continue;
        const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
        const url = source.replace(/&(amp|quot|apos|lt|gt);/g, (_, name) => entities[name]);
        images.push({ position: match.index, image: { kind: 'image', url, caption: '' } });
    }
    return images;
}

/** 只保留当前候选仍引用的已生成结果，原始消息及历史图片版本保持只读。 */
export function readZhikuImages(raw, swipe, text) {
    const entries = [], seen = new Set();
    const records = Object.entries(raw.extra?.zhikuImages ?? {}).map(([key, record]) => {
        const match = /^(\d+):(\d+):([\s\S]+)$/.exec(key);
        return match && Number(match[1]) === swipe ? { record, offset: Number(match[2]), marker: match[3] } : null;
    }).filter(Boolean).sort((a, b) => a.offset - b.offset);
    const illustrations = insertedImages(text);
    for (const marker of new Set(records.map(item => item.marker))) {
        const candidates = records.filter(item => item.marker === marker);
        let start = text.indexOf(marker), ordinal = 0;
        while (start >= 0) {
            const { record } = candidates.find(item => item.offset === start && item.record) ?? candidates[ordinal] ?? candidates[0];
            if (record && !record.deleted && typeof record.url === 'string' && record.url) {
                illustrations.push({ position: start, image: { kind: 'image', url: record.url, caption: '' } });
            }
            ordinal++;
            start = text.indexOf(marker, start + marker.length);
        }
    }
    entries.push(...illustrations.sort((a, b) => a.position - b.position).map(item => item.image));
    const inBody = comicBlocks(text);
    const pages = inBody.length ? inBody : comicBlocks(raw.extra?.zhikuComicSrc?.[String(swipe)]);
    for (const [index, body] of pages.entries()) {
        const key = comicKey(body), record = raw.extra?.zhikuComic?.[key];
        if (seen.has(key) || !Array.isArray(record?.versions) || !record.versions.length) continue;
        seen.add(key);
        const current = Number.isInteger(record.cur) && record.cur >= 0 && record.cur < record.versions.length ? record.cur : record.versions.length - 1;
        const version = record.versions[current];
        if (typeof version?.url !== 'string' || !version.url) continue;
        const captions = version.textMode === 'overlay' ? version.captions : null;
        const words = [captions?.pageTexts ?? [], captions?.panelTexts ?? []].flat(2).filter(value => typeof value === 'string' && value.trim());
        entries.push({ kind: 'comic', page: index + 1, url: version.url, caption: words.join('\n') });
    }
    return Object.freeze(entries.map(entry => Object.freeze(entry)));
}

/** 允许智库自己的本地图片、同源图片文件与宿主允许的 HTTPS 外部媒体。 */
export function zhikuImageUrl(value, { baseUrl, allowExternal = false }) {
    if (typeof value !== 'string') return null;
    if (/^idb:[a-z0-9._-]+$/i.test(value)) return value;
    if (/^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
    try {
        const base = new URL(baseUrl), url = new URL(value, new URL('/', base));
        if (url.username || url.password) return null;
        if (url.protocol === 'blob:' && url.origin === base.origin) return url.href;
        const sameOrigin = url.origin === base.origin && url.protocol === base.protocol && url.host === base.host;
        if (sameOrigin && /^\/user\/(?:images|files)\//.test(url.pathname)) return url.href;
        if (sameOrigin && url.pathname.startsWith('/images/')) return url.href;
        if (allowExternal && url.protocol === 'https:' && url.origin !== base.origin) return url.href;
    } catch { /* 非图片地址交给 UI 显示提示。 */ }
    return null;
}

/** 智库数据库缺失时中止升级事务，避免仅仅阅读就创建一个空数据库。 */
export function createZhikuImageResolver({ indexedDB = globalThis.indexedDB, baseUrl = globalThis.location?.href,
    createUrl = blob => URL.createObjectURL(blob), revokeUrl = url => URL.revokeObjectURL(url) } = {}) {
    let database, destroyed = false;
    const urls = new Map(), pending = new Map();
    async function open() {
        if (!indexedDB) return null;
        database ??= new Promise((resolve, reject) => {
            const request = indexedDB.open('zhiku_images');
            let abandoned = false;
            request.onupgradeneeded = () => request.transaction.abort();
            request.onblocked = () => { abandoned = true; reject(new Error('本地图片库正忙')); };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                if (abandoned || destroyed || !db.objectStoreNames.contains('images')) { db.close(); resolve(null); return; }
                db.onversionchange = () => { db.close(); database = undefined; };
                resolve(db);
            };
        }).catch(() => { database = undefined; return null; });
        return database;
    }
    async function read(id) {
        const db = await open();
        if (!db || destroyed) return null;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('images', 'readonly');
            const request = transaction.objectStore('images').get(id);
            transaction.oncomplete = () => resolve(request.result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        }).catch(() => null);
    }
    async function resolve(source, options = {}) {
        const value = zhikuImageUrl(source, { baseUrl, ...options });
        if (destroyed || !value) return { error: '图片地址不可用，或宿主已禁止该外部媒体。' };
        if (!value.startsWith('idb:')) return { url: value, release() {} };
        if (!urls.has(value)) {
            if (!pending.has(value)) pending.set(value, read(value).finally(() => pending.delete(value)));
            const blob = await pending.get(value);
            if (destroyed) return { error: '阅读器已关闭。' };
            if (!(blob instanceof Blob) || !IMAGE_TYPE.test(blob.type)) return { error: '此设备未找到这张智库图片，或图片格式不可用。' };
            if (!urls.has(value)) urls.set(value, { url: createUrl(blob), uses: 0 });
        }
        const entry = urls.get(value);
        entry.uses++;
        let released = false;
        return { url: entry.url, release() {
            if (released || destroyed) return;
            released = true;
            if (--entry.uses === 0) { revokeUrl(entry.url); urls.delete(value); }
        } };
    }
    function destroy() {
        destroyed = true;
        for (const entry of urls.values()) revokeUrl(entry.url);
        urls.clear();
        database?.then(db => db?.close());
    }
    return { resolve, destroy };
}
