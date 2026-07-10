# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**Починайте з чудових референсних дизайнів, а не з порожнього AI-полотна.**

Design Lens — це плагін для **Claude Code**, **OpenAI Codex CLI**, **Cursor** та **OpenCode**,
який допомагає створювати естетично досконалі фронтенди, відштовхуючись від референсних
дизайнів (сайтів рівня awwwards):

1. **Клонування** — захоплення референсної сторінки в самодостатнє, охайно відформатоване
   локальне дзеркало: фінальний DOM після виконання JS, збережені стилі CSS-in-JS/shadow-DOM,
   усі ресурси локалізовано, кожен елемент позначено стабільним `data-dl-id`.
2. **Зворотний дизайн** — читання клона очима старшого дизайнера зі створенням `DESIGN.md`
   (чому було ухвалено кожне рішення) + `VARIATIONS.md` (нові напрями, що зберігають принципи).
3. **Кастомізація** — у діалоговому режимі замініть логотип, перепишіть текст навігації, поміняйте
   hero-зображення, змініть кольори й розміри — агент редагує клон безпосередньо, спираючись на `data-dl-id`.

## Встановлення

| Агент | Рекомендований канал | Підготовка середовища виконання |
| --- | --- | --- |
| Claude Code | плагін (нижче) або `npx skills` | автоматично (хук SessionStart) |
| Codex CLI | плагін (нижче) або `npx skills` | довірте хук через `/hooks` або скористайтеся запасним варіантом нижче |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | `npx -y design-lens setup` під час першого використання |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | `npx -y design-lens setup` під час першого використання |

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

У першій сесії хук `SessionStart` розгортає `~/.design-lens/` (CLI, закріплена версія
Playwright, Chromium). **У Codex спершу потрібно довірити хук плагіна через `/hooks` або
один раз вручну виконати `bash <plugin-cache-dir>/scripts/bootstrap.sh`** — див.
[`plugin/README.md`](./plugin/README.md).

### Канал 2 — `npx skills` (будь-який агент із підтримкою skills)

```bash
npx skills add mojomoth/design-lens          # автоматично визначає встановлених агентів
npx skills add mojomoth/design-lens -a cursor -a opencode   # або вкажіть конкретних
```

Агенти, встановлені в такий спосіб, не мають хука підготовки середовища; скіли самовідновлюються,
запускаючи `npx -y design-lens setup` під час першого використання (або виконайте його один раз самі).

### Канал 3 — чистий CLI через npm

```bash
npx design-lens setup                        # одноразово: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # або користуйтеся CLI напряму, зовсім без плагіна
```

**Для LLM-агентів** — вставте це у свого агента:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

Цикл розробки (без встановлення): `claude --plugin-dir ./plugin`. Локальний абсолютний шлях також
працює замість `mojomoth/design-lens` у `marketplace add`.

Скіли (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> Функція клонування призначена для **приватного вивчення дизайну та створення похідних робіт**.
> Кожен клон постачається з ліцензійним повідомленням і чек-листом перед публікацією: замініть
> логотипи, перепишіть тексти, ліцензуйте або замініть фотографії та шрифти, перш ніж випускати
> будь-що похідне. Клони ніколи не мають розгортатися чи розповсюджуватися — див.
> [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers).

## Структура репозиторію

```
plugin/        сам плагін (побудований автономно — див. нижче)
.agentdocs/    специфікації, архітектура, критерії приймання, ADR, план реалізації
.harness/      автономний харнес розробки Ralph-loop (запечатаний)
```

## Автономна розробка (харнес)

Цей плагін будується «за один захід» циклом Ralph — свіжий контекст агента на кожній ітерації, вся
пам'ять на диску, запечатані програмні перевірочні ворота. Щоб запустити:

```bash
./.harness/bootstrap.sh     # одноразово: git init, Chromium, самоперевірка фікстури, пломба цілісності
./.harness/ralph.sh plan    # цикл планування: дебати трьох критиків → IMPLEMENTATION_PLAN.md
# рекомендована контрольна точка для людини: перегляньте .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # цикл збірки: одне завдання за ітерацію, доки строгі ворота не стануть зеленими
```

Моніторинг з іншого термінала:

```bash
./.harness/ralph.sh status                     # поточне завдання / ітерація / вартість
tail -f .harness/logs/current/*.stderr         # живий вивід агента
cat .harness/status/verify-feedback.md         # що ворота звеліли виправити наступній ітерації
touch .harness/STOP                            # плавна зупинка; відновлення: ralph.sh resume
```

Бюджети та моделі налаштовуються в `.harness/config.env`. Цикл завершується лише тоді, коли
заява агента про завершення І незалежні запечатані ворота (`.harness/verify.sh --strict`)
проходять одночасно.

## Ліцензія

MIT. Сторонні бандловані та рантайм-залежності перелічено в
[`plugin/NOTICE.md`](./plugin/NOTICE.md). Контент, захоплений командою `clone`, цією ліцензією
не покривається й залишається власністю його власників.
