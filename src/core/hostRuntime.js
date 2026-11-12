// ST Reader — AGPL-3.0
let runtimePromise;
/** TT 将高亮库移到可选包；只补齐阅读器副本，不修改宿主的 libs。 */
export async function loadHostLibraries(libs, loadLibrary = () => import('/lib.js')) {
    if (libs.hljs) return libs;
    try {
        const library = await loadLibrary();
        const hljs = library.hljs ?? await library.getHljs?.();
        return { ...libs, hljs };
    } catch (error) {
        console.warn('[st-reader] 代码高亮库加载失败，继续显示代码与 HTML：', error);
        return libs;
    }
}

/** 只在浏览器请求时读取宿主公开模块；Node 纯逻辑测试不载入 ST。 */
export function loadHostRuntime() {
    runtimePromise ??= Promise.all([
        import('/scripts/extensions/regex/engine.js'), import('/script.js'), import('/scripts/chats.js'),
        import('/scripts/showdown-underscore.js'), import('/scripts/power-user.js'),
    ]).then(async ([regex, script, chats, underscore, power]) => ({ regex, script, chats, underscore, power,
        libs: await loadHostLibraries(globalThis.SillyTavern.libs), getContext: () => globalThis.SillyTavern.getContext() }))
        .catch(error => { runtimePromise = undefined; throw error; });
    return runtimePromise;
}
