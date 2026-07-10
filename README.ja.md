# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**空白の AI キャンバスからではなく、優れたリファレンスデザインから始めよう。**

Design Lens は **Claude Code**、**OpenAI Codex CLI**、**Cursor**、**OpenCode** 向けのプラグインで、
リファレンスデザイン(awwwards クラスのサイト)を出発点に、美的に卓越したフロントエンドを
構築する手助けをします:

1. **Clone** — リファレンスページを、自己完結型で整形済みのローカルミラーとしてキャプチャします:
   JS レンダリング後の最終 DOM、CSS-in-JS / shadow-DOM スタイルの保持、すべてのアセットのローカル化、
   すべての要素への安定した `data-dl-id` の付与。
2. **Reverse-design** — シニアデザイナーのようにクローンを読み解き、`DESIGN.md`
   (すべての決定がなぜ下されたのか)と `VARIATIONS.md`(原則を保ったままの新しい方向性)を生成します。
3. **Customize** — 会話するだけで、ロゴの差し替え、ナビゲーションテキストの書き換え、ヒーロー画像の置換、
   色やサイズの変更が可能 — エージェントが `data-dl-id` をアンカーにクローンを直接編集します。

## インストール

| エージェント | 推奨チャネル | ランタイムのプロビジョニング |
| --- | --- | --- |
| Claude Code | プラグイン(下記)または `npx skills` | 自動(SessionStart フック) |
| Codex CLI | プラグイン(下記)または `npx skills` | `/hooks` でフックを信頼するか、下記のフォールバック |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | 初回使用時に `npx -y design-lens setup` |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | 初回使用時に `npx -y design-lens setup` |

### チャネル 1 — プラグイン(Claude Code / Codex)

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

初回セッションで `SessionStart` フックが `~/.design-lens/`(CLI、バージョン固定の Playwright、
Chromium)をプロビジョニングします。**Codex では、まず `/hooks` でプラグインのフックを信頼するか、
`bash <plugin-cache-dir>/scripts/bootstrap.sh` を一度手動で実行する必要があります** —
[`plugin/README.md`](./plugin/README.md) を参照してください。

### チャネル 2 — `npx skills`(skills 対応の任意のエージェント)

```bash
npx skills add mojomoth/design-lens          # インストール済みエージェントを自動検出
npx skills add mojomoth/design-lens -a cursor -a opencode   # または特定のエージェントを指定
```

この方法でインストールしたエージェントにはプロビジョニングフックがありません。スキルは初回使用時に
`npx -y design-lens setup` を実行して自己修復します(または一度自分で実行してください)。

### チャネル 3 — npm 経由のプレーン CLI

```bash
npx design-lens setup                        # 初回のみ: ~/.design-lens、Playwright、Chromium
npx design-lens clone https://example.com    # またはプラグインなしで CLI を直接使用
```

**LLM エージェント向け** — 以下をエージェントに貼り付けてください:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

開発ループ(インストール不要): `claude --plugin-dir ./plugin`。`marketplace add` では
`mojomoth/design-lens` の代わりにローカルの絶対パスも使えます。

スキル(Claude: `/design-lens:<name>`、Codex: `$<name>`): `clone-reference`、`reverse-design`、
`inspect-elements`、`customize-clone`、`build-from-design`。

> clone 機能は**私的なデザイン研究と派生制作**のためのものです。すべてのクローンには
> ライセンス通知と出荷前のブランドチェックリストが付属します: 派生物を出荷する前に、
> ロゴを差し替え、コピーを書き直し、写真とフォントはライセンスを取得するか置き換えてください。
> クローンをデプロイしたり再配布したりすることは決して許されません —
> [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers) を参照してください。

## リポジトリ構成

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## 自律開発(ハーネス)

このプラグインは Ralph ループによってワンショットで構築されます — イテレーションごとに新しい
エージェントコンテキスト、すべての記憶はディスク上に、封印されたプログラム的検証ゲート。実行方法:

```bash
./.harness/bootstrap.sh     # 初回のみ: git init、Chromium、フィクスチャのセルフテスト、整合性の封印
./.harness/ralph.sh plan    # 計画ループ: 3-critic の討論 → IMPLEMENTATION_PLAN.md
# 推奨のヒューマンチェックポイント: .agentdocs/IMPLEMENTATION_PLAN.md にざっと目を通す
./.harness/ralph.sh build   # ビルドループ: strict ゲートがグリーンになるまで、イテレーションごとにタスク 1 つ
```

別のターミナルからのモニタリング:

```bash
./.harness/ralph.sh status                     # 現在のタスク / イテレーション / コスト
tail -f .harness/logs/current/*.stderr         # エージェントのライブ出力
cat .harness/status/verify-feedback.md         # ゲートが次のイテレーションに修正を指示した内容
touch .harness/STOP                            # グレースフルストップ; 再開は: ralph.sh resume
```

予算とモデルは `.harness/config.env` で調整できます。ループは、エージェントの完了宣言と
独立した封印ゲート(`.harness/verify.sh --strict`)の両方が通過したときにのみ終了します。

## ライセンス

MIT。バンドルおよびランタイムのサードパーティ依存関係は
[`plugin/NOTICE.md`](./plugin/NOTICE.md) に列挙されています。`clone` でキャプチャされたコンテンツは
このライセンスの対象外であり、その所有者の財産のままです。
