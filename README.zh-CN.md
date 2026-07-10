# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**从优秀的参考设计出发，而不是从空白的 AI 画布开始。**

Design Lens 是一款面向 **Claude Code**、**OpenAI Codex CLI**、**Cursor** 和 **OpenCode**
的插件，帮助你从参考设计(awwwards 级别的网站)出发，构建美学上出众的前端:

1. **Clone** — 将参考页面捕获为自包含、格式化良好的本地镜像:
   JS 渲染后的最终 DOM、保留 CSS-in-JS/shadow-DOM 样式、所有资源本地化、每个
   元素都打上稳定的 `data-dl-id`。
2. **Reverse-design** — 像资深设计师一样读懂克隆,产出 `DESIGN.md`
   (每个决策背后的原因)+ `VARIATIONS.md`(在保持设计原则的前提下的新方向)。
3. **Customize** — 通过对话即可替换 logo、改写导航文案、更换主视觉图片、
   调整颜色和尺寸 — 代理以 `data-dl-id` 为锚点直接编辑克隆。

## 安装

| 代理 | 推荐渠道 | 运行时环境配置 |
| --- | --- | --- |
| Claude Code | 插件(见下)或 `npx skills` | 自动(SessionStart 钩子) |
| Codex CLI | 插件(见下)或 `npx skills` | 通过 `/hooks` 信任钩子,或使用下方的备用方案 |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | 首次使用时运行 `npx -y design-lens setup` |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | 首次使用时运行 `npx -y design-lens setup` |

### 渠道 1 — 插件(Claude Code / Codex)

Claude Code:

```bash
claude plugin marketplace add mojomoth/design-lens
claude plugin install design-lens@design-lens
```

Codex CLI:

```bash
codex plugin marketplace add https://github.com/mojomoth/design-lens
codex plugin add design-lens@design-lens
```

首个会话中,`SessionStart` 钩子会配置好 `~/.design-lens/`(CLI、固定版本的 Playwright、
Chromium)。**在 Codex 上,你必须先通过 `/hooks` 信任插件钩子,或手动运行一次
`bash <plugin-cache-dir>/scripts/bootstrap.sh`** — 参见
[`plugin/README.md`](./plugin/README.md)。

### 渠道 2 — `npx skills`(任何支持 skills 的代理)

```bash
npx skills add mojomoth/design-lens          # 自动检测已安装的代理
npx skills add mojomoth/design-lens -a cursor -a opencode   # 或指定特定代理
```

以这种方式安装的代理没有环境配置钩子;技能会在首次使用时运行
`npx -y design-lens setup` 自我修复(你也可以自己运行一次)。

### 渠道 3 — 通过 npm 直接使用 CLI

```bash
npx design-lens setup                        # 一次性: ~/.design-lens、Playwright、Chromium
npx design-lens clone https://example.com    # 或者完全不装插件,直接使用 CLI
```

**面向 LLM 代理** — 把这句话粘贴给你的代理:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

开发循环(免安装): `claude --plugin-dir ./plugin`。在 `marketplace add` 中,也可以用
本地绝对路径代替 `mojomoth/design-lens`。

技能(Claude: `/design-lens:<name>`,Codex: `$<name>`): `clone-reference`、`reverse-design`、
`inspect-elements`、`customize-clone`、`build-from-design`。

> clone 功能仅用于**私下的设计研究与二次创作**。每个克隆都附带
> 许可声明和上线前品牌检查清单: 在发布任何衍生作品之前,请替换 logo、重写文案、
> 为摄影作品和字体取得授权或予以替换。克隆绝不可部署或
> 再分发 — 参见 [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers)。

## 仓库结构

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## 自主开发(harness)

这个插件由 Ralph 循环一次性构建完成 — 每次迭代使用全新的代理上下文,所有记忆
落盘,并有一道密封的程序化验证关卡。运行方法:

```bash
./.harness/bootstrap.sh     # 一次性: git init、Chromium、fixture 自检、完整性封印
./.harness/ralph.sh plan    # 规划循环: 3-critic 辩论 → IMPLEMENTATION_PLAN.md
# 建议的人工检查点: 浏览一下 .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # 构建循环: 每次迭代完成一个任务,直到 strict 关卡变绿
```

在另一个终端中监控:

```bash
./.harness/ralph.sh status                     # 当前任务 / 迭代 / 成本
tail -f .harness/logs/current/*.stderr         # 代理实时输出
cat .harness/status/verify-feedback.md         # 关卡告诉下一次迭代要修复什么
touch .harness/STOP                            # 优雅停止; 恢复用: ralph.sh resume
```

预算和模型可在 `.harness/config.env` 中调整。只有当代理的完成声明
与独立的密封关卡(`.harness/verify.sh --strict`)同时通过时,循环才会退出。

## 许可证

MIT。捆绑及运行时的第三方依赖项列于
[`plugin/NOTICE.md`](./plugin/NOTICE.md)。由 `clone` 捕获的内容不在该
许可证的覆盖范围内,仍归其所有者所有。
