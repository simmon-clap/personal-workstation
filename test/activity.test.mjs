import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decayAt,taskScores,projectScores,organizationScores,defaultExpandedOrganizations} from '../prototype/activity.mjs';

/** 2026-10-23 已定活跃度算法 v2.1：这里只验公式接线，不另立权重。 */
const now = Date.parse('2026-10-27T00:00:00Z');
const iso = days => new Date(now - days * 86400000).toISOString();
const org = (id, extra = {}) => ({id, kind: 'organization', title: id, ...extra});
const project = (id, extra = {}) => ({id, kind: 'project', title: id, ...extra});
const task = (id, extra = {}) => ({id, kind: 'task', title: id, ...extra});

test('衰减：30/60/90 天按 ×0.5 / ×0.25 / 0，缺时间按 0', () => {
  assert.equal(decayAt(iso(0), now), 1);
  assert.equal(decayAt(iso(30), now), 0.5);
  assert.equal(decayAt(iso(60), now), 0.25);
  assert.equal(decayAt(iso(90), now), 0);
  assert.equal(decayAt(null, now), 0);
});

test('任务分：状态、被依赖、推进、重要紧急按 v2.1 公式相加', () => {
  const nodes = [
    task('t1', {businessStatus: 'todo', importance: 'high', urgency: 'high', at: iso(0), dependsOn: []}),
    task('t2', {businessStatus: 'todo', at: iso(0), dependsOn: ['t1']}),
  ];
  const score = taskScores(nodes, {now}).get('t1');
  // .35*1 + .25*(1/2) + .20*1 + .20*(1) = .35+.125+.2+.2
  assert.equal(score.T.toFixed(3), '0.875');
  assert.equal(score.parts.status, 1);
  assert.equal(score.parts.dependency, 0.5);
  assert.equal(score.parts.advance, 1);
  assert.equal(score.parts.importance, 1);
});

test('项目分：任务聚合 0.6/0.4、关系、阶段权重；生态项目保底 0.35 且权重 ×0.8', () => {
  const nodes = [
    project('p1', {businessStatus: '签约', importance: 'high', urgency: 'medium', organizationId: 'o1', partnerId: 'o2', participants: [{organizationId: 'o3'}], at: iso(0)}),
    task('t1', {projectId: 'p1', businessStatus: 'todo', importance: 'high', urgency: 'high', at: iso(0)}),
    task('t2', {projectId: 'p1', businessStatus: 'done', at: iso(0)}),
    project('p2', {businessStatus: '方案', tags: ['生态'], importance: 'high'}),
  ];
  const scores = projectScores(nodes, {now});
  const p1 = scores.get('p1');
  // best=.875, others=.2; taskAgg=.6*.875+.4*.2=.605; rel=1; stage 签约 1.2；重要/紧急=(1+.6)/2=.8
  // P=1.2*(.4*.598 + .2*1 + .2*1 + .2*.8) = 1.2*(.2392+.2+.2+.16)=.95904
  assert.equal(p1.P.toFixed(3), '0.959');
  const p2 = scores.get('p2');
  assert.equal(p2.floorActive, true);
  // 无任务，保底 .35；阶段 1；生态 ×.8；重要/紧急=(1+.5)/2=.75：.8*(.14+.15)=.232
  assert.equal(p2.P.toFixed(3), '0.232');
});

test('组织分：最高项目 0.7 + 其余 0.3 + 关系热 0.1', () => {
  const nodes = [
    org('o1'), org('o2'), org('o-other'),
    project('p1', {organizationId: 'o1', businessStatus: '签约', importance: 'high', urgency: 'high'}),
    project('p2', {partnerId: 'o1', businessStatus: '接触'}),
    task('t1', {projectId: 'p1', businessStatus: 'todo', importance: 'high', urgency: 'high', at: iso(0)}),
  ];
  const scores = organizationScores(nodes, {now});
  const o1 = scores.get('o1');
  assert.equal(o1.projectCount, 2);
  assert.ok(o1.O > 0);
  assert.equal(o1.parts.heat.toFixed(3), '0.667'); // 2/3
});

test('默认展开 = 有项目的组织 + 分数最高的前 5 个（并集）', () => {
  const nodes = [org('a'), org('b'), org('c'), org('d'), org('e'), org('f'), org('g')];
  nodes.push(project('p', {organizationId: 'g', businessStatus: '签约', importance: 'high', urgency: 'high'}));
  nodes.push(task('t', {projectId: 'p', businessStatus: 'todo', importance: 'high', urgency: 'high', at: iso(0)}));
  const expanded = defaultExpandedOrganizations(nodes, {now});
  assert.ok(expanded.has('g'), '有项目的组织必须展开');
  for (const id of ['a', 'b', 'c', 'd']) assert.ok(expanded.has(id), '分数最高的前 5 个组织（g 已占一个）必须展开：' + id);
  assert.equal(expanded.size, 5, '并集：前 5 个 + 有项目的 g（g 同时在前 5）');
});
