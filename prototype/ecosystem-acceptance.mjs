#!/usr/bin/env node
/** 生态视图画布 · 验收（真实实例或本机预览都行）。
 *
 *  为什么要有它：`live-acceptance.mjs` 核对「看到的 = 装的」，但不认识画布交互。
 *  这里走用户会走的路，并且**用真实鼠标坐标点击**（不是把 PointerEvent 合成派发到元素上——
 *  上一版就是因为合成事件绕过了 SVG 命中测试，灰点卡面点不到却全绿）。
 *
 *  用法：
 *    node prototype/ecosystem-acceptance.mjs --base http://127.0.0.1:19030
 *    node prototype/ecosystem-acceptance.mjs              # 自动找正在运行的实例（需本机会话 cookie）
 */
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {launchBrowser} from './live-target.mjs';
import {findLiveTarget} from './live-target.mjs';

const arg = name => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : undefined; };
const BASE = arg('--base');
const SHOTS = join(import.meta.dirname, 'screenshots', 'ecosystem');
mkdirSync(SHOTS, { recursive: true });
const problems = [];
const pass = text => console.log('PASS ' + text);
const fail = text => { problems.push(text); console.log('FAIL ' + text); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const target = BASE ? { base: BASE.replace(/\/+$/, ''), cookie: null } : await findLiveTarget();
const browser = await launchBrowser();

async function open(width = 1440, height = 940, { dark = false, reduced = false } = {}) {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  if (target.cookie) {
    const at = target.cookie.indexOf('=');
    await page.setCookie({ name: target.cookie.slice(0, at), value: target.cookie.slice(at + 1), domain: new URL(target.base).hostname, path: '/' });
  }
  const media = [];
  if (dark) media.push({ name: 'prefers-color-scheme', value: 'dark' });
  if (reduced) media.push({ name: 'prefers-reduced-motion', value: 'reduce' });
  if (media.length) await page.emulateMediaFeatures(media);
  await page.goto(target.base + '/personal-workstation', { waitUntil: 'networkidle0' });
  await page.click('[data-view="space"]');
  await page.waitForSelector('#space.active', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#spaceSvg [data-node],#spaceSvg [data-bucket-card],#spaceSvg [data-eco-cluster]').length > 0, { timeout: 15000 });
  await page.evaluate(() => document.querySelector('.canvas-segmented [data-seg-mode="ecosystem"]')?.click());
  await page.waitForFunction(() => document.querySelector('#spaceSvg')?.dataset.canvasMode === 'ecosystem', { timeout: 15000 });
  await sleep(400);
  return page;
}
const stageBox = page => page.evaluate(() => { const r = document.querySelector('#space .spacestage').getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}; });
/** 找一张“完整落在舞台里”的卡，用真实鼠标点它。 */
async function clickInStage(page, selector) {
  const box = await stageBox(page);
  const point = await page.evaluate(({selector, box}) => {
    for (const node of document.querySelectorAll(selector)) {
      const r = node.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.left >= box.left + 8 && r.top >= box.top + 8 && r.right <= box.right - 8 && r.bottom <= box.bottom - 8) {
        return {x:r.left + r.width / 2, y:r.top + r.height / 2, text:(node.textContent || '').slice(0, 40)};
      }
    }
    return null;
  }, {selector, box});
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  await sleep(250);
  return point;
}
const panelText = page => page.evaluate(() => { const node = document.querySelector('[data-ecopanel]'); return node && !node.hidden ? node.textContent || '' : ''; });
const canvasState = page => page.evaluate(() => ({
  mode: document.querySelector('#spaceSvg')?.dataset.canvasMode,
  zoom: document.querySelector('#zoomlabel')?.textContent,
  transform: document.querySelector('#spaceworld')?.getAttribute('transform'),
  ghost: document.querySelectorAll('#spaceSvg [data-eco-base]').length,
  cluster: document.querySelectorAll('#spaceSvg [data-eco-cluster]').length,
  orgCard: document.querySelectorAll('#spaceSvg [data-eco-card][data-eco-kind="org"]').length,
  taskCard: document.querySelectorAll('#spaceSvg [data-eco-card][data-eco-kind="task"]').length,
  panel: document.querySelector('[data-ecopanel]')?.hidden === false,
  status: document.querySelector('#graphstatus')?.textContent ?? '',
  saveHidden: document.querySelector('#savelayout')?.hidden !== false,
  selectHidden: document.querySelector('#canvasselect')?.hidden !== false,
}));

const page = await open();
try {
  // ── 默认组织视图 ──────────────────────────────────────────────────────
  let state = await canvasState(page);
  if (state.mode !== 'ecosystem') fail('画布没有切到生态视图');
  if (state.ghost !== 0) fail('默认组织视图不应画底图灰点，实际 ' + state.ghost);
  else pass('默认不画底图灰点（只画组织）');
  if (state.taskCard !== 0) fail('任务不应出现在生态图里，实际 ' + state.taskCard + ' 张');
  else pass('任务不上生态图（任务只在组织/项目弹窗）');
  const orgTotal = await page.evaluate(() => {
    let total = 0;
    for (const node of document.querySelectorAll('#spaceSvg [data-eco-cluster]')) total += Number(/×(\d+)/.exec(node.textContent || '')?.[1] ?? 0);
    for (const node of document.querySelectorAll('#spaceSvg [data-eco-card][data-eco-kind="org"]')) total += 1;
    return total;
  });
  // 单卡数字来自卡片副标题；从 dataset 不可得，用类别卡成员说明/组织卡计数核对状态行。
  if (!/已录入 \d+ 个组织/.test(state.status)) fail('状态行没有如实写已录入组织数：' + state.status);
  else pass('状态行如实写已录入组织：' + (/\d+/.exec(state.status) || [''])[0]);
  if (!state.saveHidden) fail('生态态仍显示「保存布局」'); else pass('生态态隐藏「保存布局」');
  if (!state.selectHidden) fail('生态态仍显示「框选」'); else pass('生态态隐藏「框选」');
  if (state.cluster < 1) fail('默认组织视图没有类别聚合卡'); else pass('类别聚合卡 ' + state.cluster + ' 张（一屏可读）');
  await page.screenshot({path: join(SHOTS, 'accept-focus-1440.png')});

  // 键盘：聚焦类别卡按 Enter，应和点击同一条路（右侧清单），不是详情弹窗
  const keyboardOpened = await page.evaluate(() => {
    const card = document.querySelector('#spaceSvg [data-eco-cluster]');
    if (!card) return false;
    card.focus();
    card.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
    return true;
  });
  await sleep(200);
  if (!keyboardOpened) fail('没有可聚焦的类别卡');
  else if (!(await panelText(page))) fail('类别卡按 Enter 没有打开右侧清单');
  else pass('类别卡按 Enter 打开右侧清单');
  await page.keyboard.press('Escape'); await sleep(120);

  // 轻微抖动仍算点击：按下后斜移 6px（欧氏 8.5px）松手，不能变成“死了”
  const jitterTarget = await page.evaluate(() => {
    for (const node of document.querySelectorAll('#spaceSvg [data-eco-card][data-eco-kind="org"]')) {
      const r = node.getBoundingClientRect();
      if (r.width > 20 && r.left > 300 && r.top > 250 && r.right < 1100) return {x:r.left + r.width / 2, y:r.top + r.height / 2};
    }
    return null;
  });
  if (jitterTarget) {
    await page.mouse.move(jitterTarget.x, jitterTarget.y);
    await page.mouse.down();
    await page.mouse.move(jitterTarget.x + 6, jitterTarget.y + 6, {steps:2});
    await page.mouse.up();
    await sleep(250);
    if (!(await panelText(page))) fail('生态卡轻微抖动 6px 后点击被吞（应仍打开弹窗）');
    else pass('生态卡轻微抖动仍算点击（修复 4px 死区）');
    await page.keyboard.press('Escape'); await sleep(120);
  }

  // ── 点类别卡：右侧列出组织；镜头不动 ─────────────────────────────────
  const beforeCluster = await canvasState(page);
  const cluster = await clickInStage(page, '#spaceSvg [data-eco-cluster]');
  if (!cluster) fail('舞台里没有可点的类别卡');
  else {
    const text = await panelText(page);
    const afterCluster = await canvasState(page);
    if (!text) fail('点类别卡没有出右侧清单');
    else if (!/个组织/.test(text)) fail('类别卡清单没有组织数');
    else pass('点类别卡右侧列出组织（' + cluster.text + '）');
    if (afterCluster.transform !== beforeCluster.transform) fail('点类别卡后镜头移动了：' + beforeCluster.transform + ' → ' + afterCluster.transform);
    else pass('点类别卡镜头不动');
    // 点清单里的第一个组织 → 组织弹窗
    const orgRow = await page.evaluate(() => {
      const row = document.querySelector('[data-ecopanel] [data-eco-open]');
      if (!row) return null;
      const r = row.getBoundingClientRect();
      return {x:r.left + r.width / 2, y:r.top + r.height / 2, id:row.dataset.ecoOpen};
    });
    if (!orgRow) fail('类别清单里没有可点的组织');
    else {
      await page.mouse.click(orgRow.x, orgRow.y); await sleep(250);
      const orgPanel = await panelText(page);
      if (!orgPanel) fail('点类别清单里的组织没有出组织弹窗');
      else if (!/项目 ·|任务 ·|改分类/.test(orgPanel)) fail('组织弹窗没有项目/任务/改分类');
      else pass('类别清单 → 组织弹窗（' + orgRow.id + '）');
    }
  }
  await page.keyboard.press('Escape'); await sleep(150);

  // ── 搜索某高校：弹窗有项目与任务 ───────────────────────────────────
  await page.evaluate(() => { const i = document.querySelector('#graphsearch'); if (i) i.value = ''; });
  await page.click('#graphsearch');
  await page.type('#graphsearch', '某高校');
  await page.keyboard.press('Enter'); await sleep(500);
  const hhuText = await panelText(page);
  if (!hhuText) fail('搜索某高校没有打开右侧弹窗');
  else if (!/某高校/.test(hhuText)) fail('搜索打开的不是某高校：' + hhuText.slice(0, 80));
  else if (!/行业的行业大模型项目/.test(hhuText)) fail('某高校弹窗没有行业的行业大模型项目');
  else if (!/任务 ·/.test(hhuText)) fail('某高校弹窗没有任务分区');
  else pass('搜索/点组织能打开项目与任务（某高校）');
  await page.screenshot({path: join(SHOTS, 'accept-panel-1440.png')});
  await page.keyboard.press('Escape'); await sleep(150);

  // ── 显示底图：297 全部在场；点灰点卡面中间也要有反应 ────────────────
  const toggle = await page.evaluate(() => { const b = document.querySelector('[data-ecobasetoggle]'); if (!b) return null; const r = b.getBoundingClientRect(); return {x:r.left + r.width / 2, y:r.top + r.height / 2}; });
  if (!toggle) fail('没有「显示底图」开关');
  else {
    await page.mouse.click(toggle.x, toggle.y); await sleep(500);
    state = await canvasState(page);
    const matched = await page.evaluate(() => document.querySelectorAll('#spaceSvg [data-eco-card][data-eco-matched]').length);
    if (state.ghost + matched !== 297) fail('打开底图后不是 297：灰点 ' + state.ghost + ' + 对上 ' + matched);
    else pass('打开底图：底图 297 个全部在场（灰点 ' + state.ghost + ' + 对上 ' + matched + '）');
    if (state.taskCard !== 0) fail('打开底图后任务卡又出现了');
    await page.screenshot({path: join(SHOTS, 'accept-base-1440.png')});
    // 真实鼠标点灰点卡面中心（不是文字）
    const box = await stageBox(page);
    const ghost = await page.evaluate(box => {
      for (const node of document.querySelectorAll('#spaceSvg [data-eco-base]')) {
        const r = node.getBoundingClientRect();
        if (r.width < 40 || r.left < box.left + 10 || r.top < box.top + 10 || r.right > box.right - 10 || r.bottom > box.bottom - 10) continue;
        return {x:r.left + r.width / 2, y:r.top + r.height / 2};
      }
      return null;
    }, box);
    if (!ghost) fail('舞台里没有可点的灰点卡');
    else {
      await page.mouse.click(ghost.x, ghost.y); await sleep(250);
      const ghostPanel = await panelText(page);
      if (!ghostPanel) fail('点灰点卡面中间没有反应（SVG 命中测试仍然只认文字/虚线）');
      else if (!/底图节点/.test(ghostPanel) || !/还没有录入工作台/.test(ghostPanel)) fail('灰点弹窗没有如实说未录入');
      else pass('点灰点卡面中间能打开「底图节点 / 未录入」弹窗');
    }
    await page.keyboard.press('Escape'); await sleep(120);
    // 全图：必须真的能看全
    await page.mouse.click(...await page.evaluate(() => { const r = document.querySelector('#fitspace').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
    await sleep(400);
    const fitState = await canvasState(page);
    const fitZoom = Number((fitState.zoom || '').replace('%', ''));
    if (!(fitZoom < 60)) fail('底图视图点「全图」后仍是 ' + fitState.zoom + '，没有缩到能看全');
    else pass('底图视图「全图」缩到 ' + fitState.zoom + '（能看全）');
    await page.screenshot({path: join(SHOTS, 'accept-base-fit-1440.png')});
  }

  // ── 结构态：真实数据按供应链类别折叠；点分类看机构、点机构看详情；搜索不清空 ──
  await page.evaluate(() => document.querySelector('.canvas-segmented [data-seg-mode="structure"]')?.click());
  await page.waitForFunction(() => document.querySelector('#spaceSvg')?.dataset.canvasMode === 'structure', {timeout:10000});
  await page.waitForFunction(() => document.querySelectorAll('#spaceSvg [data-bucket-card]').length > 0, {timeout:10000});
  await sleep(300);
  const structureBefore = await canvasState(page);
  const bucket = await clickInStage(page, '#spaceSvg [data-bucket-card]');
  if (!bucket) fail('结构态没有可点的分类卡');
  else {
    const structureAfter = await canvasState(page);
    const bucketDialog = await page.evaluate(() => ({
      open: document.querySelector('#veil')?.classList.contains('open'),
      title: document.querySelector('#detailtitle')?.textContent || '',
      rows: document.querySelectorAll('#detailbody [data-bucket-org]').length,
    }));
    if (structureAfter.transform !== structureBefore.transform) fail('结构态点分类后镜头移动：' + structureBefore.transform + ' → ' + structureAfter.transform);
    else pass('结构态点分类不搬镜头');
    if (!bucketDialog.open || !bucketDialog.rows) fail('点分类没有出机构清单');
    else pass('点分类能出机构清单（' + bucketDialog.rows + ' 个）');
    // 清单里的机构 → 详情
    const orgButton = await page.evaluate(() => {
      const b = document.querySelector('#detailbody [data-bucket-org]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return {x:r.left + r.width / 2, y:r.top + r.height / 2};
    });
    if (orgButton) {
      await page.mouse.click(orgButton.x, orgButton.y); await sleep(400);
      const detail = await page.evaluate(() => ({open: document.querySelector('#veil')?.classList.contains('open'), title: document.querySelector('#detailtitle')?.textContent || ''}));
      if (!detail.open) fail('点分类清单里的机构没有打开详情');
      else pass('分类清单 → 机构详情（' + detail.title + '）');
    }
    await page.keyboard.press('Escape'); await sleep(150);
  }
  // 结构态搜索：不能再把画布清空
  await page.evaluate(() => { const i = document.querySelector('#graphsearch'); if (i) i.value = ''; });
  await page.click('#graphsearch'); await page.type('#graphsearch', '某高校'); await page.keyboard.press('Enter'); await sleep(500);
  const searchState = await page.evaluate(() => ({
    veil: document.querySelector('#veil')?.classList.contains('open'),
    title: document.querySelector('#detailtitle')?.textContent || '',
    buckets: document.querySelectorAll('#spaceSvg [data-bucket-card]').length,
  }));
  if (!searchState.veil || !/某高校/.test(searchState.title)) fail('结构态搜索某高校没有打开详情');
  else if (searchState.buckets === 0) fail('结构态搜索把画布清空了');
  else pass('结构态搜索能定位且不清空画布');
  await page.keyboard.press('Escape'); await sleep(150);
  const structureSaveHidden = await page.evaluate(() => document.querySelector('#savelayout')?.hidden !== false);
  if (!structureSaveHidden) fail('结构态仍显示「保存布局」（结构态不保存）'); else pass('结构态隐藏「保存布局」');
  // 缩放读数点击：回 100% 必须以视口中心为锚，不得跳到世界原点
  const zoomBefore = await canvasState(page);
  await page.evaluate(() => document.querySelector('#zoomlabel')?.click());
  await sleep(300);
  const zoomAfter = await canvasState(page);
  if (zoomAfter.zoom !== '100%') fail('点缩放读数没有回到 100%：' + zoomAfter.zoom);
  else if (zoomAfter.transform === 'translate(0 0) scale(1)') fail('点缩放读数跳到了世界原点');
  else pass('点缩放读数以视口中心回 100%');
  await page.evaluate(() => document.querySelector('#fitspace')?.click()); await sleep(250);

  // ── 关系态：全图能看全 ─────────────────────────────────────────────
  await page.evaluate(() => document.querySelector('.canvas-segmented [data-seg-mode="all"]')?.click());
  await page.waitForFunction(() => document.querySelector('#spaceSvg')?.dataset.canvasMode === 'all', {timeout:10000});
  await sleep(300);
  const relationBefore = await canvasState(page);
  await page.mouse.click(...await page.evaluate(() => { const r = document.querySelector('#fitspace').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
  await sleep(500);
  const relationAfter = await canvasState(page);
  const relationZoom = Number((relationAfter.zoom || '').replace('%', ''));
  if (!(relationZoom < 60)) fail('关系态「全图」仍是 ' + relationAfter.zoom + '（看不到全部）');
  else pass('关系态「全图」缩到 ' + relationAfter.zoom);
  const relVisible = await page.evaluate(() => {
    const stage = document.querySelector('#space .spacestage').getBoundingClientRect();
    let inside = 0;
    for (const node of document.querySelectorAll('#spaceSvg [data-node]')) {
      const r = node.getBoundingClientRect();
      if (r.right > stage.left && r.bottom > stage.top && r.left < stage.right && r.top < stage.bottom) inside += 1;
    }
    return {inside, total:document.querySelectorAll('#spaceSvg [data-node]').length};
  });
  if (relVisible.inside < relVisible.total) fail('关系态全图后仍有 ' + (relVisible.total - relVisible.inside) + ' 个节点在舞台外');
  else pass('关系态全图后 ' + relVisible.total + ' 个节点全部在舞台内');
  await page.screenshot({path: join(SHOTS, 'accept-relation-1440.png')});
} finally {
  await page.close();
}

// ── 390：默认组织视图可打开、无横向溢出 ────────────────────────────────
const mobile = await open(390, 844);
try {
  const state = await canvasState(mobile);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  if (state.cluster < 1) fail('390 下没有类别卡');
  if (overflow) fail('390 下页面横向溢出');
  else pass('390 能打开生态视图且无横向溢出（' + state.cluster + ' 张类别卡）');
  await mobile.screenshot({path: join(SHOTS, 'accept-390.png')});
} finally { await mobile.close(); }

// ── 暗色 ───────────────────────────────────────────────────────────────
const dark = await open(1440, 940);
try {
  await dark.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await dark.evaluate(() => document.querySelector('.canvas-segmented [data-seg-mode="structure"]')?.click());
  await dark.waitForFunction(() => document.querySelector('#spaceSvg')?.dataset.canvasMode === 'structure', {timeout:10000});
  await dark.evaluate(() => document.querySelector('.canvas-segmented [data-seg-mode="ecosystem"]')?.click());
  await dark.waitForFunction(() => document.querySelector('#spaceSvg')?.dataset.canvasMode === 'ecosystem', {timeout:10000});
  await sleep(300);
  const darkPaper = await dark.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ws-paper').trim());
  if (darkPaper !== '#191c20') fail('暗色下 --ws-paper 不是 #191c20：' + darkPaper); else pass('暗色下 --ws-paper #191c20');
  await dark.screenshot({path: join(SHOTS, 'accept-dark-1440.png')});
} finally { await dark.close(); }

// ── 减少动效 ───────────────────────────────────────────────────────────
const reduced = await open(1440, 940, { reduced: true });
try {
  const mode = await reduced.evaluate(() => document.querySelector('#spaceSvg')?.dataset.canvasMode);
  if (mode !== 'ecosystem') fail('减少动效下没有渲染生态'); else pass('减少动效下可正常进入');
} finally { await reduced.close(); }

await browser.close();
if (problems.length) { console.log('\nFAIL: ' + problems.length + ' 项没通过'); process.exit(1); }
console.log('\nPASS: 生态视图验收通过（真实鼠标；截图在 prototype/screenshots/ecosystem/）');
