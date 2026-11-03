#!/usr/bin/env node
/** 画布数据策略迁移（2026-10-27 用户拍板）：
 *  - 64 个组织全部转成“待核对”；有项目的 2 个直接实现；
 *  - 3 个标签组织归档（其建议关系一并归档）；
 *  - DeepSeek 两条合并：保留 DeepSeek（幻方），客户关系并过去；
 *  - 从 297 底图导入 225 个组织候选（灰），并导入 136 条“组织—组织”外部研究候选关系。
 *  只读源：底图数据；写：目标库通过 WorkstationStore（可撤销批次）。
 *
 *  用法：node scripts/migrate-data-strategy-20261027.mjs --db /path/to/workstation.sqlite
 *  正式库必须先备份；默认打印而不写入，加 --apply 才写。
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {WorkstationStore} from '../src/store.mjs';
import {ECOSYSTEM_MAP} from '../prototype/ecosystem-map.mjs';
import {normalizeEcoName,matchEcosystemBase} from '../prototype/ecosystem-canvas.mjs';

const arg=name=>{const at=process.argv.indexOf(name);return at>=0?process.argv[at+1]:undefined};
const DB=arg('--db');
const APPLY=process.argv.includes('--apply');
if(!DB){console.error('需要 --db <库路径>');process.exit(2)}

const NON_ORG=new Set(['ascend-910','ascend-950','ascend-310','kunpeng-920','kunpeng-930','hygon-cpu','hbm-kr','nvidia-ib','taishan','atlas-800','cloudmatrix','huawei-oceanstor','huawei-ce','ub-mesh','modelarts','cce','kubeedge','openeuler','openharmony','harmony-pc','harmony-industry','harmony-robot','linux-win','gaussdb','pangu','qwen','doubao','huawei-cloudrobo','atlas-500','huawei-mdc','nvidia-jetson','vla-model','ros2','softbus','partner-program','kirin','harmony-phone','harmony-wear','harmony-cockpit','harmony-zhixing','harmony-connect','harmony-atom']);
for(const n of ECOSYSTEM_MAP.nodes)if(['AI 编译器与工具链','具身应用场景','样例加速卡行业应用','样例通用芯片政企应用'].includes(n.cat))NON_ORG.add(n.id);
const baseOrgs=ECOSYSTEM_MAP.nodes.filter(node=>!NON_ORG.has(node.id));
const baseOrgIds=new Set(baseOrgs.map(node=>node.id));
const baseOrgEdges=ECOSYSTEM_MAP.edges.filter(edge=>baseOrgIds.has(edge.s)&&baseOrgIds.has(edge.t));

const store=new WorkstationStore(DB);
const ctx={workspace:'68417e6e-b766-4fa3-a0de-c6825e7eea85',actor:'migration:data-strategy',canWrite:true};
const list=kind=>store.list(ctx,{kind,limit:1000}).filter(item=>!item.archived);
const orgs=list('organization');
const projects=list('project');
const relations=list('relation');
const orgByTitle=new Map(orgs.map(org=>[normalizeEcoName(org.data.title),org]));
const projectsOfOrg=new Map();
for(const project of projects){
 const ids=new Set();
 if(project.data.organizationId)ids.add(project.data.organizationId);
 if(project.data.partnerId)ids.add(project.data.partnerId);
 for(const participant of project.data.participants??[])if(participant.organizationId)ids.add(participant.organizationId);
 for(const id of ids){const list=projectsOfOrg.get(id)??[];list.push(project.id);projectsOfOrg.set(id,list)}
}

const labelTitles=new Set(['世界模型厂商','具身智能厂商','OTT综合']);
const labelOrgs=orgs.filter(org=>labelTitles.has(String(org.data.title||'').trim()));
const duplicate=orgs.find(org=>String(org.data.title||'').trim()==='幻方（DeepSeek）');
const kept=orgs.find(org=>String(org.data.title||'').trim()==='DeepSeek（幻方）');
const labelIds=new Set(labelOrgs.map(org=>org.id));
const dropRelations=relations.filter(rel=>labelIds.has(rel.data.from)||labelIds.has(rel.data.to));
const duplicateRelations=relations.filter(rel=>rel.data.from===duplicate?.id||rel.data.to===duplicate?.id);
const existingPairs=new Set(relations.map(rel=>rel.data.from+'|'+rel.data.to));
const matched=matchEcosystemBase(ECOSYSTEM_MAP,orgs.map(org=>({id:org.id,title:org.data.title,chainLayer:org.data.chainLayer})));
const matchedBaseOrgIds=new Set([...matched.values()].map(node=>node.id));

// 旧数据里有 8 条关系的 basis 是叙述文本（不是「对象ID@版本」数组），新校验会拒绝整批提交。
// 迁移时把叙述移回 reason/evidence，保留原文，再清掉非法 basis；这不是改事实。
const basisRepairs=[];
for(const rel of relations){
 if(rel.data.basis===undefined||Array.isArray(rel.data.basis))continue;
 const note=String(rel.data.basis??'').trim();
 if(!note)continue;
 const data={...rel.data};
 delete data.basis;
 const reason=String(data.reason??'').trim();
 data.reason=reason?reason+'；依据：'+note:'依据：'+note;
 basisRepairs.push({op:'update',id:rel.id,expectedRevision:rel.revision,data,sources:{reason:'旧关系依据文本迁到说明，保留原文'}});
}

// existing org updates: project-linked auto-realized; all others agent candidates
const updates=[];
for(const org of orgs){
 if(labelIds.has(org.id)||org.id===duplicate?.id)continue;
 const linked=projectsOfOrg.get(org.id)??[];
 const data={...org.data,source:linked.length?'project':'agent',verified:linked.length>0};
 // 只补字段；不改用户已有分类
 updates.push({op:'update',id:org.id,expectedRevision:org.revision,data,sources:{source:linked.length?'由关联项目直接实现':'Agent 整理待核对',verified:'由关联项目直接实现或待核对'}});
}

// base org candidates not already in list
const knownTitles=new Set(orgs.map(org=>normalizeEcoName(org.data.title)));
const creates=[];
const baseOrgIdMap=new Map(); // base node id -> org id
for(const [orgId,node] of matched)baseOrgIdMap.set(node.id,orgId);
for(const node of baseOrgs){
 if(matchedBaseOrgIds.has(node.id))continue;
 const key=normalizeEcoName(node.name);
 if(knownTitles.has(key))continue; // 同名已存在，不重复建
 const id='org-base-'+node.id;
 if(orgs.some(org=>org.id===id)){baseOrgIdMap.set(node.id,id);continue}
 creates.push({op:'create',kind:'organization',id,data:{
  title:node.name,
  description:node.desc??node.sub??'',
  note:'外部供应链研究底图导入，待核对',
  chainLayer:node.layer,
  chainCategory:node.cat,
  chainThreads:Array.isArray(node.threads)?[...node.threads]:[],
  chainFlags:[],
  chainSource:'ai',
  source:'external',
  verified:false,
 }});
 baseOrgIdMap.set(node.id,id);
 knownTitles.add(key);
}

// base org-org candidate relations
const relCreates=[];
for(const edge of baseOrgEdges){
 const from=baseOrgIdMap.get(edge.s),to=baseOrgIdMap.get(edge.t);
 if(!from||!to||from===to)continue;
 if(existingPairs.has(from+'|'+to))continue;
 relCreates.push({op:'create',kind:'relation',id:'rel-base-'+edge.s+'-'+edge.t,data:{
  title:edge.note||'产业关系（外部研究，待核对）',
  from,to,status:'suggested',
  evidence:'外部供应链研究底图 2026-10-26 · '+(edge.th||'未标主线'),
 }});
 existingPairs.add(from+'|'+to);
}

const summary={
 db:DB,
 existingOrganizations:orgs.length,
 labelOrganizations:labelOrgs.map(org=>org.data.title),
 duplicateOrganization:duplicate?.data.title??null,
 deepseekKept:kept?.data.title??null,
 autoRealized:updates.filter(update=>update.data.verified).map(update=>orgs.find(org=>org.id===update.id)?.data.title),
 labelRelationsToArchive:dropRelations.length,
 duplicateRelationsToMove:duplicateRelations.length,
 baseOrganizationNodes:baseOrgs.length,
 baseOrganizationEdges:baseOrgEdges.length,
 newOrganizationCandidates:creates.length,
 newCandidateRelations:relCreates.length,
 expectedOrganizationsAfter:orgs.length-labelOrgs.length-(duplicate?1:0)+creates.length,
};
console.log(JSON.stringify(summary,null,2));
if(!APPLY){console.log('\n只预览，没有写库。加 --apply 才执行。');store.close();process.exit(0)}

const back=[]; // receipts
const run=(title,changes)=>{
 const chunks=[];
 for(let i=0;i<changes.length;i+=100)chunks.push(changes.slice(i,i+100));
 for(let i=0;i<chunks.length;i+=1){
  const chunkTitle=chunks.length>1?title+'（'+(i+1)+'/'+chunks.length+'）':title;
  const batch=store.draft(ctx,{title:chunkTitle,changes:chunks[i]});
  const receipt=store.commit(ctx,{batchId:batch.id,revision:batch.revision,key:'data-strategy-20261027-'+batch.id});
  back.push(receipt);
 }
};
// 1) org fields + labels/duplicate archives + relation move
const cleanup=[...basisRepairs,...updates];
for(const rel of duplicateRelations){
 cleanup.push({op:'update',id:rel.id,expectedRevision:rel.revision,data:{...rel.data,to:kept.id},sources:{to:'两条 DeepSeek 组织合并'}});
}
for(const rel of dropRelations)cleanup.push({op:'archive',id:rel.id,expectedRevision:rel.revision});
for(const org of labelOrgs)cleanup.push({op:'archive',id:org.id,expectedRevision:org.revision});
if(duplicate)cleanup.push({op:'archive',id:duplicate.id,expectedRevision:duplicate.revision});
run('画布数据策略：确认状态 + 标签/重复合并',cleanup);
// 2) import base orgs
if(creates.length)run('画布数据策略：导入供应链研究组织名单（候选）',creates);
// 3) import base org-org candidate relations
if(relCreates.length)run('画布数据策略：导入组织候选关系（外部研究）',relCreates);

console.log(JSON.stringify({receipts:back.map(receipt=>receipt.id),organizations:list('organization').length,relations:list('relation').length},null,2));
store.close();
