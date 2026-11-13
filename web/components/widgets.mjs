import {catalogBlock} from './catalog.mjs';
import {assetURL} from '../media.mjs';
import { api, esc, icon, md, badge, date, resourceRoute } from '../api.mjs';
export const sandboxCleanups = new Set();
export function clearSandboxes() { for (const fn of sandboxCleanups)
    fn(); sandboxCleanups.clear(); }
export function sandbox(host, { widget, props = {}, data, context, state = {}, onState = () => { }, onReady = () => { }, onError = () => { }, onSelect = () => { } }) {
    const frame = document.createElement('iframe');
    frame.className = 'sandbox-frame';
    frame.title = widget.manifest.name;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.src = '/sandbox.html';
    const nonce = crypto.randomUUID();
    let timer = setTimeout(() => onError('沙箱未在 10 秒内完成挂载'), 10000), loads = 0, ready = false;
    const dispose = () => { clearTimeout(timer); window.removeEventListener('message', listener); frame.remove(); };
    frame.addEventListener('load', () => { loads++; if (loads > 1) {
        dispose();
        onError('插件尝试导航，已卸载');
    } });
    const listener = event => { if (event.source !== frame.contentWindow)
        return; const m = event.data; if (m?.type === 'lede:sandbox-ready') {
        frame.contentWindow.postMessage({ type: 'lede:init', nonce, code: widget.compiled, props, data, context, state }, '*');
        return;
    } if (!m?.lede || m.nonce !== nonce)
        return; if (m.type === 'ready') {
        clearTimeout(timer);
        ready = true;
        onReady();
    } if (m.type === 'resize' || m.type === 'ready')
        frame.style.height = Math.min(1000, Math.max(160, Number(m.data?.height) || 280)) + 'px'; if (m.type === 'state' && widget.manifest.capabilities.includes('state'))
        onState(m.data); if (m.type === 'selection' && widget.manifest.capabilities.includes('selection'))
        onSelect(m.data); if (m.type === 'error') {
        clearTimeout(timer);
        onError(m.data?.message ?? 'Widget error');
    } };
    window.addEventListener('message', listener);
    host.replaceChildren(frame);
    sandboxCleanups.add(dispose);
    return dispose;
}
export function blockHTML(block) {
    const builtin=catalogBlock(block);if(builtin!==null)return builtin;
    const props = block.props ?? {}, data = block.resolvedData ?? block.data ?? [], rows = Array.isArray(data) ? data : [data];
    if (block.type === 'media') { const x=rows[0];return x?.asset ? `<a href="${resourceRoute(x.uri)}">${x.asset.mime.startsWith('image/')?`<img class="media-thumbnail" src="${assetURL(x.asset)}" alt="${esc(x.title)}">`:`<span>${esc(x.title)} · ${esc(x.asset.mime)}</span>`}</a>` : '<p>原件不可用</p>'; }
    if (block.type === 'markdown')
        return `<div class="markdown">${md(props.text ?? (typeof data === 'string' ? data : data.content ?? ''))}</div>`;
    if (block.type === 'metric')
        return `<div class="muted small">${esc(props.label ?? block.title ?? '指标')}</div><div class="metric-widget">${esc(props.value ?? rows.length)}</div><div class="muted small">${esc(props.caption ?? '')}</div>`;
    if (block.type === 'table') {
        const cols = props.columns ?? [{ key: 'title', label: '标题' }, { key: 'category', label: '类型' }];
        return `<div class="table-scroll"><table><thead><tr>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row, i) => `<tr class="clickable" data-select-row="${i}" tabindex="0">${cols.map(c => `<td>${esc(row?.[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    if (block.type === 'tasks')
        return rows.length ? rows.map(task => `<div class="list-line"><button class="ghost grow" data-task="${esc(task.id)}" style="justify-content:flex-start">${esc(task.title)}</button>${badge(task.state)}</div>`).join('') : '<div class="empty">暂无任务</div>';
    if (block.type === 'cards')
        return `<div class="grid2">${rows.map((row, i) => `<button class="card stack" data-select-row="${i}" style="align-items:flex-start"><strong>${esc(row.title ?? row.name ?? '')}</strong><span class="small secondary">${esc(row.description ?? row.summary?.abstract ?? row.content?.slice(0, 150) ?? '')}</span></button>`).join('')}</div>`;
    if (block.type === 'chart') {
        const labels = props.labels ?? rows.map(x => x.label ?? x.title), values = props.values ?? rows.map(x => Number(x.value ?? 0));
        const max = Math.max(1, ...values);
        return `<div class="chart-bars">${labels.map((label, i) => `<button class="bar-item ghost" data-select-row="${i}"><span>${esc(values[i])}</span><div class="bar" style="height:${Math.max(2, (values[i] ?? 0) / max * 145)}px"></div><span>${esc(label)}</span></button>`).join('')}</div>`;
    }
    if (block.type === 'timeline')
        return rows.map(row => `<div class="timeline-item"><small>${date(row.updatedAt ?? row.createdAt)}</small><p>${esc(row.title)}</p><span class="small secondary">${esc(row.state ?? row.description ?? '')}</span></div>`).join('');
    if (block.type === 'relations')
        return rows.map(row => `<div class="relation-row"><small>${esc(row.type ?? 'related_to')}</small>${esc(row.sourceResource?.title ?? row.source ?? row.title ?? '')} → ${esc(row.targetResource?.title ?? row.target ?? '')}</div>`).join('');
    if (block.type.startsWith('widget:'))
        return '<div class="sandbox-host"><div class="empty">加载沙箱…</div></div>';
    return `<div class="empty">不支持组件：${esc(block.type)}</div>`;
}
export async function wireBlocks(root, { view, blocks, onSelect, onTask, onMove }) {
    for (const block of blocks) {
        const el = root.querySelector(`[data-block="${CSS.escape(block.id)}"]`);
        if (!el)
            continue;
        const rows = Array.isArray(block.resolvedData) ? block.resolvedData : [block.resolvedData];
        for (const btn of el.querySelectorAll('[data-select-row]')) {
            const select = () => { const row = rows[Number(btn.dataset.selectRow)]; onSelect({ viewId: view.id, blockId: block.id, resourceIds: row?.id ? [row.id] : [], key: String(btn.dataset.selectRow), excerpt: JSON.stringify(row ?? block.props).slice(0, 1000) }); };
            btn.addEventListener('click', select);
            btn.addEventListener('keydown', e => { if (e.key === 'Enter')
                select(); });
        }
        for (const btn of el.querySelectorAll('[data-task]'))
            btn.addEventListener('click', () => onTask(btn.dataset.task));
        if (block.type.startsWith('widget:'))
            try {
                const w = await api.call('widget?key=' + encodeURIComponent(block.type.slice(7)));
                if (w.state !== 'registered')
                    throw Error('插件已停用或尚未注册');
                if (!el.isConnected)
                    continue;
                sandbox(el.querySelector('.sandbox-host'), { widget: w, props: block.props, data: block.resolvedData, context: { viewId: view.id, blockId: block.id }, state: block.localState ?? {}, onState: state => api.call('view/state', { viewId: view.id, blockId: block.id, data: state }).catch(error => onSelect({ viewId: view.id, blockId: block.id, excerpt: '插件交互状态保存失败：' + error.message })), onSelect: s => onSelect({ viewId: view.id, blockId: block.id, ...s }), onError: message => { el.querySelector('.sandbox-host').innerHTML = `<div class="sandbox-error">${esc(message)}</div>`; } });
            }
            catch (e) {
                el.querySelector('.sandbox-host').innerHTML = `<div class="sandbox-error">${esc(e.message)}</div>`;
            }
        if (onMove) {
            const handle = el.querySelector('.drag-handle');
            handle?.addEventListener('pointerdown', e => { if (e.target.closest('button'))
                return; handle.setPointerCapture(e.pointerId); const start = { x: e.clientX, y: e.clientY, left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0 }; const move = ev => { el.style.left = Math.max(0, start.left + ev.clientX - start.x) + 'px'; el.style.top = Math.max(0, start.top + ev.clientY - start.y) + 'px'; }; const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); onMove(block.id, { x: parseInt(el.style.left), y: parseInt(el.style.top) }); }; handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); });
        }
    }
}
