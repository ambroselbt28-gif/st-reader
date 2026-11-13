// ST Reader — AGPL-3.0
import { readZhikuImages, zhikuImageUrl, createZhikuImageResolver } from './zhikuImages.js';
import { toMessageModel } from './messageModel.js';
import { normalizePrefs } from '../ui/logic.js';

function assert(value, message = '断言失败') { if (!value) throw new Error(message); }
function equal(left, right) { assert(JSON.stringify(left) === JSON.stringify(right), `${JSON.stringify(left)} ≠ ${JSON.stringify(right)}`); }
export async function testZhikuImagesLogic() {
    const results = [];
    async function test(name, run) { await run(); results.push({ name, passed: true }); }
    await test('智库：当前正文权威、按候选读取插图，不改宿主数据', () => {
        const raw = { mes: '新正文 image###one:人物###', swipe_id: 0, swipes: ['旧正文', 'image###two###'], extra: { zhikuImages: {
            '0:5:image###one:人物###': { url: 'idb:first' }, '1:0:image###two###': { url: '/user/images/second.png' },
        } } };
        const before = JSON.stringify(raw), model = toMessageModel(raw, 0);
        equal(model.swipes.map(s => s.zhikuImages.map(image => image.url)), [['idb:first'], ['/user/images/second.png']]);
        equal(JSON.stringify(raw), before);
        assert(Object.isFrozen(model.swipes[0].zhikuImages[0]));
        assert(!Object.isFrozen(raw.extra.zhikuImages));
    });
    await test('智库：重复标记顺序对应，删除、旧候选和失去正文引用的图片不显示', () => {
        const raw = { extra: { zhikuImages: {
            '0:0:image###a###': { deleted: true, url: 'idb:deleted' },
            '0:20:image###a###': { url: 'idb:kept', versions: [{ url: 'idb:old' }] },
            '0:40:image###removed###': { url: 'idb:orphan' },
            '1:1:image###a###': { url: 'idb:other' }, bad: { url: 'idb:bad' },
        } } };
        equal(readZhikuImages(raw, 0, 'image###a### image###a###').map(item => item.url), ['idb:kept']);
    });
    await test('智库：旧消息和空、损坏记录正常退化', () => {
        equal(readZhikuImages({}, 0, ''), []);
        equal(readZhikuImages({ extra: { zhikuImages: { '0:0:x': null } } }, 0, 'x'), []);
        equal(toMessageModel({ mes: '普通正文' }, 0).swipes[0].zhikuImages, []);
    });
    await test('智库：标记位置精确匹配优先，移动后的图片按当前正文顺序显示', () => {
        const raw = { extra: { zhikuImages: {
            '0:0:image###a###': { url: 'idb:old' }, '0:15:image###a###': { url: 'idb:current' },
            '0:100:image###b###': { url: 'idb:moved' },
        } } };
        equal(readZhikuImages(raw, 0, 'image###b###   image###a###').map(item => item.url), ['idb:moved', 'idb:current']);
    });
    await test('智库：画师库直接插入的图片按候选解析，支持属性顺序和查询参数', () => {
        const text = `<img alt="画师库生成" src="/user/images/a.png?x=1&amp;y=2"><img src='idb:direct' class='pc-chat-img'><img src=/images/custom.png class=custom-pc-chat-img><img src="/images/ordinary.png">`;
        equal(readZhikuImages({}, 0, text).map(item => item.url), ['/user/images/a.png?x=1&y=2', 'idb:direct', '/images/custom.png']);
    });
    await test('智库漫画：正文页键与当前图片版本，叠字按文本保留', () => {
        const raw = { extra: { zhikuComic: { mh6ay8: { cur: 0, versions: [
            { url: 'idb:one', textMode: 'overlay', captions: { pageTexts: ['标题'], panelTexts: [['一句对白'], ['<b>原样文本</b>']] } },
            { url: 'idb:two' },
        ] } } } };
        const images = readZhikuImages(raw, 0, '<image> @page   one </image>');
        equal(images[0], { kind: 'comic', page: 1, url: 'idb:one', caption: '标题\n一句对白\n<b>原样文本</b>' });
    });
    await test('智库漫画：extra 来源按候选分开，正文页优先', () => {
        const raw = { extra: { zhikuComicSrc: { 0: '<image>@page one</image>', 1: '<image>@page two</image>' },
            zhikuComic: { mh6ay8: { versions: [{ url: 'idb:one' }] }, c7t99i: { versions: [{ url: 'idb:two' }] } } } };
        equal(readZhikuImages(raw, 1, '正文')[0].url, 'idb:two');
        equal(readZhikuImages(raw, 1, '<image>@page one</image>')[0].url, 'idb:one');
    });
    const baseUrl = 'https://tavern.invalid/index.html';
    const source = (url, allowExternal = false) => zhikuImageUrl(url, { baseUrl, allowExternal });
    await test('智库地址：支持同源图片路径、内嵌图片、本地库与同源 blob', () => {
        equal(source('/user/images/a.png'), 'https://tavern.invalid/user/images/a.png');
        equal(source('user/files/a.png'), 'https://tavern.invalid/user/files/a.png');
        equal(source('idb:abc123'), 'idb:abc123');
        assert(source('data:image/png;base64,AAAA'));
        assert(source('blob:https://tavern.invalid/abc'));
    });
    await test('智库地址：拒绝写接口、带凭据网址、脚本、外部 blob、SVG 与越出媒体目录的路径', () => {
        for (const value of ['/api/example', '/images/../../api/test', 'javascript:alert(1)', 'data:text/html;base64,AAAA',
            'data:image/svg+xml;base64,AAAA', 'blob:https://other.invalid/a', 'https://name:pass@other.invalid/a.png']) equal(source(value, true), null);
    });
    await test('智库地址：外链沿用宿主允许状态，跨站 HTTP 始终关闭', () => {
        equal(source('https://other.invalid/a.png'), null);
        equal(source('https://other.invalid/a.png', true), 'https://other.invalid/a.png');
        equal(source('http://other.invalid/a.png', true), null);
        equal(zhikuImageUrl('javascript:/images/a.png', { baseUrl: 'tauri://localhost/' }), null);
        equal(zhikuImageUrl('tauri://other/images/a.png', { baseUrl: 'tauri://localhost/' }), null);
        equal(zhikuImageUrl('/images/a.png', { baseUrl: 'tauri://localhost/' }), 'tauri://localhost/images/a.png');
    });
    await test('智库解析器：直接图片地址不打开数据库，关闭后不再交付图片', async () => {
        const resolver = createZhikuImageResolver({ indexedDB: { open() { throw new Error('不应打开'); } }, baseUrl });
        const resource = await resolver.resolve('/images/a.png');
        assert(resource.url.endsWith('/a.png'));
        resource.release(); resolver.destroy();
        assert((await resolver.resolve('/images/a.png')).error);
    });
    await test('智库设置：默认显示，隐藏选择保留，旧设置与坏值兼容', () => {
        equal(normalizePrefs({}).showZhikuImages, true);
        equal(normalizePrefs({ showZhikuImages: false }).showZhikuImages, false);
        equal(normalizePrefs({ showZhikuImages: 'false' }).showZhikuImages, true);
    });
    return results;
}
