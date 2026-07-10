# Design Lens

[English](./README.md) · [한국어](./README.ko.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**Partez de références de design remarquables, pas d'une toile IA vierge.**

Design Lens est un plugin pour **Claude Code**, **OpenAI Codex CLI**, **Cursor** et **OpenCode**
qui vous aide à construire des frontends esthétiquement excellents en partant de designs de
référence (des sites dignes des awwwards) :

1. **Clone** — capturez une page de référence dans un miroir local autonome et joliment formaté :
   DOM final rendu par JS, styles CSS-in-JS/shadow-DOM préservés, chaque ressource localisée, chaque
   élément estampillé d'un `data-dl-id` stable.
2. **Reverse-design** — lisez le clone comme un designer senior et produisez `DESIGN.md`
   (le pourquoi de chaque décision) + `VARIATIONS.md` (de nouvelles directions qui conservent les principes).
3. **Customize** — remplacez le logo, réécrivez le texte de navigation, changez l'image du hero,
   modifiez couleurs et tailles, le tout en conversant — l'agent édite le clone directement, ancré par `data-dl-id`.

## Installation

| Agent | Canal recommandé | Provisionnement du runtime |
| --- | --- | --- |
| Claude Code | plugin (ci-dessous) ou `npx skills` | automatique (hook SessionStart) |
| Codex CLI | plugin (ci-dessous) ou `npx skills` | approuvez le hook via `/hooks`, ou le repli ci-dessous |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | `npx -y design-lens setup` à la première utilisation |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | `npx -y design-lens setup` à la première utilisation |

### Canal 1 — plugin (Claude Code / Codex)

Claude Code :

```bash
claude plugin marketplace add mojomoth/design-lens
claude plugin install design-lens@design-lens
```

Codex CLI :

```bash
codex plugin marketplace add https://github.com/mojomoth/design-lens
codex plugin add design-lens@design-lens
```

À la première session, un hook `SessionStart` provisionne `~/.design-lens/` (CLI, Playwright épinglé,
Chromium). **Sous Codex, vous devez d'abord approuver le hook du plugin via `/hooks`, ou exécuter
`bash <plugin-cache-dir>/scripts/bootstrap.sh` une fois à la main** — voir
[`plugin/README.md`](./plugin/README.md).

### Canal 2 — `npx skills` (tout agent compatible skills)

```bash
npx skills add mojomoth/design-lens          # détecte automatiquement les agents installés
npx skills add mojomoth/design-lens -a cursor -a opencode   # ou ciblez-en certains explicitement
```

Les agents installés de cette manière n'ont pas de hook de provisionnement ; les skills s'auto-réparent
en exécutant `npx -y design-lens setup` à la première utilisation (ou lancez-le vous-même une fois).

### Canal 3 — CLI pur via npm

```bash
npx design-lens setup                        # une seule fois : ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # ou utilisez le CLI directement, sans aucun plugin
```

**Pour les agents LLM** — collez ceci dans votre agent :

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

Boucle de dev (sans installation) : `claude --plugin-dir ./plugin`. Un chemin local absolu fonctionne
aussi à la place de `mojomoth/design-lens` pour `marketplace add`.

Skills (Claude : `/design-lens:<name>`, Codex : `$<name>`) : `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> La fonction de clonage est destinée à **l'étude et la dérivation privées de design**. Chaque clone
> est livré avec un avis de licence et une checklist de marque avant publication : remplacez les logos,
> réécrivez les textes, obtenez une licence pour — ou remplacez — la photographie et les polices avant
> de publier quoi que ce soit de dérivé. Les clones ne doivent jamais être déployés ni redistribués —
> voir [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers).

## Organisation du dépôt

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## Développement autonome (le harnais)

Ce plugin est construit d'une traite par une boucle Ralph — contexte d'agent réinitialisé à chaque
itération, toute la mémoire sur disque, un portail de vérification programmatique scellé. Pour le lancer :

```bash
./.harness/bootstrap.sh     # une seule fois : git init, Chromium, auto-test du fixture, sceau d'intégrité
./.harness/ralph.sh plan    # boucle de planification : débat à 3 critiques → IMPLEMENTATION_PLAN.md
# point de contrôle humain recommandé : parcourez .agentdocs/IMPLEMENTATION_PLAN.md
./.harness/ralph.sh build   # boucle de build : une tâche par itération jusqu'à ce que le portail strict soit vert
```

Surveillez depuis un autre terminal :

```bash
./.harness/ralph.sh status                     # tâche courante / itération / coût
tail -f .harness/logs/current/*.stderr         # sortie de l'agent en direct
cat .harness/status/verify-feedback.md         # ce que le portail a demandé à l'itération suivante de corriger
touch .harness/STOP                            # arrêt gracieux ; reprise avec : ralph.sh resume
```

Les budgets et les modèles se règlent dans `.harness/config.env`. La boucle ne se termine que lorsque
la déclaration d'achèvement de l'agent ET le portail scellé indépendant (`.harness/verify.sh --strict`)
passent tous les deux.

## Licence

MIT. Les dépendances tierces embarquées et d'exécution sont énumérées dans
[`plugin/NOTICE.md`](./plugin/NOTICE.md). Le contenu capturé par `clone` n'est pas couvert par cette
licence et reste la propriété de ses détenteurs.
