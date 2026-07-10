# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**Parti da ottimi design di riferimento, non da una tela IA vuota.**

Design Lens è un plugin per **Claude Code**, **OpenAI Codex CLI**, **Cursor** e **OpenCode**
che ti aiuta a costruire frontend esteticamente eccellenti partendo da design di riferimento
(siti da awwwards):

1. **Clone** — cattura una pagina di riferimento in un mirror locale autonomo e formattato in modo
   leggibile: DOM finale renderizzato da JS, stili CSS-in-JS/shadow-DOM preservati, ogni risorsa
   localizzata, ogni elemento marchiato con un `data-dl-id` stabile.
2. **Reverse-design** — leggi il clone come un designer senior e produci `DESIGN.md`
   (il perché di ogni decisione) + `VARIATIONS.md` (nuove direzioni che mantengono i principi).
3. **Customize** — sostituisci il logo, riscrivi il testo della nav, cambia l'immagine dell'hero,
   modifica colori e dimensioni in modo conversazionale — l'agente modifica il clone direttamente,
   ancorato da `data-dl-id`.

## Installazione

| Agente | Canale consigliato | Provisioning del runtime |
| --- | --- | --- |
| Claude Code | plugin (sotto) o `npx skills` | automatico (hook SessionStart) |
| Codex CLI | plugin (sotto) o `npx skills` | autorizza l'hook via `/hooks`, oppure il ripiego qui sotto |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | `npx -y design-lens setup` al primo utilizzo |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | `npx -y design-lens setup` al primo utilizzo |

### Canale 1 — plugin (Claude Code / Codex)

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

Alla prima sessione un hook `SessionStart` effettua il provisioning di `~/.design-lens/` (CLI,
Playwright bloccato a una versione precisa, Chromium). **Su Codex devi prima autorizzare l'hook del
plugin via `/hooks`, oppure eseguire una volta a mano
`bash <plugin-cache-dir>/scripts/bootstrap.sh`** — vedi
[`plugin/README.md`](./plugin/README.md).

### Canale 2 — `npx skills` (qualsiasi agente compatibile con le skill)

```bash
npx skills add mojomoth/design-lens          # rileva automaticamente gli agenti installati
npx skills add mojomoth/design-lens -a cursor -a opencode   # oppure indica agenti specifici
```

Gli agenti installati in questo modo non hanno alcun hook di provisioning; le skill si auto-riparano
eseguendo `npx -y design-lens setup` al primo utilizzo (oppure eseguilo tu stesso una volta).

### Canale 3 — semplice CLI via npm

```bash
npx design-lens setup                        # una tantum: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # oppure usa la CLI direttamente, senza alcun plugin
```

**Per gli agenti LLM** — incolla questo nel tuo agente:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

Loop di sviluppo (senza installazione): `claude --plugin-dir ./plugin`. Anche un percorso locale
assoluto funziona al posto di `mojomoth/design-lens` per `marketplace add`.

Skill (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> La funzione di clonazione è pensata per **studio e derivazione privati del design**. Ogni clone
> viene fornito con un avviso di licenza e una checklist di brand pre-rilascio: sostituisci i loghi,
> riscrivi i testi, ottieni la licenza o sostituisci fotografie e font prima di rilasciare qualsiasi
> derivato. I cloni non devono mai essere pubblicati né ridistribuiti — vedi
> [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers).

## Struttura del repository

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## Sviluppo autonomo (l'harness)

Questo plugin viene costruito in un colpo solo da un loop Ralph — contesto dell'agente nuovo a ogni
iterazione, tutta la memoria su disco, un gate di verifica programmatico sigillato. Per eseguirlo:

```bash
./.harness/bootstrap.sh     # una tantum: git init, Chromium, autotest della fixture, sigillo di integrità
./.harness/ralph.sh plan    # loop di pianificazione: dibattito a 3 critici → IMPLEMENTATION_PLAN.md
# checkpoint umano consigliato: scorri .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # loop di build: un task per iterazione finché il gate rigoroso non è verde
```

Monitora da un altro terminale:

```bash
./.harness/ralph.sh status                     # task corrente / iterazione / costo
tail -f .harness/logs/current/*.stderr         # output dell'agente in tempo reale
cat .harness/status/verify-feedback.md         # cosa il gate ha chiesto di correggere all'iterazione successiva
touch .harness/STOP                            # arresto pulito; riprendi con: ralph.sh resume
```

Budget e modelli sono regolabili in `.harness/config.env`. Il loop termina solo quando la
dichiarazione di completamento dell'agente E il gate sigillato indipendente
(`.harness/verify.sh --strict`) passano entrambi.

## Licenza

MIT. Le dipendenze di terze parti incluse nel bundle e quelle di runtime sono elencate in
[`plugin/NOTICE.md`](./plugin/NOTICE.md). Il contenuto catturato da `clone` non è coperto da tale
licenza e resta proprietà dei rispettivi titolari.
