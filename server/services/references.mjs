import {assert} from '../../shared/schema.mjs';
import {parseURI,uri} from '../../shared/uri.mjs';
import {uid,now} from '../db.mjs';
import {mutate} from '../runtime/mutations.mjs';
// References record an occurrence in work, without judging the referenced content.
export class References {
 constructor(s,r){this.s=s;this.r=r;}
 add(a,actor='user'){return mutate(this.s,actor,'reference:'+a.sourceId,a.request_id,a,()=>{const source=this.r.get(a.sourceId),target=this.r.resolve(a.targetUri),p=parseURI(a.targetUri);assert(['object','view','task'].includes(source.kind),'引用需要内容对象');assert(!a.sourceAnchor||source.blocks?.some(b=>b.id===a.sourceAnchor),'引用位置不存在');const citation={id:uid('citation_'),targetUri:uri(target.kind,target.id,{rev:p.rev??target.revision,anchor:p.anchor}),sourceAnchor:a.sourceAnchor??null,excerpt:String(a.excerpt??'').slice(0,4000),createdAt:now()};return this.r.update(source.id,{citations:[...(source.citations??[]),citation]},{baseRevision:a.baseRevision});});}
 remove(a){return mutate(this.s,'user','reference:'+a.sourceId,a.request_id,a,()=>{const source=this.r.get(a.sourceId);assert(source.citations?.some(c=>c.id===a.citationId),'引用不存在',404);return this.r.update(source.id,{citations:source.citations.filter(c=>c.id!==a.citationId)},{baseRevision:a.baseRevision});});}
 list(id){const source=this.r.get(id);return {outgoing:source.citations??[],incoming:this.r.all({status:'all'}).flatMap(r=>(r.citations??[]).filter(c=>parseURI(c.targetUri).id===id).map(c=>({...c,sourceId:r.id,sourceTitle:r.title,sourceUri:uri(r.kind,r.id,{rev:r.revision,anchor:c.sourceAnchor??undefined})}))) };}
}
