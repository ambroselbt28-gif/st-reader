// ST Reader — AGPL-3.0
import { createZhikuImageResolver } from './zhikuImages.js';
import { initFormatter, clearFormatterCache } from './formatter.js';
import { toMessageModel } from './messageModel.js';
import { buildFloor, fillFloor, floorFault } from '../ui/floorToolbar.js';
import { createZhikuImageManager } from '../ui/zhikuImages.js';
import { redactElement } from '../ui/redact.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function assert(value, message) { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
async function waitFor(read) {
    for (let attempt = 0; attempt < 125; attempt++) { if (read()) return; await pause(); }
    throw new Error('智库图片浏览器检查超时');
}
function requestResult(request) {
    return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

/** 全部数据库写入只用于唯一命名的合成样本，不打开用户的 zhiku_images 数据库。 */
export async function testZhikuImagesBrowser() {
    await initFormatter();
    const results = [], prefix = `stcr-t103-${crypto.randomUUID()}`, missing = prefix + '-missing';
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(prefix, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('images');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const bytes = Uint8Array.from(atob(PNG), character => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    await new Promise((resolve, reject) => {
        const transaction = db.transaction('images', 'readwrite');
        transaction.objectStore('images').put(blob, 'idb:fixture');
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    let reads = 0;
    const created = [], revoked = [], resources = [];
    const factory = { open(name) {
        assert(name === 'zhiku_images', '读取器打开了协议以外的数据库');
        reads++;
        return indexedDB.open(prefix);
    } };
    function resolver() {
        const instance = createZhikuImageResolver({ indexedDB: factory,
            createUrl(value) { const url = URL.createObjectURL(value); created.push(url); return url; },
            revokeUrl(url) { revoked.push(url); URL.revokeObjectURL(url); },
        });
        resources.push(instance);
        return instance;
    }
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;overflow:auto;background:white;z-index:2147483647;color:black';
    const chat = document.createElement('div');
    root.append(chat);
    document.body.append(root);
    const presences = [];
    const manager = createZhikuImageManager({ chat, scroller: root, enabled: false, resolver: resolver(), onPresence: value => presences.push(value) });
    const extraManagers = [];
    async function test(name, run) { await run(); results.push({ name, passed: true }); }
    try {
        await test('智库浏览器：缺失本地库时中止建库并显示原因', async () => {
            const empty = createZhikuImageResolver({ indexedDB: { open: () => indexedDB.open(missing) } });
            resources.push(empty);
            assert((await empty.resolve('idb:missing')).error.includes('此设备'), '缺失图片没有原因');
            empty.destroy();
            if (indexedDB.databases) assert(!(await indexedDB.databases()).some(item => item.name === missing), '阅读创建了一个空库');
        });
        await test('智库浏览器：同张本地图片共享对象地址，最后释放时回收', async () => {
            const shared = resolver();
            const [first, second] = await Promise.all([shared.resolve('idb:fixture'), shared.resolve('idb:fixture')]);
            assert(first.url === second.url && created.length === 1, '并行读取重复创建图片');
            first.release(); assert(revoked.length === 0, '提前回收仍在用的图片');
            second.release(); second.release();
            assert(revoked.length === 1, '释放未回收或重复回收');
            assert((await shared.resolve('idb:unknown')).error.includes('此设备'), '缺失记录没有占位原因');
            shared.destroy();
        });
        const block = document.createElement('div');
        block.innerHTML = '<div class="mes_text"><div class="pc-marker-slot"><button>生成图片</button><details><summary>提示词</summary></details></div></div>';
        const gallery = manager.attach(block, [{ kind: 'image', url: 'idb:fixture' }]);
        await test('智库浏览器：预建与隐藏状态不读图片，宿主生图控件隔离', async () => {
            const before = reads;
            await pause();
            assert(reads === before && !gallery.querySelector('img'), '未挂载楼层提前读取');
            chat.append(block); await pause();
            assert(gallery.hidden && reads === before && presences.at(-1) === true, '隐藏仍读取或按钮状态错误');
            assert(!block.querySelector('.pc-marker-slot,button'), '留下了宿主装饰器入口');
        });
        await test('智库浏览器：显示加载真实图片，隐藏清空地址，重新显示可恢复', async () => {
            manager.setEnabled(true);
            await waitFor(() => gallery.querySelector('img')?.naturalWidth === 1);
            const url = gallery.querySelector('img').src;
            manager.setEnabled(false);
            assert(gallery.hidden && !gallery.querySelector('img') && revoked.includes(url), '隐藏未回收图片');
            manager.setEnabled(true);
            await waitFor(() => gallery.querySelector('img')?.naturalWidth === 1);
            assert(gallery.querySelector('img').src !== url, '重新显示沿用了已释放的地址');
            block.remove(); await pause();
            assert(presences.at(-1) === false, '翻页移除后仍报告图片');
        });
        await test('智库浏览器：正式楼层入口跟随候选且原始聊天保持一致', async () => {
            const raw = { name: '合成角色', mes: '正文 image###one###', swipe_id: 0,
                swipes: ['正文 image###one###', '另一候选 image###two###'], extra: { zhikuImages: {
                    '0:3:image###one###': { url: 'idb:fixture' },
                    '1:5:image###two###': { url: `data:image/png;base64,${PNG}` },
                } } };
            const before = JSON.stringify(raw), model = toMessageModel(raw, 0);
            const ctx = { handle: { total: 1, getMessage: () => model,
                getRegexContext: () => ({ userName: '合成旅人', characterName: '合成角色', depth: 0, character: null }) },
                avatarFor: () => null, isReasoningOpen: () => false, isBookmarked: () => false,
                attachZhiku: manager.attach };
            clearFormatterCache();
            const floor = buildFloor(ctx, model, 0);
            assert(!floorFault(floor) && floor.querySelector('.stcr-zhiku-gallery'), '正式入口未展示图片');
            chat.replaceChildren(floor);
            await waitFor(() => floor.querySelector('.stcr-zhiku-gallery img')?.naturalWidth === 1);
            const old = floor.querySelector('.stcr-zhiku-gallery img').src;
            fillFloor(ctx, floor, model, 1);
            await waitFor(() => floor.querySelector('.stcr-zhiku-gallery img')?.naturalWidth === 1);
            assert(floor.dataset.swipe === '1' && floor.querySelector('.stcr-zhiku-gallery img').src.startsWith('data:'), '候选图片串台');
            assert(revoked.includes(old) && JSON.stringify(raw) === before, '旧图片未释放或宿主记录被修改');
            assert(!floor.querySelector('.mes_text .stcr-zhiku-gallery'), '图片改变了正文字锚点');
            floor.remove(); await pause();
        });
        await test('智库浏览器：漫画对白用文本展示并应用脱敏', async () => {
            const container = document.createElement('div');
            const captions = manager.attach(container, [{ kind: 'comic', page: 1, url: 'idb:fixture', caption: '合成秘密 <script>执行()</script>' }], {
                prepareText: element => redactElement(element, { words: ['合成秘密'], rules: [], assets: new Map(), avatarUrl: null }),
            });
            chat.append(container); await pause();
            assert(!captions.querySelector('script') && !captions.innerText.includes('合成秘密') && captions.innerText.includes('<script>'), '对白未安全显示或脱敏失败');
            container.remove(); await pause();
        });
        await test('智库浏览器：画师库插入聊天的本地图片经正式入口显示', async () => {
            const raw = { name: '合成角色', mes: '<img src="idb:fixture" class="pc-chat-img" alt="画师库生成">' };
            const model = toMessageModel(raw, 0);
            const floor = buildFloor({ handle: { total: 1, getMessage: () => model,
                getRegexContext: () => ({ character: null, characterName: '合成角色', userName: '合成旅人', depth: 0 }) },
                avatarFor: () => null, isReasoningOpen: () => false, isBookmarked: () => false, attachZhiku: manager.attach }, model, 0);
            assert(!floorFault(floor) && !floor.querySelector('.mes_text img'), '原始图片残留或格式化失败');
            chat.replaceChildren(floor);
            await waitFor(() => floor.querySelector('.stcr-zhiku-gallery img')?.naturalWidth === 1);
            floor.remove(); await pause();
        });
        await test('智库浏览器：已移除楼层的迟到图片不能重新挂载', async () => {
            let finish, releases = 0;
            const waiting = new Promise(resolve => { finish = resolve; });
            const delayed = createZhikuImageManager({ chat, scroller: root, resolver: { resolve: () => waiting, destroy() {} } });
            extraManagers.push(delayed);
            const container = document.createElement('div');
            const delayedGallery = delayed.attach(container, [{ kind: 'image', url: 'idb:delayed' }]);
            chat.append(container);
            await waitFor(() => delayedGallery.textContent.includes('正在读取'));
            container.remove(); await pause();
            finish({ url: `data:image/png;base64,${PNG}`, release() { releases++; } });
            await pause();
            assert(!delayedGallery.querySelector('img') && releases === 1, '迟到图片挂入了旧候选或泄漏地址');
            delayed.destroy();
        });
        await test('智库浏览器：禁止外部媒体时只显示原因，关闭会话回收全部地址', async () => {
            const container = document.createElement('div');
            const blocked = manager.attach(container, [{ kind: 'image', url: 'https://external.invalid/image.png' }]);
            chat.append(container);
            await waitFor(() => blocked.textContent.includes('宿主已禁止'));
            assert(!blocked.querySelector('img'), '禁止地址仍触发请求');
            manager.destroy();
            assert(created.every(url => revoked.includes(url)), '关闭后仍保留对象地址');
        });
    } finally {
        manager.destroy();
        for (const instance of extraManagers) instance.destroy();
        for (const instance of resources) instance.destroy();
        root.remove();
        clearFormatterCache();
        await requestResult(indexedDB.deleteDatabase(prefix));
        await requestResult(indexedDB.deleteDatabase(missing));
    }
    return results;
}
