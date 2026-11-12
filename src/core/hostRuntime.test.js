// ST Reader — AGPL-3.0
import { loadHostLibraries } from './hostRuntime.js';

function assert(condition, message) { if (!condition) throw new Error(message); }

/** 使用合成库对象验证 ST 与 TT 的接口差异，不读取聊天或请求网络。 */
export async function testHostRuntimeLogic() {
    const results = [];
    async function test(name, run) { await run(); results.push({ name, passed: true }); }
    const hljs = Object.freeze({ getLanguage() { return true; }, highlight() { return { value: '高亮' }; } });
    await test('宿主库：ST 自带 hljs 时不加载额外模块', async () => {
        const libs = Object.freeze({ hljs });
        const result = await loadHostLibraries(libs, () => { throw new Error('不应调用'); });
        assert(result === libs, '应直接复用 ST 库对象');
    });
    await test('宿主库：TT 的 getHljs 完成后才交付，宿主对象保持原样', async () => {
        const libs = Object.freeze({ showdown: {} });
        let finish;
        const pending = loadHostLibraries(libs, async () => ({ getHljs: () => new Promise(resolve => { finish = resolve; }) }));
        await Promise.resolve();
        finish(hljs);
        const result = await pending;
        assert(result.hljs === hljs && result.showdown === libs.showdown, 'TT 可选高亮库没有补齐');
        assert(!('hljs' in libs), '写入了宿主库对象');
    });
    await test('宿主库：兼容 lib.js 直接导出 hljs 的版本', async () => {
        const result = await loadHostLibraries({}, async () => ({ hljs, getHljs() { throw new Error('不应调用'); } }));
        assert(result.hljs === hljs, '没有使用直接导出的高亮库');
    });
    await test('宿主库：精简宿主缺少高亮接口时仍可初始化', async () => {
        const result = await loadHostLibraries({}, async () => ({}));
        assert(result.hljs === undefined, '应允许没有代码高亮');
    });
    await test('宿主库：可选包加载失败时保留正文依赖', async () => {
        const libs = Object.freeze({ showdown: {}, DOMPurify: {} });
        const warn = console.warn, warnings = [];
        console.warn = (...args) => warnings.push(args);
        try {
            const result = await loadHostLibraries(libs, async () => ({ getHljs: async () => { throw new Error('合成加载失败'); } }));
            assert(result === libs && warnings.length === 1, '可选高亮失败应保留正文依赖并记录原因');
        } finally { console.warn = warn; }
    });
    return results;
}
