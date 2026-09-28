# Design Lens

[English](./README.md) · [简体中文](./README.zh-CN.md) · [正體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Français](./README.fr.md) · [Português](./README.pt.md) · [Español](./README.es.md) · [Română](./README.ro.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Italiano](./README.it.md) · [Tiếng Việt](./README.vi.md) · [Українська](./README.uk.md) · [Indonesian](./README.id.md) · [हिन्दी](./README.hi.md) · [فارسی](./README.fa.md) · [Беларуская](./README.be.md) · [বাংলা](./README.bn.md)

**좋은 레퍼런스에서 내 제품에 맞는 프론트엔드로.**

Design Lens는 **Claude Code**, **OpenAI Codex CLI**, **Cursor**, **OpenCode**에서 레퍼런스
페이지를 분석하고 그 디자인 원칙을 새로운 제품에 적용하도록 돕습니다. **0.3.0**에서는
실제 화면 측정부터 디자인 변형, 구현, 검증까지 연결합니다.

1. **클론·비교** — 1440×900, 768×1024, 390×844 원본을 독립적으로 캡처하고, 하나의
   편집 가능한 클론을 각 크기에서 오프라인 비교합니다. 에이전트가 최대 세 차례 차이를
   보정하며, 원본 자료 부족이나 남은 차이는 미확인·실패로 표시합니다.
2. **근거 수집** — 원본·클론 이미지, 실제 레이아웃·타이포그래피, 데스크톱·모바일 화면을
   확인합니다. 관찰한 사실, 추론, 제안, 확인하지 못한 내용을 구분합니다.
3. **역설계** — 확인된 패턴, 가능한 설계 의도, 컴포넌트 구성법과 재사용 원칙을
   `DESIGN.md`로 정리합니다.
4. **제품에 맞게 변형** — 기본 세 가지 방향을 `VARIATIONS.md`에 제안하고, 목표 제품,
   선택한 방향, 구조 변경, 검증 기준을 기록합니다.
5. **구현** — 기존 프로젝트의 기술과 컴포넌트, 사용자의 콘텐츠와 에셋으로 개발합니다.
   같은 레퍼런스라도 랜딩 페이지와 관리 화면은 다른 내비게이션·정보 밀도·구조를 가질 수 있습니다.
6. **검증** — 데스크톱·태블릿·모바일 화면을 직접 확인하고, 사용 가능한 브라우저 도구로
   필요한 조작을 시험해 문제를 수정합니다. 실행하지 못한 검사는 명확히 표시합니다.

학습용 클론의 문구·이미지·색상·크기를 수정하는 기능도 유지합니다. 새로운 제품에 필요한
구조 변경은 원본 클론을 보존하면서 별도 구현에 적용합니다.

## 사용 예시

처음 사용한다면 [설치·업데이트부터 실전 프롬프트와 CLI 예제까지의 한국어 가이드](./docs/USAGE.ko.md)를 참고하세요.

Claude Code:

```text
/design-lens:build-from-design
https://example.com을 참고해서 우리 제품의 분석 대시보드를 만들어줘. 현재 저장소의 기술을 사용하고 구현 후 검증까지 해줘.
```

Codex:

```text
$build-from-design
https://example.com을 참고해서 우리 제품의 분석 대시보드를 만들어줘. 현재 저장소의 기술을 사용하고 구현 후 검증까지 해줘.
```

개발을 요청하면 필요한 캡처·분석부터 방향 추천, 구현, 검증까지 이어갑니다. 대화와 저장소에서
확인할 수 있는 내용을 먼저 활용하고, 꼭 필요한 정보나 결과를 크게 바꾸는 선택이 남을 때만
질문합니다. 단계가 바뀔 때마다 같은 승인을 다시 요구하지 않습니다.

분석만 원하면 `reverse-design`에 “분석만 해줘”, 캡처만 원하면 `clone-reference`에
“클론만 해줘”라고 요청하세요. 요청한 범위에서 마치며, 배포는 명시적으로 요청해야 합니다.
[다섯 가지 스킬과 CLI 옵션](./plugin/README.md)도 확인할 수 있습니다.

## 원본 일치와 역설계 근거 확인

```bash
~/.design-lens/bin/design-lens clone https://example.com --viewports 1440x900,768x1024,390x844
~/.design-lens/bin/design-lens fidelity .design-lens/example-com --json
~/.design-lens/bin/design-lens inspect .design-lens/example-com --viewport 390x844 --all --details
~/.design-lens/bin/design-lens validate-design .design-lens/example-com --json
```

경로에는 `clone`이 반환한 실제 `projectDir`을 사용하세요. 클론 스킬의 기본값은 세 크기이며,
옵션 없는 CLI `clone`은 기존처럼 1440×900 한 크기만 캡처합니다. `--viewports`와 명시적인
`--viewport`는 함께 쓰지 않습니다. `--viewports`를 쓰면 확보한 각 크기의 전체 정적 DOM을
별도의 열린 Shadow DOM에 담아 하나의 편집용 클론을 만듭니다. CSS가 가장 가까운 캡처 너비를
선택하며, 중간값에서는 더 큰 너비를 택합니다. 너비가 같으면 높이에도 같은 규칙을 적용합니다.
이 선택 범위는 원본의 반응형 분기점을 복원한 것이 아닙니다. 정확한 비교는 기록된 너비·높이
조합에 한정되며, 그 사이 크기의 원본 일치를 보장하지 않습니다.

`fidelity`는 외부 요청을 차단한 클론의 픽셀·영역·위치·크기·필수 에셋을 원본과 비교합니다.
결과는 `pass`, `fail`, `unverified`이며 통과할 때만 종료 코드가 0입니다. `evidence.json`과
그 안에 등록된 원본 자료는 수정하지 않습니다. `fidelity.json`은 원본 근거와 현재 클론의
해시에 연결됩니다. 원본 근거가 없는 이전 클론은 미확인으로 남기고, 필요한 재캡처는 새
프로젝트에 저장합니다. CLI는 측정하고, 최대 세 차례의 실제 보정은 에이전트가 수행합니다.
사용자가 요청한 클론 수정은 원본과의 의도된 차이로 보고하며 자동으로 되돌리지 않습니다.
원본 파일이 온전해도 캡처가 불완전하면 진단용 이미지·측정값을 제공할 수 있지만 결과는
`unverified`로 남습니다. 클론을 고쳐도 누락되거나 변경된 원본 근거를 채울 수는 없습니다.

편집용 요소 ID는 클론 전체에서 고유하며, 원본 캡처와 요소 ID를 별도로 기록합니다.
수정할 화면 크기로 먼저 점검하세요. 공용 `clone/assets/dl-overrides.css`는 문서와 각 생성된
Shadow DOM에서 마지막에 불러옵니다. 점검한 요소 ID를 대상으로 규칙을 추가하고 변경 후
비교를 다시 실행하세요.
원본 루트·본문 스타일은 생성된 대리 요소 ID를 대상으로 수정하세요. 나중에 추가한
`html`, `body`, `:root` 규칙은 이 대리 요소를 선택하지 않습니다.

역설계에는 기존 12개 섹션과 세 가지 방향 외에 구현용 구성법과 실측 표가 포함됩니다.
`validate-design`은 참조·수치·단위·반올림을 읽기 전용으로 검증합니다. 디자인 의도의 타당성이나
구현 결과의 품질을 자동으로 보증하지는 않습니다. 토큰 스키마 2는 알파값과 해석 한계를
보존하며, 간격 체계의 근거가 없으면 `spacing.base`를 `null`로 반환합니다.

자세한 내용은 [0.3.0 준비 내역](./docs/releases/0.3.0.md)과 [CLI 문서](./plugin/cli/README.md)를 참고하세요.

## 설치

**0.3.0은 이 체크아웃에 준비된 버전이며 GitHub·npm에 공개됐다고 가정하지 않습니다.**
아래 원격 채널은 이미 공개된 내용을 설치합니다. 현재 체크아웃을 검증하려면 저장소 루트에서 실행하세요.

```bash
npm --prefix plugin/cli ci
npm --prefix plugin/cli run build
bash plugin/scripts/bootstrap.sh
~/.design-lens/bin/design-lens --version
```

로컬 버전은 `0.3.0`이어야 합니다. 공용 CLI 갱신만으로 이전에 설치된 스킬 본문이 바뀌지는
않습니다. 스킬도 검증하려면 이 체크아웃의 플러그인이나 로컬 마켓플레이스를 사용하세요.


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

개발 검증에는 CLI 회귀 테스트와 별도의
[두 제품 시나리오 평가](./plugin/cli/test/evaluations/README.md)가 포함됩니다. 같은 로컬
레퍼런스로 제품 소개 페이지와 관리 화면을 제작하고, 실제 화면·동작·근거와 한계를
기록합니다. 구조 검사인 `verify`를 디자인 품질 점수로 사용하지 않습니다.
[0.3.0 독립 평가](./plugin/cli/test/evaluations/0.3.0/RESULTS.md)에서는 반응형 Clone 보정과
설계도만 전달받은 별도 개발자의 구현을 검증했습니다. 원본 근거 보존과 실제 측정 비교
결과, 평가 범위의 한계를 함께 기록했습니다.

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
