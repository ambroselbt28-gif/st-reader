// ST Reader — AGPL-3.0
import { initFormatter, clearFormatterCache } from './formatter.js';
import { loadHostRuntime } from './hostRuntime.js';
import { toMessageModel } from './messageModel.js';
import { buildFloor, floorFault } from '../ui/floorToolbar.js';
import { createHtmlManager } from '../ui/htmlBlocks.js';

function assert(condition, message) { if (!condition) throw new Error(message); }
async function waitFor(read) {
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
        const result = read();
        if (result) return result;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('合成 HTML 沙箱未就绪');
}

/** 合成消息走正式楼层构建、HTML 接线与沙箱，不访问聊天接口。 */
export async function testHostRuntimeBrowser() {
    await initFormatter();
    const runtime = await loadHostRuntime(), originalLibs = runtime.libs;
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:white;';
    root.id = 'stcr-tt-runtime-test';
    const chat = document.createElement('div');
    root.append(chat);
    document.body.append(root);
    const manager = createHtmlManager({ scroller: root, chat,
        defaults: () => ({ mode: 'render', network: false, width: 390 }),
        rememberWidth() {}, prepare: html => html, toast() {},
    });
    const results = [];
    async function test(name, run) { await run(); results.push({ name, passed: true }); }
    let index = 0;
    function floor(text, reasoning = '') {
        clearFormatterCache();
        const model = toMessageModel({ name: '合成角色', mes: text, is_user: false, extra: { reasoning } }, index++);
        const names = { userName: '合成旅人', characterName: '合成角色', depth: 0, character: null };
        const handle = { total: index, getMessage: () => model, getRegexContext: () => names };
        const el = buildFloor({ handle, avatarFor: () => null, isReasoningOpen: () => false,
            isBookmarked: () => false, attachHtml: manager.attach }, model, 0);
        chat.replaceChildren(el);
        assert(!floorFault(el) && !el.classList.contains('stcr-mes--broken'), '楼层回退成了原样显示');
        return el;
    }
    async function checkHtml(text) {
        const el = floor(text), shell = el.querySelector('.stcr-html');
        assert(shell, 'HTML 块没有接上渲染器');
        const entry = await waitFor(() => manager.entryFor(shell)?.snapshot ? manager.entryFor(shell) : null);
        const html = await entry.snapshot();
        assert(html.includes('沙箱运行成功'), 'HTML 脚本没有执行');
        shell.querySelector('[data-html="source"]').click();
        assert(!el.querySelector('.stcr-html-src').classList.contains('stcr-html-src--hidden'), '原文切换失效');
        shell.querySelector('[data-html="render"]').click();
        assert(el.querySelector('.stcr-html-src').classList.contains('stcr-html-src--hidden'), '渲染切换失效');
    }
    const html = '<html><body><p id="result">等待运行</p><script>document.getElementById("result").textContent="沙箱运行成功"</script></body></html>';
    try {
        await test('TT 兼容：带语言的 HTML 围栏经正式楼层入口进入沙箱，脚本执行且原文切换可用', () => checkHtml('```html\n' + html + '\n```'));
        await test('TT 兼容：缺少 hljs 时 HTML 围栏仍能渲染和交互', async () => {
            runtime.libs = { ...originalLibs, hljs: undefined };
            await checkHtml('```html\n' + html + '\n```');
        });
        await test('TT 兼容：缺少 hljs 时普通代码、未知语言与思维链代码保留', () => {
            const el = floor('```javascript\nconst answer = 42;\n```\n\n```unknown\n合成代码\n```', '```javascript\nconst thought = 1;\n```');
            assert(el.querySelectorAll('.mes_text pre code').length === 2 && el.textContent.includes('const answer = 42;'), '普通代码丢失');
            assert(el.querySelector('.mes_reasoning pre code')?.textContent.includes('const thought = 1;'), '思维链代码丢失');
        });
        await test('TT 兼容：缺少 hljs 时裸 HTML 仍通过沙箱执行', () => checkHtml(html));
    } finally {
        runtime.libs = originalLibs;
        clearFormatterCache();
        manager.destroy();
        root.remove();
    }
    return results;
}
