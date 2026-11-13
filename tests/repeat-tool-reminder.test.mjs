import test from 'node:test';
import assert from 'node:assert/strict';
import { RepeatToolReminder } from '../server/runtime/repeat-tool-reminder.mjs';
test('Repeat reminders canonicalize nested arguments, isolate sessions and reset on changed calls', () => {
    const guard = new RepeatToolReminder();
    assert.equal(guard.observe('a', 'read', '{"b":2,"a":{"y":1,"x":0}}'), null);
    assert.equal(guard.observe('a', 'read', '{"a":{"x":0,"y":1},"b":2}'), null);
    assert.equal(guard.observe('b', 'read', '{"b":2,"a":{"y":1,"x":0}}'), null);
    assert.equal(guard.observe('a', 'read', '{"b":2,"a":{"y":1,"x":0}}').source.count, 3);
    assert.equal(guard.observe('a', 'write', '{}'), null);
    assert.equal(guard.observe('a', 'read', '{}'), null);
    guard.reset('a');
    assert.equal(guard.observe('a', 'read', '{}'), null);
});
test('Malformed arguments can be counted and reminders stop after the final threshold', () => {
    const guard = new RepeatToolReminder();
    const counts = [];
    for (let i = 0; i < 12; i++) {
        const reminder = guard.observe('a', 'unknown', '{bad');
        if (reminder) counts.push(reminder.source.count);
    }
    assert.deepEqual(counts, [3, 5, 8]);
});
