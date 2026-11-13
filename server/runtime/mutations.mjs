import { assert } from '../../shared/schema.mjs';
import { hash, now } from '../db.mjs';
// Synchronous local mutations and their receipts commit together. No external IO.
export function mutate(s, caller, context, requestId, payload, fn) {
    if (!requestId)
        return fn();
    assert(typeof requestId === 'string' && requestId.length <= 200, 'request_id 无效');
    return s.transaction(() => {
        const key = 'mutation_' + hash([caller, context, requestId]), fingerprint = hash(payload), old = s.get('SELECT * FROM requests WHERE key=?', key);
        if (old) {
            assert(old.fingerprint === fingerprint, 'request_id 已用于不同内容', 409, 'REQUEST_CONFLICT');
            assert(old.state === 'completed', '请求结果不确定', 409, 'OUTCOME_UNKNOWN');
            return JSON.parse(old.receipt);
        }
        const result = fn();
        s.run('INSERT INTO requests VALUES(?,?,?,?,?)', key, fingerprint, 'completed', JSON.stringify(result), now());
        return result;
    });
}
