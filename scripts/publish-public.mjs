#!/usr/bin/env node
/** 把私有仓库导出成公开仓库（2026-11-03 事故后的唯一发布通道）。
 *
 *  ## 为什么需要这个脚本
 *  事故：公开仓库从第一天起就带着客户名、内部研究图谱与验收截图。根因是**没有唯一出口**——
 *  谁都能往公开仓库直接推。所以改成：公开仓库的内容只能由这里导出，且导出前必须过门禁。
 *
 *  ## 它做什么
 *  1. 按白名单导出文件（只导出"产品本体"，不导出私有规范、证据、数据资产）；
 *  2. 跑 `public-release-guard.mjs`（业务词表在仓库外，缺表即失败）——**不通过就中止**；
 *  3. 把导出结果推到一个新分支（默认 `publish/preview`），**不直接推 main**；
 *  4. 打印将要公开的文件清单与 diff 摘要，由人确认后再合并。
 *
 *  ## 用法
 *    node scripts/publish-public.mjs              # 导出 + 门禁 + 推到 preview 分支
 *    node scripts/publish-public.mjs --dry-run    # 只导出并门禁，不推
 *    node scripts/publish-public.mjs --to main    # 门禁通过后直接推 main（谨慎）
 */
import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const HOME = homedir();
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const TO = args.includes('--to') ? args[args.indexOf('--to') + 1] : 'publish/preview';
const OUT = join('/tmp', 'public-export');
const REMOTE = process.env.PUBLIC_REMOTE ?? 'public';

/** 白名单：只有这些才可能公开。不在表里的一律不导出（默认拒绝，而不是默认允许）。 */
const INCLUDE = [
  ['README.md', 'README.md'],
  ['LICENSE', 'LICENSE'],
  ['CONTRIBUTING.md', 'CONTRIBUTING.md'],
  ['SECURITY.md', 'SECURITY.md'],
  ['docs/PUBLISHING.md', 'docs/PUBLISHING.md'],
  ['scripts/public-release-guard.mjs', 'scripts/public-release-guard.mjs'],
];

/** 目录级白名单：整目录导出，但导出后仍要过门禁；命中黑名单的会被拦下。 */
const INCLUDE_DIRS = [
  ['docs/screenshots', 'docs/screenshots'],
];

const git = (argv, opts = {}) => execFileSync('/usr/bin/git', argv, {cwd: REPO, encoding: 'utf8', ...opts});

function main() {
  rmSync(OUT, {recursive: true, force: true});
  mkdirSync(OUT, {recursive: true});

  const copied = [];
  for (const [from, to] of INCLUDE) {
    const src = join(REPO, from);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(join(OUT, to)), {recursive: true});
    cpSync(src, join(OUT, to));
    copied.push(to);
  }
  for (const [from, to] of INCLUDE_DIRS) {
    const src = join(REPO, from);
    if (!existsSync(src)) continue;
    for (const name of readdirSync(src)) {
      cpSync(join(src, name), join(OUT, to, name), {recursive: true});
      copied.push(join(to, name));
    }
  }

  // 导出目录里自带 .gitignore，避免误提交私有路径
  writeFileSync(join(OUT, '.gitignore'), [
    '# 私有内容永远不进公开仓库',
    'spec/', 'prototype/screenshots/', 'releases/', '*.sqlite', '*.sqlite3', '*.db', 'data/', '.env', '',
  ].join('\n'));

  console.log('导出 ' + copied.length + ' 个条目到 ' + OUT);

  const guard = join(REPO, 'scripts/public-release-guard.mjs');
  try {
    const out = execFileSync('node', [guard, '--no-terms'], {cwd: OUT, encoding: 'utf8'});
    process.stdout.write(out);
  } catch (error) {
    console.error('门禁（结构层）未通过，已中止：');
    process.stderr.write(String(error.stdout ?? '') + String(error.stderr ?? ''));
    process.exit(1);
  }

  // 词表层必须在有词表的机器上跑：这里再跑一次完整版（缺词表会直接失败 = 不放行）
  if (!existsSync(join(HOME, '.dsh/private/business-terms.txt')) && !process.env.BUSINESS_TERMS) {
    console.error('FAIL: 没有业务词表，不能发布（词表层未执行）。');
    console.error('  建 ~/.dsh/private/business-terms.txt 或设 BUSINESS_TERMS=/path 后重跑。');
    process.exit(1);
  }
  try {
    const out = execFileSync('node', [guard], {cwd: OUT, encoding: 'utf8', env: process.env});
    process.stdout.write(out);
  } catch (error) {
    console.error('门禁（词表层）未通过，已中止：');
    process.stderr.write(String(error.stdout ?? '') + String(error.stderr ?? ''));
    process.exit(1);
  }

  if (DRY) {
    console.log('\n--dry-run：没有推送。将要公开的文件：');
    for (const file of copied) console.log('  · ' + file);
    return;
  }

  // 推到一个**新分支**，不直接推 main
  const work = join('/tmp', 'public-push');
  rmSync(work, {recursive: true, force: true});
  cpSync(OUT, work, {recursive: true});
  const run = argv => execFileSync('/usr/bin/git', argv, {cwd: work, encoding: 'utf8'});
  run(['init', '-q', '-b', TO]);
  run(['add', '-A']);
  run(['-c', 'user.name=workstation', '-c', 'user.email=workstation@local', 'commit', '-q', '-m', 'chore: 发布 ' + new Date().toISOString().slice(0, 10)]);
  run(['remote', 'add', 'origin', git(['remote', 'get-url', REMOTE]).trim()]);
  run(['push', '--force', 'origin', TO]);
  console.log('\n已推送到 ' + REMOTE + ' 的 ' + TO + ' 分支。');
  console.log('请先看 diff 再合并到 main：gh pr create 或直接在网页上比对。');
}

main();
