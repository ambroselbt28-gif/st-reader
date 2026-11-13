// ST Reader — AGPL-3.0
import { createZhikuImageResolver } from '../core/zhikuImages.js';
import { h } from './dom.js';

/** 每个阅读器会话管理自己的图片。预建楼层挂载后才进入懒加载队列。 */
export function createZhikuImageManager({ chat, scroller, enabled = true, onPresence = () => {}, resolver = createZhikuImageResolver() }) {
    const descriptions = new WeakMap(), live = new Map();
    let destroyed = false, queued = false, present = false;
    const observer = new IntersectionObserver(records => {
        for (const record of records) if (record.isIntersecting) {
            const entry = live.get(record.target);
            if (entry && enabled) void start(entry);
        }
    }, { root: scroller, rootMargin: '300px 0px' });
    const changes = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => { queued = false; if (!destroyed) sync(); });
    });
    changes.observe(chat, { childList: true, subtree: true });

    function attach(block, images, { allowExternal = false, prepareText } = {}) {
        // 智库的原生装饰器按 mesid 找 DOM；阅读器使用自有类名隔离它的生成控件。
        for (const image of block.querySelectorAll('img.pc-chat-img,img.custom-pc-chat-img,img[alt="画师库生成"]')) image.remove();
        for (const element of block.querySelectorAll('.pc-marker-slot,.custom-pc-marker-slot,.pc-chat-img,.custom-pc-chat-img')) {
            element.classList.remove('pc-marker-slot', 'custom-pc-marker-slot', 'pc-chat-img', 'custom-pc-chat-img');
            element.classList.add('stcr-zhiku-source');
            for (const button of element.querySelectorAll('button')) button.remove();
        }
        if (!images?.length) return null;
        const gallery = h('div', { class: 'stcr-zhiku-gallery', 'aria-label': '智库已生成图片' });
        const entries = images.map(image => {
            const title = image.kind === 'comic' ? `智库漫画 · 第 ${image.page} 页` : '智库插图';
            const slot = h('div', { class: 'stcr-zhiku-slot', role: 'status', text: '等待显示图片…' });
            const figure = h('figure', { class: 'stcr-zhiku-picture' }, slot, h('figcaption', { text: title }));
            if (image.caption) figure.append(h('p', { class: 'stcr-zhiku-caption', text: image.caption }));
            gallery.append(figure);
            return { figure, slot, image, title, allowExternal, token: 0, busy: false, failed: false, resource: null };
        });
        prepareText?.(gallery);
        gallery.setAttribute('data-stcr-ignore-anchor', '');
        gallery.hidden = !enabled;
        descriptions.set(gallery, entries);
        block.append(gallery);
        return gallery;
    }
    function sync() {
        for (const [figure, entry] of live) if (!chat.contains(figure)) {
            observer.unobserve(figure);
            clear(entry);
            live.delete(figure);
        }
        for (const gallery of chat.querySelectorAll('.stcr-zhiku-gallery')) {
            gallery.hidden = !enabled;
            for (const entry of descriptions.get(gallery) ?? []) if (!live.has(entry.figure)) {
                live.set(entry.figure, entry);
                if (enabled) observer.observe(entry.figure);
            }
        }
        const next = live.size > 0;
        if (next !== present) { present = next; onPresence(next); }
    }
    function clear(entry) {
        entry.token++;
        entry.busy = entry.failed = false;
        entry.slot.querySelector('img')?.removeAttribute('src');
        entry.slot.replaceChildren();
        entry.resource?.release();
        entry.resource = null;
    }
    async function start(entry) {
        if (destroyed || !enabled || entry.busy || entry.resource || entry.failed) return;
        entry.busy = true;
        const token = ++entry.token;
        entry.slot.textContent = '正在读取图片…';
        let resource;
        try { resource = await resolver.resolve(entry.image.url, { allowExternal: entry.allowExternal }); }
        catch { resource = { error: '暂时无法读取这张智库图片。' }; }
        if (destroyed || !enabled || token !== entry.token || !chat.contains(entry.figure)) { resource.release?.(); return; }
        entry.busy = false;
        if (resource.error) { entry.failed = true; entry.slot.textContent = resource.error; return; }
        entry.resource = resource;
        const img = h('img', { alt: entry.title, decoding: 'async', referrerpolicy: 'no-referrer' });
        img.addEventListener('error', () => {
            if (token !== entry.token || destroyed) return;
            resource.release();
            entry.resource = null;
            entry.failed = true;
            entry.slot.textContent = '图片加载失败，原图片可能已被移除。';
        }, { once: true });
        entry.slot.replaceChildren(img);
        img.src = resource.url;
    }
    function setEnabled(value) {
        value = !!value;
        if (value === enabled) return;
        enabled = value;
        for (const entry of live.values()) {
            observer.unobserve(entry.figure);
            if (!enabled) clear(entry); else observer.observe(entry.figure);
        }
        for (const gallery of chat.querySelectorAll('.stcr-zhiku-gallery')) gallery.hidden = !enabled;
    }
    function destroy() {
        destroyed = true;
        changes.disconnect();
        observer.disconnect();
        for (const entry of live.values()) clear(entry);
        live.clear();
        resolver.destroy();
    }
    return { attach, setEnabled, destroy };
}
