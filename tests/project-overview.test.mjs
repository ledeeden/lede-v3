import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,waitFor} from './helpers.mjs';
import {createProject} from '../server/tools.mjs';
test('lead reports stay separate from generated summaries and board revisions',async t=>{
 const a=await fixture(t),p=createProject(a.r,{title:'汇报项目'}),b=a.r.create('bot',{title:'研究员'}),lead=a.r.get(p.leadBotId);
 assert.ok(!b.tools.includes('view.*'));assert.ok(lead.tools.includes('view.*'));
 const source=a.r.create('object',{title:'原始研究',content:'完整来源正文'},{projectId:p.id});
 const brief=a.tools.get('project.brief').handler({},{projectId:p.id});assert.equal(brief.research[0].summaryState,'pending-or-unavailable');assert.ok(!JSON.stringify(brief).includes('完整来源正文'));
 const args={title:'项目汇报',content:'## 判断\n\n继续研究。',abstract:'负责人选择的摘要',sourceUris:[source.uri]};
 assert.throws(()=>a.tools.get('project.report').handler(args,{bot:b,projectId:p.id,callKey:'worker'}),/负责人/);
 const report=a.tools.get('project.report').handler(args,{bot:lead,projectId:p.id,callKey:'report'});
 a.r.saveSummary(report.id,{abstract:'自动压缩摘要',overview:'自动压缩概览',sourceSignature:a.r.signature(report.id)});
 assert.equal(a.r.get(report.id).reportAbstract,'负责人选择的摘要');assert.match(report.content,/参考资料/);
 const v=a.plugins.viewCreate({title:'负责人看板',blocks:[]},{projectId:p.id});
 a.tools.get('project.overview').handler({viewId:v.id,baseRevision:p.revision},{bot:lead,projectId:p.id});
 assert.equal(a.r.get(p.id).overviewViewId,v.id);assert.equal(a.r.get(v.id).revision,1);
});
test('worker L2 generates summaries after commit, refreshes changed sources and keeps full content',async t=>{
 const a=await fixture(t),p=createProject(a.r,{title:'分层资料'}),b=a.r.create('bot',{title:'研究员'});
 a.s.run('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)','summary_run','test_session',p.id,b.id,null,'succeeded',1,1,'{}',null,null,new Date().toISOString(),new Date().toISOString());
 let calls=0;a.providers.configured=()=>true;a.providers.complete=async()=>{assert.equal(a.s.depth,0);calls++;return {content:'# 摘要\n\n简介'+calls+'\n\n## 主题结构\n研究概览'};};
 const source=a.r.create('object',{title:'研究资料',content:'完整原文',producedBy:'summary_run'},{projectId:p.id});
 await waitFor(()=>a.r.get(source.id).summary);assert.equal(a.r.read(source.uri,{level:0}).level,0);assert.equal(a.r.read(source.uri,{level:2}).text,'完整原文');
 const current=a.r.get(source.id);a.r.update(source.id,{content:'修订后的完整原文'},{baseRevision:current.revision});
 assert.equal(a.r.get(source.id).summary.stale,true);await waitFor(()=>!a.r.get(source.id).summary.stale);assert.equal(calls,2);assert.equal(a.r.read(source.uri,{level:1}).level,1);
 await new Promise(resolve=>setTimeout(resolve,100));assert.equal(calls,2);assert.equal(a.r.get(source.id).content,'修订后的完整原文');
});
