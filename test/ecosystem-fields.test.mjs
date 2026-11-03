import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkstationStore} from '../src/store.mjs';
import {graph} from '../src/graph.mjs';
const ctx={workspace:'test',actor:'test',canWrite:true};
const chainKeys=['chainLayer','chainCategory','chainThreads','chainFlags','chainSource'];
// 每个用例都用独立内存库：互不影响，也不碰真实库。
function apply(store,list){const batch=store.draft(ctx,{title:'供应链标签',changes:list.map(item=>({op:'create',...item}))});return store.commit(ctx,{batchId:batch.id,revision:batch.revision,key:'chain:'+batch.id});}
// 非法取值必须在提交时被硬拦，并且说人话：错误信息要出现「供应链」，不能只报一句泛泛的无效。
function reject(store,item){
 const batch=store.draft(ctx,{title:'应被拒绝',changes:[{op:'create',...item}]});
 assert.throws(
  ()=>store.commit(ctx,{batchId:batch.id,revision:batch.revision,key:'bad:'+batch.id}),
  error=>error.code==='INVALID'&&/供应链/.test(error.message),
  '应当拒绝：'+JSON.stringify(item),
 );
}
function nodeOf(store,id){const node=graph(store,ctx,{limit:250}).nodes.find(item=>item.id===id);assert.ok(node,'画布上应当有这个节点：'+id);return node;}

test('organization 的 5 个供应链标签可提交，并原样投影到画布节点',()=>{
 const store=new WorkstationStore(':memory:');
 try{
  apply(store,[{id:'org-chain',kind:'organization',data:{title:'供应链机构',chainLayer:'L2',chainCategory:'算力供给',chainThreads:['ascend','harmony'],chainFlags:['主力','已签约'],chainSource:'ai'}}]);
  const stored=store.get(ctx,'org-chain').data;
  assert.deepEqual(
   {layer:stored.chainLayer,category:stored.chainCategory,threads:stored.chainThreads,flags:stored.chainFlags,source:stored.chainSource},
   {layer:'L2',category:'算力供给',threads:['ascend','harmony'],flags:['主力','已签约'],source:'ai'},
  );
  const node=nodeOf(store,'org-chain');
  assert.equal(node.chainLayer,'L2');
  assert.equal(node.chainCategory,'算力供给');
  assert.deepEqual(node.chainThreads,['ascend','harmony']);
  assert.deepEqual(node.chainFlags,['主力','已签约']);
  assert.equal(node.chainSource,'ai');
 }finally{store.close()}
});

test('task 的 5 个供应链标签同样可提交并投影，且只落在组织/任务节点上',()=>{
 const store=new WorkstationStore(':memory:');
 try{
  apply(store,[
   {id:'t-chain',kind:'task',data:{title:'供应链任务',status:'todo',chainLayer:'L0',chainCategory:'整机集成',chainThreads:['base'],chainFlags:['待验证'],chainSource:'user'}},
   {id:'p-owner',kind:'project',data:{title:'所属项目'}},
  ]);
  const stored=store.get(ctx,'t-chain').data;
  assert.equal(stored.chainLayer,'L0');
  assert.deepEqual(stored.chainThreads,['base']);
  const node=nodeOf(store,'t-chain');
  assert.equal(node.chainLayer,'L0');
  assert.equal(node.chainCategory,'整机集成');
  assert.deepEqual(node.chainThreads,['base']);
  assert.deepEqual(node.chainFlags,['待验证']);
  assert.equal(node.chainSource,'user');
  // 供应链标签不是项目字段：项目节点上不会出现，也不该被画布凭空补出来。
  const projectNode=nodeOf(store,'p-owner');
  for(const key of chainKeys)assert.equal(key in projectNode,false,'项目节点不应有 '+key);
 }finally{store.close()}
});

test('供应链标签的取值边界：层级、主线、环节长度、重复与标记类型都会被拒',()=>{
 const store=new WorkstationStore(':memory:');
 try{
  apply(store,[{id:'org-ok',kind:'organization',data:{title:'机构'}}]);
  // 层级：只认空串与 L0–L6。
  reject(store,{id:'org-l9',kind:'organization',data:{title:'层级越界',chainLayer:'L9'}});
  reject(store,{id:'org-layer-word',kind:'organization',data:{title:'层级不是文本',chainLayer:2}});
  // 主线：只认内置 4 条，不重复、最多 4 条。
  reject(store,{id:'task-thread-x',kind:'task',data:{title:'未知主线',chainThreads:['x']}});
  reject(store,{id:'org-thread-dup',kind:'organization',data:{title:'主线重复',chainThreads:['ascend','ascend']}});
  reject(store,{id:'task-thread-many',kind:'task',data:{title:'主线过多',chainThreads:['ascend','kunpeng','harmony','base','ascend']}});
  // 环节：trim 后最多 40 字。
  reject(store,{id:'org-category-long',kind:'organization',data:{title:'环节过长',chainCategory:'环'.repeat(41)}});
  // 标记：非空文本 1–20 字、最多 10 个、不重复。
  reject(store,{id:'task-flags-type',kind:'task',data:{title:'标记不是文本',chainFlags:[1]}});
  reject(store,{id:'org-flags-blank',kind:'organization',data:{title:'标记为空',chainFlags:['  ']}});
  reject(store,{id:'task-flags-long',kind:'task',data:{title:'标记过长',chainFlags:['标'.repeat(21)]}});
  reject(store,{id:'org-flags-dup',kind:'organization',data:{title:'标记重复',chainFlags:['主力','主力']}});
  reject(store,{id:'task-flags-many',kind:'task',data:{title:'标记过多',chainFlags:Array.from({length:11},(_,i)=>'标记'+i)}});
  // 来源：只认空串 / ai / user。
  reject(store,{id:'org-source',kind:'organization',data:{title:'来源未知',chainSource:'robot'}});
  // 边界值放行：空串、L0、L6、空数组、40 字环节、10 个标记。
  apply(store,[
   {id:'org-edge-1',kind:'organization',data:{title:'边界一',chainLayer:'',chainCategory:'',chainThreads:[],chainFlags:[],chainSource:''}},
   {id:'org-edge-2',kind:'organization',data:{title:'边界二',chainLayer:'L0'}},
   {id:'task-edge',kind:'task',data:{title:'边界任务',chainLayer:'L6',chainCategory:'环'.repeat(40),chainFlags:Array.from({length:10},(_,i)=>'标记'+i)}},
  ]);
  assert.equal(store.get(ctx,'org-edge-2').data.chainLayer,'L0');
  assert.equal(store.get(ctx,'task-edge').data.chainFlags.length,10);
 }finally{store.close()}
});

test('不带供应链标签的旧对象照常提交，画布节点上不出现这 5 个字段',()=>{
 const store=new WorkstationStore(':memory:');
 try{
  apply(store,[
   {id:'org-old',kind:'organization',data:{title:'旧机构',defaultRole:'客户'}},
   {id:'task-old',kind:'task',data:{title:'旧任务',status:'todo'}},
  ]);
  for(const id of ['org-old','task-old']){
   const node=nodeOf(store,id);
   for(const key of chainKeys)assert.equal(key in node,false,id+' 不应凭空长出 '+key);
  }
  assert.equal(nodeOf(store,'org-old').defaultRole,'客户');
 }finally{store.close()}
});
