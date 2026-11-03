/** 【生态视图】底图布局（纯函数，无 DOM）。
 *
 *  结构 = 7 层横带 × 12 列网格；底图 297 个节点全部上画布：
 *    · 已录入的组织如果能在底图里对上号（同名/别名），就占用那个底图节点的格子并“点亮”；
 *    · 对不上号的已录入组织/任务，按自己的供应链标签追加到对应层/环节的格子末尾；
 *    · 没有标签的对象进「未分类 · 待定位」带；
 *    · 剩下没对上的底图节点保持灰点（只作背景上下文，不代表工作台事实）。
 *
 *  这个模块只算坐标与归属，不画图、不读库；渲染与交互在 space-view-v5.mjs。
 */

export const ECO_CELL = {
  w: 168,
  h: 52,
  gapX: 10,
  gapY: 8,
  cols: 11,
  labelW: 104,
  pad: 20,
  headerH: 34,
  bandGap: 16,
  bandLabelH: 26,
};

const THREADS = ['ascend', 'kunpeng', 'harmony', 'base'];

/** 名称归一：去掉空白、括号内容、常见分隔符，只留中文/字母/数字。
 *  用来把「样例芯片厂 MetaX」「样例芯片厂（MetaX）」和底图里的「样例芯片厂集成电路」这类写法对上号。 */
export function normalizeEcoName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s·\-_/、，,.。:：'"“”‘’]/g, '')
    .trim();
}

/** 人工别名：底图里的写法与工作台里的写法不一致时在这里补一条。
 *  key 是工作台对象标题（归一后），value 是底图节点名（归一后）。 */
const ALIASES = [
  ['样例芯片厂metax', '样例芯片厂集成电路'],
  ['幻方deepseek', 'deepseek'],
  ['deepseek幻方', 'deepseek'],
  ['样例加速卡', '样例加速卡910b910c'],
  ['腾讯', '腾讯云'],
  ['百度', '百度智能云'],
  ['海光信息', '海光信息dcu'],
  ['样例整机商', '神州数码'],
];

/** 每个组织最多对一个底图节点。返回 Map<organizationId, baseNode>。 */
export function matchEcosystemBase(map, orgs) {
  const base = (map?.nodes ?? []).map(node => ({node, key: normalizeEcoName(node.name)}));
  const aliasByKey = new Map(ALIASES);
  const byKey = new Map();
  for (const entry of base) if (!byKey.has(entry.key)) byKey.set(entry.key, entry.node);
  const matched = new Map();
  const used = new Set();
  for (const org of orgs ?? []) {
    const key = normalizeEcoName(org.title);
    if (!key) continue;
    let hit = null;
    const alias = aliasByKey.get(key);
    if (alias && byKey.has(alias)) hit = byKey.get(alias);
    if (!hit && byKey.has(key)) hit = byKey.get(key);
    if (!hit) {
      // 包含匹配：取“底图名被对象名包含 / 对象名被底图名包含”里最长的一个，最少 3 个字，避免「腾讯」误配「腾讯云」之外的东西。
      const candidates = base
        .filter(entry => entry.key.length >= 3 && key.length >= 3 && (entry.key.includes(key) || key.includes(entry.key)))
        .sort((left, right) => right.key.length - left.key.length);
      hit = candidates[0]?.node ?? null;
    }
    // 用户可以把一个对上底图的组织改到别的层：这时不能再让它“占用”那个底图节点，
    // 否则卡片会停在旧层、标签却写着新层，图和文字对不上。让它按新标签落到对应层，原底图节点恢复灰点。
    if (hit && org.chainLayer && hit.layer !== org.chainLayer) hit = null;
    if (hit && !used.has(hit.id)) {
      matched.set(org.id, hit);
      used.add(hit.id);
    }
  }
  return matched;
}

const layerLabel = (layer, map) => {
  const item = (map?.layers ?? []).find(entry => entry.id === layer);
  return item?.short || item?.name || layer || '未分类';
};

/** 主入口：算整张图的坐标。
 *  @param {object} map 底图（ECOSYSTEM_MAP）
 *  @param {Array} orgs 工作台 organization 节点（graph 投影，可带 chainLayer 等）
 *  @param {Array} tasks 工作台 task 节点
 */
export function buildEcosystemLayout({map, orgs = [], tasks = []} = {}) {
  const cell = ECO_CELL;
  const width = cell.pad * 2 + cell.labelW + cell.cols * (cell.w + cell.gapX);
  const cards = [];
  const categories = [];
  const bands = [];
  const matched = matchEcosystemBase(map, orgs);
  const orgById = new Map(orgs.map(org => [org.id, org]));
  const orgByBaseId = new Map([...matched.entries()].map(([orgId, base]) => [base.id, orgId]));

  const extraByLayer = new Map(); // layer -> Map(category -> objects[])
  const unclassified = [];
  const knownLayers = new Set((map?.layers ?? []).map(layer => layer.id));
  for (const org of orgs) {
    if (matched.has(org.id)) continue;
    if (!org.chainLayer || !knownLayers.has(org.chainLayer)) { unclassified.push({...org, _kind: 'org'}); continue; }
    const category = (org.chainCategory || '未分类').trim() || '未分类';
    const layerMap = extraByLayer.get(org.chainLayer) ?? new Map();
    if (!extraByLayer.has(org.chainLayer)) extraByLayer.set(org.chainLayer, layerMap);
    const list = layerMap.get(category) ?? [];
    list.push({...org, _kind: 'org'});
    layerMap.set(category, list);
  }
  for (const task of tasks) {
    if (!task.chainLayer || !knownLayers.has(task.chainLayer)) { unclassified.push({...task, _kind: 'task'}); continue; }
    const category = (task.chainCategory || '未分类').trim() || '未分类';
    const layerMap = extraByLayer.get(task.chainLayer) ?? new Map();
    if (!extraByLayer.has(task.chainLayer)) extraByLayer.set(task.chainLayer, layerMap);
    const list = layerMap.get(category) ?? [];
    list.push({...task, _kind: 'task'});
    layerMap.set(category, list);
  }

  let cursor = 0;
  const stats = {base: 0, ghost: 0, matched: matched.size, orgs: orgs.length, tasks: tasks.length, unclassified: unclassified.length};

  for (const layer of map?.layers ?? []) {
    const layerNodes = (map?.nodes ?? []).filter(node => node.layer === layer.id);
    const groups = new Map(); // category -> items
    for (const node of layerNodes) {
      const category = node.cat || '未分类';
      const list = groups.get(category) ?? [];
      const org = orgByBaseId.get(node.id);
      if (org) {
        const object = orgById.get(org);
        list.push({
          _kind: 'org',
          objectId: object.id,
          baseId: node.id,
          title: object.title,
          sub: object.chainCategory || node.cat,
          layer: object.chainLayer || node.layer,
          category: object.chainCategory || node.cat,
          threads: object.chainThreads?.length ? object.chainThreads : node.threads,
          flags: object.chainFlags ?? node.flags,
          source: object.chainSource || 'base',
          confidence: object.chainSource === 'ai' ? 'ai' : null,
          verified: object.verified === true,
          dataSource: object.source || '',
        });
      } else {
        stats.base += 1;
        stats.ghost += 1;
        list.push({
          _kind: 'base',
          baseId: node.id,
          title: node.name,
          sub: node.sub,
          layer: node.layer,
          category: node.cat,
          threads: node.threads ?? [],
          flags: node.flags ?? [],
        });
      }
      groups.set(category, list);
    }
    for (const [category, list] of extraByLayer.get(layer.id) ?? []) {
      const existing = groups.get(category) ?? [];
      groups.set(category, [...existing, ...list.map(item => ({
        _kind: item._kind,
        objectId: item.id,
        title: item.title,
        sub: item._kind === 'task' ? '任务' : (item.chainCategory || category),
        layer: item.chainLayer,
        category: item.chainCategory || category,
        threads: item.chainThreads ?? [],
        flags: item.chainFlags ?? [],
        source: item.chainSource || 'base',
        confidence: item.chainSource === 'ai' ? 'ai' : null,
      }))]);
    }

    const bandTop = cursor;
    const contentTop = bandTop + cell.headerH;
    let row = 0;
    let col = 0;
    let placedInLayer = 0;
    const layerCards = [];
    for (const [category, items] of groups) {
      if (!items.length) continue;
      let labelRow = -1;
      for (const item of items) {
        if (col >= cell.cols) { col = 0; row += 1; }
        const x = cell.pad + cell.labelW + col * (cell.w + cell.gapX);
        const y = contentTop + row * (cell.h + cell.gapY);
        // 一个类别跨行时每行都补一个类别标签：否则第二行起用户不知道这些卡属于哪一类。
        if (labelRow !== row) {
          categories.push({layer: layer.id, label: category, x: cell.pad, y});
          labelRow = row;
        }
        const card = {...item, key: item.objectId ? 'o:' + item.objectId : 'b:' + item.baseId, x, y, w: cell.w, h: cell.h};
        cards.push(card);
        layerCards.push(card);
        col += 1;
        placedInLayer += 1;
      }
    }
    const rows = placedInLayer ? row + 1 : 0;
    const bandHeight = cell.headerH + rows * (cell.h + cell.gapY) - (rows ? cell.gapY : 0) + 8;
    bands.push({layer: layer.id, label: layerLabel(layer.id, map), top: bandTop, height: Math.max(cell.headerH + 12, bandHeight), rows, cards: layerCards.length});
    cursor = bandTop + Math.max(cell.headerH + 12, bandHeight) + cell.bandGap;
  }

  // 没有层级标签的已录入对象：单独一条「未分类 · 待定位」带，不猜层。
  let unclassifiedBand = null;
  if (unclassified.length) {
    const bandTop = cursor;
    const contentTop = bandTop + cell.headerH;
    let row = 0;
    let col = 0;
    for (const item of unclassified) {
      if (col >= cell.cols) { col = 0; row += 1; }
      const x = cell.pad + cell.labelW + col * (cell.w + cell.gapX);
      const y = contentTop + row * (cell.h + cell.gapY);
      cards.push({
        _kind: item._kind,
        objectId: item.id,
        key: 'o:' + item.id,
        title: item.title,
        sub: item._kind === 'task' ? '任务' : '未分类',
        layer: '',
        category: '',
        threads: item.chainThreads ?? [],
        flags: item.chainFlags ?? [],
        source: item.chainSource || 'base',
        confidence: item.chainSource === 'ai' ? 'ai' : null,
        x, y, w: cell.w, h: cell.h,
      });
      col += 1;
    }
    const rows = row + 1;
    const bandHeight = cell.headerH + rows * (cell.h + cell.gapY) - cell.gapY + 8;
    unclassifiedBand = {layer: '', label: '未分类 · 待定位', top: bandTop, height: bandHeight, rows, cards: unclassified.length};
    cursor = bandTop + bandHeight + cell.bandGap;
  }

  return {
    cards,
    categories,
    bands,
    unclassified: unclassifiedBand,
    width,
    height: Math.max(cursor, cell.headerH + 20),
    stats,
    matched: new Map([...matched.entries()].map(([orgId, node]) => [orgId, node.id])),
  };
}

export function ecoCardOf(layout, baseId) {
  return layout.cards.find(card => card.baseId === baseId) ?? null;
}

export function ecoThreadsOf(item) {
  return (item?.threads ?? []).filter(thread => THREADS.includes(thread));
}

/** 【2026-10-26 诊断修复】组织视图（默认）：
 *  - 只画 organization，不画 task / project（任务和项目只进右侧弹窗）；
 *  - 底图默认隐藏，不再画 284 个灰点；
 *  - 同一层同一环节的组织聚合成一张「类别卡」（如「客户与场景 · 14 个组织」），
 *    点类别卡在右侧列出组织，再点组织看项目/任务；
 *  - 只有一个组织的类别直接画组织卡，避免“1 个组织”的假聚合；
 *  - 没标签的组织进「未分类 · 待定位」带。
 *  这个函数只算坐标，不画图、不写库；底图视图仍走 buildEcosystemLayout。
 */
export function buildEcosystemFocusLayout({ map, orgs = [], cols = 7 } = {}) {
  const safeCols = [1,2,3,4,5,6,7].includes(Number(cols)) ? Number(cols) : 7;
  const cell = { ...ECO_CELL, cols: safeCols };
  const width = cell.pad * 2 + cell.labelW + cell.cols * (cell.w + cell.gapX);
  const cards = [];
  const bands = [];
  const matched = matchEcosystemBase(map, orgs);
  const knownLayers = new Set((map?.layers ?? []).map(layer => layer.id));
  const layerGroups = new Map(); // layer -> Map(category -> org[])
  const unclassified = [];
  const matchedIds = new Set(matched.keys());
  for (const org of orgs) {
    if (!org.chainLayer || !knownLayers.has(org.chainLayer)) { unclassified.push(org); continue; }
    const category = (org.chainCategory || '未分类').trim() || '未分类';
    const byCategory = layerGroups.get(org.chainLayer) ?? new Map();
    const list = byCategory.get(category) ?? [];
    list.push(org);
    byCategory.set(category, list);
    layerGroups.set(org.chainLayer, byCategory);
  }
  let cursor = 0;
  for (const layer of map?.layers ?? []) {
    const byCategory = layerGroups.get(layer.id);
    if (!byCategory || !byCategory.size) continue;
    const bandTop = cursor;
    const contentTop = bandTop + cell.headerH;
    let row = 0, col = 0, placed = 0;
    const layerCards = [];
    // 类别顺序：先按底图这一层原有类别顺序，再按录入顺序追加底图没有的类别。
    const baseOrder = [...new Set((map?.nodes ?? []).filter(node => node.layer === layer.id).map(node => node.cat).filter(Boolean))];
    const categories = [...byCategory.keys()].sort((left, right) => {
      const li = baseOrder.indexOf(left), ri = baseOrder.indexOf(right);
      return (li < 0 ? 999 : li) - (ri < 0 ? 999 : ri);
    });
    for (const category of categories) {
      const list = byCategory.get(category) ?? [];
      if (!list.length) continue;
      if (col >= cell.cols) { col = 0; row += 1; }
      const x = cell.pad + cell.labelW + col * (cell.w + cell.gapX);
      const y = contentTop + row * (cell.h + cell.gapY);
      if (list.length === 1) {
        const org = list[0];
        const card = {
          _kind: 'org', objectId: org.id, key: 'o:' + org.id, title: org.title,
          sub: category, layer: org.chainLayer, category,
          threads: org.chainThreads ?? [], flags: org.chainFlags ?? [],
          source: org.chainSource || 'base',
          confidence: org.chainSource === 'ai' ? 'ai' : null,
          verified: org.verified === true,
          dataSource: org.source || '',
          x, y, w: cell.w, h: cell.h,
        };
        cards.push(card); layerCards.push(card); placed += 1;
      } else {
        const card = {
          _kind: 'cluster', key: 'c:' + layer.id + '|' + category,
          title: category, sub: list.length + ' 个组织', layer: layer.id, category,
          count: list.length, memberIds: list.map(org => org.id),
          verifiedCount: list.filter(org => org.verified === true).length,
          x, y, w: cell.w, h: cell.h,
        };
        cards.push(card); layerCards.push(card); placed += 1;
      }
      col += 1;
    }
    const rows = placed ? row + 1 : 0;
    const bandHeight = cell.headerH + rows * (cell.h + cell.gapY) - (rows ? cell.gapY : 0) + 8;
    bands.push({
      layer: layer.id, label: layerLabel(layer.id, map), top: bandTop,
      height: Math.max(cell.headerH + 12, bandHeight), rows, cards: layerCards.length,
    });
    cursor = bandTop + Math.max(cell.headerH + 12, bandHeight) + cell.bandGap;
  }
  let unclassifiedBand = null;
  if (unclassified.length) {
    const bandTop = cursor;
    const contentTop = bandTop + cell.headerH;
    let row = 0, col = 0;
    for (const org of unclassified) {
      if (col >= cell.cols) { col = 0; row += 1; }
      const x = cell.pad + cell.labelW + col * (cell.w + cell.gapX);
      const y = contentTop + row * (cell.h + cell.gapY);
      cards.push({
        _kind: 'org', objectId: org.id, key: 'o:' + org.id, title: org.title,
        sub: '未分类', layer: '', category: '', threads: org.chainThreads ?? [],
        flags: org.chainFlags ?? [], source: org.chainSource || 'base',
        confidence: org.chainSource === 'ai' ? 'ai' : null, verified: org.verified === true, dataSource: org.source || '', x, y, w: cell.w, h: cell.h,
      });
      col += 1;
    }
    const rows = row + 1;
    const bandHeight = cell.headerH + rows * (cell.h + cell.gapY) - cell.gapY + 8;
    unclassifiedBand = { layer: '', label: '未落供应链层 · 待定位', top: bandTop, height: bandHeight, rows, cards: unclassified.length };
    cursor = bandTop + bandHeight + cell.bandGap;
  }
  return {
    cards, categories: [], bands, unclassified: unclassifiedBand,
    width, height: Math.max(cursor, cell.headerH + 20),
    stats: {
      base: 0, ghost: 0, matched: matchedIds.size, orgs: orgs.length, tasks: 0,
      unclassified: unclassified.length,
    },
    matched: new Map([...matched.entries()].map(([orgId, node]) => [orgId, node.id])),
    focus: true,
  };
}

export function ecoClusterOf(layout, clusterKey) {
  return layout.cards.find(card => card._kind === 'cluster' && card.key === clusterKey) ?? null;
}
