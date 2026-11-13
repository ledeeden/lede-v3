#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 16)) {
    console.error('Lede 需要 Node.js 22.16 或以上；当前版本：' + process.versions.node);
    process.exit(1);
}
const demo = process.argv.includes('--demo');
const { createApp } = await import('../server/index.mjs');
let app;
try {
    app = createApp({
        demo,
        home: process.env.LEDE_HOME || join(homedir(), demo ? '.lede-demo' : '.lede'),
        port: Number(process.env.PORT) || (demo ? 4218 : 4217)
    });
    const url = await app.listen();
    console.log(`\nLede v0.3 · 项目工作空间\n${url}\n数据目录：${app.s.home}\n${demo ? '演示资料，不是真实调研或正在运行的 Bot。' : '空白工作空间；先创建项目和配置模型。'}\n浏览器关闭后，本进程继续运行。Ctrl+C 安全停止。\n`);
    if (!process.argv.includes('--no-open') && process.platform === 'darwin') {
        spawn('open', [url], { stdio: 'ignore' }).on('error', () => console.log('请在浏览器打开上面的地址。'));
    }
}
catch (error) {
    console.error('启动失败：' + error.message);
    if (app)
        try {
            await app.close();
        }
        catch { }
    process.exit(1);
}
let closing = false;
async function stop() { if (closing)
    return; closing = true; await app.close(); process.exit(0); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
