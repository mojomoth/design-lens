# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**Comece a partir de ótimos designs de referência, não de uma tela de IA em branco.**

O Design Lens é um plugin para **Claude Code**, **OpenAI Codex CLI**, **Cursor** e **OpenCode**
que ajuda você a construir frontends esteticamente excelentes partindo de designs de referência
(sites de nível awwwards):

1. **Clone** — capture uma página de referência em um espelho local autocontido e bem formatado:
   DOM final renderizado por JS, estilos CSS-in-JS/shadow-DOM preservados, todos os recursos
   localizados, cada elemento carimbado com um `data-dl-id` estável.
2. **Reverse-design** — leia o clone como um designer sênior e produza `DESIGN.md`
   (o porquê de cada decisão) + `VARIATIONS.md` (novas direções que mantêm os princípios).
3. **Customize** — troque o logo, reescreva o texto de navegação, substitua a imagem do hero,
   mude cores e tamanhos de forma conversacional — o agente edita o clone diretamente,
   ancorado por `data-dl-id`.

## Instalação

| Agente | Canal recomendado | Provisionamento do runtime |
| --- | --- | --- |
| Claude Code | plugin (abaixo) ou `npx skills` | automático (hook SessionStart) |
| Codex CLI | plugin (abaixo) ou `npx skills` | confie no hook via `/hooks`, ou o plano alternativo abaixo |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | `npx -y design-lens setup` no primeiro uso |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | `npx -y design-lens setup` no primeiro uso |

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

Na primeira sessão, um hook `SessionStart` provisiona `~/.design-lens/` (CLI, Playwright fixado,
Chromium). **No Codex você precisa primeiro confiar no hook do plugin via `/hooks`, ou executar
`bash <plugin-cache-dir>/scripts/bootstrap.sh` uma vez manualmente** — veja
[`plugin/README.md`](./plugin/README.md).

### Canal 2 — `npx skills` (qualquer agente com suporte a skills)

```bash
npx skills add mojomoth/design-lens          # detecta automaticamente os agentes instalados
npx skills add mojomoth/design-lens -a cursor -a opencode   # ou mire em agentes específicos
```

Agentes instalados dessa forma não têm hook de provisionamento; as skills se autorreparam
executando `npx -y design-lens setup` no primeiro uso (ou execute você mesmo uma vez).

### Canal 3 — CLI puro via npm

```bash
npx design-lens setup                        # uma única vez: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # ou use o CLI diretamente, sem plugin nenhum
```

**Para agentes LLM** — cole isto no seu agente:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

Loop de desenvolvimento (sem instalar): `claude --plugin-dir ./plugin`. Um caminho local absoluto
também funciona no lugar de `mojomoth/design-lens` para `marketplace add`.

Skills (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> O recurso de clonagem destina-se a **estudo e derivação privados de design**. Todo clone vem com um
> aviso de licença e uma checklist de marca pré-lançamento: substitua os logos, reescreva os textos,
> licencie ou substitua fotografias e fontes antes de lançar qualquer derivado. Clones nunca devem
> ser implantados nem redistribuídos — veja
> [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers).

## Estrutura do repositório

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## Desenvolvimento autônomo (o harness)

Este plugin é construído de uma só vez por um loop Ralph — contexto de agente novo a cada iteração,
toda a memória em disco, um portão de verificação programático lacrado. Para executá-lo:

```bash
./.harness/bootstrap.sh     # uma única vez: git init, Chromium, autoteste do fixture, lacre de integridade
./.harness/ralph.sh plan    # loop de planejamento: debate de 3 críticos → IMPLEMENTATION_PLAN.md
# ponto de verificação humano recomendado: folheie .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # loop de build: uma tarefa por iteração até o portão estrito ficar verde
```

Monitore de outro terminal:

```bash
./.harness/ralph.sh status                     # tarefa atual / iteração / custo
tail -f .harness/logs/current/*.stderr         # saída do agente ao vivo
cat .harness/status/verify-feedback.md         # o que o portão mandou a próxima iteração corrigir
touch .harness/STOP                            # parada graciosa; retome com: ralph.sh resume
```

Orçamentos e modelos são ajustáveis em `.harness/config.env`. O loop só encerra quando a declaração
de conclusão do agente E o portão lacrado independente (`.harness/verify.sh --strict`) passam ambos.

## Licença

MIT. As dependências de terceiros empacotadas e de runtime estão enumeradas em
[`plugin/NOTICE.md`](./plugin/NOTICE.md). O conteúdo capturado pelo `clone` não é coberto por essa
licença e permanece propriedade de seus donos.
