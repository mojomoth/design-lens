# Design Lens

[English](./README.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**빈 AI 캔버스가 아니라, 훌륭한 레퍼런스 디자인에서 시작하세요.**

Design Lens는 **Claude Code**, **OpenAI Codex CLI**, **Cursor**, **OpenCode**용 플러그인으로,
레퍼런스 디자인(awwwards급 사이트)에서 출발해 미적으로 뛰어난 프론트엔드를
만들 수 있게 도와줍니다:

1. **Clone** — 레퍼런스 페이지를 자체 완결적이고 보기 좋게 정리된 로컬 미러로 캡처합니다:
   JS 렌더링이 끝난 최종 DOM, CSS-in-JS/shadow-DOM 스타일 보존, 모든 에셋 로컬화, 모든
   요소에 안정적인 `data-dl-id` 부여.
2. **Reverse-design** — 시니어 디자이너처럼 클론을 읽어내어 `DESIGN.md`
   (모든 결정이 왜 내려졌는지) + `VARIATIONS.md`(원칙을 유지하는 새로운 방향들)를 만들어냅니다.
3. **Customize** — 대화만으로 로고 교체, 내비게이션 문구 수정, 히어로 이미지 교체,
   색상과 크기 변경 — 에이전트가 `data-dl-id`를 기준점 삼아 클론을 직접 수정합니다.

## 설치

| 에이전트 | 권장 채널 | 런타임 프로비저닝 |
| --- | --- | --- |
| Claude Code | 플러그인(아래) 또는 `npx skills` | 자동 (SessionStart 훅) |
| Codex CLI | 플러그인(아래) 또는 `npx skills` | `/hooks`로 훅을 신뢰하거나, 아래의 대체 방법 사용 |
| Cursor | `npx skills add mojomoth/design-lens -a cursor` | 최초 사용 시 `npx -y design-lens setup` |
| OpenCode | `npx skills add mojomoth/design-lens -a opencode` | 최초 사용 시 `npx -y design-lens setup` |

### 채널 1 — 플러그인 (Claude Code / Codex)

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

첫 세션에서 `SessionStart` 훅이 `~/.design-lens/`(CLI, 고정 버전 Playwright,
Chromium)를 프로비저닝합니다. **Codex에서는 먼저 `/hooks`로 플러그인 훅을 신뢰하거나,
`bash <plugin-cache-dir>/scripts/bootstrap.sh`를 한 번 직접 실행해야 합니다** —
[`plugin/README.md`](./plugin/README.md)를 참고하세요.

### 채널 2 — `npx skills` (skills를 지원하는 모든 에이전트)

```bash
npx skills add mojomoth/design-lens          # 설치된 에이전트를 자동 감지
npx skills add mojomoth/design-lens -a cursor -a opencode   # 또는 특정 에이전트를 지정
```

이 방식으로 설치된 에이전트에는 프로비저닝 훅이 없습니다. 스킬이 최초 사용 시
`npx -y design-lens setup`을 실행해 스스로 복구합니다(또는 직접 한 번 실행해도 됩니다).

### 채널 3 — npm을 통한 순수 CLI

```bash
npx design-lens setup                        # 최초 1회: ~/.design-lens, Playwright, Chromium
npx design-lens clone https://example.com    # 또는 플러그인 없이 CLI를 직접 사용
```

**LLM 에이전트용** — 아래 문장을 에이전트에 붙여넣으세요:

> Install design-lens by following https://raw.githubusercontent.com/mojomoth/design-lens/main/INSTALL.md

개발 루프(설치 불필요): `claude --plugin-dir ./plugin`. `marketplace add`에서
`mojomoth/design-lens` 대신 로컬 절대 경로를 사용할 수도 있습니다.

스킬 (Claude: `/design-lens:<name>`, Codex: `$<name>`): `clone-reference`, `reverse-design`,
`inspect-elements`, `customize-clone`, `build-from-design`.

> clone 기능은 **비공개 디자인 연구와 파생 작업**을 위한 것입니다. 모든 클론에는
> 라이선스 고지와 출시 전 브랜드 체크리스트가 함께 제공됩니다: 파생물을 출시하기 전에
> 로고를 교체하고, 카피를 다시 쓰고, 사진과 폰트는 라이선스를 확보하거나 교체하세요.
> 클론은 절대 배포하거나 재배포해서는 안 됩니다 —
> [Fair use & respect for designers](./plugin/README.md#fair-use--respect-for-designers)를 참고하세요.

## 저장소 구조

```
plugin/        the plugin itself (built autonomously — see below)
.agentdocs/    specs, architecture, acceptance criteria, ADRs, implementation plan
.harness/      the Ralph-loop autonomous development harness (sealed)
```

## 자율 개발 (하네스)

이 플러그인은 Ralph 루프에 의해 원샷으로 만들어집니다 — 반복마다 새로운 에이전트 컨텍스트,
모든 기억은 디스크에, 봉인된 프로그램적 검증 게이트. 실행 방법:

```bash
./.harness/bootstrap.sh     # 최초 1회: git init, Chromium, 픽스처 자체 테스트, 무결성 봉인
./.harness/ralph.sh plan    # 계획 루프: 3-critic 토론 → IMPLEMENTATION_PLAN.md
# 권장 휴먼 체크포인트: .agentdocs/IMPLEMENTATION_PLAN.md를 훑어보세요
./.harness/ralph.sh build   # 빌드 루프: strict 게이트가 초록이 될 때까지 반복마다 태스크 하나씩
```

다른 터미널에서 모니터링:

```bash
./.harness/ralph.sh status                     # 현재 태스크 / 반복 횟수 / 비용
tail -f .harness/logs/current/*.stderr         # 실시간 에이전트 출력
cat .harness/status/verify-feedback.md         # 게이트가 다음 반복에 고치라고 알려준 내용
touch .harness/STOP                            # 정상 종료; 재개는: ralph.sh resume
```

예산과 모델은 `.harness/config.env`에서 조정할 수 있습니다. 루프는 에이전트의 완료 선언과
독립적인 봉인 게이트(`.harness/verify.sh --strict`)가 모두 통과할 때에만 종료됩니다.

## 라이선스

MIT. 번들 및 런타임 서드파티 의존성은
[`plugin/NOTICE.md`](./plugin/NOTICE.md)에 나열되어 있습니다. `clone`으로 캡처된 콘텐츠는
이 라이선스의 적용 대상이 아니며, 원 소유자의 재산으로 남습니다.
