# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**Начинайте с отличных референсных дизайнов, а не с пустого AI-холста.**

Design Lens — это плагин для **Claude Code**, **OpenAI Codex CLI**, **Cursor** и **OpenCode**,
который помогает создавать эстетически превосходные фронтенды, отталкиваясь от референсных
дизайнов (сайтов уровня awwwards):

1. **Клонирование** — захват референсной страницы в самодостаточное, аккуратно отформатированное
   локальное зеркало: финальный DOM после выполнения JS, сохранённые стили CSS-in-JS/shadow-DOM,
   все ресурсы локализованы, каждый элемент помечен стабильным `data-dl-id`.
2. **Обратный дизайн** — чтение клона глазами старшего дизайнера с созданием `DESIGN.md`
   (почему было принято каждое решение) + `VARIATIONS.md` (новые направления, сохраняющие принципы).
3. **Кастомизация** — в диалоговом режиме замените логотип, перепишите текст навигации, поменяйте
   hero-изображение, измените цвета и размеры — агент правит клон напрямую, опираясь на `data-dl-id`.

## Установка

| Агент | Рекомендуемый канал | Подготовка среды выполнения |
| --- | --- | --- |
| Claude Code | плагин (ниже) или `npx skills` | автоматически (хук SessionStart) |
| Codex CLI | плагин (ниже) или `npx skills` | доверьте хук через `/hooks` или используйте запасной вариант ниже |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | `npx -y design-lens setup` при первом использовании |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | `npx -y design-lens setup` при первом использовании |

### Канал 1 — плагин (Claude Code / Codex)

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

В первой сессии хук `SessionStart` разворачивает `~/.design-lens/` (CLI, закреплённая версия
Playwright, Chromium). **В Codex необходимо сначала доверить хук плагина через `/hooks` либо
один раз вручную выполнить `bash <plugin-cache-dir>/scripts/bootstrap.sh`** — см.
[`plugin/README.md`](./plugin/README.md).

### Канал 2 — `npx skills` (любой агент с поддержкой skills)

```bash
npx skills add mojomoth/design-lens          # автоматически определяет установленных агентов
npx skills add mojomoth/design-lens -a cursor -a opencode   # или укажите конкретных
```

У агентов, установленных этим способом, нет хука подготовки среды; скиллы самовосстанавливаются,
запуская `npx -y design-lens setup` при первом использовании (или выполните его один раз сами).

### Канал 3 — чистый CLI через npm

```bash
npx design-lens setup                        # однократно: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # или используйте CLI напрямую, вообще без плагина
```

**Для LLM-агентов** — вставьте это в своего агента:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

Цикл разработки (без установки): `claude --plugin-dir ./plugin`. Локальный абсолютный путь также
работает вместо `mojomoth/design-lens` в `marketplace add`.

Скиллы (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> Функция клонирования предназначена для **приватного изучения дизайна и создания производных
> работ**. Каждый клон поставляется с уведомлением о лицензии и чек-листом перед публикацией:
> замените логотипы, перепишите тексты, лицензируйте или замените фотографии и шрифты, прежде чем
> выпускать что-либо производное. Клоны никогда не должны разворачиваться или распространяться —
> см. [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers).

## Структура репозитория

```
plugin/        сам плагин (построен автономно — см. ниже)
.agentdocs/    спецификации, архитектура, критерии приёмки, ADR, план реализации
.harness/      автономный харнесс разработки Ralph-loop (запечатан)
```

## Автономная разработка (харнесс)

Этот плагин строится «в один заход» циклом Ralph — свежий контекст агента на каждой итерации, вся
память на диске, запечатанные программные проверочные ворота. Чтобы запустить:

```bash
./.harness/bootstrap.sh     # однократно: git init, Chromium, самопроверка фикстуры, пломба целостности
./.harness/ralph.sh plan    # цикл планирования: дебаты трёх критиков → IMPLEMENTATION_PLAN.md
# рекомендуемая контрольная точка для человека: просмотрите .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # цикл сборки: одна задача за итерацию, пока строгие ворота не станут зелёными
```

Мониторинг из другого терминала:

```bash
./.harness/ralph.sh status                     # текущая задача / итерация / стоимость
tail -f .harness/logs/current/*.stderr         # живой вывод агента
cat .harness/status/verify-feedback.md         # что ворота велели исправить следующей итерации
touch .harness/STOP                            # плавная остановка; возобновление: ralph.sh resume
```

Бюджеты и модели настраиваются в `.harness/config.env`. Цикл завершается только тогда, когда
заявление агента о завершении И независимые запечатанные ворота (`.harness/verify.sh --strict`)
проходят одновременно.

## Лицензия

MIT. Сторонние бандлированные и рантайм-зависимости перечислены в
[`plugin/NOTICE.md`](./plugin/NOTICE.md). Контент, захваченный командой `clone`, этой лицензией
не покрывается и остаётся собственностью его владельцев.
