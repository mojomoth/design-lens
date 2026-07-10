# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**Pornește de la designuri de referință excelente, nu de la o pânză AI goală.**

Design Lens este un plugin pentru **Claude Code**, **OpenAI Codex CLI**, **Cursor** și **OpenCode**
care te ajută să construiești frontend-uri excelente estetic pornind de la designuri de referință
(site-uri de calibrul awwwards):

1. **Clone** — capturează o pagină de referință într-o oglindă locală autonomă, frumos formatată:
   DOM-ul final randat de JS, stilurile CSS-in-JS/shadow-DOM păstrate, fiecare resursă localizată,
   fiecare element marcat cu un `data-dl-id` stabil.
2. **Reverse-design** — citește clona ca un designer senior și produce `DESIGN.md`
   (de ce a fost luată fiecare decizie) + `VARIATIONS.md` (direcții noi care păstrează principiile).
3. **Customize** — schimbă logo-ul, rescrie textul de navigare, înlocuiește imaginea hero,
   modifică culori și dimensiuni, totul conversațional — agentul editează clona direct,
   ancorat de `data-dl-id`.

## Instalare

| Agent | Canal recomandat | Provizionarea runtime-ului |
| --- | --- | --- |
| Claude Code | plugin (mai jos) sau `npx skills` | automată (hook SessionStart) |
| Codex CLI | plugin (mai jos) sau `npx skills` | aprobă hook-ul prin `/hooks`, sau varianta de rezervă de mai jos |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | `npx -y design-lens setup` la prima utilizare |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | `npx -y design-lens setup` la prima utilizare |

### Canalul 1 — plugin (Claude Code / Codex)

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

La prima sesiune, un hook `SessionStart` provizionează `~/.design-lens/` (CLI, Playwright fixat la o
versiune anume, Chromium). **Pe Codex trebuie mai întâi să aprobi hook-ul plugin-ului prin `/hooks`,
sau să rulezi o dată manual `bash <plugin-cache-dir>/scripts/bootstrap.sh`** — vezi
[`plugin/README.md`](./plugin/README.md).

### Canalul 2 — `npx skills` (orice agent compatibil cu skill-uri)

```bash
npx skills add mojomoth/design-lens          # detectează automat agenții instalați
npx skills add mojomoth/design-lens -a cursor -a opencode   # sau țintește anumiți agenți
```

Agenții instalați în acest mod nu au hook de provizionare; skill-urile se auto-repară rulând
`npx -y design-lens setup` la prima utilizare (sau rulează-l tu însuți o dată).

### Canalul 3 — CLI simplu prin npm

```bash
npx design-lens setup                        # o singură dată: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # sau folosește CLI-ul direct, fără niciun plugin
```

**Pentru agenți LLM** — lipește asta în agentul tău:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

Bucla de dezvoltare (fără instalare): `claude --plugin-dir ./plugin`. O cale locală absolută
funcționează de asemenea în locul lui `mojomoth/design-lens` pentru `marketplace add`.

Skill-uri (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> Funcția de clonare este destinată **studiului și derivării private de design**. Fiecare clonă vine
> cu o notă de licență și o listă de verificare de brand înainte de lansare: înlocuiește logo-urile,
> rescrie textele, licențiază sau înlocuiește fotografiile și fonturile înainte de a lansa orice
> derivat. Clonele nu trebuie niciodată publicate sau redistribuite — vezi
> [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers).

## Structura depozitului

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## Dezvoltare autonomă (harness-ul)

Acest plugin este construit dintr-o singură trecere de o buclă Ralph — context de agent proaspăt la
fiecare iterație, toată memoria pe disc, o poartă de verificare programatică sigilată. Pentru a o rula:

```bash
./.harness/bootstrap.sh     # o singură dată: git init, Chromium, autotestul fixture-ului, sigiliul de integritate
./.harness/ralph.sh plan    # bucla de planificare: dezbatere cu 3 critici → IMPLEMENTATION_PLAN.md
# punct de control uman recomandat: răsfoiește .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # bucla de build: o sarcină per iterație până când poarta strictă e verde
```

Monitorizează din alt terminal:

```bash
./.harness/ralph.sh status                     # sarcina curentă / iterația / costul
tail -f .harness/logs/current/*.stderr         # ieșirea agentului în timp real
cat .harness/status/verify-feedback.md         # ce i-a spus poarta iterației următoare să repare
touch .harness/STOP                            # oprire grațioasă; reia cu: ralph.sh resume
```

Bugetele și modelele sunt ajustabile în `.harness/config.env`. Bucla se încheie doar când declarația
de finalizare a agentului ȘI poarta sigilată independentă (`.harness/verify.sh --strict`) trec amândouă.

## Licență

MIT. Dependențele terțe incluse în bundle și cele de runtime sunt enumerate în
[`plugin/NOTICE.md`](./plugin/NOTICE.md). Conținutul capturat de `clone` nu este acoperit de acea
licență și rămâne proprietatea deținătorilor săi.
