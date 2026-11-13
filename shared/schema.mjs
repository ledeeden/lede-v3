/** Small, fail-closed JSON Schema subset. Used identically by API and plugins.
 * Supports type/properties/required/additionalProperties/items/enum/const/oneOf,
 * numeric and string bounds. Unsupported validation keywords are rejected on publish.
 */
export class AppError extends Error {
    constructor(message, status = 400, code = 'INVALID_INPUT', details) { super(message); this.status = status; this.code = code; this.details = details; }
}
export const assert = (condition, message, status = 400, code = 'INVALID_INPUT') => { if (!condition)
    throw new AppError(message, status, code); };
const blocked = new Set(['__proto__', 'prototype', 'constructor']);
export function safeJSON(text) { const value = JSON.parse(text); guard(value); return value; }
export function guard(v, depth = 0) { assert(depth <= 40, 'JSON nesting exceeds 40'); if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
        assert(!blocked.has(k), 'Unsafe property: ' + k);
        guard(v[k], depth + 1);
    }
} return v; }
export function validate(schema, value, path = '$') {
    const errors = [];
    const check = (s, v, p, depth) => {
        if (depth > 32) {
            errors.push(p + ': schema too deep');
            return;
        }
        if (s.oneOf) {
            if (s.oneOf.filter(x => validate(x, v).length === 0).length !== 1)
                errors.push(p + ': must match exactly one variant');
            return;
        }
        if (s.const !== undefined && JSON.stringify(v) !== JSON.stringify(s.const))
            errors.push(p + ': unexpected constant');
        if (s.enum && !s.enum.some(x => JSON.stringify(x) === JSON.stringify(v)))
            errors.push(p + ': expected ' + s.enum.join(', '));
        const types = Array.isArray(s.type) ? s.type : [s.type];
        if (s.type && !types.some(t => t === 'null' ? v === null : t === 'array' ? Array.isArray(v) : t === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : t === 'integer' ? Number.isInteger(v) : t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === t)) {
            errors.push(p + ': expected ' + types.join('|'));
            return;
        }
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            for (const k of s.required ?? [])
                if (!Object.hasOwn(v, k))
                    errors.push(`${p}.${k}: required`);
            for (const [k, x] of Object.entries(v)) {
                if (blocked.has(k)) {
                    errors.push(p + ': unsafe property');
                    continue;
                }
                if (s.properties?.[k])
                    check(s.properties[k], x, `${p}.${k}`, depth + 1);
                else if (s.additionalProperties === false)
                    errors.push(`${p}.${k}: unknown property`);
                else if (s.additionalProperties && typeof s.additionalProperties === 'object')
                    check(s.additionalProperties, x, `${p}.${k}`, depth + 1);
            }
        }
        if (Array.isArray(v)) {
            if (s.maxItems !== undefined && v.length > s.maxItems)
                errors.push(p + ': too many items');
            if (s.minItems !== undefined && v.length < s.minItems)
                errors.push(p + ': too few items');
            if (s.uniqueItems && new Set(v.map(x => JSON.stringify(x))).size !== v.length)
                errors.push(p + ': duplicate items');
            if (s.items)
                v.forEach((x, i) => check(s.items, x, `${p}[${i}]`, depth + 1));
        }
        if (typeof v === 'string') {
            if (s.maxLength !== undefined && v.length > s.maxLength)
                errors.push(p + ': too long');
            if (s.minLength !== undefined && v.length < s.minLength)
                errors.push(p + ': too short');
            if (s.pattern && !new RegExp(s.pattern, 'u').test(v))
                errors.push(p + ': format mismatch');
        }
        if (typeof v === 'number') {
            if (s.minimum !== undefined && v < s.minimum)
                errors.push(p + ': below minimum');
            if (s.maximum !== undefined && v > s.maximum)
                errors.push(p + ': above maximum');
        }
    };
    check(schema, value, path, 0);
    return errors;
}
export function ensure(schema, v) { guard(v); const errors = validate(schema, v); if (errors.length)
    throw new AppError(errors.join('; '), 400, 'SCHEMA_VALIDATION', errors); return v; }
const keywords = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'oneOf', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'title', 'description', 'default', '$schema']);
export function checkSchema(s, depth = 0) { assert(s && typeof s === 'object' && !Array.isArray(s), 'Invalid schema'); assert(depth < 20, 'Schema too deep'); for (const k of Object.keys(s))
    assert(keywords.has(k), 'Unsupported schema keyword: ' + k); if (s.pattern) {
    assert(s.pattern.length <= 160, 'Pattern too long');
    assert(!/[+*}]\)?[+*{]/.test(s.pattern), 'Nested repetition is not allowed');
    new RegExp(s.pattern, 'u');
} for (const x of Object.values(s.properties ?? {}))
    checkSchema(x, depth + 1); if (s.items)
    checkSchema(s.items, depth + 1); if (s.additionalProperties && typeof s.additionalProperties === 'object')
    checkSchema(s.additionalProperties, depth + 1); for (const x of s.oneOf ?? [])
    checkSchema(x, depth + 1); return s; }
export const objectSchema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const str = { type: 'string', maxLength: 20000 };
export const idSchema = { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,100}$' };
