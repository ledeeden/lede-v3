import { openSync, readFileSync, writeFileSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
/** Single local writer. PID + nonce keeps an old process from deleting a new lock. */
export function acquireHomeLock(home) {
    const file = join(home, '.runtime.lock'), nonce = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = openSync(file, 'wx', 0o600);
            writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce, startedAt: new Date().toISOString() }));
            closeSync(fd);
            return () => { try {
                if (JSON.parse(readFileSync(file, 'utf8')).nonce === nonce)
                    unlinkSync(file);
            }
            catch { } };
        }
        catch (e) {
            if (e.code !== 'EEXIST')
                throw e;
            let old;
            try {
                old = JSON.parse(readFileSync(file, 'utf8'));
            }
            catch {
                throw new Error('工作空间锁无法读取。确认没有其他 Lede 进程后再检查 .runtime.lock。');
            }
            let alive = true;
            try {
                process.kill(old.pid, 0);
            }
            catch (err) {
                if (err.code === 'ESRCH')
                    alive = false;
            }
            if (alive)
                throw new Error(`此工作空间已被进程 ${old.pid} 打开。请停止该进程或使用不同 LEDE_HOME。`);
            // Re-read before removing a stale lock to reduce replacement races.
            if (JSON.parse(readFileSync(file, 'utf8')).nonce === old.nonce)
                unlinkSync(file);
        }
    }
    throw new Error('无法获取工作空间锁，请重试。');
}
