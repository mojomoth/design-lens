# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**從卓越的參考設計出發,而不是從空白的 AI 畫布開始。**

Design Lens 是一款支援 **Claude Code**、**OpenAI Codex CLI**、**Cursor** 與 **OpenCode**
的外掛,協助你從參考設計(awwwards 等級的網站)出發,打造美學出眾的前端:

1. **Clone** — 將參考頁面擷取為自給自足、排版精美的本機鏡像:
   JS 渲染完成的最終 DOM、保留 CSS-in-JS/shadow-DOM 樣式、所有資產在地化、每個
   元素都標上穩定的 `data-dl-id`。
2. **Reverse-design** — 像資深設計師一樣解讀複製品,產出 `DESIGN.md`
   (每個決策背後的理由)+ `VARIATIONS.md`(在維持設計原則下的全新方向)。
3. **Customize** — 透過對話即可更換 logo、改寫導覽文字、替換主視覺圖片、
   調整顏色與尺寸 — 代理程式以 `data-dl-id` 為錨點直接編輯複製品。

## 安裝

| 代理程式 | 建議管道 | 執行環境佈建 |
| --- | --- | --- |
| Claude Code | 外掛(見下)或 `npx skills` | 自動(SessionStart 掛鉤) |
| Codex CLI | 外掛(見下)或 `npx skills` | 透過 `/hooks` 信任掛鉤,或採用下方的備援方式 |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | 首次使用時執行 `npx -y design-lens setup` |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | 首次使用時執行 `npx -y design-lens setup` |

### 管道 1 — 外掛(Claude Code / Codex)

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

首次工作階段時,`SessionStart` 掛鉤會佈建 `~/.design-lens/`(CLI、鎖定版本的 Playwright、
Chromium)。**在 Codex 上,你必須先透過 `/hooks` 信任外掛掛鉤,或手動執行一次
`bash <plugin-cache-dir>/scripts/bootstrap.sh`** — 參見
[`plugin/README.md`](./plugin/README.md)。

### 管道 2 — `npx skills`(任何支援 skills 的代理程式)

```bash
npx skills add mojomoth/design-lens          # 自動偵測已安裝的代理程式
npx skills add mojomoth/design-lens -a cursor -a opencode   # 或指定特定的代理程式
```

以這種方式安裝的代理程式沒有佈建掛鉤;技能會在首次使用時執行
`npx -y design-lens setup` 自我修復(你也可以自己執行一次)。

### 管道 3 — 透過 npm 直接使用 CLI

```bash
npx design-lens setup                        # 一次性: ~/.design-lens、Playwright、Chromium
npx design-lens clone https://example.com    # 或完全不裝外掛,直接使用 CLI
```

**給 LLM 代理程式** — 將這句話貼給你的代理程式:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

開發迴圈(免安裝): `claude --plugin-dir ./plugin`。在 `marketplace add` 中,也可以用
本機絕對路徑取代 `mojomoth/design-lens`。

技能(Claude: `/design-lens:<name>`,Codex: `$<name>`): `clone-reference`、`reverse-design`、
`inspect-elements`、`customize-clone`、`build-from-design`。

> clone 功能僅供**私下的設計研究與衍生創作**之用。每個複製品都附有
> 授權聲明與出貨前品牌檢查清單: 在發佈任何衍生作品之前,請更換 logo、重寫文案、
> 為攝影作品與字型取得授權或予以更換。複製品絕不可部署或
> 再散布 — 參見 [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers)。

## 儲存庫結構

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## 自主開發(harness)

這個外掛由 Ralph 迴圈一次到位地建置完成 — 每次迭代都使用全新的代理程式情境,所有記憶
落於磁碟,並設有一道密封的程式化驗證關卡。執行方式:

```bash
./.harness/bootstrap.sh     # 一次性: git init、Chromium、fixture 自我測試、完整性封印
./.harness/ralph.sh plan    # 規劃迴圈: 3-critic 辯論 → IMPLEMENTATION_PLAN.md
# 建議的人工檢查點: 瀏覽一下 .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # 建置迴圈: 每次迭代完成一項任務,直到 strict 關卡轉綠
```

從另一個終端機監控:

```bash
./.harness/ralph.sh status                     # 目前任務 / 迭代 / 成本
tail -f .harness/logs/current/*.stderr         # 代理程式即時輸出
cat .harness/status/verify-feedback.md         # 關卡要求下一次迭代修正的內容
touch .harness/STOP                            # 優雅停止; 恢復用: ralph.sh resume
```

預算與模型可在 `.harness/config.env` 中調整。只有當代理程式的完成宣告
與獨立的密封關卡(`.harness/verify.sh --strict`)同時通過時,迴圈才會結束。

## 授權

MIT。捆綁與執行期的第三方相依套件列於
[`plugin/NOTICE.md`](./plugin/NOTICE.md)。由 `clone` 擷取的內容不在該
授權涵蓋範圍內,仍屬其擁有者所有。
