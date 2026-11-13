import React, {useState, useRef, useEffect, useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {ReactFlow, Background, Controls, MiniMap, Handle, Position, NodeResizer, applyNodeChanges, applyEdgeChanges, addEdge} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

function KnowledgeNode({data, selected}) {
    const ref = useRef(null);
    useEffect(() => { ref.current.innerHTML = data.html; data.wire(ref.current); }, [data.html]);
    return <section className="flow-knowledge card view-block" data-block={data.block.id}>
        <NodeResizer isVisible={selected&&!data.block.layout?.locked} minWidth={200} minHeight={100} onResizeEnd={(_, size)=>data.resize(size)}/>
        <Handle type="target" position={Position.Left}/>
        <header className="drag-handle"><span>{data.block.title || data.block.id}</span><button className="nodrag small ghost" onClick={()=>data.select()}>问负责人</button></header>
        <div className="nodrag nowheel" ref={ref}/><Handle type="source" position={Position.Right}/>
    </section>;
}
const nodeTypes = {knowledge: KnowledgeNode};
function Canvas({view, blocks, html, wire, onSelect, save, onError}) {
    const chain = useRef(Promise.resolve()), revision = useRef(view.revision), failed = useRef(false);
    const persist = useCallback(operations => {
        chain.current = chain.current.then(async()=> {
            if(failed.current) return;
            try { const updated=await save(revision.current, operations); revision.current=updated.revision; }
            catch(e) { failed.current=true; onError(e); }
        });
    }, []);
    const [nodes,setNodes] = useState(()=>blocks.filter(b=>!b.hidden).map((b,i)=>({id:b.id,type:'knowledge',position:{x:b.layout?.x??(i%2)*460+40,y:b.layout?.y??Math.floor(i/2)*320+40},style:{width:b.layout?.width??400,height:b.layout?.height},parentId:b.layout?.parentId,draggable:!b.layout?.locked,data:{block:b,html:html(b),wire:el=>wire(el,b),select:()=>onSelect(b),resize:size=>persist([{op:'updateBlock',id:b.id,patch:{layout:{width:size.width,height:size.height}}}])}})));
    const [edges,setEdges]=useState(view.edges??[]);
    const [message,setMessage]=useState('');
    const [undo,setUndo]=useState(null);
    const selected=nodes.filter(n=>n.selected);
    const lock=()=>{const next=nodes.map(n=>n.selected?{...n,draggable:n.draggable===false,data:{...n.data,block:{...n.data.block,layout:{...n.data.block.layout,locked:n.draggable!==false}}}}:n);setNodes(next);persist(next.filter(n=>n.selected).map(n=>({op:'updateBlock',id:n.id,patch:{layout:{locked:!n.draggable}}})));};
    const group=()=>{const id=crypto.randomUUID();setNodes(ns=>ns.map(n=>n.selected?{...n,data:{...n.data,block:{...n.data.block,layout:{...n.data.block.layout,groupId:id}}}}:n));persist(selected.map(n=>({op:'updateBlock',id:n.id,patch:{layout:{groupId:id}}})));setMessage('已分组；点击任意组内节点选择整组');};
    const ungroup=()=>{setNodes(ns=>ns.map(n=>n.selected?{...n,data:{...n.data,block:{...n.data.block,layout:{...n.data.block.layout,groupId:null}}}}:n));persist(selected.map(n=>({op:'updateBlock',id:n.id,patch:{layout:{groupId:null}}})));};
    const groupIds=[...new Set(nodes.map(n=>n.data.block.layout?.groupId).filter(Boolean))];
    const backgrounds=groupIds.map(id=>{const members=nodes.filter(n=>n.data.block.layout?.groupId===id),x=Math.min(...members.map(n=>n.position.x))-24,y=Math.min(...members.map(n=>n.position.y))-36;return {id:'group-'+id,type:'group',position:{x,y},style:{width:Math.max(...members.map(n=>n.position.x+(n.measured?.width??n.style.width??400)))-x+24,height:Math.max(...members.map(n=>n.position.y+(n.measured?.height??n.style.height??240)))-y+24,background:'rgba(125,150,180,.04)',border:'1px dashed #667080',borderRadius:16,pointerEvents:'none'},data:{},selectable:false,draggable:false,deletable:false,zIndex:-1};});
    const changeNodes = changes=> {setNodes(ns=>applyNodeChanges(changes.filter(c=>!(c.id??c.item?.id??'').startsWith('group-')),ns));};
    const changeEdges = changes=> {setEdges(es=>{const next=applyEdgeChanges(changes,es);if(changes.some(c=>c.type==='remove'))persist([{op:'setEdges',value:next}]);return next;});};
    const connect=connection=>setEdges(es=>{const next=addEdge({...connection,id:crypto.randomUUID()},es);persist([{op:'setEdges',value:next}]);return next;});
    const arrange=()=> {setUndo(nodes.map(n=>({id:n.id,position:{...n.position}})));const next=nodes.map((n,i)=>n.draggable===false?n:({...n,position:{x:(i%2)*460+40,y:Math.floor(i/2)*340+40}}));setNodes(next);persist(next.map(n=>({op:'updateBlock',id:n.id,patch:{layout:{...n.position}}})));setMessage('布局已整理');};
    return <><div className="flow-tools"><button onClick={arrange}>整理布局</button><button disabled={!undo} onClick={()=>{setNodes(ns=>ns.map(n=>({...n,position:undo.find(u=>u.id===n.id)?.position??n.position})));persist(undo.map(n=>({op:"updateBlock",id:n.id,patch:{layout:n.position}})));setUndo(null);}}>撤销整理</button><button disabled={!selected.length} onClick={lock}>锁定 / 解锁</button><button disabled={selected.length<2} onClick={group}>分组</button><button disabled={!selected.length} onClick={ungroup}>取消分组</button><span className="muted small">{message}</span></div><ReactFlow nodes={[...backgrounds,...nodes]} edges={edges.filter(e=>nodes.some(n=>n.id===e.source)&&nodes.some(n=>n.id===e.target))} nodeTypes={nodeTypes} onNodesChange={changeNodes} onNodeClick={(_,node)=>{const g=node.data.block?.layout?.groupId;if(g)setNodes(ns=>ns.map(n=>({...n,selected:n.data.block.layout?.groupId===g})));}} onEdgesChange={changeEdges} onConnect={connect} onNodeDragStop={(_,node,dragged)=>persist((dragged?.length?dragged:[node]).map(n=>({op:'updateBlock',id:n.id,patch:{layout:n.position}})))} onNodesDelete={deleted=>persist(deleted.map(n=>({op:'removeBlock',id:n.id})))} multiSelectionKeyCode="Shift" fitView minZoom={0.15} maxZoom={3} colorMode={document.documentElement.dataset.theme==='light'?'light':'dark'}><Background gap={24} size={1}/><Controls/><MiniMap pannable zoomable/></ReactFlow></>;
}
export function mountCanvas(element, options) { const root=createRoot(element);root.render(<Canvas {...options}/>);return ()=>root.unmount(); }
