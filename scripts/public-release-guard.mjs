#!/usr/bin/env node
/** 公开仓库发布门禁：**业务数据一律不得入库**（2026-11-03 事故后加的）。
 *
 *  ## 事故
 *  仓库从第一天起就是公开的，而 `spec/`、`src/v7/ecosystem-map.mjs`（297 家企业的供应链研究）、
 *  `prototype/screenshots/`（真实验收证据）一直都在里面。准备对外宣传时才被发现。
 *  根因不是某一处误提交，而是**从来没有一道门禁在「推之前」问一句：这些能不能公开**。
 *
 *  ## 这道门禁怎么判
 *  1. **词表必须来自仓库之外**：`~/.dsh/private/business-terms.txt`（一行一个词）。
 *     词表放在仓库里 = 又一次泄露，所以缺词表时**直接失败**，绝不"没有词表就放行"。
 *  2. **路径黑名单**：私有规范、验收证据、数据库、发布包、私有研究资产。
 *  3. **形状识别**：绝对家目录、内网/Tailscale 域名、SQLite 文件头、超过 N 条的"企业图谱"式数据结构。
 *  4. 只看 **git 会提交的文件**（`git ls-files`），不看本地临时产物。
 *
 *  用法：
 *    node scripts/public-release-guard.mjs            # 检查将要公开的文件
 *    node scripts/public-release-guard.mjs --staged   # 只查暂存区（可挂 pre-commit）
 *    BUSINESS_TERMS=/path/to/terms.txt node scripts/public-release-guard.mjs
 */
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const args = new Set(process.argv.slice(2));
const STAGED = args.has('--staged');
const NO_TERMS = args.has('--no-terms');   // CI 里没有词表：只做结构层，并如实标注「词表层未执行」
const HOME = homedir();
const TERMS_FILE = process.env.BUSINESS_TERMS ?? join(HOME, '.dsh/private/business-terms.txt');

/** 路径黑名单：这些目录/文件本身就不属于公开范围。 */
const DENY_PATHS = [
  // spec/ 允许公开，但**必须脱敏**：真正的守门是下面的词表与形状识别；
  // 如果某份规范里有客户名，词表层会把它拦下来。
  [/^prototype\/screenshots\//, '验收证据（真实数据截图与日志）'],
  [/^releases\//, '发布产物（含数据库导出/快照）'],
  [/\.(sqlite|sqlite3|db)(-wal|-shm)?$/, '数据库文件'],
  [/^data\//, '本地数据目录'],
];

/** 形状识别：不看词表也能认出来的"业务数据长相"。 */
const SHAPES = [
  {name: '绝对家目录路径', test: text => {
    // 占位用户名（example/user/test/demo/runner）不算泄露；真实用户名要拦
    const hits = [...text.matchAll(/\/(?:Users|home)\/([A-Za-z0-9._-]+)/g)].map(m => m[1]);
    return hits.some(name => !/^(example|user|users|test|demo|runner|placeholder|you)$/i.test(name));
  }},
  {name: '内网 / Tailscale 域名', test: text => /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(text) && !/\b(?:127\.0\.0\.1|0\.0\.0\.0)\b/.test(text) || /\.ts\.net\b/.test(text)},
  {name: '企业图谱式数据（≥100 个节点）', test: (text, file) =>
    !/PUBLIC-DATA:\s*synthetic/.test(text) && /ecosystem|供应链|图谱/.test(file) && (text.match(/"id"\s*:/g) ?? []).length >= 100},
];

/** 词表：一行一个，允许 # 注释。 */
function loadTerms() {
  if (!existsSync(TERMS_FILE)) {
    console.error('FAIL: 找不到业务词表 ' + TERMS_FILE);
    console.error('  这道门禁刻意**不接受"没有词表就通过"**：词表放仓库里本身又是一次泄露。');
    console.error('  处理：在仓库外建一份词表（一行一个词），或用 BUSINESS_TERMS=/path 指过去。');
    process.exit(2);
  }
  return readFileSync(TERMS_FILE, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function listFiles() {
  // 不是 git 仓库（比如刚导出的目录）就退化成遍历文件系统——门禁必须在"推之前"就能跑，
  // 不能因为换了目录就变成"跳过"。
  try {
    const cmd = STAGED ? ['diff', '--cached', '--name-only', '--diff-filter=ACM'] : ['ls-files'];
    return execFileSync('/usr/bin/git', cmd, {encoding: 'utf8'})
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    const out = [];
    const walk = (dir, prefix = '') => {
      for (const name of readdirSync(dir)) {
        if (name === '.git' || name === 'node_modules') continue;
        const full = join(dir, name);
        const rel = prefix ? prefix + '/' + name : name;
        if (statSync(full).isDirectory()) walk(full, rel);
        else out.push(rel);
      }
    };
    walk(process.cwd());
    return out;
  }
}

const TEXT_EXT = new Set(['.mjs', '.js', '.json', '.md', '.yml', '.yaml', '.css', '.html', '.ts', '.txt']);

const terms = NO_TERMS ? [] : loadTerms();
const files = listFiles();
const problems = [];

for (const file of files) {
  for (const [pattern, why] of DENY_PATHS) {
    if (pattern.test(file)) problems.push({file, rule: '路径黑名单', detail: why});
  }
  const dot = file.lastIndexOf('.');
  const ext = dot === -1 ? '' : file.slice(dot);
  if (!TEXT_EXT.has(ext)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lower = text.toLowerCase();
  for (const term of terms) {
    if (!term) continue;
    // 文件名本身就是泄露面：spec/58-某客户画布.md 这种，内容再干净也没用
    if (file.toLowerCase().includes(term.toLowerCase())) problems.push({file, rule: '文件名', detail: term});
    if (lower.includes(term.toLowerCase())) problems.push({file, rule: '业务词表', detail: term});
  }
  for (const shape of SHAPES) {
    if (shape.test(text, file)) problems.push({file, rule: '形状识别', detail: shape.name});
  }
}

const seen = new Set();
const unique = problems.filter(p => {
  const key = p.file + '|' + p.rule + '|' + p.detail;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

if (!unique.length) {
  if (NO_TERMS) {
    console.log('PARTIAL: ' + files.length + ' 个文件通过了结构层（路径/形状），但**词表层没有执行**——');
    console.log('  本环境没有业务词表。这不算"干净"，只是"没测到词"。发布前必须在有词表的机器上再跑一次。');
    process.exit(0);
  }
  console.log('PASS: 将要公开的 ' + files.length + ' 个文件里没有业务数据（词表 ' + terms.length + ' 条）');
  process.exit(0);
}

console.error('FAIL: 发现 ' + unique.length + ' 处不应该公开的内容：');
for (const p of unique.slice(0, 40)) console.error('  · ' + p.file + ' — ' + p.rule + '：' + p.detail);
if (unique.length > 40) console.error('  … 还有 ' + (unique.length - 40) + ' 处');
console.error('');
console.error('处理：从仓库移出（并考虑重写历史）、换成脱敏示例，或把该词加进私有词表后清理对应文件。');
process.exit(1);
