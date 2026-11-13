export const api = { token: '', async call(path, data, method) { const res = await fetch('/api/' + path, { method: method ?? (data === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', 'X-Lede-Token': this.token }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) }); const value = await res.json(); if (!res.ok) {
        const error = new Error(value.error?.message || '请求失败');
        error.code = value.error?.code;
        throw error;
    } return value; }, async boot() { const b = await this.call('bootstrap'); this.token = b.token; return b; } };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const qs = (s, root = document) => root.querySelector(s);
export const qsa = (s, root = document) => [...root.querySelectorAll(s)];
export function toast(message, error = false) { const node = document.createElement('div'); node.className = 'toast' + (error ? ' error' : ''); node.textContent = message; document.querySelector('#toast-root').append(node); setTimeout(() => node.remove(), 6000); }
export async function action(fn) { try {
    return await fn();
}
catch (e) {
    toast(e.message, true);
    throw e;
} }
export const date = value => value ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
export const statusText = { queued: '排队', doing: '进行中', running: '执行中', review: '待审查', done: '已完成', succeeded: '已完成', blocked: '待处理', failed: '失败', canceled: '已停止', interrupted: '中断待恢复', waiting: '等待返回', waiting_input: '等你确认', idle: '空闲', active: '活跃', archived: '已归档', draft: '草稿', built: '已编译', previewed: '预览通过', registered: '已注册', disabled: '已停用', error: '校验失败', open: '待交回', delivered: '已返回', consumed: '已结算', abandoned: '已放弃', truncated: '输出截断' };
export function badge(state) { return `<span class="badge ${esc(state)}"><i></i>${esc(statusText[state] ?? state)}</span>`; }
export function icon(name, size = 16) { return `<img class="icon" alt="" aria-hidden="true" width="${size}" height="${size}" src="/public/assets/${name}.svg">`; }
export const resourceRoute = uri => '#resource/' + encodeURIComponent(uri);
export function md(text) {
    let s = esc(text);
    const inline = t => t.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => { const raw = url.replaceAll('&amp;', '&'); if (raw.startsWith('lede://'))
        return `<a href="${esc(resourceRoute(raw))}">${label}</a>`; if (/^https?:\/\//.test(raw))
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`; return label; });
    const lines = s.split('\n'), out = [];
    let code = false, codeLines = [], table = [];
    const flushTable = () => { if (!table.length)
        return; const rows = table.filter(x => !/^\|?[\s:|-]+\|?$/.test(x)); out.push('<div class="table-scroll"><table>' + rows.map((row, i) => '<tr>' + row.replace(/^\||\|$/g, '').split('|').map(c => `<${i ? 'td' : 'th'}>${inline(c.trim())}</${i ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table></div>'); table = []; };
    for (const line of lines) {
        if (line.startsWith('```')) {
            flushTable();
            if (code) {
                out.push('<pre><code>' + codeLines.join('\n') + '</code></pre>');
                codeLines = [];
            }
            code = !code;
            continue;
        }
        if (code) {
            codeLines.push(line);
            continue;
        }
        if (line.includes('|') && /^\s*\|/.test(line)) {
            table.push(line);
            continue;
        }
        flushTable();
        const h = line.match(/^(#{1,4})\s+(.*)/);
        if (h)
            out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
        else if (/^&gt;\s?/.test(line))
            out.push('<blockquote>' + inline(line.replace(/^&gt;\s?/, '')) + '</blockquote>');
        else if (/^[-*]\s/.test(line))
            out.push('<div class="md-list">• ' + inline(line.slice(2)) + '</div>');
        else if (line.trim())
            out.push('<p>' + inline(line) + '</p>');
    }
    flushTable();
    if (codeLines.length)
        out.push('<pre>' + codeLines.join('\n') + '</pre>');
    return out.join('');
}
export function download(name, value, type = 'application/json') { const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
