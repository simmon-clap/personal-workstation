import {escapeHtml as esc} from './project-render.mjs';
import {sharedModal} from './modal.mjs';
import {selectHtml,wireSelects} from './vi-select.mjs';
import {renderMarkdown,readerHtml} from './markdown.mjs';
import {downloadFile} from './download.mjs';
import {classify,childrenOf,expandState,outwardDir,expandLayout,fitRect,semanticTier,roleVisual,capacityReport,UNCLASSIFIED_LABEL,UNASSIGNED_LABEL} from './ecosystem-layout.mjs';
import {buildEcosystemLayout,buildEcosystemFocusLayout,ecoClusterOf} from './ecosystem-canvas.mjs';
import {ECOSYSTEM_MAP} from './ecosystem-map.mjs';
import {defaultExpandedOrganizations} from './activity.mjs';

const ns='http://www.w3.org/2000/svg';
// 画布配色**只用 VI 的 token**（V5：同一语义不允许两套颜色）。
// SVG 的 fill/stroke 属性不支持 var()，所以运行时从根元素读出 token 的值；
// 读不到就退回纸面/墨色，绝不自己写一个新色值。
const viToken=name=>{
 // 测试沙箱（runInNewContext）里没有 getComputedStyle —— 必须守卫，
 // 否则画布整块渲染直接抛错（第 9 轮实测：13 个测试因此变红）。
 if(typeof getComputedStyle!=='function'||!document?.documentElement)return 'transparent';
 const value=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
 return value||'transparent';
};
const palette=()=>({
 // 10 色扩展板：每一类一个色相，不再靠同色系深浅区分。
 project:[viToken('--pal-indigo-soft'),viToken('--pal-indigo'),'project'],
 task:[viToken('--pal-teal-soft'),viToken('--pal-teal'),'task'],
 artifact:[viToken('--pal-cyan-soft'),viToken('--pal-cyan'),'artifact'],
 topic:[viToken('--pal-violet-soft'),viToken('--pal-violet'),'topic'],
 memory:[viToken('--pal-magenta-soft'),viToken('--pal-magenta'),'memory'],
 judgment:[viToken('--pal-pink-soft'),viToken('--pal-pink'),'judgment'],
 event:[viToken('--pal-orange-soft'),viToken('--pal-orange'),'event'],
 org:[viToken('--pal-slate-soft'),viToken('--pal-slate'),'org'],
 person:[viToken('--pal-gold-soft'),viToken('--pal-gold'),'person'],
});
const kindOrder=['project','task','artifact','topic','memoryRef','judgment','event','organization','person'];
const typeOf=kind=>({project:'project',task:'task',artifact:'artifact',topic:'topic',memoryRef:'memory',judgment:'judgment',event:'event',organization:'org',person:'person'}[kind]||'topic');
const iconOf=kind=>({project:'pg-folder',task:'pg-kanban',artifact:'pg-file-text',topic:'pg-bookmark',memoryRef:'pg-database',event:'pg-calendar-days',organization:'pg-building',person:'pg-users',judgment:'pg-shield'}[kind]||'pg-layers');
// 画布文案必须与原型一致：不把内部枚举直接暴露给用户。
export const statusLabels={todo:'待办',waiting:'等待中',in_progress:'进行中',done:'已完成',cancelled:'已取消'};
export const kindLabels={project:'项目',task:'任务',artifact:'资料',topic:'研究议题',memoryRef:'记忆引用',judgment:'判断',event:'事务',organization:'组织',person:'联系人'};
export function nodeSubtitle(node){
 const kind=kindLabels[node.kind]||node.kind;
 if(node.kind==='project'||node.kind==='task'){
  const done=node.progress?.done??0,total=node.progress?.total??0;
  // 0/0 不画成指标（S4/TK-02）：没有步骤/交付项就如实说「尚无步骤 / 尚无交付项」。
  const progress=total?done+'/'+total+' 项':(node.kind==='task'?'尚无步骤':'尚无交付项');
  return `${kind} · ${progress} · ${statusLabels[node.businessStatus]||node.businessStatus||''}`.replace(/ · $/,'');
 }
 return kind;
 return kind;
}
/** 手册 §07 缩放与层级：低于 60% 只看得到「对象名 + 类型」；60–110% 才补充状态与计数；
 *  高于 110% 才按需显示关系文字。这样缩小时画面不会因为文字互相压叠而变成一团。 */
export function nodeDetailAt(node,zoom){
 const kind=kindLabels[node.kind]||node.kind;
 if(zoom<0.6)return kind;
 return nodeSubtitle(node);
}
export function showsEdgeLabels(zoom){return zoom>1.1}

/** 每个节点多大。
 *  用户 2026-10-16：「不要都很大，要**精致**一些；**不要重要和紧急**，而是**节点** ——
 *  比如项目是个大节点，里面任务是小节点；联动很多的知识是个重要的，小知识就不是很重要」。
 *  所以：**按种类给底**（项目大、任务小）+ **按连接数加成**（联动越多越大），与 priority/urgency 无关。 */
export function nodeSize(kind,degree=0){
 // 星点图：类型决定基础大小（项目最大、联系人/组织最小），连接数再加成。
 const base={project:[260,110],task:[176,72],artifact:[160,64],topic:[150,60],judgment:[176,72],event:[160,64],organization:[140,56],person:[140,56]}[kind]??[150,60];
 const bonus=Math.min(30,Math.max(0,(degree-1))*6);
 return {w:base[0]+bonus,h:base[1]+Math.round(bonus*0.35)};
}
/** 每个节点的尺寸表（与 positions 同一套用法：算一次，五处共用）。 */
function sizeMap(live,edges){
 const degree=new Map();
 for(const edge of edges){degree.set(edge.from,(degree.get(edge.from)??0)+1);degree.set(edge.to,(degree.get(edge.to)??0)+1)}
 const map=new Map();
 for(const node of live)map.set(node.id,nodeSize(node.kind,degree.get(node.id)??0));
 return map;
}
/** 节点卡片里可放文字的宽度（卡片 200 宽，文字从 x=51 起，右侧留 10）。 */
export const NODE_TEXT_WIDTH=139;
export function textWidth(text,fontSize=13){
 let width=0;
 for(const char of String(text))width+=/[⺀-鿿豈-﫿＀-￯]/.test(char)?fontSize:fontSize*0.51;
 return width;
}
/** 最多折两行，第二行放不下就用省略号——宁可截断也不画到卡片外面。 */
export function wrapNodeTitle(text,{maxWidth=NODE_TEXT_WIDTH,fontSize=13,maxLines=2}={}){
 const chars=[...String(text??'')];
 const lines=[];
 let current='';
 for(const char of chars){
  if(textWidth(current+char,fontSize)<=maxWidth){current+=char;continue}
  lines.push(current);
  current=char;
  if(lines.length===maxLines-1)break;
 }
 if(lines.length<maxLines){
  const consumed=lines.join('').length+current.length;
  if(consumed<chars.length){
   // 还有剩余字符：第二行放尽可能多，再加省略号
   let rest=chars.slice(consumed).join('');
   while(rest&&textWidth(current+rest+'…',fontSize)>maxWidth)rest=rest.slice(0,-1);
   current=current+rest+(rest.length<chars.slice(consumed).length?'…':'');
  }
  lines.push(current);
  return lines.filter(line=>line!=='');
 }
 const last=lines[maxLines-1];
 // 已到行数上限但还有剩余：末行加省略号
 if(textWidth(last,fontSize)>maxWidth||chars.join('').length>lines.join('').length+last.length)lines[maxLines-1]=last.replace(/.$/,'…');
 return lines.map(line=>line);
}
const relationFields=['title','description','projectId','sourceRefs','tags','from','to','status','evidence','reason'];

/** Deterministic initial layout: one column per kind in canonical order, rows in stable id order. */
export function spaceLayout(nodes){
 const positions={},columns=new Map();
 for(const node of nodes){if(!columns.has(node.kind))columns.set(node.kind,[]);columns.get(node.kind).push(node.id)}
 const kinds=[...kindOrder.filter(kind=>columns.has(kind)),...[...columns.keys()].filter(kind=>!kindOrder.includes(kind)).sort()];
 let column=0;
 for(const kind of kinds){const ids=columns.get(kind).sort();ids.forEach((id,row)=>{positions[id]={x:column*300,y:row*160}});if(ids.length)column++}
 return positions;
}

/** 星点状布局（2026-10-18）：以一个焦点为中心，按关系距离分环排布。
 *  中心 = 当前聚焦对象 / 连接最多的项目；一环 = 直接关联；二环 = 二度；其余放外环。
 *  同一环内按类型聚合，再按标题稳定排序 —— 每次重开位置一致，不会跳来跳去。 */
export function starLayout(nodes,edges,focus=''){
 const live=edges.filter(edge=>edge.status!=='rejected');
 const degree=new Map();
 for(const edge of live){degree.set(edge.from,(degree.get(edge.from)??0)+1);degree.set(edge.to,(degree.get(edge.to)??0)+1)}
 const byId=new Map(nodes.map(node=>[node.id,node]));
 const projects=nodes.filter(node=>node.kind==='project').sort((a,b)=>(degree.get(b.id)??0)-(degree.get(a.id)??0));
 const hubId=focus&&byId.has(focus)?focus:(projects[0]?.id??[...nodes].sort((a,b)=>(degree.get(b.id)??0)-(degree.get(a.id)??0))[0]?.id);
 if(!hubId)return {};
 const adjacency=new Map(nodes.map(node=>[node.id,[]]));
 for(const edge of live){if(!adjacency.has(edge.from)||!adjacency.has(edge.to))continue;adjacency.get(edge.from).push(edge.to);adjacency.get(edge.to).push(edge.from)}
 const depth=new Map([[hubId,0]]);const queue=[hubId];
 while(queue.length){const id=queue.shift();for(const next of adjacency.get(id)??[]){if(depth.has(next))continue;depth.set(next,depth.get(id)+1);queue.push(next)}}
 const kindRank=['project','task','judgment','event','artifact','topic','memoryRef','organization','person'];
 const ringOf=list=>[...list].sort((a,b)=>{const ka=kindRank.indexOf(a.kind),kb=kindRank.indexOf(b.kind);return ka-kb||String(a.title??'').localeCompare(String(b.title??''),'zh')||a.id.localeCompare(b.id)});
 const rings=[[],[],[],[],[]];
 for(const node of nodes){const d=depth.get(node.id);const ring=d===undefined?4:Math.min(4,d);rings[ring].push(node)}
 const positions={};
 rings.forEach((list,ring)=>{
  if(!list.length)return;
  if(ring===0){positions[list[0].id]={x:0,y:0};return}
  const sorted=ringOf(list);
  const radius=[0,360,650,930,1200][ring]+Math.max(0,sorted.length-10)*26;
  const offset=-Math.PI/2+(ring%2?0.18:-0.18);
  sorted.forEach((node,index)=>{
   const angle=offset+index/sorted.length*Math.PI*2;
   const size=nodeSize(node.kind,degree.get(node.id)??0);
   positions[node.id]={x:Math.round(Math.cos(angle)*radius-size.w/2),y:Math.round(Math.sin(angle)*radius-size.h/2)};
  });
 });
 return positions;
}
/** 旧版布局是「每种类型一列」（x 300 倍数、y 160 倍数）；识别它并在新布局里一次性替换。 */
export function wasColumnLayout(positions){
 const values=Object.values(positions??{});
 if(!values.length)return false;
 return values.every(position=>Math.abs(position.x%300)<1&&Math.abs(position.y%160)<1);
}
/** Same scope semantics as the prototype: all, cross-project shared objects, or nodes reached by pending suggestions. */
export function pendingSuggestions(edges){
 // 待确认候选按 id 稳定排序：同一批数据每次打开看到的是同一条，不在你眼前跳来跳去。
 return edges.filter(edge=>edge.status!=='rejected'&&(edge.status==='suggested'||edge.stale)).sort((left,right)=>String(left.id).localeCompare(String(right.id)));
}
export function scopeNodes(nodes,edges,scope){
 const live=edges.filter(edge=>edge.status!=='rejected');
 // 「AI 建议」范围一次只显示**一条**待确认（CV-08：一次一条，处理完再看下一条）。
 if(scope==='suggestions'){const first=pendingSuggestions(live)[0];const ids=first?new Set([first.from,first.to]):new Set();return nodes.filter(node=>ids.has(node.id))}
 if(scope==='shared'){const owners=id=>new Set(live.filter(edge=>edge.derived&&edge.title==='项目归属'&&(edge.from===id||edge.to===id)).map(edge=>edge.from===id?edge.to:edge.from));const hubs=nodes.filter(node=>['artifact','topic','memoryRef','event'].includes(node.kind)&&owners(node.id).size>1).map(node=>node.id);const ids=new Set(hubs);for(const edge of live)if(hubs.includes(edge.from)||hubs.includes(edge.to)){ids.add(edge.from);ids.add(edge.to)}return nodes.filter(node=>ids.has(node.id))}
 return nodes;
}
export function relationData(edge,status){const data={};for(const field of relationFields){const value=field==='status'?status:field==='from'?edge.from:field==='to'?edge.to:edge[field];if(value!==undefined&&value!==null&&value!=='')data[field]=value}return data}
export function visibleEdges(nodes,edges,scope){
 const ids=new Set(scopeNodes(nodes,edges,scope).map(node=>node.id));
 const visible=edges.filter(edge=>edge.status!=='rejected'&&ids.has(edge.from)&&ids.has(edge.to));
 if(scope!=='suggestions')return visible;
 const first=pendingSuggestions(visible)[0];
 return first?[first]:[];
}

/** 框选：与选框相交的节点即被选中（用节点卡片 200×86 的实际矩形判断）。
 *  纯函数，便于单测；不做副作用。 */
/** 高连接分页：单个节点最多画 N 条关联，其余在状态栏如实计数（CV-04 正式版要求）。
 *  已确认的关系优先于待确认建议——用户确认过的先可见。 */
export const EDGES_PER_NODE=12;
export function capEdges(list,limit=EDGES_PER_NODE){
 const count=new Map(),kept=[],dropped=[];
 for(const edge of [...list].sort((a,b)=>(a.status==='confirmed'?0:1)-(b.status==='confirmed'?0:1))){
  const from=count.get(edge.from)??0,to=count.get(edge.to)??0;
  if(from>=limit||to>=limit){dropped.push(edge);continue}
  count.set(edge.from,from+1);count.set(edge.to,to+1);kept.push(edge);
 }
 return {kept,dropped};
}
export function marqueeSelect(box,placed,sizes=null){
 const left=Math.min(box.x1,box.x2),right=Math.max(box.x1,box.x2);
 const top=Math.min(box.y1,box.y2),bottom=Math.max(box.y1,box.y2);
 return placed.filter(({position,n})=>{if(!position)return false;const sz=sizes?.get(n?.id)??{w:200,h:86};return position.x<right&&position.x+sz.w>left&&position.y<bottom&&position.y+sz.h>top}).map(({node})=>node.id);
}
/** 分组的包围盒：成员节点的最小外接矩形 + 内外边距（含标题行）。 */
export function groupBounds(members,{padding=18,titleHeight=26}={},sizes=null){
 const placed=members.filter(item=>item.position);
 if(!placed.length)return null;
 const left=Math.min(...placed.map(item=>item.position.x)),top=Math.min(...placed.map(item=>item.position.y));
 const right=Math.max(...placed.map(item=>item.position.x+(sizes?.get(item.n?.id)?.w??200))),bottom=Math.max(...placed.map(item=>item.position.y+(sizes?.get(item.n?.id)?.h??86)));
 return {x:left-padding,y:top-padding-titleHeight,width:right-left+padding*2,height:bottom-top+padding*2+titleHeight};
}
/** 折叠分组时隐藏其成员（视图层行为，不改业务数据）。 */
export function hiddenByGroups(groups){
 const hidden=new Set();
 for(const group of groups??[])if(group.collapsed)for(const id of group.nodeIds)hidden.add(id);
 return hidden;
}

/** 把外壳带来的原生下拉换成 VI 选择控件，返回**同名的 hidden input**。
 *  为什么保留同名 id：调用处（.value / .onchange / dispose）用的是原生 select 的形状，
 *  换成 hidden input 后这三件事的语义完全一致，不必把调用点全改一遍。 */
function mountCanvasSelect(document,select){
 if(!select||select.dataset.viMounted==='1')return select;
 const options=[...select.options].map(option=>[option.value,option.textContent]);
 const wrapper=document.createElement('div');
 wrapper.innerHTML=selectHtml({name:select.id,attribute:'id',value:select.value,options,placeholder:options[0]?.[1]??'请选择'});
 const node=wrapper.firstElementChild;
 node.dataset.canvasSelect=select.id;
 select.replaceWith(node);
 const input=node.querySelector('input[type="hidden"]');
 input.dataset.viMounted='1';
 return input;
}

/** 改 hidden input 的值时同步可见文字（否则下拉显示的还是旧选项）。 */
function setViValue(document,input,value){
 if(!input)return;
 input.value=value;
 const wrapper=input.closest('[data-viselect]');
 if(!wrapper)return;
 const option=[...wrapper.querySelectorAll('[data-viselect-option]')].find(item=>item.dataset.viselectOption===value);
 if(option){wrapper.querySelector('[data-viselect-text]').textContent=option.textContent;return}
 const first=wrapper.querySelector('[data-viselect-option]');
 wrapper.querySelector('[data-viselect-text]').textContent=first?first.textContent:'';
}

/** 重建某个 VI 下拉的候选（原来是 focusSelect.replaceChildren() + <option>）。 */
function setViOptions(document,input,list,value=''){
 if(!input)return;
 const wrapper=input.closest('[data-viselect]');
 if(!wrapper)return;
 const listNode=wrapper.querySelector('[data-viselect-list]');
 listNode.replaceChildren();
 for(const [optionValue,label] of list){
  const button=document.createElement('button');
  button.type='button';button.className='viselect-option';button.setAttribute('role','option');
  button.dataset.viselectOption=optionValue;button.textContent=label;
  button.onclick=()=>{setViValue(document,input,optionValue);listNode.hidden=true;wrapper.querySelector('[data-viselect-button]')?.setAttribute('aria-expanded','false');input.dispatchEvent(new Event('change',{bubbles:true}))};
  listNode.append(button);
 }
 setViValue(document,input,value);
}

export function mountSpace(document,{send,batch,open,create:onCreate,notify=()=>{},projects=[],key=()=>'space:'+Date.now()+':'+Math.random().toString(36).slice(2)}){
 // 2026-10-14（用户点名「下拉框感觉 VI 有点土」+ VI §6 组件唯一）：外壳带来的是两个原生下拉控件，
 // 与表单里的 .viselect 并存。这里在挂载时换成同一套 VI 选择控件，并保留同名的 hidden input，
 // 于是 .value / .onchange 的调用点全部不用改。
 const svg=document.querySelector('#spaceSvg'),status=document.querySelector('#graphstatus'),
  focusSelect=mountCanvasSelect(document,document.querySelector('#projectfocus')),
  scopeSelect=mountCanvasSelect(document,document.querySelector('#scopefilter'));
 if(scopeSelect||focusSelect)wireSelects(document,{document});
 // 范围选择器（不是新入口，沿用画布原有那一个）：结构态是默认（D8=全部机构），
 // 其余三个是既有关系态。选项补在运行时，冻结外壳一个字不动。
 if(scopeSelect){setViOptions(document,scopeSelect,[['structure','按分类'],['all','全网'],['shared','跨项目共享'],['suggestions','AI 建议'],['ecosystem','生态视图']],'all')}
 const modal=sharedModal(document);let token=null,disposed=false,epoch=0;
 let nodes=[],edges=[],relationList=[],positions={},sizes=new Map(),revision=0,gx=20,gy=20,zoom=1,scope='all',focus='',drag=null,moved=false,pending=null;
 // 生态视图（2026-10-26）：底图布局与右侧详情面板只存在于这个模式，不写业务数据。
 let ecoLayout=null,ecoSelected=null,ecoPanel=null,ecoLegend=null,ecoLayerBadge=null,ecoView='focus',structureFallback=false;
 // 结构态（A2 / spec/54 §1·§2）：同一张画布的两个范围，不新增入口。
 // mode 来自范围选择器：structure（默认，D8=全部机构）/ all / shared / suggestions（后三个是既有关系态）。
 // 展开状态只存在本次会话（spec/54 §2.3：v1 不写业务数据）；拖拽位置也只在本会话生效（显式保存归 A4）。
 let showCandidates=false,mode='all',structure=null,structPositions={},childPositions={},expandedOrg=null,expandedProject=null,structMoved={},cameraFrame=0,roleMap=null,bucketVisual=new Map(),structureBucketRects=[],structureOverview=false;
 // 画布第 1 批：框选 / 批量操作 / 分组。分组属于**视图层**（CV-05：不改业务事实），随 layout 一起保存。
 let selection=new Set(),groups=[],marquee=null,selectMode=false,link=null,lastNodeClick={id:'',at:0},lastDoubleAt=0,showAllEdges=false;
 const se=(name,attributes={},text)=>{const node=document.createElementNS(ns,name);for(const [name2,value]of Object.entries(attributes))node.setAttribute(name2,value);if(text!==undefined)node.textContent=text;return node};
 const wire=(selector,handler)=>{const node=document.querySelector(selector);if(node)node.onclick=handler};
 function shown(){
  let scoped=scopeNodes(nodes,edges,scope);
  if(mode==='all'){
   // 全网主角是组织/项目/任务；候选组织默认只展开“有项目的 + 活跃度前 5”，其余折叠。
   // 与主角直接相连的资料/判断等证据节点保留，避免待确认关系的操作条被一起藏掉。
   const coreKinds=new Set(['organization','project','task']);
   let core=scoped.filter(node=>coreKinds.has(node.kind));
   if(!showCandidates){
    const expanded=defaultExpandedOrganizations(core,{limit:5});
    core=core.filter(node=>node.kind!=='organization'||node.verified===true||expanded.has(node.id));
   }
   const coreIds=new Set(core.map(node=>node.id));
   const support=scoped.filter(node=>!coreKinds.has(node.kind)&&edges.some(edge=>edge.status!=='rejected'&&((edge.from===node.id&&coreIds.has(edge.to))||(edge.to===node.id&&coreIds.has(edge.from)))));
   scoped=[...core,...support];
  }
  if(!focus)return scoped;
  const near=new Set([focus]);
  for(const edge of edges)if(edge.status!=='rejected'&&(edge.from===focus||edge.to===focus)){near.add(edge.from);near.add(edge.to)}
  return scoped.filter(node=>near.has(node.id));
 }
 function transform(){const world=svg.querySelector('#spaceworld');if(!world)return;world.setAttribute('transform',`translate(${gx} ${gy}) scale(${zoom})`);const label=document.querySelector('#zoomlabel');if(label)label.textContent=Math.round(zoom*100)+'%';if(mode==='ecosystem')updateEcoLayerBadge()}
 // 缩放分层（VI §9，**强制**）：<60% 名称+类型 · 60–110% 补状态与计数 · >110% 才显示关系文字。
 // 这些内容是在 draw() 里按当时的 zoom 算出来的，而原来所有缩放入口**只调 transform()、不重绘** ——
 // 于是缩到 250% 也不会出现关系文字、缩到 25% 也不会隐藏副标题（2026-10-16 在真实浏览器上实测确认）。
 // 修法：把"改缩放"与"平移"分开 —— `setZoom()` 在缩放真的变了之后，用 requestAnimationFrame 节流重绘一次；
 // 平移仍然只改 transform（平移不影响分层，不必重绘）。
 let zoomDraw=0;
 function setZoom(next){
  const value=Number.isFinite(next)?next:zoom;
  const changed=Math.abs(value-zoom)>1e-6;
  zoom=value;transform();
  if(!changed)return;
  if(zoomDraw)return;
  // 兜底：jsdom（单元测试）里没有 requestAnimationFrame —— 直接用它会让 setZoom 抛错，
  // 后面那句 saveLayout() 就永远不执行（实测把"连续保存"的断言打成了 revision 1）。
  const schedule=typeof requestAnimationFrame==='function'?requestAnimationFrame:callback=>setTimeout(callback,0);
  zoomDraw=schedule(()=>{zoomDraw=0;draw()});
 }
 function fit(){
  if(mode==='ecosystem')return fitEcosystem();
  if(mode==='structure'){
   if(structureOverview&&structureBucketRects.length){
    const viewport=viewportSize();
    cameraTo(fitRect({rects:structureBucketRects,viewport,padding:viewport.w<700?12:32,minZoom:viewport.w<700?0.3:0.6,maxZoom:0.95}),{animate:false});
    return;
   }
   // 适配要把**分类列的框与列头**也算进去：只按节点矩形算会让最右一列的外框超出视口
   //（实测 390 下右边界 425，移动端门禁抓到的就是这条）。
   const rects=Object.keys(structPositions).map(id=>rectOf(id)).filter(Boolean);
   for(const bucket of structure?.buckets??[])if(Number.isFinite(bucket.x))rects.push({x:bucket.x,y:bucket.top??20,w:bucket.width??300,h:Math.max(110,bucket.height??120)});
   const viewport=viewportSize();
   if(!rects.length||!viewport.w){gx=20;gy=20;zoom=1;transform();return}
   // 手机（窄画布）保持「全图适配」：390 宽本来就放不下多列，VI §9 允许 <60% 只显示名称+类型；
   // 桌面则守住 60%（spec/54 §2.3 / S5），其余靠无限画布平移看。
   cameraTo(fitRect({rects,viewport,padding:viewport.w<700?28:70,minZoom:viewport.w<700?0.2:0.6,maxZoom:1}),{animate:false});
   return;
  }
  const rect=svg.getBoundingClientRect(),live=shown();if(!rect.width||!live.length){gx=20;gy=20;zoom=1;transform();return}const xs=live.map(node=>positions[node.id]?.x??0),ys=live.map(node=>positions[node.id]?.y??0);const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)+200-x,h=Math.max(...ys)+86-y;if(w<=0||h<=0){gx=20;gy=20;zoom=1;transform();return}
  // 默认视图必须可读：46 号审计实测原型自动适配到 44%，节点文字只剩 5.7px（17 §4.6 不成立）。
  // 整张图画得下就居中；画不下也不缩到 44% —— 72% 起，其余靠无限画布平移看。这是对原型的**有意偏离**，已入账。
  const fitted=Math.min(1.1,(rect.width-70)/w,(rect.height-95)/h);
  // 手机（窄画布）保持"全图适配"：390 宽本来就不可能既全览又 12px；手册 §07 允许 <60% 只显示名称+类型。
  const readable=rect.width>=700?0.72:0;
  if(!readable||fitted>=readable){zoom=fitted;gx=(rect.width-w*zoom)/2-x*zoom;gy=(rect.height-h*zoom)/2-y*zoom}
  else{zoom=readable;gx=(rect.width/2-(x+w/2)*zoom);gy=(rect.height/2-(y+h/2)*zoom)}
  transform()}
 function dataSummary(){
  const orgs=nodes.filter(node=>node.kind==='organization');
  const verified=orgs.filter(node=>node.verified===true).length;
  return {orgs:orgs.length,verified,pending:orgs.length-verified,projects:nodes.filter(node=>node.kind==='project').length,tasks:nodes.filter(node=>node.kind==='task').length,pendingRelations:(relationList??[]).filter(rel=>rel.status==='suggested').length};
 }
 function relayoutAll(){
  if(mode!=='all'||showCandidates)return;
  const live=shown();
  positions={...positions,...spaceLayout(live)};
 }
 function draw(){
  svg.dataset.canvasMode=mode;
  syncModeTools();
  syncCandidateButton();
  syncPendingButton();
  if(mode!=='ecosystem'){if(ecoLegend)ecoLegend.hidden=true;if(ecoPanel)ecoPanel.hidden=true;ecoSelected=null}
  const crumbs=document.querySelector('#space .canvas-crumbs');if(crumbs)crumbs.hidden=mode==='ecosystem';
  const caption=document.querySelector('#space .spacecaption');
  if(caption)caption.textContent=mode==='ecosystem'?'点类别卡看组织 · 点组织看项目与任务 · 可显示底图 · 滚轮缩放 · 拖拽平移':'单击开详情 · 双击展开 · 拖动平移 · 滚轮缩放 · 拖右侧圆点连线';
  if(mode==='structure')return drawStructure();
  if(mode==='ecosystem')return drawEcosystem();
  return drawRelations();
 }
  /** 画布底：网格 + 世界坐标组。关系态与结构态共用一份，避免两套坐标系。 */
  function canvasBase(){
   svg.replaceChildren();const defs=se('defs'),pattern=se('pattern',{id:'spacegrid',width:24,height:24,patternUnits:'userSpaceOnUse'});pattern.append(se('circle',{cx:1,cy:1,r:.7,fill:viToken('--ws-line')}));defs.append(pattern);svg.append(defs,se('rect',{width:'100%',height:'100%',fill:'url(#spacegrid)'}));
   const world=se('g',{id:'spaceworld'});svg.append(world);return world;
  }
  /** 节点卡 = **一套实现两档密度**（spec/54 §4 / registry.components.card）：
   *  关系态用标准档、结构态用画布紧凑变体 `canvasNode`（同一函数，差别只有内边距与去留）。
   *  两档都只用 VI token；颜色永远不是唯一的区分手段（还有类型名/角色名/形状）。 */
  function nodeCard(node,position,{dim=false,accent=null,roleShape=null,compact=false,showHandle=false,extraSubtitle=''}={}){
   const typeColour=accent?viToken(accent):null,[bg,colour]=typeColour?[viToken(accent+'-soft'),typeColour]:palette()[typeOf(node.kind)];
   const selected=selection.has(node.id);
   const candidate=node.kind==='organization'&&node.verified!==true;
   const size=sizes.get(node.id)??nodeSize(node.kind,0);
   const projectNode=node.kind==='project';
   const radius=compact?12:17;
   const group=se('g',{class:'graphnode graphnode-'+node.kind+(compact?' graphnode-compact':'')+(candidate?' graphnode-candidate':''),'data-kind':node.kind,'data-density':compact?'canvasNode':'standard','data-selected':selected?'1':'0','data-candidate':candidate?'1':'0',transform:`translate(${position.x} ${position.y})`,tabindex:0,role:'button','data-node':node.id,'aria-label':(kindLabels[node.kind]||node.kind)+'：'+(node.title||'未命名')+(candidate?'，待核对':'')+'，单击'+(compact?'展开':'看详情')+'，双击看详情，拖动调整位置',...(dim||candidate?{opacity:candidate&&!dim?'.62':'.32'}:(candidate?{}:{})),...(dim?{'data-dim':'1'}:{})});
   group.append(se('rect',{x:0,y:0,width:size.w,height:compact?3:4,rx:2,fill:colour,'fill-opacity':projectNode?'.95':'.6'}));
   group.append(se('rect',{x:0,y:compact?12:14,width:compact?3:4,height:size.h-(compact?24:28),rx:2,fill:colour,'fill-opacity':projectNode?'1':'.75'}));
   group.append(se('rect',{width:size.w,height:size.h,rx:radius,fill:selected?viToken('--ws-paper'):viToken('--ws-surface'),stroke:selected?viToken('--ws-action'):colour,'stroke-opacity':selected?'1':projectNode?'.8':'.55','stroke-width':selected?2.4:projectNode?2:1,...(candidate?{'stroke-dasharray':'5 4'}:{})}),se('rect',{x:compact?12:12,y:compact?12:14,width:compact?25:29,height:compact?25:29,rx:compact?8:9,fill:bg}));
   const glyph=se('svg',{x:compact?17:18,y:compact?16:20,width:compact?15:17,height:compact?15:17,viewBox:'0 0 24 24',fill:'none',stroke:colour,'stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round'});glyph.append(se('use',{href:'#i-'+iconOf(node.kind)}));group.append(glyph);
   // 关系角色是**三重编码**之一：形状徽标（颜色之外的第二重），名称写在副标题里（第三重）。
   if(roleShape)group.append(shapeBadge(roleShape,size.w-16,compact?14:16,5,colour));
   const titleLines=wrapNodeTitle(node.title||'未命名',{maxWidth:size.w-(compact?51:51)-14});
   const title=se('text',{x:compact?44:51,y:titleLines.length>1?31:33,'font-size':compact?12:13,fill:viToken('--ws-ink'),'font-weight':550});
   titleLines.forEach((line,index)=>{title.append(se('tspan',{x:compact?44:51,dy:index===0?0:14},line))});
   title.append(se('title',{},node.title||'未命名'));
   group.append(title);
   const dots=[['importance',size.w-28,'重要程度'],['urgency',size.w-14,'紧急程度']];
   const levelText={high:'高',medium:'中',low:'低'};
   const tooltip=[];
   for(const [field,x,label] of dots){
    const value=node[field];
    if(!['high','medium','low'].includes(value))continue;
    group.append(se('circle',{cx:x,cy:16,r:4,fill:value==='high'?viToken('--ws-action'):value==='medium'?viToken('--ws-muted'):viToken('--ws-line')}));
    tooltip.push(label+'：'+levelText[value]);
   }
   if(node.folder)tooltip.push('项目文件夹：'+node.folder);
   if(candidate)tooltip.push('待核对：来源 '+(node.source==='external'?'外部研究':node.source==='agent'?'Agent 整理':'未标'));
   if(node.verified)tooltip.push(node.source==='project'?'由项目直接实现':'已确认');
   if(tooltip.length)group.append(se('title',{},tooltip.join(' · ')));
   if(node.kind==='task'&&(node.businessStatus==='waiting'||node.businessStatus==='in_progress')){
    group.append(se('circle',{cx:12,cy:12,r:5,fill:node.businessStatus==='waiting'?viToken('--ws-warning'):viToken('--ws-action')}));
   }
   const subtitle=[nodeDetailAt(node,zoom),candidate?'待核对':null,extraSubtitle].filter(Boolean).join(' · ');
   group.append(se('text',{x:compact?13:14,y:size.h-13,'font-size':12,fill:viToken('--ws-muted')},subtitle));
   if(['artifact','topic'].includes(node.kind)&&!compact){
    const preview=se('text',{x:186,y:titleLines.length>1?72:60,'font-size':12,fill:viToken('--ws-action'),class:'nodepreview','text-anchor':'end'});
    preview.textContent='预览';preview.append(se('title',{},'在画布内预览内容（文本 / 图片 / PDF）'));
    preview.addEventListener('click',event=>{event.stopPropagation();void openPreview(node.id)});
    group.append(preview);
   }
   if(showHandle){
    const handle=se('circle',{cx:size.w,cy:size.h/2,r:7,fill:viToken('--ws-surface'),stroke:viToken('--ws-muted'),'stroke-width':1.6,class:'nodehandle'});
    handle.append(se('title',{},'从这里拖到另一个对象，建立关联'));
    handle.addEventListener('pointerdown',event=>{
     event.stopPropagation();
     link={id:event.pointerId,from:node.id};
     svg.querySelectorAll('#linkghost').forEach(node=>node.remove());
     const ghost=se('path',{id:'linkghost',fill:'none',stroke:viToken('--ws-muted'),'stroke-width':2,'stroke-dasharray':'5 4'});
     svg.querySelector('#spaceworld')?.append(ghost);
     try{svg.setPointerCapture?.(event.pointerId)}catch{/* 指针已失效时忽略：连线仍可按坐标落点判断 */}
    });
    group.append(handle);
   }
   return group;
  }
  /** 分类徽标形状（5 种，非图标）：颜色不单独承担区分，同色也能靠形状分开。 */
  function shapeBadge(shape,x,y,r,fill){
   const n=r*2;
   if(shape==='circle')return se('circle',{cx:x,cy:y,r,fill,class:'roleshape'});
   if(shape==='square')return se('rect',{x:x-r,y:y-r,width:n,height:n,rx:1.5,fill,class:'roleshape'});
   if(shape==='diamond')return se('polygon',{points:[[x,y-r],[x+r,y],[x,y+r],[x-r,y]].map(pair=>pair.join(',')).join(' '),fill,class:'roleshape'});
   if(shape==='triangle')return se('polygon',{points:[[x,y-r],[x+r,y+r*0.85],[x-r,y+r*0.85]].map(pair=>pair.join(',')).join(' '),fill,class:'roleshape'});
   // 默认六边形
   const points=[];
   for(let i=0;i<6;i+=1){const angle=Math.PI/180*(60*i-30);points.push([(x+Math.cos(angle)*r).toFixed(2),(y+Math.sin(angle)*r).toFixed(2)])}
   return se('polygon',{points:points.map(pair=>pair.join(',')).join(' '),fill,class:'roleshape'});
  }

  // ── 结构态：按关系角色分组 + 原地展开 + 镜头（spec/54 §1·§2） ────────────────
  const STRUCTURE='structure';
  function structureScope(){return focus?'project:'+focus:'all'}
  function nodeOf(id){return nodes.find(node=>node.id===id)}
  function cardSize(id){return sizes.get(id)??nodeSize(nodeOf(id)?.kind??'topic',0)}
  function rectOf(id){const position=structPositions[id]??childPositions[id];if(!position)return null;const size=cardSize(id);return {x:position.x,y:position.y,w:size.w,h:size.h}}
  function viewportSize(){const rect=svg.getBoundingClientRect?.()??{width:0,height:0};return {w:rect.width??0,h:rect.height??0}}
  function isNarrowViewport(){const width=viewportSize().w||0;return width>0&&width<700}
  function viewportCenter(){const {w,h}=viewportSize();if(!w||!h)return null;return {x:(w/2-gx)/zoom,y:(h/2-gy)/zoom}}
  function visualForBucket(bucket,index){
   const name=bucket.kind==='role'?bucket.label:'';
   const saved=bucket.kind==='role'?roleMap?.roleColors?.[name]:null;
   const savedShape=bucket.kind==='role'?roleMap?.roleShapes?.[name]:null;
   let colorToken=saved&&/^--pal-[a-z]+(-soft)?$/.test(saved)?saved.replace(/-soft$/,''):roleVisual(name||'other',index).colorToken;
   let shape=savedShape??roleVisual(name||'other',index).shape;
   if(bucket.kind==='unclassified'){colorToken='--pal-slate';shape='circle'}
   if(bucket.kind==='unassigned'){colorToken='--pal-slate';shape='diamond'}
   return {colorToken,shape};
  }
  /** 结构排版：每个角色一列（未分类/未归属在最后），列头是角色名与真实数量。
   *  不移动用户原有位置：会话内拖动结果放在 structMoved 里覆盖计算值（不写库）。 */
  function buildStructure(){
   // 诊断修复（2026-10-26）：这批真实组织的 defaultRole（关系角色）全是空的，61 个机构
   // 全落「未分类」，结构态首屏 39%、单桶 61 个。角色没录时先用供应链类别作为**视图分组**
   // （不写库、不改对象），让组织按「AI 加速芯片 / 客户与场景 / 标准与行业组织…」分桶；
   // 等用户补了 defaultRole，会自然切回角色分桶。
   const structureNodes=nodes.map(node=>{
    if(node.kind!=='organization')return node;
    if(String(node.defaultRole??'').trim())return node;
    const category=String(node.chainCategory??'').trim();
    return category?{...node,defaultRole:category}:node;
   });
   structureFallback=structureNodes.some((node,index)=>node!==nodes[index]);
   structure=classify({nodes:structureNodes,scope:structureScope()});
   // classify 的「未归属」口径是「没有 organizationId 也没有 partnerId」。
   // 但旧数据里只有 partnerId 的项目（A1 迁移只做 dry-run，还没映射成 participants）也必须看得见——
   // 结构态不猜它的主责机构，如实放进「未归属」桶，而不是让它在画布上消失。
   if(!focus){
    // ① 参与关系已经归属的项目不算「未归属」：classify 的未归属口径只看 organizationId/partnerId，
    //    有 participants 的项目（按角色挂在某些机构下）必须从这一桶里摘掉，否则同一个项目会出现两次。
    const attributed=new Set(nodes.filter(node=>node.kind==='project'&&(node.participants??[]).length).map(node=>node.id));
    if(attributed.size){
     for(const bucket of structure.buckets)if(bucket.kind==='unassigned')bucket.roleIds=bucket.roleIds.filter(id=>!attributed.has(id));
     structure.unassignedIds=(structure.unassignedIds??[]).filter(id=>!attributed.has(id));
     structure.buckets=structure.buckets.filter(bucket=>bucket.kind!=='unassigned'||bucket.roleIds.length);
    }
    // ② 旧数据里只有 partnerId 的项目（A1 迁移只做 dry-run，还没映射成 participants）也必须看得见：
    //    结构态不猜它的主责机构，如实放进「未归属」，而不是让它在画布上消失。
    const listed=new Set(structure.buckets.flatMap(bucket=>bucket.roleIds));
    const orphans=nodes.filter(node=>node.kind==='project'&&!listed.has(node.id)&&!String(node.organizationId??'').trim()&&!(node.participants??[]).length).map(node=>node.id);
    const missing=orphans.filter(id=>!(structure.unassignedIds??[]).includes(id));
    if(missing.length){
     const bucket=structure.buckets.find(item=>item.kind==='unassigned');
     if(bucket){bucket.roleIds.push(...missing);(structure.unassignedIds??=[]).push(...missing)}
     else{structure.unassignedIds=[...missing];structure.buckets.push({key:'unassigned',label:UNASSIGNED_LABEL,kind:'unassigned',roleIds:missing.slice(),counts:{organizations:0,projects:missing.length,tasks:0}})}
    }
   }
   const live=[];const seen=new Set();
   for(const bucket of structure.buckets)for(const id of bucket.roleIds){if(seen.has(id))continue;seen.add(id);const node=nodeOf(id);if(node)live.push(node)}
   sizes=sizeMap(live,edges);
   // 结构态卡片的最小尺寸：标题最多两行（wrapNodeTitle），卡片太矮会让两行标题与副标题压在一起。
   // 只放大结构态的卡，关系态沿用原尺寸（两态视觉一致，但结构态要容纳分类角色名）。
   const structureMin={organization:{w:220,h:86},project:{w:260,h:96},task:{w:190,h:76}};
   for(const [id,size] of sizes){const node=nodeOf(id),min=structureMin[node?.kind];if(!min)continue;sizes.set(id,{w:Math.max(size.w,min.w),h:Math.max(size.h,min.h)})}
   structPositions={};
   bucketVisual=new Map();
   // 手机（窄画布）：分类列竖排成一列分组列表 —— 390 的宽度放不下 5 列，硬挤会让文字小到读不了。
   // 桌面沿用「一角色一列」。
   const narrow=isNarrowViewport();
   if(narrow){
    let stackY=20;
    structure.buckets.forEach((bucket,index)=>{
     const visual=visualForBucket(bucket,index);bucketVisual.set(bucket.key,visual);
     const ids=bucket.roleIds.filter(id=>sizes.has(id));
     const width=Math.max(300,(viewportSize().w||340)-16);
     bucket.x=8;bucket.width=width;bucket.top=stackY;bucket.headerTop=stackY+24;
     let y=stackY+52;
     for(const id of ids){structPositions[id]={x:bucket.x+16,y};y+=(sizes.get(id)?.h??86)+14}
     bucket.height=Math.max(110,y-stackY+8);
     stackY+=bucket.height+12;
    });
   }else{
    // 桌面：对齐 demo（核心居中、分类环绕、客户/其他成底部横带），不再从左到右排成列。
    // 通用：不写死任何行业/项目分类。只有「核心/主体/自身」这类通用角色键才居中；
    // 其余分类按数据里出现的顺序依次放到上/右/下/左，多出来的进底部横带。
    // 具体分类名只存在数据里的 defaultRole，不写进产品代码。
    const isCenter=bucket=>bucket.kind==='role'&&/核心|主体|自身|中心|self/i.test(bucket.label);
    const centerBucket=structure.buckets.find(isCenter);
    // 分类顺序优先用视图配置 layout.order（用户可控）；没配就按成员数从多到少。
    // 前四类依次放上/左/右/下，其余（含客户、其他、未分类、未归属）进底部横带。
    const configured=Array.isArray(roleMap?.order)?roleMap.order.map(name=>String(name).trim()).filter(Boolean):[];
    const rank=bucket=>{const i=configured.indexOf(bucket.label);return i>=0?i:1e6};
    const ordered=structure.buckets.filter(bucket=>bucket!==centerBucket&&bucket.kind==='role')
     .sort((left,right)=>rank(left)-rank(right)||right.roleIds.length-left.roleIds.length);
    const sideFor=new Map();
    const sides=['top','left','right','bottom'];
    ordered.forEach((bucket,index)=>{sideFor.set(bucket,sides[index]||'band')});
    const sideOf=bucket=>{
     if(bucket===centerBucket)return 'center';
     if(bucket.kind!=='role')return 'band';
     return sideFor.get(bucket)??'band';
    };
    const placeGroup=(bucket,ids,side,index)=>{
     if(!ids.length){bucket.x=0;bucket.width=0;bucket.height=0;bucket.top=0;bucket.headerTop=0;return}
     if(centerBucket===bucket){
      const size=sizes.get(ids[0])??{w:300,h:120};
      structPositions[ids[0]]={x:-size.w/2,y:-size.h/2};
      bucket.x=-size.w/2-40;bucket.width=size.w+80;bucket.top=-size.h/2-56;bucket.height=size.h+96;bucket.headerTop=-size.h/2-24;
      return;
     }
     const gap=28;
     if(side==='top'||side==='bottom'){
      let x=0;const row=ids.map(id=>{const w=sizes.get(id)?.w??220,h=sizes.get(id)?.h??86;const item={id,w,h,x};x+=w+gap;return item});
      const total=x-gap;const x0=-total/2;const y=side==='top'?-470:470;
      for(const item of row)structPositions[item.id]={x:x0+item.x,y};
      bucket.x=x0-24;bucket.width=total+48;bucket.top=y-58;bucket.height=(sizes.get(ids[0])?.h??86)+110;bucket.headerTop=y-26;
      return;
     }
     if(side==='left'||side==='right'){
      const rowsPerCol=6;
      const cols=Math.ceil(ids.length/rowsPerCol);
      const colWidths=[],colHeights=[];
      for(let c=0;c<cols;c+=1){
       const slice=ids.slice(c*rowsPerCol,(c+1)*rowsPerCol);
       colWidths.push(Math.max(...slice.map(id=>sizes.get(id)?.w??220)));
       colHeights.push(slice.reduce((sum,id,i)=>sum+(sizes.get(id)?.h??86)+(i?gap:0),0));
      }
      const totalW=colWidths.reduce((a,b)=>a+b,0)+gap*(cols-1);
      const totalH=Math.max(...colHeights);
      const x0=side==='left'?-280-gap-totalW:280+gap;
      ids.forEach((id,i)=>{
       const c=Math.floor(i/rowsPerCol),r=i%rowsPerCol;
       const slice=ids.slice(c*rowsPerCol,(c+1)*rowsPerCol);
       const y=-(colHeights[c]/2)+slice.slice(0,r).reduce((sum,id2)=>sum+(sizes.get(id2)?.h??86)+gap,0);
       const colX=x0+colWidths.slice(0,c).reduce((a,b)=>a+b+gap,0);
       structPositions[id]={x:colX,y};
      });
      bucket.x=x0-24;bucket.width=totalW+48;bucket.top=-totalH/2-58;bucket.height=totalH+110;bucket.headerTop=-totalH/2-26;
      return;
     }
     // band：底部横排（每行 6 个），客户/未分类/未归属都走这里
     const perRow=6;const rows=Math.ceil(ids.length/perRow);
     const w=240,h=76;const rowWidth=perRow*w+(perRow-1)*20;
     const x0=-rowWidth/2;const y0=700+(index-1)*360;
     ids.forEach((id,i)=>{const r=Math.floor(i/perRow),c=i%perRow;structPositions[id]={x:x0+c*(w+20),y:y0+r*(h+18)}});
     bucket.x=x0-24;bucket.width=Math.min(rowWidth+48,6*260+40);bucket.top=y0-58;bucket.height=rows*(h+18)+110;bucket.headerTop=y0-26;
    };
    let bandIndex=0;
    structure.buckets.forEach((bucket,index)=>{
     const visual=visualForBucket(bucket,index);bucketVisual.set(bucket.key,visual);
     const ids=bucket.roleIds.filter(id=>sizes.has(id));
     const side=sideOf(bucket);
     if(side==='band'){bandIndex+=1}
     placeGroup(bucket,ids,side,bandIndex);
    });
   }
   // 分类顺序是视图配置（layout:ecosystem 的 order）：配了就把角色桶按它排；
   // 未分类永远最后、未归属在未分类之前（这条不受配置影响，避免"看不见未分类"）。
   const configuredOrder=Array.isArray(roleMap?.order)?roleMap.order.map(name=>String(name).trim()).filter(Boolean):[];
   if(configuredOrder.length){
    const rank=bucket=>{if(bucket.kind==='unclassified')return 1e9;if(bucket.kind==='unassigned')return 1e8;const index=configuredOrder.indexOf(bucket.label);return index>=0?index:1e7};
    structure.buckets=structure.buckets.map((bucket,index)=>({bucket,index,rank:rank(bucket)})).sort((left,right)=>left.rank-right.rank||left.index-right.index).map(item=>item.bucket);
   }
   // 分组框按实际卡片范围重算，避免框比内容大/小（之前按估算值画，实测会压叠与溢出）
   for(const bucket of structure.buckets){
    const ids=bucket.roleIds.filter(id=>structPositions[id]);
    if(!ids.length){bucket.x=0;bucket.width=0;bucket.top=0;bucket.height=0;bucket.headerTop=0;continue}
    const rs=ids.map(id=>rectOf(id)).filter(Boolean);
    if(!rs.length)continue;
    const minX=Math.min(...rs.map(r=>r.x)),minY=Math.min(...rs.map(r=>r.y));
    const maxX=Math.max(...rs.map(r=>r.x+r.w)),maxY=Math.max(...rs.map(r=>r.y+r.h));
    bucket.x=minX-24;bucket.top=minY-58;bucket.width=maxX-minX+48;bucket.height=maxY-minY+110;bucket.headerTop=minY-26;
   }
   for(const [id,position] of Object.entries(structMoved))if(structPositions[id])structPositions[id]={...position};
  }
  /** 展开布局：机构旁一列项目、项目旁一列任务（只算位置，不改父卡；不写库）。 */
  function layoutBranch(){
   childPositions={};
   if(!expandedOrg&&!expandedProject)return;
   const childIds=[];
   if(expandedOrg)for(const id of childrenOf(expandedOrg,{nodes}).items)childIds.push(id);
   if(expandedProject)for(const id of childrenOf(expandedProject,{nodes}).items)childIds.push(id);
   const visibleIds=[...new Set([...Object.keys(structPositions),...childIds])];
   const live=visibleIds.map(nodeOf).filter(Boolean);
   sizes=sizeMap(live,edges);
   const structureMin={organization:{w:220,h:86},project:{w:260,h:96},task:{w:190,h:76}};
   for(const [id,size] of sizes){const node=nodeOf(id),min=structureMin[node?.kind];if(!min)continue;sizes.set(id,{w:Math.max(size.w,min.w),h:Math.max(size.h,min.h)})}
   const center=viewportCenter();
   const occupied=Object.keys(structPositions).map(id=>rectOf(id)).filter(Boolean);
   const place=(parentId,list)=>{
    const parentRect=rectOf(parentId);if(!parentRect||!list.length)return;
    const dir=outwardDir(parentRect,center);
    const children=list.map(id=>{const size=cardSize(id);return {id,w:size.w,h:size.h}});
    const result=expandLayout({parentRect,children,occupied:[...occupied,...Object.keys(childPositions).map(id=>rectOf(id)).filter(Boolean)],dir,gap:44});
    for(const [id,position] of Object.entries(result.positions))childPositions[id]=position;
   };
   if(expandedOrg)place(expandedOrg,childrenOf(expandedOrg,{nodes}).items);
   if(expandedProject)place(expandedProject,childrenOf(expandedProject,{nodes}).items);
  }
  function branchNodeIds(){
   const ids=new Set();
   if(expandedOrg){ids.add(expandedOrg);for(const id of childrenOf(expandedOrg,{nodes}).items)ids.add(id)}
   if(expandedProject){ids.add(expandedProject);for(const id of childrenOf(expandedProject,{nodes}).items)ids.add(id)}
   return ids;
  }
  function branchRects(){return [...branchNodeIds()].map(id=>rectOf(id)).filter(Boolean)}
  function scheduleFrame(callback){return typeof requestAnimationFrame==='function'?requestAnimationFrame(callback):setTimeout(callback,16)}
  function cancelFrame(handle){if(!handle)return;if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(handle);else clearTimeout(handle)}
  /** 镜头：fitRect(机构+子节点)，220ms、缩放 0.6–1.0（spec/54 §2.3）；减动效偏好下直接到位。 */
  function cameraTo(target,{animate=true}={}){
   if(!target)return;
   const reduce=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches??false;
   const tierBefore=semanticTier(zoom);
   const apply=()=>{zoom=target.zoom;gx=target.gx;gy=target.gy;transform()};
   if(!animate||reduce||typeof performance==='undefined'){
    apply();if(semanticTier(zoom)!==tierBefore)draw();return;
   }
   cancelFrame(cameraFrame);
   const from={zoom,gx,gy},started=performance.now(),duration=220;
   const step=now=>{const t=Math.min(1,Math.max(0,(now-started)/duration)),ease=1-(1-t)**3;
    zoom=from.zoom+(target.zoom-from.zoom)*ease;gx=from.gx+(target.gx-from.gx)*ease;gy=from.gy+(target.gy-from.gy)*ease;transform();
    if(t<1)cameraFrame=scheduleFrame(step);else{cameraFrame=0;if(semanticTier(zoom)!==tierBefore)draw()}};
   cameraFrame=scheduleFrame(step);
  }
  function focusBranch(){
   const rects=branchRects();const viewport=viewportSize();
   if(!rects.length||!viewport.w||!viewport.h)return;
   const narrow=viewport.w<700;
   cameraTo(fitRect({rects,viewport,padding:narrow?24:70,minZoom:narrow?0.2:0.6,maxZoom:1}),{animate:true});
  }
  /** 结构态的空态：如实说「还没分类/还没归属」，不猜、不画假结构。 */
  function structureEmptyText(){
   if(focus)return '这个项目还没有参与机构；在项目详情里给机构标注角色后，这里按角色分组显示。';
   return '还没有可用于分组的机构；新建机构并填写分类后，这里按角色分组显示。';
  }
  /** 结构态默认是「分类总览」：这批真实组织没有关系角色，只有供应链类别；
  *  16 类 61 个机构一次摊开会 60% 缩放只看到 3 类。先画 16 张分类卡（一屏全见），
  *  点分类看机构清单，点机构看详情；不再把 61 张卡挤成一整屏。 */
 function openStructureBucket(bucket){
  const request=token=modal.begin();if(request===null)return;
  const orgs=bucket.roleIds.map(id=>nodeOf(id)).filter(Boolean);
  const rows=orgs.length
   ?'<div class="relationlist">'+orgs.map(org=>'<button class="btn" type="button" data-bucket-org="'+esc(org.id)+'">'+esc(org.title||'未命名')+'</button>').join('')+'</div>'
   :'<p>这个分类下还没有机构。</p>';
  const html=rows+'<p class="notice">点机构看它的项目与任务；这里只按分类折叠，不改数据。按 Esc 关闭。</p>';
  if(!modal.present(request,{title:bucket.label,type:'分类 · '+orgs.length+' 个机构',html:html+'<div class="modalactions"><button class="btn" id="bucketclose">关闭</button></div>'}))return;
  for(const button of document.querySelectorAll('#detailbody [data-bucket-org]'))button.onclick=()=>{const id=button.dataset.bucketOrg;modal.close();open?.(id)};
  const close=document.querySelector('#detailbody #bucketclose');if(close)close.onclick=()=>modal.close();
 }
 function drawStructureBuckets(world){
  const narrow=typeof window!=='undefined'&&window.innerWidth<700;
  const cols=narrow?2:4,cardW=260,cardH=76,gapX=20,gapY=20,startX=40,startY=48;
  structureBucketRects=[];
  const buckets=structure.buckets.filter(bucket=>bucket.roleIds.length);
  buckets.forEach((bucket,index)=>{
   const col=index%cols,row=Math.floor(index/cols);
   const x=startX+col*(cardW+gapX),y=startY+row*(cardH+gapY);
   const visual=bucketVisual.get(bucket.key)??roleVisual(bucket.label||'other',index);
   const label=bucket.kind==='unclassified'?UNCLASSIFIED_LABEL:bucket.kind==='unassigned'?UNASSIGNED_LABEL:bucket.label;
   const unit=bucket.kind==='unassigned'?'个项目':'个机构';
   const group=se('g',{class:'graphbucket-card','data-bucket-card':bucket.key,role:'button',tabindex:0,'aria-label':label+'，'+bucket.roleIds.length+unit+'，点开清单',transform:'translate('+x+' '+y+')'});
   group.append(se('rect',{width:cardW,height:cardH,rx:14,fill:viToken(visual.colorToken+'-soft'),'fill-opacity':'.55',stroke:viToken('--ws-line')}));
   group.append(se('rect',{x:0,y:10,width:4,height:cardH-20,rx:2,fill:viToken(visual.colorToken)}));
   const title=se('text',{x:18,y:28,'font-size':14,fill:viToken('--ws-ink'),'font-weight':600});title.textContent=ecoClip(label,18);group.append(title);
   const sub=se('text',{x:18,y:52,'font-size':12,fill:viToken('--ws-muted')});sub.textContent=bucket.roleIds.length+' '+unit+' · 点开清单';group.append(sub);
   const count=se('text',{x:cardW-18,y:28,'text-anchor':'end','font-size':18,fill:viToken(visual.colorToken),'font-weight':600});count.textContent=String(bucket.roleIds.length);group.append(count);
   group.append(se('title',{},label+' · '+bucket.roleIds.length+unit+'（点开清单）'));
   world.append(group);
   structureBucketRects.push({x,y,w:cardW,h:cardH});
  });
  const caption=document.querySelector('#space .spacecaption');
  if(caption)caption.textContent='点分类看机构 · 点机构看详情 · 拖动平移 · 滚轮缩放';
  transform();
  if(status){
   status.dataset.readout='1';
   const organisations=structure.buckets.filter(bucket=>bucket.kind!=='unassigned').reduce((sum,bucket)=>sum+bucket.roleIds.length,0);
   const unclassified=structure.buckets.find(bucket=>bucket.kind==='unclassified')?.roleIds.length??0;
   const unassigned=structure.buckets.find(bucket=>bucket.kind==='unassigned')?.roleIds.length??0;
   status.textContent=(structureFallback?'按供应链类别':'按分类')+'：'+buckets.length+' 类 · '+organisations+' 个机构'+(unclassified?'（未分类 '+unclassified+'）':'')+(unassigned?' · 未归属项目 '+unassigned:'')+' · 点分类看机构，点机构看详情';
  }
 }
 function drawStructure(){
   const world=canvasBase();
   const narrow=isNarrowViewport();
   svg.dataset.canvasMode=STRUCTURE;
   buildStructure();
   const structureOrgs=structure.buckets.filter(bucket=>bucket.kind!=='unassigned').reduce((sum,bucket)=>sum+bucket.roleIds.length,0);
   structureOverview=structureFallback||structure.buckets.length>6||structureOrgs>24;
   if(structureOverview){
    // 真实数据 64 个机构 / 8 类：先把分类折叠成一屏卡片，点分类看机构；
    // 小数据集（单元测试/少量机构）仍保留原来的“机构+分支”画布。
    drawStructureBuckets(world);
    return;
   }
   structureBucketRects=[];
   layoutBranch();
   const branch=branchNodeIds();
   const dimOthers=branch.size>0;
   const tier=semanticTier(zoom);
   // 低缩放：展开的子节点折叠成「N 个项目 / N 个任务」计数（spec/54 §2.2）
   const collapsedBranch=tier==='name'&&branch.size>0;
   // 外框先画（在卡片之下）：每列一个淡底 + 列头（角色名 + 真实数量）
   for(const bucket of structure.buckets){
    const visual=bucketVisual.get(bucket.key)??roleVisual('other',0);
    const frameTop=bucket.top??20;
    const frame=se('g',{class:'graphbucket','data-bucket':bucket.key,role:'group','aria-label':bucket.label+'：'+bucket.roleIds.length+' 个'});
    frame.append(se('rect',{x:bucket.x,y:frameTop,width:bucket.width,height:Math.max(110,bucket.height),rx:18,fill:viToken(visual.colorToken+'-soft'),'fill-opacity':'.5',stroke:viToken('--ws-line'),'stroke-dasharray':'5 7'}));
    const name=bucket.kind==='unclassified'?UNCLASSIFIED_LABEL:bucket.kind==='unassigned'?UNASSIGNED_LABEL:bucket.label;
    const unit=bucket.kind==='unassigned'?'个项目':'个机构';
    const headY=(bucket.headerTop??48);
    const head=se('text',{x:bucket.x+22,y:headY,'font-size':15,fill:viToken('--ws-ink'),'font-weight':600},name+' · '+bucket.roleIds.length+' '+unit);
    head.append(se('title',{},'角色：'+name+'（点列内机构展开它的项目）'));
    frame.append(head,shapeBadge(bucket.kind==='role'?visual.shape:'circle',bucket.x+bucket.width-30,headY-6,6,viToken(visual.colorToken)));
    world.append(frame);
   }
   if(!structure.buckets.length){
    world.append(se('text',{x:40,y:120,'font-size':15,fill:viToken('--ws-muted')},structureEmptyText()));
   }
   // demo 的「网络感」：核心到各分类的虚线导引（只是视觉关系，不写业务数据）
   if(!narrow){
    const centerBucket=structure.buckets.find(bucket=>bucket.kind==='role'&&/核心|主体|自身|中心|self/.test(bucket.label));
    const centerId=centerBucket?.roleIds?.[0];
    const centerRect=centerId?rectOf(centerId):null;
    if(centerRect){
     const cx0=centerRect.x+centerRect.w/2,cy0=centerRect.y+centerRect.h/2;
     for(const bucket of structure.buckets){
      if(bucket===centerBucket||!bucket.roleIds.length)continue;
      const hx=bucket.x+bucket.width/2,hy=bucket.headerTop??48;
      world.append(se('path',{class:'graphguide',d:'M'+cx0+' '+cy0+' L'+hx+' '+hy,fill:'none',stroke:viToken('--ws-line'),'stroke-width':1.1,'stroke-dasharray':'3 7','stroke-opacity':'.55'}));
     }
    }
   }

   // 连线：父卡→子卡实线（明确、已确认的结构关系）
   for(const id of Object.keys(childPositions)){
    const parentId=expandedProject&&childrenOf(expandedProject,{nodes}).items.includes(id)?expandedProject:expandedOrg;
    const parentRect=parentId?rectOf(parentId):null,childRect=rectOf(id);
    if(!parentRect||!childRect)continue;
    const fromRight=childRect.x>parentRect.x;
    const x1=fromRight?parentRect.x+parentRect.w:parentRect.x,x2=fromRight?childRect.x:childRect.x+childRect.w;
    const y1=parentRect.y+parentRect.h/2,y2=childRect.y+childRect.h/2;
    world.append(se('path',{class:'graphbranchline',d:`M${x1} ${y1} L${x2} ${y2}`,fill:'none',stroke:viToken('--ws-line'),'stroke-width':1.6}));
   }
   // 顶层卡片
   for(const bucket of structure.buckets){
    const visual=bucketVisual.get(bucket.key)??roleVisual('other',0);
    for(const id of bucket.roleIds){
     const node=nodeOf(id),position=structPositions[id];if(!node||!position)continue;
     const accent=bucket.kind==='role'?visual.colorToken:null;
     const extra=bucket.kind==='role'?bucket.label:bucket.kind==='unclassified'?UNCLASSIFIED_LABEL:bucket.kind==='unassigned'?UNASSIGNED_LABEL:'';
     const card=nodeCard(node,position,{compact:true,accent,roleShape:bucket.kind==='role'?visual.shape:null,extraSubtitle:extra,dim:dimOthers&&!branch.has(id)});
     if(id===expandedOrg||id===expandedProject)card.dataset.expanded='1';
     world.append(card);
    }
   }
   // 展开的子卡（低缩放时改画计数胶囊）
   for(const id of Object.keys(childPositions)){
    const node=nodeOf(id),position=childPositions[id];if(!node||!position)continue;
    if(collapsedBranch)continue;
    const card=nodeCard(node,position,{compact:true});
    card.dataset.branchChild='1';
    world.append(card);
   }
   if(collapsedBranch){
    const parentId=expandedProject??expandedOrg;
    const parentRect=parentId?rectOf(parentId):null;
    if(parentRect){
     const counts=new Map();
     for(const id of Object.keys(childPositions)){const kind=nodeOf(id)?.kind??'topic';counts.set(kind,(counts.get(kind)??0)+1)}
     const text=[...counts].map(([kind,count])=>count+' 个'+(kindLabels[kind]??'对象')).join(' · ');
     const isLeft=(viewportCenter()?.x??0)>parentRect.x;
     const pill=se('g',{class:'graphbranchcount','data-branch-count':'1'});
     pill.append(se('rect',{x:isLeft?parentRect.x+parentRect.w+20:parentRect.x-20-150,y:parentRect.y+parentRect.h/2-16,width:150,height:32,rx:16,fill:viToken('--ws-surface'),stroke:viToken('--ws-line')}));
     pill.append(se('text',{x:isLeft?parentRect.x+parentRect.w+95:parentRect.x-95,y:parentRect.y+parentRect.h/2+5,'text-anchor':'middle','font-size':12,fill:viToken('--ws-muted')},text));
     world.append(pill);
    }
   }
   transform();
   if(status){
    const organisations=structure.buckets.filter(bucket=>bucket.kind!=='unassigned').reduce((sum,bucket)=>sum+bucket.roleIds.length,0);
    const unclassified=structure.buckets.find(bucket=>bucket.kind==='unclassified')?.roleIds.length??0;
    const unassigned=structure.buckets.find(bucket=>bucket.kind==='unassigned')?.roleIds.length??0;
    const branchText=expandedOrg||expandedProject?' · 已展开 '+(expandedOrg?nodeOf(expandedOrg)?.title??'':'')+(expandedProject?' → '+(nodeOf(expandedProject)?.title??''):''):'';
    status.dataset.readout='1';
    const capacity=structureFallback?{overCap:false,message:''}:capacityReport({bucketCount:structure.buckets.length,nodeCount:structure.buckets.reduce((max,bucket)=>Math.max(max,bucket.roleIds.length),0)});
    status.textContent=structure.buckets.length
     ?(structureFallback?'按供应链类别':'按分类')+'：'+structure.buckets.length+' 类 · '+organisations+' 个机构'+(unclassified?'（未分类 '+unclassified+'）':'')+(unassigned?' · 未归属项目 '+unassigned:'')+' · 单击机构展开项目，双击看详情'+branchText+(capacity.overCap?' · '+capacity.message:'')
     :structureEmptyText();
   }
  }
 function openPendingRelations(){
  const pending=(relationList??[]).filter(rel=>rel.status==='suggested');
  const request=token=modal.begin();if(request===null)return;
  const html='<div class="relationlist">'+(pending.map(rel=>{
    const from=nodes.find(node=>node.id===rel.from),to=nodes.find(node=>node.id===rel.to);
    return '<button class="btn" type="button" data-pendingrel="'+esc(rel.id)+'">'+esc((from?.title||'未知')+' ↔ '+(to?.title||'未知'))+' · '+esc(rel.title||'待判断')+'</button>';
  }).join('')||'<p>没有待确认的关系。</p>')+'</div><p class="notice">这些是 Agent 或外部研究提出的候选关系；确认后才会成为事实。</p>';
  if(!modal.present(request,{title:'待确认 · '+pending.length+' 条',type:'候选关系',html:html+'<div class="modalactions"><button class="btn" id="pendingclose">关闭</button></div>'}))return;
  for(const button of document.querySelectorAll('#detailbody [data-pendingrel]'))button.onclick=()=>{const id=button.dataset.pendingrel;modal.close();edgeDialog(id)};
  const close=document.querySelector('#detailbody #pendingclose');if(close)close.onclick=()=>modal.close();
 }
 function drawRelations(){
  const world=canvasBase();
  // 星点结构底纹：以焦点（或连接最多的项目）为圆心画三圈；只在有节点时出现，缩放时跟随。
  const ringHub=(()=>{const degree=new Map();for(const edge of edges){if(edge.status==='rejected')continue;degree.set(edge.from,(degree.get(edge.from)??0)+1);degree.set(edge.to,(degree.get(edge.to)??0)+1)}return (focus&&positions[focus]?focus:(nodes.filter(n=>n.kind==='project').sort((a,b)=>(degree.get(b.id)??0)-(degree.get(a.id)??0))[0]?.id))})();
  const hubPosition=ringHub?positions[ringHub]:null;
  if(hubPosition){
   const hubSize=sizes.get(ringHub)??{w:200,h:86};
   for(const radius of [360,650,930])world.append(se('circle',{cx:hubPosition.x+hubSize.w/2,cy:hubPosition.y+hubSize.h/2,r:radius,fill:'none',stroke:viToken('--ws-action'),'stroke-opacity':'.16','stroke-dasharray':'4 10'}));
  }
  const hidden=hiddenByGroups(groups);
  const allLive=shown(),live=allLive.filter(node=>!hidden.has(node.id));
  // 尺寸表在 live 之后算一次：分组框、节点、框选三处共用同一份。
  // 踩过两次作用域坑：放分组循环体里 → 循环外拿不到；放 draw 开头 → live 还没初始化。
  sizes=sizeMap(live,edges);
  const visible=visibleEdges(allLive,edges,scope).filter(edge=>!hidden.has(edge.from)&&!hidden.has(edge.to));
  const {kept:liveEdges,dropped:droppedEdges}=showAllEdges?{kept:visible,dropped:[]}:capEdges(visible);
  // 分组框画在节点之下：成员位置决定包围盒。点标题折叠/展开、双击改名、× 解散——都只改视图，随 layout 保存。
  for(const group of groups){
   const members=group.nodeIds.map(id=>({node:allLive.find(item=>item.id===id),position:positions[id]})).filter(item=>item.node);
   const box=groupBounds(members,{padding:18,titleHeight:26},sizes);if(!box)continue;
   const frame=se('g',{class:'graphgroup','data-group':group.id,tabindex:0,role:'button','aria-label':'分组 '+(group.title||'')+'，'+group.nodeIds.length+' 个对象'});
   frame.append(se('rect',{x:box.x,y:box.y,width:box.width,height:box.height,rx:22,fill:viToken('--ws-action-soft'),'fill-opacity':'.55',stroke:viToken('--ws-line'),'stroke-dasharray':'6 5'}));
   const label=se('text',{x:box.x+14,y:box.y+19,'font-size':12,fill:viToken('--ws-ink'),'font-weight':550});
   label.textContent=(group.collapsed?'▸ ':'▾ ')+(group.title||'分组')+' · '+group.nodeIds.length;
   label.append(se('title',{},'点击折叠/展开；双击改名；右侧 × 解散分组'));
   const remove=se('text',{x:box.x+box.width-20,y:box.y+19,'font-size':14,fill:viToken('--ws-muted'),class:'groupremove'});
   remove.textContent='×';remove.append(se('title',{},'解散分组（只解散分组，不删除对象）'));
   frame.append(label,remove);
   frame.addEventListener('click',event=>{
    pushHistory();
    if(event.target===remove){groups=groups.filter(item=>item.id!==group.id);markDirtyLayout();draw();return}
    group.collapsed=!group.collapsed;markDirtyLayout();draw();
   });
   frame.addEventListener('dblclick',event=>{event.preventDefault();void renameGroup(group)});
   world.append(frame);
  }
  for(const edge of liveEdges){
   const a=positions[edge.from],b=positions[edge.to];if(!a||!b)continue;
   // 待确认建议与「已确认但依据失效」都画成虚线：前者未经确认，后者不再可信。
   const suggested=edge.status==='suggested',review=Boolean(edge.stale);const dashed=suggested||review;
   // VI §8 V1 来源三态：AI 推的必须是「紫 + 虚线 + **「AI 判断」文字**」三样齐全。
   // 原来只有紫与虚线，文字一次都没出现过 —— 颜色不得单独承担判断（VI §2 / 宪章第八条）。
   const sourceLabel=suggested?'AI 判断':'';
   const group=se('g',{class:'graphlink',tabindex:0,role:'button','data-edge':edge.id,'aria-label':(edge.title||'关联')+'，'+(review?'依据已变化，待复核':suggested?'AI 判断，待确认建议':'已明确记录')});
   const sa=sizes.get(edge.from)??{w:170,h:74},sb=sizes.get(edge.to)??{w:170,h:74};
   const ax=a.x+sa.w/2,ay=a.y+sa.h/2,bx=b.x+sb.w/2,by=b.y+sb.h/2,d=`M${ax} ${ay} L${bx} ${by}`;
   const active=selection.has(edge.from)||selection.has(edge.to)||focus===edge.from||focus===edge.to;
   group.append(se('path',{d,class:'graph-hit'}),se('path',{d,fill:'none',stroke:review?viToken('--ws-warning'):suggested?viToken('--ws-knowledge'):active?viToken('--ws-action'):viToken('--ws-line'),'stroke-width':active?2.2:1.4,'stroke-opacity':active?'0.95':'0.7','stroke-dasharray':dashed?'6 6':'none'}));
   if(showsEdgeLabels(zoom)){
    const mx=(ax+bx)/2,my=(ay+by)/2,label=se('g',{class:'graph-minor graphlabel'});
    const labelText=(sourceLabel?sourceLabel+' · ':'')+(edge.title||'')+(review?' · 待复核':'');const labelWidth=labelText.length*10+16;
    label.append(se('rect',{x:mx-labelWidth/2,y:my-11,width:labelWidth,height:20,rx:7,fill:viToken('--ws-surface')}),se('text',{x:mx,y:my+3,'text-anchor':'middle','font-size':10,fill:review?viToken('--ws-warning'):suggested?viToken('--ws-knowledge'):viToken('--ws-muted')},labelText));
    group.append(label);
   }
   world.append(group);
  }
  for(const node of live){const position=positions[node.id];if(!position)continue;world.append(nodeCard(node,position,{showHandle:true}));}
  transform();
  if(status)status.dataset.readout='1';
  if(status)status.textContent=nodes.length?(()=>{
   const summary=dataSummary();
   const capText=showAllEdges?'':'（单个对象最多显示 12 条）';
   const prefix='全网 · 组织 '+summary.orgs+'（已实现 '+summary.verified+' / 待核对 '+summary.pending+'）· 项目 '+summary.projects+' · 任务 '+summary.tasks+' · 待确认 '+summary.pendingRelations;
   const pendingText=scope==='suggestions'?` · 待确认 ${summary.pendingRelations} 条，当前看第 1 条（点连线用操作条处理，处理完看下一条）`:'';
   return `${prefix} · 当前显示 ${live.length} 个${showCandidates?'（候选已展开）':'（候选已折叠，前 5 + 有项目展开）'}${selection.size?' · 已选 '+selection.size+' 个':''}${droppedEdges.length?' · 已隐藏 '+droppedEdges.length+' 条关联'+capText:''}${pendingText}`;
  })():'暂无关联对象；创建项目、任务或资料后在此显示。';
 }

 // ── 生态视图（2026-10-26 用户口径）────────────────────────────────────────
 // 底图 297 节点是外部研究资料，只读；工作台里已有的组织和任务叠在上面。
 // 对得上底图的组织“点亮”底图节点；对不上但打了供应链标签的对象按标签落到对应层；
 // 没标签的对象进「未分类 · 待定位」；其余底图节点保持灰色高透明，只作背景。
 const ECO_THREAD_LABEL={ascend:'样例加速卡主线',kunpeng:'样例通用芯片主线',harmony:'样例操作系统主线',base:'公共底座'};
 const ECO_TYPE_LABEL={organization:'组织',task:'任务'};
 const ecoClip=(value,length)=>{const text=String(value??'');return text.length>length?text.slice(0,length-1)+'…':text};
 const ecoSourceLabel=node=>node.source==='project'?'由项目直接实现':node.source==='agent'?'Agent 整理':node.source==='external'?'外部研究':node.verified?'已确认':'待核对';
 function ecoLayerToken(layer){const item=ECOSYSTEM_MAP.layers.find(entry=>entry.id===layer);return item?.colorToken||'--pal-slate'}
 function ecoThreadToken(thread){const item=ECOSYSTEM_MAP.threads.find(entry=>entry.id===thread);return item?.colorToken||'--pal-slate'}
 function ecoBuild(){
  if(!ecoLayout){
   const orgs=nodes.filter(node=>node.kind==='organization');
   ecoLayout=ecoView==='base'
    ?buildEcosystemLayout({map:ECOSYSTEM_MAP,orgs,tasks:[]})
    :buildEcosystemFocusLayout({map:ECOSYSTEM_MAP,orgs,cols:(viewportSize().w||1440)<700?2:7});
  }
  return ecoLayout;
 }
 function ensureEcoPanel(){
  if(ecoPanel)return ecoPanel;
  const host=document.querySelector('#space .spacestage');if(!host)return null;
  ecoPanel=document.createElement('aside');ecoPanel.className='ecopanel';ecoPanel.dataset.ecopanel='1';ecoPanel.hidden=true;ecoPanel.setAttribute('aria-label','生态视图 · 对象详情');
  const head=document.createElement('header');head.className='ecopanel-head';
  const title=document.createElement('div');title.className='ecopanel-title';
  const name=document.createElement('b');name.dataset.ecoName='1';
  const type=document.createElement('span');type.className='ecopanel-type';type.dataset.ecoType='1';
  title.append(name,type);
  const close=document.createElement('button');close.type='button';close.className='ecopanel-close';close.dataset.ecoClose='1';close.setAttribute('aria-label','关闭详情');close.textContent='×';close.onclick=()=>closeEcoPanel();
  head.append(title,close);
  const body=document.createElement('div');body.className='ecopanel-body';body.dataset.ecoBody='1';
  const foot=document.createElement('footer');foot.className='ecopanel-foot';foot.dataset.ecoFoot='1';
  ecoPanel.append(head,body,foot);host.append(ecoPanel);
  return ecoPanel;
 }
 function ensureEcoLegend(){
  if(ecoLegend)return ecoLegend;
  const host=document.querySelector('#space .spacestage');if(!host)return null;
  ecoLegend=document.createElement('div');ecoLegend.className='ecolegend';ecoLegend.dataset.ecolegend='1';ecoLegend.hidden=true;
  const item=(tone,text)=>{const span=document.createElement('span');const dot=document.createElement('i');dot.dataset.tone=tone;span.append(dot,document.createTextNode(text));return span};
  ecoLegend.append(item('vivid','已录入组织 · 点类别/组织'),item('cluster','类别卡 · 点开清单'),item('ghost','底图（可开关）'),item('ai','虚线 = AI 建议关系'));
  const source=document.createElement('span');source.className='ecosrc';source.textContent='底图 2026-10-26 · 外部研究整理';ecoLegend.append(source);
  const toggle=document.createElement('button');toggle.type='button';toggle.className='btn btn-sm';toggle.dataset.ecobasetoggle='1';toggle.textContent='显示底图';toggle.setAttribute('aria-pressed','false');
  toggle.onclick=()=>{
   ecoView=ecoView==='base'?'focus':'base';ecoLayout=null;ecoSelected=null;if(ecoPanel)ecoPanel.hidden=true;
   toggle.textContent=ecoView==='base'?'只看组织':'显示底图';toggle.setAttribute('aria-pressed',String(ecoView==='base'));
   draw();fit();
  };
  ecoLegend.append(toggle);
  host.append(ecoLegend);return ecoLegend;
 }
 function ensureEcoLayerBadge(){
  if(ecoLayerBadge)return ecoLayerBadge;
  const host=document.querySelector('#space .spacestage');if(!host)return null;
  ecoLayerBadge=document.createElement('div');ecoLayerBadge.className='ecolayerbadge';ecoLayerBadge.dataset.ecolayerbadge='1';ecoLayerBadge.hidden=true;
  host.append(ecoLayerBadge);return ecoLayerBadge;
 }
 /** 视口中心落在哪一层：横向平移时层名会移出视口，这个徽标始终告诉用户“现在看的是哪一层”。 */
 function updateEcoLayerBadge(){
  if(mode!=='ecosystem'){if(ecoLayerBadge)ecoLayerBadge.hidden=true;return}
  const badge=ensureEcoLayerBadge();if(!badge)return;
  const layout=ecoBuild(),viewport=viewportSize();
  // 组织视图一屏就包含所有层，再显示“当前看 L4”会误导；底图视图才需要这个定位徽标。
  if(layout.focus){badge.hidden=true;return}
  if(!viewport.w||!viewport.h){badge.hidden=true;return}
  const centerY=(viewport.h/2-gy)/zoom;
  const band=layout.bands.find(item=>centerY>=item.top&&centerY<=item.top+item.height)
   ||(layout.unclassified&&centerY>=layout.unclassified.top&&centerY<=layout.unclassified.top+layout.unclassified.height?layout.unclassified:null);
  if(!band){badge.textContent='当前看：全图';badge.hidden=false;return}
  badge.textContent='当前看：'+(band.label||'未分类 · 待定位');
  badge.hidden=false;
 }
 function ecoChipRow(items){
  const row=document.createElement('div');row.className='ecopanel-chips';
  for(const entry of items){if(!entry)continue;const chip=document.createElement('span');chip.className='ecopanel-chip';if(entry.tone)chip.dataset.tone=entry.tone;chip.textContent=entry.text;row.append(chip)}
  return row;
 }
 function ecoSection(body,title,items,emptyText,{clickable=true,rowOf,onRow}={}){
  const section=document.createElement('section');section.className='ecopanel-sec';
  const heading=document.createElement('h4');heading.textContent=title+' · '+items.length;section.append(heading);
  if(!items.length){const empty=document.createElement('p');empty.className='ecopanel-empty';empty.textContent=emptyText;section.append(empty);}
  else for(const item of items){
   const [label,meta]=rowOf?rowOf(item):[item.title||'未命名',''];
   if(!clickable){const row=document.createElement('div');row.className='ecopanel-row ecopanel-row-static';const bold=document.createElement('b');bold.textContent=label;const span=document.createElement('span');span.textContent=meta||'';row.append(bold,span);section.append(row);continue}
   const row=document.createElement('button');row.type='button';row.className='ecopanel-row';row.dataset.ecoOpen=item.id;
   const bold=document.createElement('b');bold.textContent=label;const span=document.createElement('span');span.textContent=meta||'';row.append(bold,span);
   row.onclick=()=>{if(onRow)onRow(item);else if(open)open(item.id)};
   section.append(row);
  }
  body.append(section);
 }
 function openEcoPanel({objectId='',baseId='',clusterKey=''}={}){
  const panel=ensureEcoPanel();if(!panel)return;
  const nameEl=panel.querySelector('[data-eco-name]'),typeEl=panel.querySelector('[data-eco-type]'),
   body=panel.querySelector('[data-eco-body]'),foot=panel.querySelector('[data-eco-foot]');
  body.replaceChildren();foot.replaceChildren();
  if(clusterKey){
   const cluster=ecoClusterOf(ecoBuild(),clusterKey);
   if(!cluster){closeEcoPanel();return}
   ecoSelected={clusterKey};
   nameEl.textContent=cluster.title||'类别';
   typeEl.textContent='分类 · '+cluster.count+' 个组织';
   const chips=[];
   if(cluster.layer)chips.push({text:cluster.layer});
   chips.push({text:cluster.count+' 个组织'});
   body.append(ecoChipRow(chips));
   const members=(cluster.memberIds??[]).map(id=>nodes.find(item=>item.id===id)).filter(Boolean);
   ecoSection(body,'组织',members,'这个类别下还没有组织。',{rowOf:item=>[item.title||'未命名',(item.verified?'已实现 · ':'待核对 · ')+(item.chainLayer?item.chainLayer+' · '+(item.chainCategory||''):'未落层')],onRow:item=>openEcoPanel({objectId:item.id})});
   const note=document.createElement('p');note.className='ecopanel-note';note.textContent='点组织看它的项目与任务；这里只折叠呈现，不改分类。';
   body.append(note);
   panel.hidden=false;
   if(mode==='ecosystem')draw();
   return;
  }
  if(objectId){
   const node=nodes.find(item=>item.id===objectId);if(!node){closeEcoPanel();return}
   ecoSelected={objectId};
   nameEl.textContent=node.title||'未命名';
   typeEl.textContent=(node.kind==='task'?'任务':'组织')+(node.kind==='organization'&&node.verified!==true?' · 待核对':' · 已确认');
   const chips=[];
   if(node.kind==='organization')chips.push({text:ecoSourceLabel(node),tone:node.verified?'':'muted'});
   if(node.chainLayer)chips.push({text:node.chainLayer});
   if(node.chainCategory)chips.push({text:node.chainCategory});
   for(const thread of node.chainThreads??[])chips.push({text:ECO_THREAD_LABEL[thread]||thread});
   if(node.chainSource==='ai')chips.push({text:'AI 判断',tone:'ai'});
   if(!chips.length)chips.push({text:node.kind==='task'?'还没有供应链标签':'还没有供应链标签',tone:'muted'});
   body.append(ecoChipRow(chips));
   if(node.kind==='organization'){
    const projects=nodes.filter(item=>item.kind==='project'&&(item.organizationId===objectId||item.partnerId===objectId||(item.participants??[]).some(entry=>entry.organizationId===objectId)));
    const projectIds=new Set(projects.map(item=>item.id));
    const tasks=nodes.filter(item=>item.kind==='task'&&projectIds.has(item.projectId));
    ecoSection(body,'项目',projects,'这个组织还没有归属项目。在项目详情里把它设为主责机构或合作机构后，这里会自动出现。',{rowOf:item=>[item.title,item.businessStatus?statusLabels[item.businessStatus]||item.businessStatus:'项目']});
    ecoSection(body,'任务',tasks,'这些项目下还没有任务；建任务时选上所属项目即可。',{rowOf:item=>[item.title,projectIds.has(item.projectId)?(nodeOf(item.projectId)?.title??'任务'):'任务']});
    const relations=(relationList??[]).filter(rel=>rel.from===objectId||rel.to===objectId);
    ecoSection(body,'关系',relations,'还没有和这个组织相关的关系。',{clickable:false,rowOf:rel=>{const other=nodeOf(rel.from===objectId?rel.to:rel.from);return [other?.title||'未知对象',rel.status==='suggested'?'AI 建议 · 待确认':rel.status==='confirmed'?'已确认':'已失效']}});
   }else{
    const project=nodeOf(node.projectId);
    if(project)ecoSection(body,'所属项目',[project],'这个任务还没有所属项目。',{rowOf:item=>[item.title,'项目']});
    const siblings=nodes.filter(item=>item.kind==='task'&&item.projectId===node.projectId&&item.id!==objectId);
    ecoSection(body,'同一项目下的其他任务',siblings,'这个项目下没有其他任务。',{rowOf:item=>[item.title,statusLabels[item.businessStatus]||item.businessStatus||'任务']});
    const relations=(relationList??[]).filter(rel=>rel.from===objectId||rel.to===objectId);
    ecoSection(body,'关系',relations,'还没有和这个任务相关的关系。',{clickable:false,rowOf:rel=>{const other=nodeOf(rel.from===objectId?rel.to:rel.from);return [other?.title||'未知对象',rel.status==='suggested'?'AI 建议 · 待确认':rel.status==='confirmed'?'已确认':'已失效']}});
   }
   const editButton=document.createElement('button');editButton.type='button';editButton.className='btn';editButton.dataset.ecoEdit='1';editButton.textContent='改分类';editButton.onclick=()=>ecoEditLabels(node);
   const openButton=document.createElement('button');openButton.type='button';openButton.className='btn primary';openButton.textContent='打开详情';openButton.onclick=()=>{if(open)open(objectId)};
   if(node.kind==='organization'&&node.verified!==true){
    const confirmButton=document.createElement('button');confirmButton.type='button';confirmButton.className='btn';confirmButton.dataset.ecoConfirm='1';confirmButton.textContent='确认这个组织';confirmButton.onclick=()=>void confirmOrganization(node);
    foot.append(confirmButton,editButton,openButton);
   }else foot.append(editButton,openButton);
  }else{
   const base=(ECOSYSTEM_MAP.nodes??[]).find(item=>item.id===baseId);if(!base){closeEcoPanel();return}
   ecoSelected={baseId};
   nameEl.textContent=base.name;typeEl.textContent='底图节点 · 未录入工作台';
   const chips=[{text:base.layer}];if(base.cat)chips.push({text:base.cat});for(const thread of base.threads??[])chips.push({text:ECO_THREAD_LABEL[thread]||thread});
   body.append(ecoChipRow(chips));
   if(base.sub){const sub=document.createElement('p');sub.className='ecopanel-note';sub.textContent=base.sub;body.append(sub)}
   if(base.desc){const desc=document.createElement('p');desc.className='ecopanel-note';desc.textContent=base.desc;body.append(desc)}
   const note=document.createElement('p');note.className='ecopanel-empty';note.textContent='这是研究底图里的节点，还没有录入工作台。把对应组织录进来后，它会点亮，并在这里显示项目与任务。';body.append(note);
  }
  panel.hidden=false;
  if(mode==='ecosystem')draw();
 }
 /** 改分类：分类是 AI 整理的，不是圣旨——用户要能当场改，保存后立刻生效、可撤销。
  *  只改 5 个标签字段，其余对象字段原样保留（从 get 拿完整对象再合并，不整条覆盖）。 */
 function ecoEditLabels(node){
  const panel=ensureEcoPanel();if(!panel)return;
  const body=panel.querySelector('[data-eco-body]'),foot=panel.querySelector('[data-eco-foot]');
  body.replaceChildren();foot.replaceChildren();
  const form=document.createElement('form');form.className='ecopanel-form';form.dataset.ecoLabelsForm='1';
  form.addEventListener('submit',event=>event.preventDefault());
  const field=(text,control)=>{const wrap=document.createElement('label');wrap.className='ecopanel-field';wrap.append(document.createTextNode(text),control);return wrap};
  const option=(value,label)=>{const node=document.createElement('option');node.value=value;node.textContent=label;return node};
  // 全站下拉只有 vi-select 一个实现（controlOwners）：这里生成同一套控件，不手搓原生下拉。
  const layerHost=document.createElement('div');
  layerHost.innerHTML=selectHtml({name:'layer',attribute:'data-eco-field',value:node.chainLayer||'',id:'ecolayersel',
   options:[['','未分类'],...ECOSYSTEM_MAP.layers.map(layer=>[layer.id,(layer.short||layer.id)+' · '+layer.name])]});
  const categoryInput=document.createElement('input');categoryInput.className='ecopanel-input';categoryInput.dataset.ecoField='category';
  categoryInput.value=node.chainCategory||'';categoryInput.maxLength=40;categoryInput.placeholder='例如：AI 加速芯片 / 云与算力服务';
  const list=document.createElement('datalist');list.id='ecocatecategories';
  const seen=new Set();
  for(const item of ECOSYSTEM_MAP.nodes){if(!item.cat||seen.has(item.cat))continue;seen.add(item.cat);list.append(option(item.cat,item.cat))}
  categoryInput.setAttribute('list',list.id);
  const threads=document.createElement('div');threads.className='ecopanel-threads';
  for(const thread of ECOSYSTEM_MAP.threads){
   const label=document.createElement('label');
   const box=document.createElement('input');box.type='checkbox';box.value=thread.id;box.dataset.ecoThread=thread.id;box.checked=(node.chainThreads??[]).includes(thread.id);
   label.append(box,document.createTextNode(thread.name));
   threads.append(label);
  }
  form.append(field('层级',layerHost),field('环节',categoryInput),field('主线（可多选）',threads),list);
  const hint=document.createElement('p');hint.className='ecopanel-note';hint.textContent='保存后立刻生效，左下角可以撤销。拿不准就留「未分类」，不要硬塞。';
  body.append(form,hint);
  wireSelects(form,{document});
  const cancel=document.createElement('button');cancel.type='button';cancel.className='btn';cancel.textContent='取消';cancel.onclick=()=>openEcoPanel({objectId:node.id});
  const save=document.createElement('button');save.type='button';save.className='btn primary';save.dataset.ecoLabelsSave='1';save.textContent='保存分类';
  save.onclick=()=>void ecoSaveLabels(node,form,save);
  foot.append(cancel,save);
 }
 async function confirmOrganization(node){
  try{
   const fetched=await send('get',{id:node.id});const item=fetched?.item;if(!item)throw Error('读不到这个组织，请稍后再试');
   if(!batch?.apply)throw Error('这里暂时不能确认，请稍后再试');
   const data={...item.data,source:'user',verified:true};
   await batch.apply('确认组织：'+(item.data.title||''),[{op:'update',id:node.id,expectedRevision:item.revision,data}],{label:'这个组织'});
   notify('已确认这个组织 · 左下角可以撤销');
   const current=nodes.find(entry=>entry.id===node.id);
   if(current)Object.assign(current,{source:'user',verified:true,revision:item.revision+1});
   ecoLayout=null;draw();openEcoPanel({objectId:node.id});
  }catch(error){notify(error?.message||'确认组织失败',true)}
 }
 async function ecoSaveLabels(node,form,saveButton){
  if(saveButton)saveButton.disabled=true;
  try{
   const fetched=await send('get',{id:node.id});
   const item=fetched?.item;
   if(!item)throw Error('读不到这个对象，请稍后再试');
   const layer=form.querySelector('[data-eco-field="layer"]')?.value||'';
   const category=(form.querySelector('[data-eco-field="category"]')?.value||'').trim();
   const threads=[...form.querySelectorAll('[data-eco-thread]')].filter(box=>box.checked).map(box=>box.value);
   if(!batch?.apply)throw Error('这里暂时不能保存分类，请到对象详情里编辑');
   const data={...item.data,chainLayer:layer,chainCategory:category,chainThreads:threads,chainFlags:Array.isArray(item.data.chainFlags)?item.data.chainFlags:[],chainSource:'user'};
   await batch.apply('改供应链分类：'+(item.data.title||''),[{op:'update',id:node.id,expectedRevision:item.revision,data}],{label:'这次分类'});
   notify('分类已保存 · 左下角可以撤销');
   // 提交已成功：直接更新本地投影并重排，不整页 load —— 否则会和 onCommitted 触发的刷新抢 epoch，
   // 偶发把弹窗重现成旧标签（2026-10-26 端到端实测）。
   const current=nodes.find(entry=>entry.id===node.id);
   if(current)Object.assign(current,{chainLayer:layer,chainCategory:category,chainThreads:threads,chainFlags:data.chainFlags,chainSource:'user',revision:item.revision+1});
   ecoLayout=null;
   if(mode==='ecosystem')draw();
   openEcoPanel({objectId:node.id});
  }catch(error){
   if(saveButton)saveButton.disabled=false;
   notify(error?.message||'保存分类失败',true);
  }
 }
 function closeEcoPanel(){
  if(ecoPanel)ecoPanel.hidden=true;
  ecoSelected=null;
  if(mode==='ecosystem')draw();
 }
 function ecoCardColour(card){return card._kind==='task'?viToken('--pal-teal'):viToken(ecoLayerToken(card.layer))}
 function ecoCardBackground(card){return card._kind==='task'?viToken('--pal-teal-soft'):viToken(ecoLayerToken(card.layer)+'-soft')}
 function drawEcoCard(card,tier){
  const selected=Boolean(ecoSelected&&((ecoSelected.objectId&&ecoSelected.objectId===card.objectId)||(ecoSelected.baseId&&ecoSelected.baseId===card.baseId)));
  if(card._kind==='base'){
   // 灰点不是装饰：整张卡都要能点。fill:'none' 在 SVG 默认 visiblePainted 下只有描边/文字可命中，
   // 实测点卡面中间会命中层带后被当成空白（诊断报告 P0）。用透明填充 + pointer-events:all 修。
   const group=se('g',{class:'econode econode-ghost','data-eco-base':card.baseId,role:'button',tabindex:-1,'pointer-events':'all','aria-label':card.title+'，底图节点，未录入工作台',transform:'translate('+card.x+' '+card.y+')'});
   group.append(se('rect',{width:card.w,height:card.h,rx:9,fill:'transparent','fill-opacity':'0','pointer-events':'all',stroke:viToken('--ws-line'),'stroke-width':1,'stroke-opacity':selected?'.9':'.4','stroke-dasharray':'3 4'}));
   group.append(se('circle',{cx:12,cy:card.h/2,r:2.4,fill:viToken('--ws-muted'),'fill-opacity':'.45'}));
   if(tier!=='low'){const text=se('text',{x:22,y:card.h/2+4,'font-size':12,fill:viToken('--ws-muted'),'fill-opacity':'.52'});text.textContent=ecoClip(card.title,11);group.append(text)}
   group.append(se('title',{},card.title+(card.sub?' · '+card.sub:'')+'（底图节点，未录入）'));
   return group;
  }
  if(card._kind==='cluster'){
   const colour=viToken(ecoLayerToken(card.layer)),background=viToken(ecoLayerToken(card.layer)+'-soft');
   const group=se('g',{class:'econode econode-cluster','data-eco-cluster':card.key,'data-eco-layer':card.layer||'',role:'button',tabindex:0,'aria-label':card.title+'，'+card.count+' 个组织，点开看清单',transform:'translate('+card.x+' '+card.y+')'});
   const clusterSelected=Boolean(ecoSelected&&ecoSelected.clusterKey===card.key);
   const clusterCandidate=(card.verifiedCount??0)===0;
   group.setAttribute('data-candidate',clusterCandidate?'1':'0');if(clusterCandidate){group.setAttribute('opacity','.62');group.setAttribute('class','econode econode-cluster econode-candidate')}
   group.append(se('rect',{width:card.w,height:card.h,rx:11,fill:background,stroke:clusterSelected?viToken('--ws-action'):colour,'stroke-width':clusterSelected?2.2:1.6,'stroke-opacity':clusterSelected?'1':'.9',...(clusterCandidate?{'stroke-dasharray':'5 4'}:{})}));
   group.append(se('rect',{x:0,y:9,width:4,height:card.h-18,rx:2,fill:colour}));
   const glyph=se('svg',{x:13,y:10,width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:colour,'stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round'});
   glyph.append(se('use',{href:'#i-pg-layers'}));group.append(glyph);
   const title=se('text',{x:37,y:22,'font-size':13,fill:viToken('--ws-ink'),'font-weight':550});title.textContent=ecoClip(card.title,12);group.append(title);
   const sub=se('text',{x:37,y:40,'font-size':11,fill:viToken('--ws-muted')});sub.textContent=card.count+' 个组织 · '+(card.verifiedCount?card.verifiedCount+' 已实现':'待核对');group.append(sub);
   group.append(se('title',{},card.title+' · '+card.count+' 个组织 · '+(card.verifiedCount?card.verifiedCount+' 已实现':'全部待核对')+'（点开右侧清单）'));
   return group;
  }
  const candidate=card._kind==='org'&&card.verified!==true;
  const colour=ecoCardColour(card),background=ecoCardBackground(card);
  const group=se('g',{class:'econode econode-vivid'+(card._kind==='task'?' econode-task':'')+(candidate?' econode-candidate':''),'data-candidate':candidate?'1':'0',...(candidate?{opacity:'.62'}:{}),'data-node':card.objectId,'data-eco-card':'1','data-eco-kind':card._kind,'data-eco-layer':card.layer||'',...(card.baseId?{'data-eco-matched':card.baseId}:{}),role:'button',tabindex:0,'aria-label':(ECO_TYPE_LABEL[card._kind]||'对象')+'：'+card.title+'，点击看项目与任务',transform:'translate('+card.x+' '+card.y+')'});
  group.append(se('rect',{width:card.w,height:card.h,rx:11,fill:background,stroke:selected?viToken('--ws-action'):colour,'stroke-width':selected?2.2:1.6,'stroke-opacity':selected?'1':'.9',...(candidate?{'stroke-dasharray':'5 4'}:{})}));
  group.append(se('rect',{x:0,y:9,width:4,height:card.h-18,rx:2,fill:colour}));
  const glyph=se('svg',{x:13,y:10,width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:colour,'stroke-width':1.6,'stroke-linecap':'round','stroke-linejoin':'round'});
  glyph.append(se('use',{href:'#i-'+(card._kind==='task'?'pg-kanban':'pg-building')}));group.append(glyph);
  const title=se('text',{x:37,y:22,'font-size':13,fill:viToken('--ws-ink'),'font-weight':550});title.textContent=ecoClip(card.title,12);group.append(title);
  const sub=se('text',{x:37,y:40,'font-size':11,fill:viToken('--ws-muted')});sub.textContent=(candidate?'待核对 · ':'')+(card.layer?card.layer+' · ':'')+(card.category||'');group.append(sub);
  group.append(se('title',{},card.title+' · '+(card.layer||'未分类')+' / '+(card.category||'')+(card.confidence==='ai'?'（AI 判断，可改）':'')+'；点击看项目与任务'));
  return group;
 }
 function drawEcosystem(){
  const world=canvasBase();
  svg.dataset.canvasMode='ecosystem';
  const layout=ecoBuild();
  const focus=layout.focus===true;
  const tier=zoom<0.55?'low':zoom<1.05?'mid':'high';
  const orgsInBand=band=>layout.cards.reduce((sum,card)=>sum+(card.layer===band.layer?((card._kind==='cluster'?card.count:1)):0),0);
  // 层带：整行淡底 + 层名 + 这一层已录入多少组织（底图视图再补底图数量）。
  for(const band of layout.bands){
   const layerToken=ecoLayerToken(band.layer),soft=viToken(layerToken+'-soft'),colour=viToken(layerToken);
   world.append(se('rect',{x:0,y:band.top,width:layout.width,height:band.height,rx:16,'data-eco-band':band.layer,fill:soft,'fill-opacity':'.66',stroke:viToken('--ws-line'),'stroke-opacity':'.55'}));
   world.append(se('rect',{x:0,y:band.top,width:5,height:band.height,rx:2,fill:colour,'fill-opacity':'.9'}));
   for(let labelX=20;labelX<layout.width-120;labelX+=660){
    world.append(se('text',{x:labelX,y:band.top+22,'font-size':13,fill:viToken('--ws-ink'),'font-weight':600},band.label));
   }
   const rightText=focus?'已录入 '+orgsInBand(band)+' 个组织':'底图 '+band.cards+' · 已录入 '+orgsInBand(band);
   world.append(se('text',{x:layout.width-20,y:band.top+22,'text-anchor':'end','font-size':11,fill:viToken('--ws-muted')},rightText));
  }
  if(layout.unclassified){
   const band=layout.unclassified;
   world.append(se('rect',{x:0,y:band.top,width:layout.width,height:band.height,rx:16,fill:viToken('--ws-paper'),stroke:viToken('--ws-line'),'stroke-opacity':'.6'}));
   for(let labelX=20;labelX<layout.width-160;labelX+=660){
    world.append(se('text',{x:labelX,y:band.top+22,'font-size':13,fill:viToken('--ws-muted'),'font-weight':600},(band.label||'未分类 · 待定位')+' · '+band.cards+' 个'));
   }
   world.append(se('text',{x:layout.width-20,y:band.top+22,'text-anchor':'end','font-size':11,fill:viToken('--ws-muted')},'补上供应链层级后会落到对应层'));
  }
  if(!focus)for(const category of layout.categories){world.append(se('text',{x:category.x,y:category.y+18,'font-size':12,fill:viToken('--ws-muted')},category.label))}
  // 底图连线只在“显示底图”时画；否则不画 365 条灰线。
  if(!focus){
   const byBase=new Map(layout.cards.filter(card=>card.baseId).map(card=>[card.baseId,card]));
   const centre=card=>({x:card.x+card.w/2,y:card.y+card.h/2});
   for(const edge of ECOSYSTEM_MAP.edges){
    const from=byBase.get(edge.s),to=byBase.get(edge.t);if(!from||!to)continue;
    const a=centre(from),b=centre(to);
    world.append(se('path',{d:'M'+a.x+' '+a.y+' L'+b.x+' '+b.y,fill:'none',stroke:viToken(ecoThreadToken(edge.th)),'stroke-width':1,'stroke-opacity':'.09'}));
   }
  }
  // 已录入组织之间的关系：只在两端都画成组织卡（非聚合卡）时画，聚合卡不伪造连线。
  const byObject=new Map(layout.cards.filter(card=>card.objectId).map(card=>[card.objectId,card]));
  for(const relation of relationList??[]){
   const from=byObject.get(relation.from),to=byObject.get(relation.to);if(!from||!to)continue;
   const a={x:from.x+from.w/2,y:from.y+from.h/2},b={x:to.x+to.w/2,y:to.y+to.h/2},suggested=relation.status==='suggested';
   world.append(se('path',{d:'M'+a.x+' '+a.y+' L'+b.x+' '+b.y,fill:'none',stroke:viToken(suggested?'--pal-violet':'--ws-action'),'stroke-width':suggested?1.1:1.2,'stroke-opacity':suggested?'.35':'.45','stroke-dasharray':suggested?'4 5':'none'}));
  }
  for(const card of layout.cards)world.append(drawEcoCard(card,tier));
  ensureEcoLegend();
  if(ecoLegend)ecoLegend.hidden=false;
  transform();
  updateEcoLayerBadge();
  if(status){
   status.dataset.readout='1';
   if(focus){
    const clusters=layout.cards.filter(card=>card._kind==='cluster').length;
    const summary=dataSummary();
    status.textContent='生态视图 · 组织 '+summary.orgs+'（已实现 '+summary.verified+' / 待核对 '+summary.pending+'）· 项目 '+summary.projects+' · 任务 '+summary.tasks+' · 待确认 '+summary.pendingRelations+' · 按 '+clusters+' 个类别折叠'+(layout.stats.unclassified?' · 未落层 '+layout.stats.unclassified+' 个':'')+' · 点类别看组织，点组织看项目与任务';
   }else{
    const summary=dataSummary();
    status.textContent='生态视图 · 组织 '+summary.orgs+'（已实现 '+summary.verified+' / 待核对 '+summary.pending+'）· 项目 '+summary.projects+' · 任务 '+summary.tasks+' · 待确认 '+summary.pendingRelations+' · 底图 '+ECOSYSTEM_MAP.nodes.length+' 个 · 灰色未录入 '+layout.stats.ghost+' 个'+(layout.stats.unclassified?' · 未落层 '+layout.stats.unclassified+' 个':'')+' · 点组织看项目与任务';
   }
  }
 }
 function fitEcosystem({overview=false}={}){
  const layout=ecoBuild(),viewport=viewportSize();
  if(!viewport.w||!viewport.h){gx=20;gy=20;zoom=1;transform();return}
  if(layout.focus){
   // 组织视图：所有类别卡/组织卡都在一屏内，默认就能看到“生态有哪些类”。
   const rects=layout.cards.map(card=>({x:card.x,y:card.y,w:card.w,h:card.h}));
   for(const band of layout.bands)rects.push({x:0,y:band.top,w:layout.width,h:band.height});
   if(layout.unclassified)rects.push({x:0,y:layout.unclassified.top,w:layout.width,h:layout.unclassified.height});
   cameraTo(fitRect({rects,viewport,padding:viewport.w<700?18:54,minZoom:viewport.w<700?0.3:0.55,maxZoom:0.95}),{animate:false});
   return;
  }
  if(overview){
   // 底图视图的“全图”：允许缩到能看全 297 个底图；低于 55% 时文字由 draw() 隐藏，只留层带与点。
   const rects=[{x:0,y:0,w:layout.width,h:layout.height}];
   const target=fitRect({rects,viewport,padding:20,minZoom:0.18,maxZoom:0.9});
   cameraTo(target,{animate:false});
   if(zoom<0.55)draw();
   return;
  }
  const vivid=layout.cards.filter(card=>card._kind!=='base');
  if(vivid.length){
   const cx=vivid.reduce((sum,card)=>sum+card.x+card.w/2,0)/vivid.length;
   const cy=vivid.reduce((sum,card)=>sum+card.y+card.h/2,0)/vivid.length;
   const targetZoom=viewport.w<700?0.55:0.72;
   cameraTo({zoom:targetZoom,gx:viewport.w/2-cx*targetZoom,gy:viewport.h/2-cy*targetZoom},{animate:false});
   return;
  }
  cameraTo(fitRect({rects:[{x:0,y:0,w:layout.width,h:layout.height}],viewport,padding:24,minZoom:0.45,maxZoom:0.9}),{animate:false});
 }
 function fitAllRelations(){
  const live=shown(),viewport=viewportSize();
  if(!live.length||!viewport.w||!viewport.h){gx=20;gy=20;zoom=1;transform();return}
  const xs=live.map(node=>positions[node.id]?.x??0),ys=live.map(node=>positions[node.id]?.y??0);
  const rects=live.map(node=>({x:positions[node.id]?.x??0,y:positions[node.id]?.y??0,w:sizes.get(node.id)?.w??200,h:sizes.get(node.id)?.h??86}));
  const target=fitRect({rects,viewport,padding:viewport.w<700?12:32,minZoom:0.05,maxZoom:1});
  cameraTo(target,{animate:false});
  draw();
 }
 function fitOverview(){
  if(mode==='ecosystem')return fitEcosystem({overview:true});
  if(mode==='all'){fitAllRelations();markDirtyLayout();return}
  fit();
  if(mode!=='structure')markDirtyLayout();
 }
 async function load(){
  const run=++epoch;let offset=0,total=0;
  const nodeMap=new Map(),edgeMap=new Map(),relationMap=new Map();
  for(;;){
   const page=await send('graph',{limit:250,offset});if(disposed||run!==epoch)return;
   if(!Array.isArray(page?.nodes)||!Array.isArray(page?.edges))throw Error('画布数据响应无效');
   // 分页时 relations 可能在每页重复返回；按 id 去重，否则待确认数会翻倍。
   for(const node of page.nodes)nodeMap.set(node.id,node);
   for(const edge of page.edges)edgeMap.set(edge.id,edge);
   for(const relation of (page.relations??page.edges.filter(edge=>!edge.derived)))relationMap.set(relation.id,relation);
   total=page.total;
   if(page.nextOffset===null||page.nextOffset===undefined||nodeMap.size>=1000)break;
   offset=page.nextOffset;
  }
  const all=[...nodeMap.values()],allEdges=[...edgeMap.values()],allRelationList=[...relationMap.values()];
  const layout=await send('layout_get',{view:'space'});if(disposed||run!==epoch)return;
  // 角色颜色/形状映射是视图配置（layout:ecosystem）：有就按用户配置，没有就按角色稳定自动映射（不写库）。
  try{const eco=await send('layout_get',{view:'ecosystem'});if(!disposed&&run===epoch)roleMap=eco?.item?.data??null}catch{roleMap=null}
  if(disposed||run!==epoch)return;
  const savedRaw=layout?.item?.data?.positions??{};const ids=new Set(all.map(node=>node.id));
  const saved=Object.fromEntries(Object.entries(savedRaw).filter(([id])=>ids.has(id)));
  const star=starLayout(all,allEdges);
  // 星点布局一次性迁移（2026-10-18）：旧浏览器里可能存着列布局或局部拖动位置；
  // 第一次进入新画布时整体换成星点并保存，之后保留用户自己的拖动结果。
  let migrateStar=false;
  try{migrateStar=!globalThis.localStorage?.getItem('ws-space-star-v5');if(migrateStar)globalThis.localStorage?.setItem('ws-space-star-v5','1')}catch{}
  positions=migrateStar?star:wasColumnLayout(saved)?star:{...star,...saved};
  revision=layout.item?.revision??0;nodes=all;edges=allEdges;relationList=allRelationList;ecoLayout=null;syncCandidateButton();syncPendingButton();
  relayoutAll();
  groups=(layout.item?.data?.groups??[]).map(group=>({...group,nodeIds:[...group.nodeIds]}));
  selection=new Set([...selection].filter(id=>all.some(node=>node.id===id)));
  setViValue(document,focusSelect,'');
  draw();
  // 画布打开时总是先看全图：星点/手拖布局都从全局开始，再自己缩放。
  fit();
  if(status&&total>all.length)status.textContent+=' · 数据超过画布显示条数，仅显示前 '+all.length+' 个';
  // 挂载时页面可能还藏着（宽高为 0），等它真正显示后再全图一次。
  let tries=0;const wait=setInterval(()=>{if(disposed||tries++>20){clearInterval(wait);return}const page=document.querySelector('#space');if(page&&!page.hidden&&page.classList.contains('active')){clearInterval(wait);fit()}},200);
 }
 // ── 画布第 3 批：撤销/重做（仅视图层：位置与分组）、导出、高连接分页 ──────────
 const history={past:[],future:[]};
 const snapshot=()=>({positions:JSON.parse(JSON.stringify(positions)),groups:groups.map(group=>({...group,nodeIds:[...group.nodeIds]}))});
 function pushHistory(){
  history.past.push(snapshot());
  if(history.past.length>50)history.past.shift();
  history.future.length=0;
  syncHistoryButtons();
 }
 function restore(state){
  positions=JSON.parse(JSON.stringify(state.positions));
  groups=state.groups.map(group=>({...group,nodeIds:[...group.nodeIds]}));
  draw();void saveLayout();syncHistoryButtons();
 }
 function undo(){const state=history.past.pop();if(!state){notify('没有可撤销的画布操作',true);return}history.future.push(snapshot());restore(state)}
 function redo(){const state=history.future.pop();if(!state){notify('没有可重做的画布操作',true);return}history.past.push(snapshot());restore(state)}
 const syncHistoryButtons=()=>{
  const undoButton=document.querySelector('#canvasundo'),redoButton=document.querySelector('#canvasredo');
  if(undoButton)undoButton.disabled=!history.past.length;
  if(redoButton)redoButton.disabled=!history.future.length;
 };
 // 高连接分页用模块级纯函数（EDGES_PER_NODE / capEdges），便于单测。
 /** 导出：SVG 直接序列化（带内联样式）；PNG 把同一份 SVG 画到画布再导出。 */
 async function exportCanvas(kind){
  const clone=svg.cloneNode(true);
  clone.setAttribute('xmlns',ns);
  clone.setAttribute('width',Math.max(600,svg.clientWidth||900));
  clone.setAttribute('height',Math.max(400,svg.clientHeight||600));
  const style=document.createElementNS(ns,'style');
  style.textContent='.graphnode text{font-family:system-ui,-apple-system,sans-serif}.graphgroup text{font-family:system-ui,-apple-system,sans-serif}';
  clone.prepend(style);
  const markup=new XMLSerializer().serializeToString(clone);
  if(kind==='svg'){downloadFile(document,{filename:'关联空间.svg',mime:'image/svg+xml;charset=utf-8',content:markup});notify('已导出 SVG（只包含画布内容，不含业务数据之外的任何东西）');return}
  const image=new Image();
  const url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(markup);
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('无法把画布转换成图片'));image.src=url});
  const canvas=document.createElement('canvas');
  canvas.width=clone.getAttribute('width');canvas.height=clone.getAttribute('height');
  const context=canvas.getContext('2d');
  context.fillStyle=viToken('--ws-surface');context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(image,0,0);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw Error('导出 PNG 失败');
  downloadFile(document,{filename:'关联空间.png',mime:'image/png',content:blob});
  notify('已导出 PNG');
 }
 /** 连线时问清楚：什么关系 + 一句话依据（默认给一句候选，你改也行）。
  *  这块是"当场问"，不是事后用报错拦你。 */
 function askLink(source,destination){
  return new Promise(resolve=>{
   const a=source?.title??'这个对象',b=destination?.title??'那个对象';
   // 候选依据：优先取其中一方已有的描述/摘要，取不到就如实写成"你在画布上手动连线"。
   const snippet=(value)=>{
    const text=String(value??'').trim();
    if(!text)return '';
    const first=text.split(/\n|。/).map(part=>part.trim()).filter(Boolean)[0]??'';
    return first.slice(0,60);
   };
   const candidate=snippet(source?.data?.summary)||snippet(source?.data?.description)||snippet(destination?.data?.summary)||snippet(destination?.data?.description)||('你在画布上把「'+a+'」和「'+b+'」连在一起');
   // 走唯一的弹窗实现（modal.mjs）。第 12 轮实测这里曾是**全站第二套弹窗**：
   // 自己 createElement('div').className='veil'，绕过 modal.mjs，几何/焦点/关闭口径与其它弹窗不一致。
   // 用户 2026-10-13 明确要求"同一控件全站唯一实现"。改走 sharedModal 后焦点锁定、Escape、
   // 遮罩点击关闭、背景不可操作全部由那一处承担，这里只负责内容与动作。
   const request=modal.begin();
   if(request===null){resolve(null);return}
   const html=`<p class="noticeline">${esc(a)} → ${esc(b)}</p>
     <label class="field"><span>这是什么关系？</span>
      ${selectHtml({name:'linktype',attribute:'data-linktype',value:'相关',options:[['相关','相关'],['依赖','依赖'],['证据','证据'],['负责人','负责人'],['其他','其他']],placeholder:'选择关系',id:'linktype'})}</label>
     <label class="field"><span>为什么连在一起？（一句话，之后能回看）</span>
      <textarea data-linkbasis="1" rows="3">${esc(candidate)}</textarea></label>
     <p class="noticeline" data-linkhint="1">保存后立刻生效；顶部会出现「已保存 · 撤销」。</p>
     <div class="modalactions"><button class="btn primary" type="button" data-linksave="1">保存</button><button class="btn" type="button" data-linkcancel="1">取消</button></div>`;
   if(!modal.present(request,{title:'建立关联',type:'关联',html})){resolve(null);return}
   const body=document.querySelector('#detailbody');
   try{wireSelects(body,{document})}catch{/* VI 下拉初始化失败不影响保存 */}
   let settled=false;
   const finish=answer=>{if(settled)return;settled=true;modal.close();resolve(answer)};
   body.querySelector('[data-linksave]').onclick=()=>{
    const type=body.querySelector('[data-linktype]')?.value||body.querySelector('#linktype')?.value||'相关';
    const basis=body.querySelector('[data-linkbasis]').value.trim();
    if(!basis){body.querySelector('[data-linkhint]').textContent='还差一句依据：写清为什么把它们连在一起。';return}
    finish({type,basis});
   };
   for(const node of body.querySelectorAll('[data-linkcancel]'))node.onclick=()=>finish(null);
   body.querySelector('[data-linkbasis]').focus();
  });
 }
 // ── A4：布局的显式保存 ───────────────────────────────────────────────────
 // 17 C9 的只读纪律：缩放/平移/拖拽/折叠都只是视图状态，**不写库**；只有点「保存布局」才落一次
 // （revision +1）。结构态更严格：展开状态 v1 只存在于本次会话，保存按钮也不落它（spec/54 §2.3）。
 let layoutDirty=false;
 function syncSaveButton(){
  const button=document.querySelector('#savelayout');
  if(!button)return;
  button.textContent=layoutDirty?'保存布局 •':'保存布局';
  button.dataset.dirty=layoutDirty?'1':'0';
  button.setAttribute('aria-label',layoutDirty?'保存布局（有未保存的位置与缩放）':'保存布局（已保存）');
 }
 function markDirtyLayout(){
  if(mode==='structure'){syncSaveButton();return}
  layoutDirty=true;syncSaveButton();
 }
 function saveLayout(){
  // 结构态：展开/镜头/拖动都只是本次会话的视图状态，不写业务数据（显式保存归 A4）。
  if(mode==='structure'){layoutDirty=false;syncSaveButton();return Promise.resolve();}
  // 生态态没有可保存的“关系位置”；旧实现会把生态镜头写进 layout:space，跨视图污染。
  if(mode==='ecosystem'){layoutDirty=false;syncSaveButton();return Promise.resolve();}
  if(pending)return pending;
  const run=++epoch,snapshot={...positions},viewport={x:gx,y:gy,zoom};
  pending=(async()=>{try{await send('layout_save',{view:'space',revision,positions:snapshot,viewport,groups:groups.map(group=>({...group,nodeIds:[...group.nodeIds]})),key:key()});if(!disposed&&run===epoch){revision+=1;layoutDirty=false;syncSaveButton()}}catch(error){if(!disposed)notify('画布布局未保存：'+error.message,true)}finally{pending=null}})();
  return pending;
 }
 async function decide(edge,next,{withBasis=false}={}){
  const data=relationData(edge,next);
  if(withBasis){
   // 确认时记录两端版本作为依据，之后任一来源更新即显示待复核。
   const basis=[];
   for(const id of [edge.from,edge.to]){const node=nodes.find(item=>item.id===id);if(!node)continue;const {item}=await send('get',{id});if(item&&!item.archived)basis.push(id+'@'+item.revision);}
   if(basis.length)data.basis=basis;
  }
  await batch.draft('关系判定 · '+(edge.title||'关联'),[{op:'update',id:edge.id,expectedRevision:edge.revision,data}]);
 }
 /** 处理一条"AI 提议的关联"：同意 = 提交收件箱里那条改动；不用了 = 撤销它。
  *  为什么走收件箱链路而不是另写一条关系：同一条建议在两个地方要有同一个结果，
  *  否则"在画布上点了同意"和"在收件箱里点了同意"会变成两件事。 */
 async function respondPending(edge,accept){
  try{
   // 注意：浏览器接口的提交参数名是 `id`（Agent 工具那边叫 `batchId`）—— 传错会得到一个笼统的"服务错误"。
   if(accept)await send('commit',{id:edge.pendingBatchId,revision:edge.pendingRevision,key:'canvas-accept-'+edge.pendingBatchId});
   else await send('cancel_draft',{id:edge.pendingBatchId,revision:edge.pendingRevision});
   notify(accept?'已同意这条关联':'这条关联不再提了');
   await load();
  }catch(error){notify('没能处理这条关联：'+error.message,true)}
 }
 /** 点虚线（AI 建议 / 待确认 / 待复核）时的**画布内操作条**（PRD CV-08：不强制弹窗）。
  *  看依据 → 打开现有的关联证据弹窗（内容仍是同一份）；同意 / 不同意 / 稍后 直接处理，
  *  走的是与收件箱同一条链路（不另造一套写入）。 */
 function showEdgeActions(id){
  const edge=relationList.find(item=>item.id===id)??edges.find(item=>item.id===id);
  if(!edge)return;
  const light=edge.status==='suggested'||Boolean(edge.pendingBatchId)||Boolean(edge.stale);
  if(!light){edgeDialog(id);return}
  document.querySelector('#canvasactionbar')?.remove();
  const fromPosition=positions[edge.from],toPosition=positions[edge.to];
  const stage=document.querySelector('#space .spacestage');
  if(!stage||!fromPosition||!toPosition){edgeDialog(id);return}
  const svgRect=svg.getBoundingClientRect?.()??{left:0,top:0};
  const fromSize=sizes.get(edge.from)??{w:200,h:86},toSize=sizes.get(edge.to)??{w:200,h:86};
  const midX=svgRect.left+((fromPosition.x+fromSize.w/2+toPosition.x+toSize.w/2)/2)*zoom+gx;
  const midY=svgRect.top+((fromPosition.y+fromSize.h/2+toPosition.y+toSize.h/2)/2)*zoom+gy;
  const bar=document.createElement('div');
  bar.className='canvasactionbar';bar.id='canvasactionbar';bar.dataset.edgeActions=id;
  bar.innerHTML='<span class="canvasactionbar-title">'+esc(edge.title||'关联')+'</span>'
   +'<span class="canvasactionbar-state">'+(edge.pendingBatchId?'AI 提议 · 还没生效 · 等你决定':edge.stale?'已确认 · 待复核':'待确认建议')+'</span>'
   +'<button class="btn" type="button" data-edge-action="basis">看依据</button>'
   +'<button class="btn primary" type="button" data-edge-action="accept">同意</button>'
   +'<button class="btn" type="button" data-edge-action="reject">不同意</button>'
   +'<button class="btn txt" type="button" data-edge-action="later">稍后</button>';
  bar.style.left=Math.max(8,Math.min(midX-140,Math.max(8,(globalThis.innerWidth??1440)-300)))+'px';
  bar.style.top=Math.max(8,midY-46)+'px';
  stage.append(bar);
  const close=()=>bar.remove();
  bar.querySelector('[data-edge-action="basis"]').onclick=()=>{close();edgeDialog(id)};
  bar.querySelector('[data-edge-action="later"]').onclick=close;
  bar.querySelector('[data-edge-action="accept"]').onclick=()=>{
   close();
   if(edge.pendingBatchId)void respondPending(edge,true);
   else decide(edge,'confirmed',{withBasis:true}).catch(error=>notify(error.message,true));
  };
  bar.querySelector('[data-edge-action="reject"]').onclick=()=>{
   close();
   if(edge.pendingBatchId)void respondPending(edge,false);
   else decide(edge,'rejected').catch(error=>notify(error.message,true));
  };
  // 点空白处 / Esc 收起操作条（不改变任何数据）
  const dismiss=event=>{if(!bar.isConnected)return;if(event.type==='keydown'&&event.key!=='Escape')return;if(event.type==='pointerdown'&&bar.contains(event.target))return;close()};
  document.addEventListener('pointerdown',dismiss);
  document.addEventListener('keydown',dismiss);
 }
 function edgeDialog(id){
  const edge=relationList.find(item=>item.id===id)??edges.find(item=>item.id===id);if(!edge)return;const request=token=modal.begin();if(request===null)return;
  const from=nodes.find(node=>node.id===edge.from),to=nodes.find(node=>node.id===edge.to),suggested=edge.status==='suggested',review=Boolean(edge.stale);
  const isPending=Boolean(edge.pendingBatchId);
  const state=isPending?'AI 提议 · 等你决定':suggested?'待确认建议':review?'已确认 · 待复核':edge.status==='confirmed'?'已确认':'未记录状态';
  const html=`<p>${esc(from?.title??edge.from)} → ${esc(to?.title??edge.to)}</p><div class="proof"><b>关联类型</b><br>${esc(edge.title||'未命名')}<br><br><b>来源依据</b><br>${esc(edge.evidence||'由对象字段推导，没有独立保存的依据。')}</div><p>状态：${esc(state)}${edge.derived?' · 由对象字段推导，不可在此修改':''}</p>${review?`<p class="notice">复核原因：${esc(edge.stale)}。确认时的对象版本已变化，关系不再自动可信；重新确认会记录当前版本，或忽略。</p>`:''}<p class="notice">${isPending?'这条是 AI 从已有数据里推断的，还没生效 —— 只有你同意之后才会成为正式关联。':'关系状态保存在工作台数据库；确认、忽略或撤销都会先生成待你确认的改动，并让你先看一眼。'}</p><div class="modalactions">${isPending?'<button class="btn primary" id="edgeAccept">同意这条关联</button><button class="btn" id="edgeDecline">不用了</button>':''}${!isPending&&!edge.derived&&suggested?'<button class="btn primary" id="edgeConfirm">确认关联</button><button class="btn" id="edgeReject">忽略建议</button>':''}${!edge.derived&&review?'<button class="btn primary" id="edgeReconfirm">重新确认（记录当前版本）</button><button class="btn" id="edgeReject">忽略</button>':''}${!edge.derived&&!suggested&&!review?'<button class="btn" id="edgeReopen">撤销判断</button>':''}<button class="btn" id="edgeFocus">聚焦此关系</button><button class="btn" id="edgeClose">关闭</button></div>`;
  if(!modal.present(request,{title:edge.title||'关联证据',type:'关联证据',html}))return;
  const act=(selector,next,options)=>{const node=document.querySelector(selector);if(node)node.onclick=()=>{modal.close();decide(edge,next,options).catch(error=>notify(error.message,true))}};
  wire('#edgeClose',()=>modal.close());
  wire('#edgeFocus',()=>{focus=edge.from;setViValue(document,scopeSelect,'all');setViValue(document,focusSelect,nodes.find(node=>node.id===edge.from)?.kind==='project'?edge.from:'');modal.close();draw();fit()});
  if(isPending){
   // 同意 / 不用了：直接处理收件箱里那一条（同一条链路，不另造一套）。
   wire('#edgeAccept',()=>{modal.close();void respondPending(edge,true)});
   wire('#edgeDecline',()=>{modal.close();void respondPending(edge,false)});
  } else if(suggested)act('#edgeConfirm','confirmed',{withBasis:true}),act('#edgeReject','rejected');
  else if(review)act('#edgeReconfirm','confirmed',{withBasis:true}),act('#edgeReject','rejected');
  else act('#edgeReopen','suggested');
 }
 function focusOn(id){
  if(!nodes.some(item=>item.id===id))return false;
  focus=id;setViValue(document,scopeSelect,'all');
  // hidden input 没有 .options；能不能聚焦看的是**候选里有没有这个 id**（VI 下拉的选项）。
  const focusWrapper=focusSelect?.closest('[data-viselect]');
  const canFocus=Boolean(focusWrapper&&[...focusWrapper.querySelectorAll('[data-viselect-option]')].some(option=>option.dataset.viselectOption===id));
  setViValue(document,focusSelect,canFocus?id:'');
  draw();fit();return true;
 }
 /** 重命名：只改 title，其余字段原样带回（不覆盖 Agent 写过的属性）。 */
 /** 结构态单击：机构 → 原地长出项目；项目 → 旁边长出任务；再点同一对象收起（D4：一次只展开一个分支）。
  *  不换页、不改路由、不移动其它节点；镜头由 focusBranch() 放大到这一支。 */
 function toggleNode(id,{openOnUnsupported=false}={}){
  const node=nodeOf(id);if(!node)return false;
  if(!['organization','project'].includes(node.kind)){if(openOnUnsupported)open?.(id);return false}
  if(node.kind==='organization'){
   const next=expandState({expandedId:expandedOrg,itemIds:[]},id,{nodes});
   expandedOrg=next.expandedId;expandedProject=null;
   if(expandedOrg&&!childrenOf(expandedOrg,{nodes}).items.length)notify('这个机构还没有主责或参与的项目');
  }else if(expandedProject===id){expandedProject=null}
  else{
   expandedProject=id;
   // 项目在机构分支里被点开时保留机构分支；不在该分支里（未归属桶里的项目）就只开它自己的任务。
   if(expandedOrg&&!childrenOf(expandedOrg,{nodes}).items.includes(id))expandedOrg=null;
  }
  // 诊断修复（2026-10-26）：单击只展开/收起，不自动搬镜头。
  // 旧行为在 220ms 内把 39% 拉到 100%，被点卡片从光标下移走，下一次点击必然点空；
  // 要聚焦由用户自己点「全图」/平移，或双击打开详情。镜头只由显式动作改变。
  draw();
  return true;
 }
 function activate(id){
  const node=nodes.find(item=>item.id===id);if(!node)return;
  if(mode==='structure')return toggleNode(id,{openOnUnsupported:true});
  if(['project','task','artifact','topic','memoryRef','event'].includes(node.kind)){
   focusOn(id);notify('已展开「'+(node.title||'未命名')+'」及其关联节点');
   return;
  }
  open?.(id);
 }
 function relations(){  const request=token=modal.begin();if(request===null)return;
  const html=`<div class="relationlist">${relationList.map(edge=>`<button class="btn" data-region="${esc(edge.id)}">${esc(edge.title||'关联')} · ${esc(edge.stale?'待复核':edge.status==='suggested'?'待确认':edge.status==='rejected'?'已忽略':'已确认')}${edge.stale?`（${esc(edge.stale)}）`:edge.derived?'（由内容推导）':''}</button>`).join('')||'<p>当前没有关联记录。</p>'}</div><p class="notice">已忽略的建议不会出现在画布上；撤销判断会恢复为待确认。</p>`;
  if(!modal.present(request,{title:'关系与依据',type:'关联清单',html:html+'<div class="modalactions"><button class="btn" id="relationsclose">关闭</button></div>'}))return;
  {const close=document.querySelector('#detailbody #relationsclose');if(close)close.onclick=()=>modal.close();}
  for(const node of document.querySelectorAll('#detailbody [data-region]'))node.onclick=()=>edgeDialog(node.dataset.region);
 }
 function explain(){
  const request=token=modal.begin();if(request===null)return;
  const html='<div class="proof">业务记录：项目、任务、会议与当前状态。<br>知识：资料、议题与引用证据。<br>关系层：对象 ID、关联类型、依据、确认与失效状态。</div><p>当前画布只展示数据库中的真实对象与关联：项目归属、负责人、合作方、组织与任务依赖由对象字段推导；其余关系来自保存的关联记录。虚线表示状态为待确认的关联。</p><p class="notice">模型推断服务尚未接入：这里不会自动生成 AI 建议，也不会自动确认关系。原文更新、权限撤回或事实失效后的重新评估同样未实现。</p>';
  if(modal.present(request,{title:'关联如何产生',type:'关联如何产生',html:html+'<div class="modalactions"><button class="btn" id="explainclose">关闭</button></div>'})){
   const close=document.querySelector('#detailbody #explainclose');if(close)close.onclick=()=>modal.close();
   return;
  }
 }
 wire('#more',()=>{setZoom(Math.min(2.5,zoom*1.2));markDirtyLayout()});
 wire('#less',()=>{setZoom(Math.max(.25,zoom/1.2));markDirtyLayout()});
 wire('#fitspace',()=>{fitOverview()});
 wire('#resetlayout',()=>{
  if(mode==='structure'){structMoved={};expandedOrg=null;expandedProject=null;draw();fit();return}
  pushHistory();positions={...spaceLayout(nodes)};draw();fit();markDirtyLayout();});
 wire('#allrelations',relations);

 // ── 画布第 2 批：节点内预览（文本/图片/PDF/Office）与手动连线 ───────────
 const stageEl0=document.querySelector('.spacestage');
 const panel=document.createElement('div');
 panel.className='canvaspreview';panel.id='canvaspreview';panel.hidden=true;
 if(stageEl0)stageEl0.append(panel);
 function closePreview(){panel.hidden=true;panel.replaceChildren()}
 // 预览路由需要工作区标识：读一次运行状态并缓存（读不到就返回空串，路由会如实报错）
 let workspaceId='';
 async function currentWorkspace(){
  if(workspaceId)return workspaceId;
  try{const status=await send('runtime_status');workspaceId=status?.workspace?.id??''}catch{workspaceId=''}
  return workspaceId;
 }
 /** 在画布内直接看内容：图片/PDF/Office 走既有受权字节路由；文本走阅读器（markdown 渲染）。
  *  只读，不改记录；没有文件路径的材料显示其正文。 */
 async function openPreview(nodeId){
  const node=nodes.find(item=>item.id===nodeId);if(!node)return;
  const {item}=await send('get',{id:nodeId});if(!item)return;
  const data=item.data??{};
  panel.hidden=false;
  panel.replaceChildren();
  const head=document.createElement('div');head.className='canvaspreview-head';
  const title=document.createElement('strong');title.textContent=node.title||'预览';
  const close=document.createElement('button');close.className='btn';close.type='button';close.textContent='关闭';
  close.onclick=closePreview;
  head.append(title,close);panel.append(head);
  const body=document.createElement('div');body.className='canvaspreview-body';panel.append(body);
  const suffix=String(data.path??'').toLowerCase().split('.').pop();
  const office=['doc','docx','xls','xlsx','ppt','pptx'].includes(suffix);
  if(data.path&&data.fileGrantId){
   const source='/personal-workstation/file?'+new URLSearchParams({workspace:await currentWorkspace(),grantId:data.fileGrantId,path:data.path});
   if(['png','jpg','jpeg','gif','webp','svg','bmp'].includes(suffix)){const img=document.createElement('img');img.src=source;img.alt=node.title||'';body.append(img)}
   else if(suffix==='pdf'||office){const frame=document.createElement('iframe');frame.src=source;frame.title=node.title||'预览';body.append(frame)}
   else {
    // 文本走 file_read（与材料详情的「读取文件内容」同一条通道）：预览路由只收图片/PDF/Office。
    const caption=document.createElement('p');caption.className='notice';caption.textContent='正在读取文件…';body.append(caption);
    try{
     const result=await send('file_read',{grantId:data.fileGrantId,path:data.path});
     caption.remove();const holder=document.createElement('div');holder.className='reader';holder.innerHTML=readerHtml(result.content??'');body.append(holder);
    }catch(error){caption.textContent='打不开这个文件：'+error.message+'（可能是目录未授权，或文件已移动）'}
   }
  }else if(typeof data.content==='string'&&data.content.trim()){
   const holder=document.createElement('div');holder.className='reader';holder.innerHTML=readerHtml(data.content);body.append(holder);
  }else{
   const empty=document.createElement('p');empty.className='notice';empty.textContent='这条记录既没有文件路径也没有正文，没有可预览的内容。';
   body.append(empty);
  }
 }
 closePreview();

 // ── 画布第 1 批：框选后的批量操作条 + 分组 ─────────────────────────────
 const stageEl=document.querySelector('.spacestage');
 const bar=document.createElement('div');
 bar.className='canvasbar';bar.id='canvasbar';bar.hidden=true;
 bar.innerHTML='<span class="count" id="canvasbarcount">已选 0 个</span>'
  +'<button class="btn" id="canvasgroup">归为一组</button>'
  +'<button class="btn" id="canvasassign">改归属项目</button>'
  +'<button class="btn" id="canvasconfirm">确认建议</button>'
  +'<button class="btn" id="canvasignore">忽略建议</button>'
  +'<button class="btn" id="canvasarchive">归档</button>'
  +'<button class="btn" id="canvascancel">取消选择</button>';
 if(stageEl)stageEl.append(bar);
 const tool=(id,text,run)=>{const button=document.createElement('button');button.className='btn';button.id=id;button.type='button';button.textContent=text;button.onclick=run;return button};
 const undoButton=tool('canvasundo','撤销',undo),redoButton=tool('canvasredo','重做',redo);
 const exportSvg=tool('canvasexportsvg','导出 SVG',()=>void exportCanvas('svg').catch(error=>notify(error.message,true)));
 const exportPng=tool('canvasexportpng','导出 PNG',()=>void exportCanvas('png').catch(error=>notify(error.message,true)));
 const saveButton=tool('savelayout','保存布局',()=>{
  // 诊断修复：结构态和生态态都没有“可保存的布局”，旧实现照样提示「已保存画布布局」，
  // 是假成功（结构态直接 return，生态态会把关系布局/镜头写脏）。这里按模式如实回应。
  if(mode==='structure'){notify('结构视图不保存布局：展开与镜头只在这次查看里生效');return}
  if(mode==='ecosystem'){notify('生态视图的层级是固定的，不需要保存布局');return}
  void saveLayout().then(()=>notify(layoutDirty?'布局仍未保存':'已保存画布布局')).catch(error=>notify('画布布局未保存：'+error.message,true));
 });
 syncSaveButton();
 const selectButton=document.createElement('button');
 selectButton.className='btn';selectButton.id='canvasselect';selectButton.type='button';selectButton.textContent='框选';
 const candidateButton=document.createElement('button');
 candidateButton.className='btn';candidateButton.id='candidatetoggle';candidateButton.type='button';
 candidateButton.onclick=()=>{showCandidates=!showCandidates;syncCandidateButton();relayoutAll();draw();fit()};
 const pendingButton=document.createElement('button');
 pendingButton.className='btn';pendingButton.id='pendingbadge';pendingButton.type='button';
 pendingButton.onclick=()=>openPendingRelations();
 const edgeToggle=document.createElement('button');
 edgeToggle.className='btn';edgeToggle.id='canvasshowedges';edgeToggle.type='button';edgeToggle.textContent='显示全部关联';edgeToggle.setAttribute('aria-pressed','false');
 edgeToggle.onclick=()=>{showAllEdges=!showAllEdges;edgeToggle.textContent=showAllEdges?'收起多余关联':'显示全部关联';edgeToggle.setAttribute('aria-pressed',String(showAllEdges));draw()};
 const toolbar=document.querySelector('#space .spacebar');
 if(toolbar)toolbar.append(candidateButton,pendingButton,selectButton,edgeToggle,undoButton,redoButton,exportSvg,exportPng);
 function syncCandidateButton(){const count=nodes.filter(node=>node.kind==='organization'&&node.verified!==true).length;if(!candidateButton)return;candidateButton.textContent=showCandidates?'收起候选（'+count+'）':'显示候选（'+count+'）';candidateButton.setAttribute('aria-pressed',String(showCandidates))}
 function syncPendingButton(){const count=(relationList??[]).filter(rel=>rel.status==='suggested').length;if(pendingButton){pendingButton.textContent='待确认 '+count;pendingButton.hidden=false}}
 syncHistoryButtons();
 // 诊断修复：生态态是固定布局，框选/分组/保存/撤销/重置/聚焦详情都作用在关系态 positions 上，
 // 继续显示会引导用户对错对象下操作。按模式隐藏，关系/待确认态保留。
 function syncModeTools(){
  const eco=mode==='ecosystem';
  const structure=mode==='structure';
  const structureHide=structure&&structureOverview;
  for(const node of [selectButton,undoButton,redoButton,saveButton,edgeToggle,document.querySelector('#resetlayout'),document.querySelector('#globalCanvas'),focusButton])if(node)node.hidden=eco||structure||(structureHide&&node===edgeToggle);
  if(candidateButton)candidateButton.hidden=eco;
  if(eco&&selectMode){selectMode=false;selectButton.classList.remove('active');selection=new Set();syncBar()}
  const legend=ensureEcoLegend();
  const toggle=legend?.querySelector('[data-ecobasetoggle]');
  if(toggle){toggle.textContent=ecoView==='base'?'只看组织':'显示底图';toggle.setAttribute('aria-pressed',String(ecoView==='base'))}
 }
 selectButton.onclick=()=>{selectMode=!selectMode;selectButton.classList.toggle('active',selectMode);notify(selectMode?'框选模式：在空白处拖拽选择对象（Shift+拖拽同样可用）':'已退出框选模式')};

 function syncBar(){
  if(mode==='ecosystem'){if(bar)bar.hidden=true;return}
  const count=selection.size;
  if(bar){bar.hidden=count===0;const label=bar.querySelector('#canvasbarcount');if(label)label.textContent='已选 '+count+' 个'}
  const suggested=selectedSuggestedEdges().length;
  for(const [id,visible] of [['#canvasgroup',count>1],['#canvasassign',count>0],['#canvasarchive',count>0],['#canvasconfirm',suggested>0],['#canvasignore',suggested>0]]){
   const button=bar?.querySelector(id);if(button)button.hidden=!visible;
  }
 }
 /** 选中节点之间的「待确认建议」关系：批量确认/忽略的作用对象。 */
 function selectedSuggestedEdges(){
  return edges.filter(edge=>edge.status==='suggested'&&selection.has(edge.from)&&selection.has(edge.to));
 }
 function clearSelection(){selection=new Set();draw();syncBar()}
 const groupName=async(defaultName)=>{
  const request=token=modal.begin();if(request===null)return null;
  const html='<div class="formrow"><label>分组名称<input id="groupname" value="'+esc(defaultName)+'" placeholder="例如：示例科技相关"></label></div><p class="notice">分组只改变画布视图（位置与折叠），不会修改项目、任务或关系；随布局一起保存。</p>';
  if(!modal.present(request,{title:'归为一组',type:'画布分组',html:html+'<div class="modalactions"><button class="btn primary" id="groupok">创建分组</button><button class="btn" id="groupcancel">取消</button></div>'}))return null;
  return await new Promise(resolve=>{
   wire('#groupcancel',()=>{modal.close();resolve(null)});
   wire('#groupok',()=>{const value=document.querySelector('#detailbody #groupname')?.value?.trim();modal.close();resolve(value||null)});
  });
 };
 async function renameGroup(group){
  const name=await groupName(group.title||'分组');if(!name)return;
  group.title=name;markDirtyLayout();draw();
 }
 async function makeGroup(){
  if(selection.size<2){notify('至少选中两个对象才能分组',true);return}
  const name=await groupName('分组 '+(groups.length+1));if(!name)return;
  pushHistory();
  const members=[...selection];
  // 同一对象只属于一个分组：先从旧分组里摘掉，避免"一物两组"。
  for(const group of groups)group.nodeIds=group.nodeIds.filter(id=>!members.includes(id));
  groups=groups.filter(group=>group.nodeIds.length);
  groups.push({id:'group-'+Date.now().toString(36),title:name,nodeIds:members,collapsed:false});
  markDirtyLayout();draw();syncBar();notify('已创建分组「'+name+'」：'+members.length+' 个对象');
 }
 /** 批量改归属：一个批次里多条更新，走同一套草稿与确认（可撤销）。 */
 async function assignProject(){
  const {items=[]}=await send('list',{kind:'project',limit:200});
  const live=items.filter(item=>!item.archived);
  if(!live.length){notify('还没有项目可归属',true);return}
  const targets=nodes.filter(node=>selection.has(node.id)&&['task','artifact','topic','event'].includes(node.kind));
  if(!targets.length){notify('选中的对象里没有可归属的类型（只有任务/资料/议题/事务能归属项目）',true);return}
  const request=token=modal.begin();if(request===null)return;
  const html='<div class="formrow">'+selectHtml({name:'project',label:'归属项目',value:'',options:[['','（不归属）'],...live.map(item=>[item.id,item.data.title])],placeholder:'选择项目'})+'</div><p class="notice">将对 '+targets.length+' 个对象生成一条变更待确认的改动，在收件箱确认后生效；可凭记录编号撤销。</p>';
  if(!modal.present(request,{title:'批量改归属',type:'批量操作',html:html+'<div class="modalactions"><button class="btn primary" id="assignok">生成待确认的改动</button><button class="btn" id="assigncancel">取消</button></div>'}))return;
  wireSelects(document.querySelector('#detailbody'),{document});
  wire('#assigncancel',()=>modal.close());
  wire('#assignok',()=>{
   const value=document.querySelector('#detailbody input[type="hidden"][data-field="project"]')?.value??'';
   modal.close();
   void (async()=>{
    const list=[];
    for(const node of targets){
     const {item}=await send('get',{id:node.id});if(!item)continue;
     const data={...item.data};if(value)data.projectId=value;else delete data.projectId;
     list.push({op:'update',id:item.id,expectedRevision:item.revision,data,sources:{projectId:value?'用户在画布批量指定归属':'用户在画布取消归属'}});
    }
    if(!list.length){notify('没有可更新的对象',true);return}
    await batch.draft('画布批量改归属 · '+list.length+' 个对象',list);
    clearSelection();
   })().catch(error=>notify(error.message,true));
  });
 }
 /** 批量确认/忽略：作用于"选中对象之间"的建议关系（一次一条草稿）。 */
 async function decideSelected(next){
  const list=selectedSuggestedEdges();
  if(!list.length){notify('选中的对象之间没有待确认的建议',true);return}
  await batch.draft((next==='confirmed'?'画布批量确认 ':'画布批量忽略 ')+list.length+' 条建议',
   list.map(edge=>({op:'update',id:edge.id,expectedRevision:edge.revision,data:relationData(edge,next),sources:{status:'用户在画布批量'+(next==='confirmed'?'确认':'忽略')}})));
  clearSelection();
 }
 async function archiveSelected(){
  const targets=nodes.filter(node=>selection.has(node.id)&&!['layout','relation'].includes(node.kind));
  if(!targets.length){notify('选中的对象不可归档',true);return}
  await batch.draft('画布批量归档 · '+targets.length+' 个对象',targets.map(node=>({op:'archive',id:node.id,expectedRevision:node.revision,sources:{}})));
  clearSelection();
 }
 wire('#canvascancel',clearSelection);
 const groupButton=bar.querySelector('#canvasgroup');if(groupButton)groupButton.onclick=()=>{void makeGroup()};
 const assignButton=bar.querySelector('#canvasassign');if(assignButton)assignButton.onclick=()=>{void assignProject()};
 const confirmButton=bar.querySelector('#canvasconfirm');if(confirmButton)confirmButton.onclick=()=>{void decideSelected('confirmed')};
 const ignoreButton=bar.querySelector('#canvasignore');if(ignoreButton)ignoreButton.onclick=()=>{void decideSelected('rejected')};
 const archiveButton=bar.querySelector('#canvasarchive');if(archiveButton)archiveButton.onclick=()=>{void archiveSelected()};
 syncBar();
 wire('#aiExplain',explain);
 // 新增节点：走统一新建流程（同一套草稿与确认），创建后由控制器重新加载并重新适配视图。
 const newButton=document.querySelector('#spacenew');
 if(newButton)newButton.onclick=()=>onCreate?.();
 wire('#globalCanvas',()=>{scope='all';focus='';expandedOrg=null;expandedProject=null;structMoved={};setViValue(document,scopeSelect,mode==='structure'?'structure':'all');setViValue(document,focusSelect,'');draw();fit()});
 // 原型中由布局脚本插入的两个控件：整屏画布与聚焦对象详情。
 // 画布提示条：把真实交互说清楚（冻结原型的文案不能改，这里在运行时更新）。
 (function refreshCaption(){
  const caption=document.querySelector('#space .spacecaption');
  if(caption)caption.textContent='单击开详情 · 双击展开 · 拖动平移 · 滚轮缩放 · 拖右侧圆点连线';
 })();
 // 顶部按钮收拢：一行只留高频操作，其余进「更多」。原来一行 15 个按钮，
 // 「全局视图 / 全屏画布 / 全图」三个还长得像，用户分不清（用户 2026-10-12 反馈）。
 (function consolidateToolbar(){
  const bar=document.querySelector('#space .spacebar');
  if(!bar||bar.querySelector('[data-moretools]'))return;
  const more=document.createElement('button');
  more.className='btn';more.type='button';more.dataset.moretools='1';more.textContent='更多 ▾';
  const panel=document.createElement('div');
  panel.className='morepanel';panel.hidden=true;panel.dataset.morepanel='1';
  panel.innerHTML='<p class="noticeline">画布操作</p>';
  bar.append(more);
  bar.parentElement?.append(panel);
  const move=(id,label)=>{const node=typeof id==='string'?document.querySelector(id):id;if(!node)return;if(label&&node.textContent.trim().length>8)node.textContent=label;panel.append(node)};
  move('#aiExplain');move('#allrelations');move('#canvasselect');move('#canvasshowedges');move('#canvasundo');move('#canvasredo');
  move(saveButton);move('#canvasexportsvg');move('#canvasexportpng');move('#resetlayout');
  const full=[...document.querySelectorAll('#space button')].find(node=>/全屏画布|退出全屏/.test(node.textContent));
  const focus=[...document.querySelectorAll('#space button')].find(node=>node.textContent.trim()==='打开聚焦对象详情');
  move(full);move(focus);
  const global=document.querySelector('#globalCanvas');
  if(global)global.textContent='全部关系';
  // 「更多」是工具菜单：点开/收起，点里面的按钮后收起（WIP 删菜单时把这条也删了，控件变成点了没反应）。
  more.onclick=()=>{panel.hidden=!panel.hidden};
  for(const button of panel.querySelectorAll('button'))button.addEventListener('click',()=>{panel.hidden=true});
  // 2026-10-22 用户：更多里的按钮价值不大；改成 demo 的分段（结构/关系/待确认），保存布局留在外面。
  // 2026-10-22 用户把“看什么”改成分段控件；但撤销/导出/重置布局/全屏这些工具仍然要能点到，
  // 所以「更多」作为工具菜单保留（WIP 曾把菜单删掉，连带这些按钮一起从 DOM 消失）。
  if(saveButton){saveButton.classList.add('btn','btn-secondary','btn-sm');bar.append(saveButton)}
  const seg=document.createElement('div');
  seg.className='segmented canvas-segmented';
  seg.setAttribute('role','group');seg.setAttribute('aria-label','画布模式');
  const segDefs=[['all','全网'],['ecosystem','生态视图']];
  for(const [value,label] of segDefs){
   const button=document.createElement('button');
   button.type='button';button.className='btn btn-sm';button.dataset.segMode=value;button.textContent=label;
   button.setAttribute('aria-pressed',String(scopeSelect?.value===value));
   button.onclick=()=>{
    if(!scopeSelect)return;
    const already=scopeSelect.value===value;
    setViValue(document,scopeSelect,value);
    scopeSelect.dispatchEvent(new (document.defaultView?.Event??Event)('change',{bubbles:true}));
    for(const other of seg.querySelectorAll('button'))other.setAttribute('aria-pressed',String(other===button));
    // 重复点当前视图也要给一句回应（宪章六「点了没反应」）：不换视图时最少说清"现在就是它"。
    if(already)notify('现在就是「'+label+'」视图');
   };
   seg.append(button);
  }
  bar.append(seg);
  // 原下拉隐藏（功能仍由分段驱动，保留给脚本/键盘与兼容）
  const scopeHost=scopeSelect?.closest('[data-viselect]')||scopeSelect;
  if(scopeHost&&scopeHost!==seg)scopeHost.style.display='none';
 })();

 const space=document.querySelector('#space'),stage=document.querySelector('.spacestage');
 const buttons=[...document.querySelectorAll('#space button')];
 const fullButton=buttons.find(node=>/全屏画布|退出全屏/.test(node.textContent));
 const focusButton=buttons.find(node=>node.textContent.trim()==='打开聚焦对象详情');
 const expanded=()=>space.classList.contains('expanded-screen');
 const toggleFullscreen=()=>{
  const on=!expanded();space.classList.toggle('expanded-screen',on);
  stage.style.cssText=on?'position:fixed;inset:0;z-index:7;background:var(--ws-paper);padding:var(--ws-space-16);overflow:auto;margin:0':'';
  stage.style.height=on?'calc(100dvh - 155px)':'';
  if(fullButton)fullButton.textContent=on?'退出全屏':'全屏画布';
  fit();
 };
 const shortcuts=event=>{
  if(!(event.metaKey||event.ctrlKey))return;
  if(event.key.toLowerCase()!=='z')return;
  event.preventDefault();
  if(event.shiftKey)redo();else undo();
 };
 document.addEventListener('keydown',shortcuts);
 const escapeFullscreen=event=>{
  if(event.key!=='Escape'||document.querySelector('#veil').classList.contains('open'))return;
  if(mode==='ecosystem'&&ecoPanel&&!ecoPanel.hidden){closeEcoPanel();return}
  if(mode==='structure'&&(expandedOrg||expandedProject)){expandedOrg=null;expandedProject=null;draw();fit();return}
  if(selection.size){selection=new Set();draw();syncBar();return}
  if(expanded())toggleFullscreen();
 };
 if(fullButton)fullButton.onclick=toggleFullscreen;
 if(focusButton)focusButton.onclick=()=>{if(!focus){notify('请先点击节点或选择聚焦项目',true);return}open?.(focus)};
 document.addEventListener('keydown',escapeFullscreen);
 if(scopeSelect)scopeSelect.onchange=()=>{
  const next=['structure','all','shared','suggestions','ecosystem'].includes(scopeSelect.value)?scopeSelect.value:'structure';
  if(next!=='ecosystem'&&ecoPanel)ecoPanel.hidden=true;
  mode=next;
  scope=(next==='structure'||next==='ecosystem')?'all':next;
  focus='';expandedOrg=null;expandedProject=null;structMoved={};setViValue(document,focusSelect,'');
  selection=new Set();selectMode=false;if(selectButton)selectButton.classList.remove('active');syncBar();
  if(next==='ecosystem'){ecoView='focus';ecoLayout=null}
  if(next==='all')relayoutAll();
  draw();fit();
 };
 if(focusSelect){setViOptions(document,focusSelect,[['','所有项目'],...projects.map(project=>[project.id,project.title])]);focusSelect.onchange=()=>{focus=focusSelect.value;scope='all';expandedOrg=null;expandedProject=null;structMoved={};if(mode!=='structure')setViValue(document,scopeSelect,'all');draw();fit()}}
 const search=document.querySelector('#graphsearch');
 if(search)search.onkeydown=async event=>{
  if(event.key!=='Enter')return;const query=search.value.trim();if(!query)return;
  if(mode==='ecosystem'){
   const layout=ecoBuild(),needle=query.toLowerCase();
   // 先找已录入组织：组织可能被折叠在类别卡里，不能只搜当前可见卡。
   const org=nodes.find(item=>item.kind==='organization'&&String(item.title||'').toLowerCase().includes(needle));
   if(org){
    const card=layout.cards.find(item=>item.objectId===org.id)
     ??layout.cards.find(item=>item._kind==='cluster'&&(item.memberIds??[]).includes(org.id));
    if(card){
     const viewport=viewportSize(),targetZoom=Math.max(0.9,Math.min(1.2,zoom||1));
     cameraTo({zoom:targetZoom,gx:viewport.w/2-(card.x+card.w/2)*targetZoom,gy:viewport.h/2-(card.y+card.h/2)*targetZoom},{animate:true});
     openEcoPanel({objectId:org.id});return;
    }
   }
   const card=layout.cards.find(item=>String(item.title||'').toLowerCase().includes(needle));
   if(!card){notify('底图和工作台里都没有找到「'+query+'」',true);return}
   const viewport=viewportSize(),targetZoom=Math.max(0.9,Math.min(1.2,zoom||1));
   cameraTo({zoom:targetZoom,gx:viewport.w/2-(card.x+card.w/2)*targetZoom,gy:viewport.h/2-(card.y+card.h/2)*targetZoom},{animate:true});
   if(card.objectId)openEcoPanel({objectId:card.objectId});else if(card.baseId)openEcoPanel({baseId:card.baseId});else openEcoPanel({clusterKey:card.key});
   return;
  }
  try{
   const result=await send('node_search',{query,limit:20});if(disposed)return;
   const hit=result.items?.[0];if(!hit){notify('未找到匹配对象',true);return}
   if(mode==='structure'&&hit.kind!=='project'){
    // 诊断修复：结构态把任意搜索结果塞进 focus，会被当成「项目 scope」，画布直接变 0 个节点。
    // 机构/任务/资料搜索改为打开详情；项目才用聚焦过滤。
    focus='';expandedOrg=null;expandedProject=null;draw();open?.(hit.id);notify('已定位「'+(hit.title||'匹配对象')+'」');return;
   }
   if(mode==='all'&&hit.kind==='organization'){openEcoPanel({objectId:hit.id});notify('已定位「'+(hit.title||'匹配对象')+'」');return}
   focus=hit.id;draw();fit()
  }catch(error){notify(error.message,true)}
 };
 // 世界坐标（画布坐标系）换算：框选与分组都用它。
 const toWorld=event=>{const rect=svg.getBoundingClientRect();return {x:(event.clientX-rect.left-gx)/zoom,y:(event.clientY-rect.top-gy)/zoom}};
 const pointerDown=event=>{
  if(event.button!==0)return;
  const clusterEl=event.target.closest?.('[data-eco-cluster]');
  if(clusterEl&&mode==='ecosystem'){
   drag={id:event.pointerId,x:event.clientX,y:event.clientY,gx,gy,nodeId:null,clusterKey:clusterEl.dataset.ecoCluster};moved=false;
   try{svg.setPointerCapture?.(event.pointerId)}catch{/* 指针失效时忽略 */}
   return;
  }
  const target=event.target.closest?.('[data-node]'),id=target?.dataset.node;
  // 关系线和底图灰点不参与拖动/框选：留到 pointerup 里按“点击”处理（否则点击会被框选吞掉）。
  if(event.target.closest?.('[data-edge],[data-eco-base]'))return;
  // Shift+点击节点＝加入/移出选择（不触发聚焦或详情）；空白处 Shift+拖拽＝框选；普通拖拽＝平移。
  if(id&&event.shiftKey){if(selection.has(id))selection.delete(id);else selection.add(id);draw();syncBar();event.preventDefault();return}
  if(!id){
   if(mode==='ecosystem')closeEcoPanel();
   if(!selectMode&&!event.shiftKey){
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,gx,gy,nodeId:null};moved=false;
    try{svg.setPointerCapture?.(event.pointerId)}catch{/* 指针失效时忽略，不影响平移 */}
    return;
   }
   const point=toWorld(event);marquee={id:event.pointerId,x1:point.x,y1:point.y,x2:point.x,y2:point.y};moved=false;try{svg.setPointerCapture?.(event.pointerId)}catch{/* 节点重绘后指针可能已失效：忽略即可，不影响点击与拖动 */};drawMarquee();return
  }
  if(mode!=='ecosystem')pushHistory();
  if(mode==='ecosystem'){
   drag={id:event.pointerId,x:event.clientX,y:event.clientY,gx,gy,nodeId:id,start:null};moved=false;
   try{svg.setPointerCapture?.(event.pointerId)}catch{/* 指针失效时忽略 */}
   return;
  }
  const startPosition=mode==='structure'?(structPositions[id]??childPositions[id]):positions[id];
  drag={id:event.pointerId,x:event.clientX,y:event.clientY,gx,gy,nodeId:id,start:startPosition?{...startPosition}:null};moved=false;try{svg.setPointerCapture?.(event.pointerId)}catch{/* 节点重绘后指针可能已失效：忽略，不影响点击与拖动 */}};
 const drawMarquee=()=>{const world=svg.querySelector('#spaceworld');if(!world)return;world.querySelector('#marquee')?.remove();if(!marquee)return;
  const rect=se('rect',{id:'marquee',x:Math.min(marquee.x1,marquee.x2),y:Math.min(marquee.y1,marquee.y2),width:Math.abs(marquee.x2-marquee.x1),height:Math.abs(marquee.y2-marquee.y1),fill:viToken('--ws-action'),'fill-opacity':'.08',stroke:viToken('--ws-action'),'stroke-dasharray':'4 4'});
  world.append(rect)};
 const pointerMove=event=>{
  if(link&&event.pointerId===link.id){
   const point=toWorld(event),from=positions[link.from];
   const ghost=svg.querySelector('#linkghost');
   if(ghost&&from)ghost.setAttribute('d',`M${from.x+(sizes.get(link.from)?.w??200)} ${from.y+(sizes.get(link.from)?.h??74)/2} L${point.x} ${point.y}`);
   return;
  }
  if(marquee&&event.pointerId===marquee.id){const point=toWorld(event);marquee.x2=point.x;marquee.y2=point.y;moved=true;drawMarquee();return}
  if(!drag||event.pointerId!==drag.id)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  // 生态态的卡是固定布局：小抖动（≤8px）仍当点击；真拖动则平移画布。旧版 >4px 直接 return，
  // 既不开弹窗也不平移，用户感觉“卡死了”（诊断报告 P1）。
  // 用欧氏距离而不是 |dx|+|dy|：斜着抖 6px 实际只有 8.5px，不该被判成拖动。
  const threshold=mode==='ecosystem'?10:4;
  if(Math.hypot(dx,dy)>threshold)moved=true;if(!moved)return;
  if(mode==='ecosystem'){gx=drag.gx+dx;gy=drag.gy+dy;transform();return;}
  if(drag.nodeId&&drag.start){
   const target=mode==='structure'?(structPositions[drag.nodeId]?structPositions:childPositions[drag.nodeId]?childPositions:null):positions;
   if(target)target[drag.nodeId]={x:drag.start.x+dx/zoom,y:drag.start.y+dy/zoom};
   draw();
  }else{gx=drag.gx+dx;gy=drag.gy+dy;transform()}};
 const pointerUp=event=>{
  if(link&&event.pointerId===link.id){
   const from=link.from;link=null;
   svg.querySelector('#linkghost')?.remove();
   // 用了 pointer capture，pointerup 的 event.target 是 SVG 而不是节点；
   // 因此按坐标命中（elementFromPoint）判断松手时落在哪个节点上。
   const under=document.elementFromPoint?.(event.clientX,event.clientY);
   const target=under?.closest?.('[data-node]')?.dataset.node??event.target.closest?.('[data-node]')?.dataset.node;
   if(!target||target===from){notify('连线取消：请从节点右侧的小圆点拖到另一个对象上',true);return}
   const exists=edges.some(edge=>((edge.from===from&&edge.to===target)||(edge.from===target&&edge.to===from))&&edge.status!=='rejected');
   if(exists){notify('这两个对象之间已经有关联了',true);return}
   void (async()=>{
    const source=nodes.find(node=>node.id===from),destination=nodes.find(node=>node.id===target);
    // 你自己连的线：当场问清"什么关系、为什么"，保存即生效（不再生成待确认的改动、也不会事后报错卡住）。
    const answer=await askLink(source,destination);
    if(!answer)return;
    try{
     const receipt=await batch.apply('画布关联：'+(source?.title??from)+' → '+(destination?.title??target),[{op:'create',kind:'relation',data:{
      title:answer.type,from,to:target,status:'confirmed',
      reason:answer.basis,evidence:answer.basis,
     },sources:{from:'你在画布上手动连线',to:'你在画布上手动连线',status:'你在画布上手动连线',reason:'你在画布上填写的依据',evidence:'你在画布上填写的依据'}}],{label:'这条关联'});
     void receipt;
    }catch(error){notify(error.message,true)}
   })();
   return;
  }
  if(marquee&&event.pointerId===marquee.id){
   const box={...marquee};const dragged=moved;marquee=null;
   svg.querySelector('#spaceworld #marquee')?.remove();
   if(dragged){const hiddenNow=hiddenByGroups(groups);const vis=shown().filter(node=>!hiddenNow.has(node.id));const sm=sizeMap(vis,edges);const placed=vis.map(node=>({n:node,position:positions[node.id]}));const hit=marqueeSelect(box,placed,sm);selection=new Set(hit);notify(hit.length?'已选中 '+hit.length+' 个对象':'没有选中对象')}
   else selection=new Set();
   if(mode==='ecosystem')closeEcoPanel();
   draw();syncBar();return;
  }
  if(!drag){
   const under=document.elementFromPoint?.(event.clientX,event.clientY);
   const target=event.target.closest?.('[data-edge],[data-eco-base]')??under?.closest?.('[data-edge],[data-eco-base]');
   if(target?.dataset.edge){showEdgeActions(target.dataset.edge);return}
   if(target?.dataset.ecoBase){openEcoPanel({baseId:target.dataset.ecoBase});return}
   if(mode==='ecosystem')closeEcoPanel();
   return;
  }
  const dragged=moved,draggedNode=drag.nodeId;drag=null;
  if(dragged){
   if(mode==='ecosystem')return;
   // 结构态拖动只在本次会话生效（不写业务数据）；关系态沿用原来的布局保存。
   if(mode==='structure'){if(draggedNode){const position=structPositions[draggedNode]??childPositions[draggedNode];if(position)structMoved[draggedNode]={...position}}return}
   markDirtyLayout();return;
  }
  // 单击 = 打开详情；想看关联改双击（或右键菜单）。
  // 注意：pointerdown 里 pushHistory() 会重绘节点，pointerup 的 target 会变成 SVG 而不是节点，
  // 只按 event.target 判断会导致"点了没反应"（实测事件序列：pointerup@(svg)）。
  // 所以这里按坐标命中，和连线落点用同一套办法。
  const under=document.elementFromPoint?.(event.clientX,event.clientY);
  const target=event.target.closest?.('[data-node],[data-edge],[data-eco-base],[data-eco-cluster],[data-bucket-card]')??under?.closest?.('[data-node],[data-edge],[data-eco-base],[data-eco-cluster],[data-bucket-card]');
  if(!target){if(mode==='ecosystem')closeEcoPanel();return}
  if(target.dataset.bucketCard){const bucket=structure?.buckets.find(item=>item.key===target.dataset.bucketCard);if(bucket)openStructureBucket(bucket);return}
  if(target.dataset.ecoCluster){openEcoPanel({clusterKey:target.dataset.ecoCluster});return}
  if(target.dataset.ecoBase){openEcoPanel({baseId:target.dataset.ecoBase});return}
  if(target.dataset.node){
   if(mode==='ecosystem'){openEcoPanel({objectId:target.dataset.node});return}
   if(mode==='all'&&nodeOf(target.dataset.node)?.kind==='organization'){openEcoPanel({objectId:target.dataset.node});return}
   if(mode==='structure'){
    const id=target.dataset.node,now=Date.now();
    // 真正的双击：第二次在 300ms 内点同一张卡 → 打开详情，不再反复展开/收起。
    // 慢一点再点同一张卡（>300ms）仍然是“再次单击收起”。这条区分只靠时间，不靠 DOM 是否被重绘。
    if(lastNodeClick.id===id&&now-lastNodeClick.at<300){lastNodeClick={id:'',at:0};lastDoubleAt=now;open?.(id);return}
    lastNodeClick={id,at:now};toggleNode(id,{openOnUnsupported:true});return;
   }
   open?.(target.dataset.node)
  }else if(target.dataset.edge)showEdgeActions(target.dataset.edge)};
 // CV-02 键盘访问：聚焦的节点/连线用 Enter 或空格激活，与点击同一条路径。
 const keydown=event=>{if(event.key!=='Enter'&&event.key!==' ')return;const target=event.target.closest?.('[data-node],[data-edge],[data-eco-cluster],[data-eco-base],[data-bucket-card]');if(!target)return;event.preventDefault();
  if(target.dataset.bucketCard){const bucket=structure?.buckets.find(item=>item.key===target.dataset.bucketCard);if(bucket)openStructureBucket(bucket);return}
  if(target.dataset.ecoCluster){openEcoPanel({clusterKey:target.dataset.ecoCluster});return}
  if(target.dataset.ecoBase){openEcoPanel({baseId:target.dataset.ecoBase});return}
  if(target.dataset.node){if(mode==='ecosystem')openEcoPanel({objectId:target.dataset.node});else activate(target.dataset.node);return}
  showEdgeActions(target.dataset.edge)};
 svg.addEventListener('keydown',keydown);
 const wheel=event=>{event.preventDefault?.();
  const rect=svg.getBoundingClientRect?.()??{left:0,top:0};
  // 2026-10-22 用户反馈：触控板捏合才是缩放，双指滑动应当平移。
  // 浏览器/Electron 的触控板捏合会以 ctrlKey+wheel 送达；普通 wheel 是双指滑动。
  if(event.ctrlKey){
   const x=event.clientX-rect.left,y=event.clientY-rect.top;
   const next=Math.max(.25,Math.min(2.5,zoom*Math.exp(-event.deltaY*.0015))),ratio=next/zoom;
   gx=x-(x-gx)*ratio;gy=y-(y-gy)*ratio;setZoom(next);
  }else{
   gx-=(event.deltaX??0);gy-=(event.deltaY??0);transform();
  }
 };
 svg.addEventListener('dblclick',event=>{const under=document.elementFromPoint?.(event.clientX,event.clientY);const node=event.target.closest?.('[data-node]')??under?.closest?.('[data-node]');if(!node)return;event.preventDefault();if(mode==='ecosystem'||(mode==='all'&&nodeOf(node.dataset.node)?.kind==='organization'))openEcoPanel({objectId:node.dataset.node});else if(mode==='structure'){if(Date.now()-lastDoubleAt<500)return;open?.(node.dataset.node)}else activate(node.dataset.node)});
 svg.addEventListener('pointerdown',pointerDown);svg.addEventListener('pointermove',pointerMove);svg.addEventListener('pointerup',pointerUp);svg.addEventListener('pointercancel',()=>{drag=null});svg.addEventListener('wheel',wheel,{passive:false});
 // 结构态的画布尺寸会随页面布局（滚动条、容器内边距）变化：宽度一变就重新适配，
 // 否则「加载时算的适配」会停在旧宽度上，窄屏就会出现元素超出右边（实测 390 下右边界 425）。
 const ResizeObserverCtor=document.defaultView?.ResizeObserver;
 const sizeObserver=ResizeObserverCtor?new ResizeObserverCtor(()=>{if(!disposed&&mode==='structure')fit()}):null;
 sizeObserver?.observe(svg);
 // 操作长在画布上（用户 2026-10-12）：缩放与新建放进画布浮动控件，空白处右键/双击也能操作，
 // 顶栏只留"看什么"的筛选，不再堆一排功能按钮。
 (function canvasNative(){
  const stage=document.querySelector('#space .spacestage');
  if(!stage)return;
  if(!stage.querySelector('[data-canvas-crumbs]')){
   const crumbs=document.createElement('div');
   crumbs.className='canvas-crumbs';crumbs.dataset.canvasCrumbs='1';
   crumbs.textContent='关联空间';stage.prepend(crumbs);
  }
  const zoomBox=document.createElement('div');
  zoomBox.className='canvaszoom';zoomBox.dataset.canvaszoom='1';
  // 交互律 04：缩放读数是个状态（当前 49%），点它回到 100% —— 这是通用约定，
  // 也让这个数字不再是"只能看不能动"的装饰。
  {const label=document.getElementById('zoomlabel');
   if(label){label.dataset.readout='1';label.style.cursor='pointer';label.title='点一下回到 100%';
    label.onclick=()=>{
     // 诊断修复：旧实现 gx=gy=0 直接跳到世界原点，整张图无预警位移。
     // 现在以视口中心为锚点放大到 100%，用户正在看的那块内容留在原地。
     const viewport=viewportSize();if(!viewport.w||!viewport.h){setZoom(1);return}
     const worldX=(viewport.w/2-gx)/zoom,worldY=(viewport.h/2-gy)/zoom;
     cameraTo({zoom:1,gx:viewport.w/2-worldX,gy:viewport.h/2-worldY},{animate:false});
    };}}
  for(const id of ['less','zoomlabel','more','fitspace']){
   const node=document.querySelector('#'+id);
   if(node)zoomBox.append(node);
  }
  stage.append(zoomBox);
  // 顶栏已经有「全部关系」下拉，按钮是重复的 → 移进「更多」里当"回到全局视图"。
  const globalButton=document.querySelector('#globalCanvas');
  const morePanel=document.querySelector('[data-morepanel]');
  if(globalButton&&morePanel){globalButton.textContent='回到全局视图';morePanel.append(globalButton)}
  const fab=document.createElement('div');
  fab.className='canvasfab';fab.dataset.canvasfab='1';
  const newButton=document.querySelector('#spacenew');
  if(newButton)fab.append(newButton);
  stage.append(fab);
  // 2026-10-14（用户点名「画布仍然有右键点击的很多多余的功能」）：**两个右键菜单都删掉**。
  // 依据宪章六「克制：新元素必须证明无法被现有元素表达」与 §7「不依赖隐藏手势」：
  //   · 节点原本 7 项 —— 打开详情＝单击、展开关联＝双击、从这里连线＝拖右侧圆点、
  //     编辑/归档/删除＝详情弹窗里的编辑、在画布内预览＝详情已有；「重命名」也只是改标题。
  //   · 空白原本 3 项 —— 新建节点＝画布常驻按钮、全图＝缩放组按钮、关系列表＝「更多」面板已有。
  // 没有一项是别处表达不了的，所以整块去掉；画布上只留看得见、点得到的常驻控件。
  // 空白处双击：直接新建（画布里的直觉动作）
  stage.addEventListener('dblclick',event=>{
   if(event.target.closest?.('[data-node]'))return;
   event.preventDefault();
   document.querySelector('#spacenew')?.click();
  });
  })();
 return {load,refit(){if(svg.getBoundingClientRect().width)fit()},focusNode:focusOn,dispose(){disposed=true;epoch++;document.querySelector('#canvasactionbar')?.remove();document.removeEventListener('keydown',escapeFullscreen);document.removeEventListener('keydown',shortcuts);document.querySelector('#nodemenu')?.remove();svg.removeEventListener('keydown',keydown);if(space)space.classList.remove('expanded-screen');if(stage)stage.style.cssText='';if(fullButton)fullButton.onclick=null;if(focusButton)focusButton.onclick=null;svg.removeEventListener('pointerdown',pointerDown);svg.removeEventListener('pointermove',pointerMove);svg.removeEventListener('pointerup',pointerUp);svg.removeEventListener('wheel',wheel);for(const selector of ['#more','#less','#fitspace','#resetlayout','#allrelations','#aiExplain','#globalCanvas'])wire(selector,null);if(scopeSelect)scopeSelect.onchange=null;if(focusSelect)focusSelect.onchange=null;if(search)search.onkeydown=null;try{sizeObserver?.disconnect()}catch{}modal.invalidate(token)}};
}