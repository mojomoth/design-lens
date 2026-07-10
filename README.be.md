# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [বাংলা](./README.bn.md)

**Пачынайце з выдатных рэферэнсных дызайнаў, а не з пустога AI-палатна.**

Design Lens — гэта плагін для **Claude Code**, **OpenAI Codex CLI**, **Cursor** і **OpenCode**,
які дапамагае ствараць эстэтычна дасканалыя фронтэнды, адштурхоўваючыся ад рэферэнсных
дызайнаў (сайтаў узроўню awwwards):

1. **Кланаванне** — захоп рэферэнснай старонкі ў самадастатковае, ахайна адфарматаванае
   лакальнае люстэрка: фінальны DOM пасля выканання JS, захаваныя стылі CSS-in-JS/shadow-DOM,
   усе рэсурсы лакалізаваны, кожны элемент пазначаны стабільным `data-dl-id`.
2. **Зваротны дызайн** — чытанне клона вачыма старшага дызайнера са стварэннем `DESIGN.md`
   (чаму было прынята кожнае рашэнне) + `VARIATIONS.md` (новыя напрамкі, што захоўваюць прынцыпы).
3. **Кастамізацыя** — у дыялогавым рэжыме замяніце лагатып, перапішыце тэкст навігацыі, памяняйце
   hero-выяву, змяніце колеры і памеры — агент рэдагуе клон непасрэдна, абапіраючыся на `data-dl-id`.

## Усталяванне

| Агент | Рэкамендаваны канал | Падрыхтоўка асяроддзя выканання |
| --- | --- | --- |
| Claude Code | плагін (ніжэй) або `npx skills` | аўтаматычна (хук SessionStart) |
| Codex CLI | плагін (ніжэй) або `npx skills` | даверце хук праз `/hooks` або скарыстайцеся запасным варыянтам ніжэй |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | `npx -y design-lens setup` пры першым выкарыстанні |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | `npx -y design-lens setup` пры першым выкарыстанні |

### Канал 1 — плагін (Claude Code / Codex)

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

У першай сесіі хук `SessionStart` разгортвае `~/.design-lens/` (CLI, замацаваная версія
Playwright, Chromium). **У Codex спачатку трэба даверыць хук плагіна праз `/hooks` або
адзін раз уручную выканаць `bash <plugin-cache-dir>/scripts/bootstrap.sh`** — гл.
[`plugin/README.md`](./plugin/README.md).

### Канал 2 — `npx skills` (любы агент з падтрымкай skills)

```bash
npx skills add mojomoth/design-lens          # аўтаматычна вызначае ўсталяваных агентаў
npx skills add mojomoth/design-lens -a cursor -a opencode   # або ўкажыце канкрэтных
```

Агенты, усталяваныя такім спосабам, не маюць хука падрыхтоўкі асяроддзя; скілы самааднаўляюцца,
запускаючы `npx -y design-lens setup` пры першым выкарыстанні (або выканайце яго адзін раз самі).

### Канал 3 — чысты CLI праз npm

```bash
npx design-lens setup                        # аднаразова: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # або карыстайцеся CLI наўпрост, зусім без плагіна
```

**Для LLM-агентаў** — устаўце гэта ў свайго агента:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

Цыкл распрацоўкі (без усталявання): `claude --plugin-dir ./plugin`. Лакальны абсалютны шлях таксама
працуе замест `mojomoth/design-lens` у `marketplace add`.

Скілы (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> Функцыя кланавання прызначана для **прыватнага вывучэння дызайну і стварэння вытворных работ**.
> Кожны клон пастаўляецца з ліцэнзійным паведамленнем і чэк-лістом перад публікацыяй: замяніце
> лагатыпы, перапішыце тэксты, ліцэнзуйце або замяніце фатаграфіі і шрыфты, перш чым выпускаць
> што-небудзь вытворнае. Клоны ніколі не павінны разгортвацца ці распаўсюджвацца — гл.
> [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers).

## Структура рэпазіторыя

```
plugin/        сам плагін (пабудаваны аўтаномна — гл. ніжэй)
.agentdocs/    спецыфікацыі, архітэктура, крытэрыі прыёмкі, ADR, план рэалізацыі
.harness/      аўтаномны харнэс распрацоўкі Ralph-loop (запячатаны)
```

## Аўтаномная распрацоўка (харнэс)

Гэты плагін будуецца «за адзін заход» цыклам Ralph — свежы кантэкст агента на кожнай ітэрацыі, уся
памяць на дыску, запячатаныя праграмныя праверачныя вароты. Каб запусціць:

```bash
./.harness/bootstrap.sh     # аднаразова: git init, Chromium, самаправерка фікстуры, пломба цэласнасці
./.harness/ralph.sh plan    # цыкл планавання: дэбаты трох крытыкаў → IMPLEMENTATION_PLAN.md
# рэкамендаваная кантрольная кропка для чалавека: прагледзьце .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # цыкл зборкі: адна задача за ітэрацыю, пакуль строгія вароты не стануць зялёнымі
```

Маніторынг з іншага тэрмінала:

```bash
./.harness/ralph.sh status                     # бягучая задача / ітэрацыя / кошт
tail -f .harness/logs/current/*.stderr         # жывы вывад агента
cat .harness/status/verify-feedback.md         # што вароты загадалі выправіць наступнай ітэрацыі
touch .harness/STOP                            # плаўны прыпынак; аднаўленне: ralph.sh resume
```

Бюджэты і мадэлі наладжваюцца ў `.harness/config.env`. Цыкл завяршаецца толькі тады, калі
заява агента пра завяршэнне І незалежныя запячатаныя вароты (`.harness/verify.sh --strict`)
праходзяць адначасова.

## Ліцэнзія

MIT. Іншабаковыя бандляваныя і рантайм-залежнасці пералічаны ў
[`plugin/NOTICE.md`](./plugin/NOTICE.md). Кантэнт, захоплены камандай `clone`, гэтай ліцэнзіяй
не пакрываецца і застаецца ўласнасцю яго ўладальнікаў.
