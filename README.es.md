# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**Parte de grandes diseños de referencia, no de un lienzo de IA en blanco.**

Design Lens es un plugin para **Claude Code**, **OpenAI Codex CLI**, **Cursor** y **OpenCode**
que te ayuda a construir frontends estéticamente excelentes partiendo de diseños de referencia
(sitios de nivel awwwards):

1. **Clone** — captura una página de referencia en un espejo local autocontenido y con formato
   legible: DOM final renderizado por JS, estilos CSS-in-JS/shadow-DOM preservados, cada recurso
   localizado, cada elemento marcado con un `data-dl-id` estable.
2. **Reverse-design** — lee el clon como un diseñador sénior y produce `DESIGN.md`
   (el porqué de cada decisión) + `VARIATIONS.md` (nuevas direcciones que conservan los principios).
3. **Customize** — cambia el logo, reescribe el texto de navegación, reemplaza la imagen del hero,
   modifica colores y tamaños de forma conversacional — el agente edita el clon directamente,
   anclado por `data-dl-id`.

## Instalación

| Agente | Canal recomendado | Aprovisionamiento del runtime |
| --- | --- | --- |
| Claude Code | plugin (abajo) o `npx skills` | automático (hook SessionStart) |
| Codex CLI | plugin (abajo) o `npx skills` | confía en el hook vía `/hooks`, o el plan alternativo de abajo |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | `npx -y design-lens setup` en el primer uso |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | `npx -y design-lens setup` en el primer uso |

### Canal 1 — plugin (Claude Code / Codex)

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

En la primera sesión, un hook `SessionStart` aprovisiona `~/.design-lens/` (CLI, Playwright fijado,
Chromium). **En Codex primero debes confiar en el hook del plugin vía `/hooks`, o ejecutar
`bash <plugin-cache-dir>/scripts/bootstrap.sh` una vez a mano** — consulta
[`plugin/README.md`](./plugin/README.md).

### Canal 2 — `npx skills` (cualquier agente compatible con skills)

```bash
npx skills add mojomoth/design-lens          # detecta automáticamente los agentes instalados
npx skills add mojomoth/design-lens -a cursor -a opencode   # o apunta a agentes concretos
```

Los agentes instalados de esta forma no tienen hook de aprovisionamiento; las skills se autorreparan
ejecutando `npx -y design-lens setup` en el primer uso (o ejecútalo tú mismo una vez).

### Canal 3 — CLI a secas vía npm

```bash
npx design-lens setup                        # una sola vez: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # o usa el CLI directamente, sin plugin alguno
```

**Para agentes LLM** — pega esto en tu agente:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

Bucle de desarrollo (sin instalar): `claude --plugin-dir ./plugin`. Una ruta local absoluta también
funciona en lugar de `mojomoth/design-lens` para `marketplace add`.

Skills (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> La función de clonado es para **estudio y derivación privados de diseño**. Cada clon incluye un
> aviso de licencia y una checklist de marca previa a la publicación: reemplaza los logos, reescribe
> los textos, licencia o sustituye la fotografía y las tipografías antes de publicar cualquier
> derivado. Los clones nunca deben desplegarse ni redistribuirse — consulta
> [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers).

## Estructura del repositorio

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## Desarrollo autónomo (el arnés)

Este plugin se construye de una sola pasada mediante un bucle Ralph — contexto de agente nuevo en
cada iteración, toda la memoria en disco, una puerta de verificación programática sellada. Para ejecutarlo:

```bash
./.harness/bootstrap.sh     # una sola vez: git init, Chromium, autotest del fixture, sello de integridad
./.harness/ralph.sh plan    # bucle de planificación: debate de 3 críticos → IMPLEMENTATION_PLAN.md
# punto de control humano recomendado: hojea .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # bucle de build: una tarea por iteración hasta que la puerta estricta esté en verde
```

Monitorea desde otra terminal:

```bash
./.harness/ralph.sh status                     # tarea actual / iteración / costo
tail -f .harness/logs/current/*.stderr         # salida del agente en vivo
cat .harness/status/verify-feedback.md         # lo que la puerta le pidió corregir a la siguiente iteración
touch .harness/STOP                            # parada limpia; reanuda con: ralph.sh resume
```

Los presupuestos y modelos son ajustables en `.harness/config.env`. El bucle solo termina cuando la
declaración de finalización del agente Y la puerta sellada independiente (`.harness/verify.sh --strict`)
pasan ambas.

## Licencia

MIT. Las dependencias de terceros empaquetadas y de runtime están enumeradas en
[`plugin/NOTICE.md`](./plugin/NOTICE.md). El contenido capturado por `clone` no está cubierto por esa
licencia y sigue siendo propiedad de sus dueños.
