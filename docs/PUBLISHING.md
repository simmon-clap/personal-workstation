# 发布纪律：业务数据永不出仓库

> 立这条规矩的原因写在最前面：2026-11-03 发现，一个**从第一天就是公开**的仓库里，
> 一直躺着客户名、内部研究图谱（297 家企业的供应链底图）、真实验收截图与本机绝对路径。
> 不是某一次误提交，而是从来没有一道门禁在**推之前**问一句。

## 三条铁律

1. **业务数据不进公开仓库**，包括：真实客户/项目名、内部研究数据、验收证据（真实数据截图/日志）、
   数据库文件、家目录绝对路径、内网地址。
2. **一个内容只有一个来源**：公开仓库的内容由 `scripts/publish-public.mjs` 从私有仓库导出，
   **不允许**手工往公开仓库推。
3. **词表放在仓库之外**（`~/.dsh/private/business-terms.txt`，或用 `BUSINESS_TERMS=/path`）。
   词表进仓库本身就是一次泄露；**缺词表时门禁直接失败**，绝不"没有词表就放行"。

## 门禁是什么

`scripts/public-release-guard.mjs`：

| 层 | 检查 |
|---|---|
| 词表 | 业务词表逐词比对（区分大小写不敏感） |
| 路径 | `spec/`、`prototype/screenshots/`、`releases/`、`*.sqlite`、`data/` 一律拒绝 |
| 形状 | 家目录绝对路径、内网 IP / Tailscale 域名、≥100 节点的图谱式数据 |
| 范围 | 只看 git 会提交的文件（`git ls-files`），提交前用 `--staged` |

```bash
npm run guard:public          # 全量检查
node scripts/public-release-guard.mjs --staged   # 只查暂存区（pre-commit 已挂）
```

## 发布流程

```bash
# 1. 在私有仓库里开发、测试、验收
# 2. 导出并脱敏
node scripts/publish-public.mjs --dry-run    # 只生成，不推
# 3. 门禁通过后再推
node scripts/publish-public.mjs --push
```

`publish-public.mjs` 会：按黑白名单导出 → 跑门禁（失败即中止）→ 推到一个**全新的临时分支** →
把 diff 打出来给人看 → 你确认后才合并到 `main`。

## 已经泄露过怎么办

删文件**不够**：git 历史里还在，按旧提交 SHA 仍能取到。要么重写历史，要么**换仓库**（本项目就是这么做的：
旧仓库转私有，公开仓库从空开始）。
