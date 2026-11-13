import { assert } from './schema.mjs';
export const kinds = ['project', 'object', 'collection', 'task', 'view', 'bot', 'run', 'widget', 'session'];
export function uri(kind, id, { rev, anchor } = {}) { assert(kinds.includes(kind), 'Unknown resource kind'); assert(/^[A-Za-z0-9_.@-]{1,200}$/.test(id), 'Invalid resource ID'); return `lede://${kind}/${id}${rev ? '?rev=' + rev : ''}${anchor ? '#' + encodeURIComponent(anchor) : ''}`; }
export function parseURI(input) { assert(typeof input === 'string' && input.length < 1024, 'Invalid URI'); const raw = input.match(/^lede:\/\/([a-z]+)\/([^/?#]+)(?:\?[^#]*)?(?:#.*)?$/); assert(raw && !['.', '..'].includes(decodeURIComponent(raw[2])), 'Invalid canonical resource path'); let u; try {
    u = new URL(input);
}
catch {
    assert(false, 'Malformed URI');
} assert(u.protocol === 'lede:' && kinds.includes(u.hostname), 'Expected canonical lede:// resource URI'); assert(!u.username && !u.password && !u.port, 'URI authority is not a host'); const id = decodeURIComponent(u.pathname.slice(1)); assert(/^[A-Za-z0-9_.@-]{1,200}$/.test(id), 'Invalid resource path'); for (const k of u.searchParams.keys())
    assert(k === 'rev', 'Unknown URI option'); assert(u.searchParams.getAll('rev').length <= 1, 'Duplicate revision'); const rev = u.searchParams.has('rev') ? Number(u.searchParams.get('rev')) : undefined; assert(rev === undefined || (Number.isSafeInteger(rev) && rev > 0), 'Invalid revision'); return { kind: u.hostname, id, rev, anchor: u.hash ? decodeURIComponent(u.hash.slice(1)) : undefined }; }
export function toWebURL(resource, origin = '') { return `${origin}/#resource/${encodeURIComponent(resource)}`; }
