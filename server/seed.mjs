/** Demonstration content is visibly marked; no invented live model calls or network research. */
export const funnelSource = `export default function mount(root, props, sdk) {
  const rows = props.rows || [{ label: '曝光', value: 3200 }, { label: '试用', value: 412 }, { label: '付费', value: 23 }];
  const max = Math.max(1, ...rows.map(r => r.value));
  root.append(h('h3', {}, props.title || '转化漏斗'));
  root.append(h('p', {style: {color: '#686c74', fontSize: '12px'}}, '点击某一阶段，把数据交给负责人。'));
  for (const [i, row] of rows.entries()) {
    const btn = h('button', {style:{width:'100%',display:'flex',justifyContent:'space-between',gap:'16px',padding:'14px 16px',marginTop:'9px',border:'1px solid #2d3036',background:'#1b1d21',borderRadius:'9px',color:'#ecedef',cursor:'pointer'}, onclick: () => sdk.select({key: row.label, resourceIds: row.resourceId ? [row.resourceId] : [], excerpt: row.label + ': ' + row.value})}, row.label, h('strong', {}, String(row.value)));
    root.append(btn);
    root.append(h('div', {style:{height:'3px',width:Math.max(8,row.value/max*100)+'%',background:i===2?'#8fceaf':'#9db8ff',borderRadius:'4px'}}));
  }
  return () => root.replaceChildren();
}`;
export const funnelManifest = { id: 'research.funnel', version: '1.0.0', name: '转化漏斗', description: '用可选中的阶段数据查看转化落差。支持 selection/context。', entry: 'index.tsx', propsSchema: { type: 'object', properties: { title: { type: 'string', default: '转化漏斗' }, rows: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' }, resourceId: { type: 'string' } }, required: ['label', 'value'], additionalProperties: false }, maxItems: 20 } }, additionalProperties: false }, capabilities: ['selection', 'context', 'resize'] };
export function bootstrap(r) { if (!r.maybe('bot_global'))
    r.create('bot', { title: '总助', role: 'global', instructions: '全局助手。帮助用户找到资料、创建项目、把工作路由到项目负责人。', tools: ['*'] }, { id: 'bot_global' }); }
export function seed({ r, plugins, s }) {
    bootstrap(r);
    if (s.getMeta('demoSeeded', false))
        return;
    s.transaction(() => {
        const bots = [['bot_lead', '出海负责人', 'lead', '明确增长目标、以证据验收结果。'], ['bot_research', '调研 Bot', 'research', '阅读来源，区分事实和推断，保存带引用的研究。'], ['bot_analyst', '分析 Bot', 'analyst', '分析数据，不用相关性代替因果。'], ['bot_maker', '制作 Bot', 'maker', '制作交付物和可交互视图，记录源数据。'], ['bot_review', '审查 Bot', 'reviewer', '复核证据、运行测试，不虚报完成。'], ['bot_video', '视频负责人', 'lead', '负责产品视频项目。'], ['bot_dev', '开发负责人', 'lead', '负责本地应用工程。']];
        for (const [id, title, role, instructions] of bots)
            r.create('bot', { title, role, instructions, tools: ['*'], demo: true }, { id });
        const p = r.create('project', { title: '英语跟读 App 出海', goal: '首批 100 个付费用户', phase: '冷启动', leadBotId: 'bot_lead', memberBotIds: ['bot_lead', 'bot_research', 'bot_analyst', 'bot_maker', 'bot_review'], metrics: [{ label: '试用', value: 412 }, { label: '付费', value: 23 }, { label: '转化', value: '5.6%' }], description: '验证适合英语跟读产品的首批获客渠道。', demo: true }, { id: 'project_growth' });
        r.create('project', { title: '安静型产品视频', goal: '建立 20 个可复用的产品表达方式', phase: '研究中', leadBotId: 'bot_video', memberBotIds: ['bot_video', 'bot_research', 'bot_maker'], metrics: [], demo: true }, { id: 'project_video' });
        r.create('project', { title: 'Lede 本身', goal: '项目工作台与动态视图插件', phase: '构建中', leadBotId: 'bot_dev', memberBotIds: ['bot_dev', 'bot_maker', 'bot_review'], metrics: [], demo: true }, { id: 'project_lede' });
        const docs = [
            ['01JPR', '竞品订阅价格报告', 'report', '# 竞品订阅价格报告\n\n> 示例资料 · 这里的产品与价格只用于演示界面，不是已完成的市场调查。\n\n## 观察范围\n英语学习、口语跟读与发音辅助产品。研究时需保留地区、日期和产品页面来源。\n\n## 决策前检查\n不能只比较年费。还需要比较试用机制、订阅权益、退款规则和真实留存表现。\n\n## 待验证\n重新采集当前价格，避免使用过时信息。'],
            ['01JRD', 'Reddit 学习类子版块规则', 'report', '# Reddit 学习类子版块规则\n\n> 示例资料 · 下列内容演示知识引用与选择功能，不代表当前社区规则。正式使用前需核对原始来源。\n\n## 基本原则\n先理解社区规则与用户需求，再决定是否参与。不要把研究任务直接变成广告投放。保留每条规则的原文链接和检查时间。\n\n## 可测试的内容形式\n学习经验、公开练习材料、具体问题的实用回答。先做小规模测试，记录反馈，不把曝光量当成付费意愿。\n\n## 下一步\n调研 Bot 应逐一核对允许发布的内容、推广限制和置顶帖，再把证据交给负责人。'],
            ['obj_method', '冷启动增长指南', 'method', '# 冷启动增长指南\n\n## 先确定问题\n区分「找到用户」「验证需求」「提高留存」「增加付费」四种目标，不要混用指标。\n\n## 研究与假设\n收集目标用户的真实表达、竞品现状和渠道限制。每个关键判断至少附上能回看的来源。\n\n## 最小实验\n确定一个主要指标、一组受众和一项变化，记录预算、时间和停止条件。\n\n## 复盘\n对照原先假设解释结果；保留失败经验和不确定性。'],
            ['obj_experiment', '实验设计与证据记录', 'method', '# 实验设计与证据记录\n\n明确假设、观察指标、入选样本和测试时间。小样本结果不应过度外推。\n\n## 可追溯性\n保存原始数据、处理过程和结论版本。任务完成需要证据，不只是 Agent 的一句完成。'],
            ['decision_channel', '先做 Reddit，后做 TikTok', 'decision', '该决定尚待确认。先研究社区与内容匹配程度，再决定实验优先级。'],
            ['decision_price', '年付定价 $59.99', 'decision', '示例决策，并非真实定价建议。需要当前竞品和付费意愿证据来验证。'],
            ['decision_ios', '只做 iOS 首发', 'decision', '本轮开发与验证先聚焦 iOS，避免平台范围过大。'],
            ['obj_drafts', '10 条 Reddit 帖子草稿', 'material', '# 帖子草稿\n\n示例产物占位：尚未调研社区规则，不包含可直接发布的推广内容。\n\n请负责人先安排真实调研，再依据规则组织内容。']
        ];
        for (const [id, title, category, content] of docs)
            r.create('object', { title, category, content, tags: category === 'method' ? ['方法论', '增长'] : ['出海'], demo: true, decisionState: id === 'decision_channel' ? 'pending' : 'accepted', source: { kind: 'example', label: '内置示例，不是实时研究' } }, { id, projectId: p.id });
        r.create('collection', { title: '冷启动增长方法', description: '从定位、渠道验证到增长实验的方法与案例。', mode: 'static', demo: true }, { id: 'collection_growth', projectId: p.id });
        r.create('collection', { title: '竞品资料', description: '用于核对定价、功能和用户需求的资料。', mode: 'static', demo: true }, { id: 'collection_competitors', projectId: p.id });
        for (const id of ['obj_method', 'obj_experiment'])
            r.member('collection_growth', id);
        for (const id of ['01JPR', '01JRD'])
            r.member('collection_competitors', id);
        r.saveSummary('collection_growth', { abstract: '从定位、渠道验证到增长实验的方法与案例。', overview: '# 冷启动增长方法\n\n从定位、渠道验证到增长实验的方法与案例。\n\n## 主题结构\n先区分增长目标，再收集来源，形成可验证的假设，最后设计小规模实验。\n\n## 主要资料\n- [冷启动增长指南](lede://object/obj_method)\n- [实验设计与证据记录](lede://object/obj_experiment)\n\n此概览来自内置示例资料，不是模型运行结果。', sourceSignature: r.signature('collection_growth'), method: 'bundled-example' });
        r.relate('decision_price', '01JPR', 'references');
        r.relate('decision_channel', '01JRD', 'references');
        r.relate('01JRD', 'obj_method', 'related_to');
        const tasks = [['task_reddit', 'Reddit 学习类子版块推广案例', 'doing', 'bot_research', 65], ['task_screens', 'App Store 截图改版 3 套', 'review', 'bot_maker', 85], ['task_funnel', '试用→付费漏斗拆解', 'queued', 'bot_analyst', 0], ['task_prices', '竞品定价资料核对', 'done', 'bot_review', 100]];
        for (const [id, title, state, assigneeBotId, progress] of tasks)
            r.create('task', { title, state, assigneeBotId, progress, projectId: p.id, description: '示例任务状态；不表示后台真实 Agent 正在执行。', acceptance: '保留可定位来源与完整结果。', demo: true, evidence: state === 'done' ? '仅为演示完成态，未执行真实研究。' : '' }, { id });
        plugins.viewCreate({ title: '渠道对比', blocks: [{ id: 'intro', type: 'markdown', props: { text: '## 渠道对比\n以下是示例结构。真实调研结果由 Bot 写入后持续更新。' } }, { id: 'sources', type: 'table', props: { columns: [{ key: 'title', label: '资料' }, { key: 'category', label: '类型' }, { key: 'revision', label: '版本' }] }, dataSource: { kind: 'query', query: { kind: 'object', projectId: p.id } } }, { id: 'tasks', type: 'tasks', dataSource: { kind: 'query', query: { kind: 'task', projectId: p.id } } }], mode: 'live', demo: true }, { id: '01JCH', projectId: p.id });
        plugins.mount({ projectId: p.id, viewId: '01JCH', pinned: true });
        plugins.create({ manifest: funnelManifest, source: funnelSource });
        plugins.build('research.funnel@1.0.0');
        s.setMeta('demoSeeded', true);
        s.setMeta('demoMode', true);
    });
}
