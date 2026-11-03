#!/usr/bin/env node
/** 画布数据策略与两视图 · 真实验收（只读；不确认/不改数据）。
 *
 *  用法：
 *    node prototype/data-strategy-acceptance.mjs --base http://127.0.0.1:64327
 *    node prototype/data-strategy-acceptance.mjs          # 自动找本机实例（需 cookie）
 *
 *  只做用户会走的路径，真实鼠标坐标；查的是“当前装的应用”，不是测试夹具。
 */
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {launchBrowser, findLiveTarget} from './live-target.mjs';

const arg=name=>{const at=process.argv.indexOf(name);return at>=0?process.argv[at+1]:undefined};
const BASE=arg('--base');
const SHOTS=join(import.meta.dirname,'screenshots','data-strategy');mkdirSync(SHOTS,{recursive:true});
const problems=[];const pass=text=>console.log('PASS '+text);const fail=text=>{problems.push(text);console.log('FAIL '+text)};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const target=BASE?{base:BASE.replace(/\/+$/,''),cookie:null}:await findLiveTarget();
const browser=await launchBrowser();

async function open(width=1440,height=940,{dark=false,reduced=false}={}){
 const page=await browser.newPage();await page.setCacheEnabled(false);await page.setViewport({width,height,deviceScaleFactor:1});
 if(target.cookie){const at=target.cookie.indexOf('=');await page.setCookie({name:target.cookie.slice(0,at),value:target.cookie.slice(at+1),domain:new URL(target.base).hostname,path:'/'})}
 const media=[];if(dark)media.push({name:'prefers-color-scheme',value:'dark'});if(reduced)media.push({name:'prefers-reduced-motion',value:'reduce'});
 if(media.length)await page.emulateMediaFeatures(media);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(target.base+'/personal-workstation',{waitUntil:'networkidle0'});
 await page.click('[data-view="space"]');await page.waitForSelector('#space.active',{timeout:15000});
 await page.waitForFunction(()=>document.querySelectorAll('#spaceSvg [data-node],#spaceSvg [data-eco-cluster]').length>0,{timeout:15000});
 await sleep(800);return {page,errors};
}
const stageBox=page=>page.evaluate(()=>{const r=document.querySelector('#space .spacestage').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}});
async function clickInStage(page,selector){
 const box=await stageBox(page);
 const point=await page.evaluate(({selector,box})=>{
  for(const node of document.querySelectorAll(selector)){const r=node.getBoundingClientRect();if(r.width<8||r.height<8)continue;if(r.left>=box.left+8&&r.top>=box.top+8&&r.right<=box.right-8&&r.bottom<=box.bottom-8)return {x:r.left+r.width/2,y:r.top+r.height/2,text:(node.textContent||'').slice(0,50)}}
  return null;
 },{selector,box});
 if(!point)return null;await page.mouse.click(point.x,point.y);await sleep(300);return point;
}
const panelText=page=>page.evaluate(()=>{const n=document.querySelector('[data-ecopanel]');return n&&!n.hidden?n.textContent||'':''});
const state=page=>page.evaluate(()=>({
 mode:document.querySelector('#spaceSvg')?.dataset.canvasMode,
 seg:[...document.querySelectorAll('.canvas-segmented button')].map(b=>b.textContent.trim()),
 status:document.querySelector('#graphstatus')?.textContent??'',
 nodes:document.querySelectorAll('#spaceSvg [data-node]').length,
 candidates:document.querySelectorAll('#spaceSvg [data-kind="organization"][data-candidate="1"]').length,
 verified:document.querySelectorAll('#spaceSvg [data-kind="organization"][data-candidate="0"]').length,
 tasks:document.querySelectorAll('#spaceSvg [data-eco-card][data-eco-kind="task"]').length,
 clusters:document.querySelectorAll('#spaceSvg [data-eco-cluster]').length,
 panel:document.querySelector('[data-ecopanel]')?.hidden===false,
}));
const shot=(page,name)=>page.screenshot({path:join(SHOTS,name)});

let page,errors;
try{
 ({page,errors}=await open());
 let s=await state(page);
 if(s.mode!=='all')fail('默认不是全网：'+s.mode);else pass('默认进入全网');
 if(JSON.stringify(s.seg)!==JSON.stringify(['全网','生态视图']))fail('分段不是两个：'+JSON.stringify(s.seg));else pass('只有两个视图：全网 / 生态视图');
 if(!/组织 272（已实现 2 \/ 待核对 270）/.test(s.status))fail('数据说明不对：'+s.status);else pass('数据说明：272 个组织 / 2 已实现 / 270 待核对');
 if(!/项目 3 · 任务 6/.test(s.status))fail('项目/任务数不对：'+s.status);else pass('项目 3 / 任务 6 同一句');
 if(!/待确认 202/.test(s.status))fail('待确认数不对：'+s.status);else pass('待确认 202 如实写出');
 if(s.candidates<1)fail('全网没有候选灰卡');else pass('全网画出候选灰卡 '+s.candidates+' 个');
 if(s.verified!==2)fail('有项目的组织应 2 个直接实现，实际 '+s.verified);else pass('有项目的组织 2 个直接实现');
 await shot(page,'accept-full-1440.png');

 // 候选组织：灰 + 可直接打开，弹窗有来源/待核对/确认按钮（不点确认，避免改真实数据）
 const cand=await clickInStage(page,'#spaceSvg [data-kind="organization"][data-candidate="1"]');
 if(!cand)fail('舞台里没有可点的候选组织');
 else{
  const text=await panelText(page);
  if(!text)fail('点候选组织没有弹窗');
  else if(!/待核对/.test(text))fail('候选弹窗没有“待核对”：'+text.slice(0,80));
  else if(!/Agent 整理|外部研究/.test(text))fail('候选弹窗没有来源');
  else if(!(await page.evaluate(()=>!!document.querySelector('[data-eco-confirm]'))))fail('候选弹窗没有“确认这个组织”');
  else pass('候选组织：灰卡 → 弹窗来源/待核对/确认按钮');
  await shot(page,'accept-candidate-panel.png');
 }
 await page.keyboard.press('Escape');await sleep(150);

 // 搜索某高校：项目+任务
 await page.click('#graphsearch');await page.type('#graphsearch','某高校');await page.keyboard.press('Enter');await sleep(500);
 const hhu=await panelText(page);
 if(!hhu)fail('搜索某高校没有打开弹窗');else if(!/某高校/.test(hhu)||!/行业的行业大模型项目/.test(hhu))fail('某高校弹窗缺项目：'+hhu.slice(0,100));else pass('某高校：项目+任务都在');
 await page.keyboard.press('Escape');await sleep(150);

 // 生态视图
 await page.evaluate(()=>document.querySelector('.canvas-segmented [data-seg-mode="ecosystem"]')?.click());
 await page.waitForFunction(()=>document.querySelector('#spaceSvg')?.dataset.canvasMode==='ecosystem',{timeout:10000});await sleep(500);
 s=await state(page);
 if(s.mode!=='ecosystem')fail('没有切到生态视图');
 else pass('切到生态视图');
 if(!/组织 272（已实现 2 \/ 待核对 270）/.test(s.status))fail('生态数据说明不一致：'+s.status);else pass('两视图同一句数据说明');
 if(s.tasks!==0)fail('生态图不应画任务，实际 '+s.tasks);else pass('生态图只画组织，任务不进图');
 if(s.clusters<1)fail('生态没有类别折叠卡');else pass('生态按 '+s.clusters+' 个类别折叠');
 await shot(page,'accept-eco-1440.png');
 const cluster=await clickInStage(page,'#spaceSvg [data-eco-cluster]');
 if(!cluster)fail('舞台里没有可点的类别卡');
 else{
  const text=await panelText(page);
  if(!text)fail('点类别卡没有清单');else if(!/个组织/.test(text))fail('类别清单缺组织数');else pass('类别卡 → 组织清单');
  const row=await page.evaluate(()=>{const r=document.querySelector('[data-ecopanel] [data-eco-open]');if(!r)return null;const b=r.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}});
  if(row){await page.mouse.click(row.x,row.y);await sleep(300);const org=await panelText(page);if(!org)fail('类别清单→组织弹窗失败');else if(!/项目 ·|任务 ·/.test(org))fail('组织弹窗缺项目/任务');else pass('类别清单 → 组织项目/任务');}
 }
 await page.keyboard.press('Escape');await sleep(150);

 // 3 个标签不再作为组织：搜索“世界模型厂商”不应打开组织弹窗
 await page.evaluate(()=>{const i=document.querySelector('#graphsearch');if(i)i.value=''});
 await page.click('#graphsearch');await page.type('#graphsearch','世界模型厂商');await page.keyboard.press('Enter');await sleep(500);
 const labelPanel=await panelText(page);
 if(labelPanel&&/世界模型厂商/.test(labelPanel)&&/组织/.test(labelPanel))fail('标签仍以组织出现：'+labelPanel.slice(0,80));else pass('3 个标签不再作为组织出现');
 await page.keyboard.press('Escape');await sleep(150);

 if(errors.length)fail('页面报错：'+errors.slice(0,2).join(' | '));else pass('无页面报错');
 await page.setViewport({width:390,height:780});await sleep(400);await shot(page,'accept-390.png');
}catch(error){fail('验收异常：'+error.message)}
finally{await browser.close()}
console.log('────────────────────────────────────────────────────────');
console.log(problems.length?'FAIL: '+problems.length+' 项未通过':'PASS: 画布数据策略两视图验收全部通过。');
process.exit(problems.length?1:0);
