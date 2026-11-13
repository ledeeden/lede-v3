// A standalone local test fixture. Production startup never imports this file.
import { createApp } from '../../server/index.mjs';
import { modelFixture } from './model-server.mjs';
const peer = await modelFixture(null, { respond: body => { if(body.messages[0]?.content.startsWith('长期记忆整理')) return {content:'{"changes":[]}'}; if (body.messages.at(-1)?.content === 'Respond with only OK.')
        return { content: 'OK' }; const snapshot = body.messages.findLast(m=>m.role==='user' && m.content.startsWith('<system-reminder>')); const context = JSON.parse(snapshot.content.split('\n\n')[1]); const called = name => body.messages.some(m => m.tool_calls?.some(c => c.function.name === name)); if (!called('knowledge__create'))
        return { tools: [{ name: 'knowledge__create', args: { title: '浏览器验收报告', category: 'report', content: '这是一条来自确定性 HTTP 测试提供方的集成测试产物，不是真实研究。' } }] }; if (!called('view__register'))
        return { tools: [{ name: 'view__register', args: { title: '浏览器验收视图', blocks: [{ id: 'report', type: 'table', dataSource: { kind: 'query', query: { kind: 'object', projectId: context.project.id } } }], mount: true } }] }; return { content: '测试工具已经保存报告并创建项目视图。' }; } });
const app = createApp({ home: process.env.TEST_HOME, port: 0, demo: true });
await app.listen();
console.log(JSON.stringify({ url: app.origin, providerConfig: peer.config }));
const stop = async () => { await app.close(); await peer.close(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
