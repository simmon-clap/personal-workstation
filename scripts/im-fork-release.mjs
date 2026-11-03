#!/usr/bin/env node
/** IM 插件（本地 fork）一次性发布：**编译一次、两端装同一份**（2026-11-03）。
 *
 *  为什么需要它：2026-11-03 微信离线 2 小时的根因不是网络，而是**两端 fork 版本不一样**——
 *  笔记本是 0.1.69（peer 放宽到 0.2.x），Mini 还是 0.1.68（peer 只到 0.1.x）。
 *  DSH 0.2.1-rc.5 在重启时按 peer 判定不兼容，插件干脆没加载；而它上一次能用，只是靠前一个
 *  进程的热加载。等下一次重启就"突然断联"。
 *
 *  所以：fork 的源码只有一份（笔记本），产物只有一份（这里打出来的 tar），两端装它。
 *
 *  用法：
 *    node scripts/im-fork-release.mjs                # 编译 + 打包 + 装本机 + 推到 Mini
 *    node scripts/im-fork-release.mjs --local-only   # 只装本机
 *    node scripts/im-fork-release.mjs --check        # 只核对两端版本，不装
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, cpSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const HOME = homedir();
const FORK = process.env.IM_FORK ?? join(HOME, 'Desktop/DSH/im-connect-slack/upstream');
const PROFILE = join(HOME, '.dsh/profiles/desktop');
const INSTALLED = join(PROFILE, 'node_modules/@michengai/dsh-im-connect');
const REMOTE = process.env.IM_REMOTE ?? 'simmon@mini-host';
// 远端路径写 $HOME 相对：Node 的 require 不认 `~`（这就是第一次 --check 读到 none 的原因）
const REMOTE_FORK = '$HOME/.dsh/plugins/im-connect-fork';
const REMOTE_INSTALLED = '$HOME/.dsh/profiles/desktop/node_modules/@michengai/dsh-im-connect';

const RELEASES = join(REPO, 'releases');

const args = process.argv.slice(2);
const LOCAL_ONLY = args.includes('--local-only');
const CHECK_ONLY = args.includes('--check');
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, {encoding: 'utf8', maxBuffer: 1 << 28, ...opts});
const ssh = (script) => sh('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', REMOTE, script]);

const version = (dir) => {
 try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version; } catch { return null; }
};

/** peer 必须覆盖 0.2.x —— 否则宿主一升级就把插件踢掉（这次事故的根因）。 */
function assertPeersAccept02x() {
 const pkg = JSON.parse(readFileSync(join(FORK, 'package.json'), 'utf8'));
 const bad = Object.entries(pkg.peerDependencies ?? {}).filter(([name, range]) => name.startsWith('@deepseek-ai/dsh-') && !range.includes('>=0.2.0-rc.1'));
 if (bad.length) {
  console.error('FAIL: 这些 peer 没有覆盖 DSH 0.2.x，重启后插件会被判不兼容：' + bad.map(([n, r]) => n + ' ' + r).join('、'));
  process.exit(1);
 }
}

function check() {
 const local = version(INSTALLED);
 // Mini 的非交互 ssh 里没有 node 在 PATH 上（实测），要回退到绝对路径
 const REMOTE_PKG = "process.env.HOME+'/.dsh/profiles/desktop/node_modules/@michengai/dsh-im-connect/package.json'";
 const readVersion = () => `($(command -v node || echo /usr/local/bin/node) -p "require(${REMOTE_PKG}).version" 2>/dev/null || echo none)`
 const remote = ssh(readVersion()).trim();
 const forkVersion = version(FORK);
 console.log('fork 源码 ' + forkVersion + ' · 本机装 ' + local + ' · Mini 装 ' + remote);
 if (local !== remote || local !== forkVersion) {
  console.error('FAIL: 两端版本不一致（这正是"重启后突然断联"的根因）');
  process.exit(1);
 }
 console.log('PASS: 两端同一个版本');
}

if (CHECK_ONLY) { check(); process.exit(0); }

assertPeersAccept02x();

console.log('1/4 编译 TypeScript…');
sh(join(FORK, 'node_modules/typescript/bin/tsc'), ['-p', 'tsconfig.json'], {cwd: FORK, stdio: 'inherit'});

console.log('2/4 打包（lib + client.js + package.json）…');
mkdirSync(RELEASES, {recursive: true});
const stage = join('/tmp', 'im-fork-stage');
rmSync(stage, {recursive: true, force: true});
mkdirSync(stage, {recursive: true});
cpSync(join(FORK, 'lib'), join(stage, 'lib'), {recursive: true});
for (const file of ['client.js', 'package.json']) {
 if (existsSync(join(FORK, file))) copyFileSync(join(FORK, file), join(stage, file));
}
const v = version(FORK);
const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
const tarball = join(RELEASES, `dsh-im-connect-fork-${v}-${stamp}.tgz`);
sh('tar', ['-czf', tarball, '-C', stage, '.']);
const hash = createHash('sha256').update(readFileSync(tarball)).digest('hex');
console.log('    ' + tarball);
console.log('    sha256 ' + hash.slice(0, 16) + '…');

const installLocal = () => {
 const backup = INSTALLED + '.bak-' + stamp;
 if (existsSync(INSTALLED)) cpSync(INSTALLED, backup, {recursive: true});
 rmSync(join(INSTALLED, 'lib'), {recursive: true, force: true});
 cpSync(join(stage, 'lib'), join(INSTALLED, 'lib'), {recursive: true});
 for (const file of ['client.js', 'package.json']) {
  if (existsSync(join(stage, file))) copyFileSync(join(stage, file), join(INSTALLED, file));
 }
 console.log('3/4 本机已装 ' + version(INSTALLED));
};
installLocal();

if (!LOCAL_ONLY) {
 console.log('4/4 推到 Mini 并安装…');
 sh('scp', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', tarball, `${REMOTE}:/tmp/im-fork.tgz`]);
 ssh([
  'set -e',
  `F=${REMOTE_FORK}`,
  `N=${REMOTE_INSTALLED}`,
  `T=${stamp}`,
  '[ -d "$F" ] && cp -R "$F" "$F.bak-$T"',
  '[ -d "$N" ] && cp -R "$N" "$N.bak-$T"',
  'rm -rf "$F/lib"',
  'tar -xzf /tmp/im-fork.tgz -C "$F"',
  'rm -rf "$N/lib"',
  'cp -R "$F/lib" "$N/lib"',
  'cp "$F/package.json" "$N/package.json" 2>/dev/null || true',
  'cp "$F/client.js" "$N/client.js" 2>/dev/null || true',
  `echo "    Mini 已装 "$($(command -v node || echo /usr/local/bin/node) -p "require(${REMOTE_PKG}).version")`,
 ].join('; '));
}
check();
console.log('\n两端装的是同一份产物。改完需要**完全退出并重开 DSH**才生效。');
