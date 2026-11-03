/** 画布活跃度（2026-10-23 已定算法，2026-10-27 接入；不新造公式）。
 *
 *  权威：~/Desktop/DSH/画布活跃度算法-v2.1-20261023.md
 *  参考：~/Desktop/DSH/活跃度调参-demo.html（缺字段兜底）
 *
 *  任务 T = .35 状态 + .25 被依赖 + .20 推进衰减 + .20 重要紧急
 *  项目 P = 项目权重 × (.4 任务聚合 + .2 阶段推进 + .2 关系 + .2 重要紧急)
 *  组织 O = .7 最高项目 + .3 其余项目 + .1 关系热度
 *  衰减：最近推进 30 天 ×.5、60 天 ×.25、90 天 =0
 *  生态常态化项目：任务聚合保底 .35；项目权重 ×.8
 *
 *  纯函数：不读 DOM、不写库；只看传进来的画布节点。
 */
const IMPORTANCE = {high:1,medium:0.6,low:0.3};
const STATUS = {todo:1,waiting:0.8,in_progress:1,done:0.2,cancelled:0};
const STAGE = {接触:1.0,方案:1.0,复盘:1.1,签约:1.2,执行:1.15,收尾:0.9};
const DAY = 86400000;

const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const daysSince = (value, now) => {
  const time = Date.parse(String(value ?? ''));
  if (!Number.isFinite(time)) return Infinity;
  return Math.max(0, (now - time) / DAY);
};
/** 30/60/90 天衰减；缺时间 = 0（demo 的兜底也是 0）。 */
export function decayAt(value, now = Date.now()) {
  const days = daysSince(value, now);
  if (!Number.isFinite(days) || days >= 90) return 0;
  if (days >= 60) return 0.25;
  if (days >= 30) return 0.5;
  return 1;
}
const importanceOf = value => (typeof value === 'string' && IMPORTANCE[value] !== undefined ? IMPORTANCE[value] : 0.5);
const statusOf = value => (typeof value === 'string' && STATUS[value] !== undefined ? STATUS[value] : 0.5);
const stageWeight = value => (typeof value === 'string' && STAGE[value] !== undefined ? STAGE[value] : 1);
const hasEcoTag = project => Array.isArray(project?.tags) && project.tags.includes('生态');

/** 项目连了几个组织：主责/合作/参与都算；用于 P 的“关系”项。 */
const projectLinks = project => {
  let count = 0;
  if (project?.organizationId) count += 1;
  if (project?.partnerId) count += 1;
  for (const participant of project?.participants ?? []) if (participant?.organizationId) count += 1;
  return count;
};

export function taskScores(nodes, {now = Date.now()} = {}) {
  const tasks = (nodes ?? []).filter(node => node?.kind === 'task');
  const scores = new Map();
  for (const task of tasks) {
    const dependents = tasks.filter(other => (other.dependsOn ?? []).includes(task.id)).length;
    const status = statusOf(task.businessStatus ?? task.status);
    const dependency = Math.min(1, dependents / 2);
    const advance = decayAt(task.at, now);
    const importance = (importanceOf(task.importance) + importanceOf(task.urgency)) / 2;
    scores.set(task.id, {
      T: clamp01(0.35 * status + 0.25 * dependency + 0.20 * advance + 0.20 * importance),
      parts: {status, dependency, advance, importance},
    });
  }
  return scores;
}

export function projectScores(nodes, {now = Date.now()} = {}) {
  const projects = (nodes ?? []).filter(node => node?.kind === 'project');
  const tasks = (nodes ?? []).filter(node => node?.kind === 'task');
  const taskMap = taskScores(nodes, {now});
  const scores = new Map();
  for (const project of projects) {
    const list = tasks.filter(task => task.projectId === project.id);
    const taskScoresList = list.map(task => taskMap.get(task.id)?.T ?? 0).sort((left, right) => right - left);
    const best = taskScoresList[0] ?? 0;
    const others = taskScoresList.length > 1
      ? taskScoresList.slice(1).reduce((sum, value) => sum + value, 0) / (taskScoresList.length - 1)
      : 0;
    const eco = hasEcoTag(project);
    const floor = eco ? 0.35 : 0;
    const taskAggregate = Math.max(floor, 0.6 * best + 0.4 * others);
    const history = Array.isArray(project.stageHistory) ? project.stageHistory : [];
    const lastStage = history.length ? history[history.length - 1]?.at : project.at;
    const advance = decayAt(lastStage, now);
    const relations = Math.min(1, projectLinks(project) / 3);
    const importance = (importanceOf(project.importance) + importanceOf(project.urgency)) / 2;
    const weight = stageWeight(project.businessStatus ?? project.stage) * (eco ? 0.8 : 1);
    scores.set(project.id, {
      P: clamp01(weight * (0.4 * taskAggregate + 0.2 * advance + 0.2 * relations + 0.2 * importance)),
      parts: {taskAggregate, advance, relations, importance},
      floorActive: eco,
      taskCount: list.length,
    });
  }
  return scores;
}

export function organizationScores(nodes, {now = Date.now()} = {}) {
  const organizations = (nodes ?? []).filter(node => node?.kind === 'organization');
  const projects = (nodes ?? []).filter(node => node?.kind === 'project');
  const projectMap = projectScores(nodes, {now});
  const scores = new Map();
  for (const org of organizations) {
    const linked = projects.filter(project =>
      project.organizationId === org.id
      || project.partnerId === org.id
      || (project.participants ?? []).some(participant => participant?.organizationId === org.id));
    const list = linked.map(project => projectMap.get(project.id)?.P ?? 0).sort((left, right) => right - left);
    const best = list[0] ?? 0;
    const others = list.length > 1 ? list.slice(1).reduce((sum, value) => sum + value, 0) / (list.length - 1) : 0;
    const heat = Math.min(1, linked.length / 3);
    scores.set(org.id, {
      O: clamp01(0.7 * best + 0.3 * others + 0.1 * heat),
      parts: {best, others, heat},
      projectCount: linked.length,
    });
  }
  return scores;
}

/** 默认展开的组织：有项目的 + 分数最高的前 5 个。返回 Set。 */
export function defaultExpandedOrganizations(nodes, {now = Date.now(), limit = 5} = {}) {
  const scores = organizationScores(nodes, {now});
  const organizations = (nodes ?? []).filter(node => node?.kind === 'organization');
  const sorted = organizations.slice().sort((left, right) => (scores.get(right.id)?.O ?? 0) - (scores.get(left.id)?.O ?? 0));
  const expanded = new Set();
  for (const org of organizations) if ((scores.get(org.id)?.projectCount ?? 0) > 0) expanded.add(org.id);
  for (const org of sorted.slice(0, Math.max(0, limit))) expanded.add(org.id);
  // “有项目的组织”与“分数前 5”取并集；不是二选一。
  return expanded;
}
