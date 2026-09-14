# Design Lens 0.2.0 사용 가이드

레퍼런스의 타이포그래피·여백·위계와 같은 원리를 분석해 **내 제품의 목적과 콘텐츠에 맞는 화면을 제작**할 때 사용합니다. 새 화면이 필요하면 `build-from-design`으로 시작하세요. 필요한 캡처와 역설계부터 구현, 화면·동작 검증까지 이어집니다.

아래 주소·제품명·경로는 사용법을 보여 주는 예시입니다. 실제 레퍼런스와 프로젝트 정보로 바꿔 사용하세요. 예시에 대한 캡처나 제작 결과를 뜻하지 않습니다.

## 1. 설치와 버전 확인

터미널에서 `node --version`으로 Node.js 20 이상인지 확인하세요. 에이전트가 작업할 **프로젝트 폴더**를 열고 다음 중 한 채널로 설치합니다.

### Claude Code

```bash
claude plugin marketplace add mojomoth/design-lens
claude plugin install design-lens@design-lens
```

새 세션을 시작하면 훅이 공용 CLI와 Playwright, Chromium을 준비합니다. 처음에는 브라우저 다운로드 시간이 필요합니다.

### Codex CLI

```bash
codex plugin marketplace add https://github.com/mojomoth/design-lens
codex plugin add design-lens@design-lens
```

Codex의 `/hooks`에서 Design Lens 훅을 신뢰한 뒤 새 세션을 시작하세요. 훅을 사용하지 않는 경우 아래 명령으로 런타임을 직접 준비할 수 있습니다.

```bash
npx -y design-lens@0.2.0 setup
```

### Cursor, OpenCode 등

사용하는 에이전트에 맞는 명령 하나를 실행합니다.

```bash
npx skills add mojomoth/design-lens -a cursor
```

```bash
npx skills add mojomoth/design-lens -a opencode
```

이 채널에는 프로비저닝 훅이 없으므로 다음 명령도 한 번 실행하세요.

```bash
npx -y design-lens@0.2.0 setup
```

어느 채널이든 마지막으로 확인합니다.

```bash
~/.design-lens/bin/design-lens --version
```

이 가이드에 해당하는 CLI 버전은 `0.2.0`입니다. CLI만 필요하면 스킬 설치 없이 `setup`부터 실행해도 됩니다. 다만 `DESIGN.md`, `VARIATIONS.md`, 새 페이지의 코드는 **에이전트 스킬이 작성**합니다. CLI 명령만 실행해서 이 문서나 앱이 자동 생성되지는 않습니다.

GitHub 릴리스에 첨부된 0.2.0 패키지로 런타임을 준비하는 방법도 있습니다. npm 레지스트리에 해당 버전이 아직 없거나 배포 파일을 직접 지정하고 싶을 때 사용합니다.

```bash
npx -y --package=https://github.com/mojomoth/design-lens/releases/download/v0.2.0/design-lens-0.2.0.tgz design-lens setup
~/.design-lens/bin/design-lens --version
```

### 기존 설치 업데이트

Claude Code에서는 마켓플레이스와 플러그인을 갱신한 뒤 세션을 다시 시작합니다.

```bash
claude plugin marketplace update design-lens
claude plugin update design-lens@design-lens
```

Codex에서는 마켓플레이스 정보를 갱신하고 플러그인을 설치 대상으로 지정합니다.

```bash
codex plugin marketplace upgrade design-lens
codex plugin add design-lens@design-lens
```

`codex plugin list`에서 설치 상태와 제공되는 버전 정보를 확인하고 새 세션에서 사용하세요. 기존 설치가 새 버전으로 교체됐는지도 확인해야 합니다. 호스트 버전에 따라 관리 기능이 다르면 `codex plugin --help`를 확인하세요. `npx skills`로 설치했다면 위의 해당 에이전트 설치 명령으로 최신 저장소의 스킬을 다시 설치합니다.

런타임 버전도 확인하고 필요하면 `npx -y design-lens@0.2.0 setup`을 다시 실행하세요. **스킬 파일 갱신과 공용 CLI 갱신은 별개**입니다. CLI 버전만 바꿔도 이전에 설치한 스킬 본문이 자동 교체되지는 않습니다.

## 2. 스킬을 부르는 방법

다음 호출은 **터미널 명령이 아니라 에이전트 대화창에 입력하는 내용**입니다.

| 작업 | 스킬 | Claude Code 호출 | Codex 호출 |
| --- | --- | --- | --- |
| 내 제품의 새 화면 제작 | `build-from-design` | `/design-lens:build-from-design` | `$build-from-design` |
| 레퍼런스 한 페이지 캡처 | `clone-reference` | `/design-lens:clone-reference` | `$clone-reference` |
| 디자인 분석과 변형 방향 작성 | `reverse-design` | `/design-lens:reverse-design` | `$reverse-design` |
| 요소·컨테이너·모바일 측정 | `inspect-elements` | `/design-lens:inspect-elements` | `$inspect-elements` |
| 학습용 클론의 문구·스타일 수정 | `customize-clone` | `/design-lens:customize-clone` | `$customize-clone` |

스킬 자체에는 정해진 위치 인수나 CLI 옵션이 없습니다. **스킬을 선택하고 자연어로 요청**하세요. URL, 프로젝트 경로, 색상, 화면 크기는 대화의 맥락으로 전달합니다. 이전 대화에서 레퍼런스와 목적을 이미 정했다면 다시 적지 않아도 됩니다. Cursor·OpenCode에서는 해당 에이전트의 스킬 선택 기능을 사용하거나 스킬 이름과 요청을 자연어로 적습니다.

아래 예시는 Codex 형식입니다. Claude Code에서는 첫 줄만 표의 호출로 바꾸세요.

## 3. 새 제품 소개 페이지 만들기

```text
$build-from-design
https://example.com의 글자 위계와 넓은 여백을 참고해
우리 제품 '온보드 노트'의 소개 페이지를 만들어줘.

대상은 신규 구성원 온보딩을 담당하는 팀 리더야.
핵심 기능은 체크리스트, 담당자 지정, 진행 상황 확인이야.
주요 행동은 '체험 화면 보기'이고, 클릭하면 페이지 안의 데모로 이동하게 해줘.
데모에서는 체크 항목을 완료하고 진행률이 바뀌는 것을 볼 수 있어야 해.
가격과 고객 사례는 아직 없으니 만들지 말아줘.

이 폴더는 빈 프로젝트라 HTML/CSS와 필요한 JavaScript로 구현해줘.
레퍼런스 원본 이미지와 문구는 쓰지 말고 우리 제품에 맞게 작성해줘.
방향을 따로 고르지 않았으니 추천안을 적용하고,
데스크톱·태블릿·모바일 화면과 CTA·키보드 동작까지 확인해줘.
```

에이전트는 프로젝트와 요청을 읽고, 레퍼런스를 캡처한 뒤 `DESIGN.md`와 `VARIATIONS.md`를 작성합니다. 선택한 방향과 구조 변경 이유를 기록하고 실제 페이지를 구현합니다. 단계마다 같은 승인을 다시 요구하지 않으며, 프로젝트나 대화에서 찾을 수 없는 필수 정보가 남을 때 질문합니다.

완료 후에는 적용한 원칙, 코드 위치와 실행 방법, 확인한 화면과 동작, 미확인 사항을 확인하세요. 실제 서비스가 연결되지 않은 데모 폼을 운영 중인 접수 기능으로 설명해서는 안 됩니다.

## 4. 같은 레퍼런스로 관리 화면 만들기

```text
$build-from-design
앞에서 분석한 레퍼런스로 이번에는 팀의 온보딩 관리 화면을 만들어줘.
소개 페이지의 섹션 순서보다 빠르게 업무를 찾고 처리하는 것이 중요해.

사용자는 여러 신규 구성원의 상태를 관리하는 운영 담당자야.
이름 검색, 담당자·진행 상태 필터, 상세 패널, 완료 처리가 필요해.
데모 데이터는 이름·입사일·담당자·상태를 가진 8개 항목을 작성해줘.
외부 API는 없고 변경은 현재 화면의 메모리에만 유지하면 돼.
검색 결과 없음, 긴 이름, 좁은 화면에서의 상세 패널도 확인해줘.
소개 페이지와 구조를 다르게 선택한 이유를 VARIATIONS.md에 기록해줘.
```

같은 색과 여백을 참고하더라도 정보 밀도, 탐색 방식, 표·카드·상세 패널의 조합은 제품의 작업에 따라 달라집니다. 원본 랜딩 페이지를 그대로 관리 화면으로 옮기도록 요구할 필요가 없습니다.

## 5. 기존 프로젝트에 적용하기

기존 저장소를 연 상태에서 작업 대상과 재사용할 자산을 알려 주세요. 아래 경로와 구성은 예시이며, 실제 존재하는 경로로 바꿉니다.

```text
$build-from-design
https://example.com을 참고해 이 저장소의 /projects 화면을 개선해줘.
기존 프레임워크와 라우팅, 컴포넌트, 디자인 토큰을 먼저 확인해줘.
현재 Button·Input·Dialog와 프로젝트 로고를 재사용해줘.
사용자 목적은 진행 중인 프로젝트를 찾아 상태를 업데이트하는 것이야.
데이터 조회와 저장은 기존 API를 사용하고 기존 동작을 유지해줘.
VARIATIONS.md에 기록된 B 방향을 적용하되,
정보 밀도와 모바일 구성은 이 작업에 맞게 조정해줘.
프로젝트의 관련 검사와 화면·동작 검증까지 수행해줘.
```

이미 `DESIGN.md`가 있다면 해당 파일 경로를 알려 주면 됩니다. 에이전트는 기존 결정을 활용하고, 측정 근거나 반응형 설명이 부족한 부분을 보완합니다. 사용자가 선택한 방향이 있으면 추천안보다 우선합니다.

## 6. 캡처·분석·수정만 요청하기

### 클론만 만들기

```text
$clone-reference
https://example.com을 'reference-study'라는 이름으로 클론만 해줘.
원본과 클론 화면을 확인하고 누락된 이미지·폰트·동작을 알려줘.
이번에는 분석 문서나 새 페이지는 만들지 마.
```

클론은 공개 페이지 한 장의 렌더링 상태를 저장합니다. 전체 사이트 수집이나 로그인 페이지 복구용이 아닙니다. 원본 JavaScript와 인라인 이벤트 처리가 제거되므로 메뉴·로그인·결제 등 원래 앱의 동작이 복원되지는 않습니다.

### 역설계 문서만 만들기

```text
$reverse-design
.design-lens/reference-study를 분석만 해줘.
관찰한 사실과 의도 추정, 새 디자인 제안을 구분해줘.
데스크톱과 모바일의 위계·여백·컴포넌트 구성을 설명하고,
우리 교육 서비스에 적용할 수 있는 방향 세 가지와 추천 이유를 작성해줘.
페이지 구현은 하지 마.
```

`DESIGN.md`에는 캡처 조건과 분석 한계, 기존 12개 분석 섹션, 재사용 원칙이 들어갑니다. 원칙은 **근거 → 가능한 이유 → 적용 조건 → 구현 방법 → 검증 기준**으로 정리합니다. `VARIATIONS.md`에는 기본 세 방향과 추천 이유를 기록합니다. 모바일 원본이나 실제 동작을 확보하지 못하면 확인 불가로 남깁니다.

### 측정하거나 학습용 클론 수정하기

```text
$inspect-elements
.design-lens/reference-study에서 제목과 그 부모 컨테이너를 측정해줘.
캡처 크기와 390×844에서 글자 크기·줄 높이·여백·배치가 어떻게 달라지는지 알려줘.
측정값과 실제 요소 ID를 함께 보여줘.
```

```text
$customize-clone
방금 측정한 학습용 클론의 제목을 '팀의 첫 주를 더 명확하게'로 바꿔줘.
CTA 색은 #245C47로 조정하고 모바일 줄바꿈을 확인해줘.
변경 전후 화면과 구조 검사를 확인해줘.
```

클론의 스타일 수정은 별도 `dl-overrides.css`에 쌓습니다. 캡처한 원본 자료는 보존합니다. 내 제품용으로 구조를 바꾸고 새 앱을 만드는 작업은 `build-from-design`을 사용하세요. 학습용 클론을 배포하는 대신, 사용자 콘텐츠와 자산으로 제작한 파생 작업을 배포합니다.

## 7. CLI를 직접 사용하는 예제

이 절은 **터미널에서 실행하는 명령**입니다. 작업할 프로젝트 폴더에서 시작하세요.

### 캡처하고 출력 경로 확인하기

```bash
~/.design-lens/bin/design-lens clone https://example.com --project reference-study --viewport 1440x900
```

진행 상황과 경고는 stderr, 최종 결과 JSON은 stdout으로 나옵니다. 결과의 `projectDir`을 다음 명령에 사용하세요. 동일 이름으로 다시 캡처하면 접미사가 붙을 수 있으므로 디렉터리 이름을 추측하지 마세요.

다음 예시 변수는 **반환된 실제 경로로 교체**합니다.

```bash
dl_project='.design-lens/reference-study'
~/.design-lens/bin/design-lens serve "$dl_project"
```

`serve`가 표시하는 `http://127.0.0.1:포트` 주소를 브라우저에서 열고 `Ctrl+C`로 서버를 종료합니다. 고정 포트가 필요하면 `--port 4173`을 추가하세요.

### 모바일·상세 스타일·특정 요소 측정하기

```bash
~/.design-lens/bin/design-lens inspect "$dl_project" --pretty
~/.design-lens/bin/design-lens inspect "$dl_project" --viewport 390x844 --details --pretty
~/.design-lens/bin/design-lens inspect "$dl_project" --viewport 1440x900 --kind hero-heading --details --pretty
```

첫 명령의 기본 크기는 1440×900이며 기존 `{elements, colors}` 구조를 반환합니다. `--details`는 요소별 계산 스타일과 부모·직접 자식 ID, 선택된 이미지 경로, 페이지의 루트 글자 크기·body·폰트 상태를 추가합니다. 단위는 브라우저가 실제 적용한 값을 기준으로 읽습니다.

반환된 `dlId` 또는 `details.parentDlId`를 사용해 특정 요소나 배치 컨테이너를 조회할 수 있습니다. 아래 `dl-17`은 예시이므로 실제 ID로 바꿉니다.

```bash
~/.design-lens/bin/design-lens inspect "$dl_project" --viewport 390x844 --id dl-17 --pretty
```

`--id`는 상세 모드를 자동 적용하고 숨겨진 요소도 반환합니다. 미분류 요소는 `role`과 `confidence`가 `null`일 수 있습니다. `--kind`와 동시에 쓸 수 없으며 Shadow DOM 내부 요소는 조회 대상에 포함되지 않습니다. 역할 목록에는 숨겨진 후보가 제외됩니다. `--viewport`는 `390x844`처럼 양의 정수 두 개를 영문 소문자 `x`로 연결합니다.

`inspect`는 프로젝트 파일을 바꾸거나 측정 파일을 저장하지 않습니다. 수정한 뒤에는 다시 실행하세요. `tokens`는 파일을 생성합니다.

```bash
~/.design-lens/bin/design-lens tokens "$dl_project"
```

`tokens.json`의 색상 횟수는 CSS 선언 등장 횟수입니다. 화면에서 차지하는 면적이나 중요도가 아닙니다. 정적 rem/em 환산에는 16px 가정이 있으므로 실제 값은 해당 화면 크기의 `inspect --details`로 확인하세요.

### 같은 조건의 스크린샷과 구조 검사

아래 파일 이름은 아직 존재하지 않을 때 사용하고, 반복 실행 시 숫자를 올려 이전 이미지를 보존하세요.

```bash
~/.design-lens/bin/design-lens screenshot "$dl_project" --width 390 --height 844 --dsf 1 --full-page --out "$dl_project/screenshots/guide-clone-mobile-1.png"
~/.design-lens/bin/design-lens screenshot --url https://example.com --width 390 --height 844 --dsf 1 --full-page --out "$dl_project/screenshots/guide-reference-mobile-1.png"
~/.design-lens/bin/design-lens verify "$dl_project"
```

`screenshot` 기본값은 화면 영역만, DSF 2입니다. 비교할 때는 위처럼 크기·DSF·전체 페이지 여부를 명시적으로 맞추세요. 새로 찍은 원본은 캡처 시점 이후의 관찰이므로 처음 저장한 원본과 상태가 달라질 수 있습니다.

새 앱의 화면은 개발 서버를 실행한 뒤 `screenshot --url http://127.0.0.1:실제포트/실제경로`로 캡처할 수 있습니다. 새 앱은 클론 형식이 아니므로 앱 품질 검사 용도로 `verify`를 적용하지 않습니다.

## 8. 결과 파일은 어디에 있나요?

```text
.design-lens/실제-프로젝트명/
├── clone/
│   ├── index.html                  캡처한 DOM과 요소 ID
│   └── assets/
│       ├── ...                     확보한 이미지·폰트·스타일
│       └── dl-overrides.css        학습용 클론의 스타일 수정
├── manifest.json                   출처·시점·화면 크기·리소스 기록
├── REPORT.md                       재현 차이·누락·경고
├── tokens.json                     tokens 실행 후 생성
├── DESIGN.md                       reverse-design 실행 후 생성
├── VARIATIONS.md                   방향·선택·구조 변경·검증 기록
└── screenshots/
    ├── original-viewport.png       원본의 첫 화면
    ├── original-full.png           원본 전체 페이지
    ├── clone-full.png              저장한 클론 전체 페이지
    └── ...                        별도 이름의 분석·수정·제작 검증 이미지
```

새 제품의 코드는 실제 프로젝트의 경로와 기술에 맞게 생성됩니다. 고정된 `app/` 폴더에 생성된다고 가정하지 말고 완료 보고의 구현 경로와 실행 명령을 확인하세요. 캡처 실패 시 일부 파일만 남을 수 있으므로 파일의 존재만으로 성공을 판단하지 않습니다.

## 9. 완료 결과를 확인하는 기준

| 확인 항목 | 확인 방법 |
| --- | --- |
| 디자인 근거 | 원본 관찰·클론 측정·추정·제안·확인 불가가 구분되어 있는지 읽기 |
| 제품 적합성 | `VARIATIONS.md`의 사용자 목적, 선택 방향, 구조 변경 이유 확인 |
| 반응형 화면 | 1440×900, 768×1024, 390×844 이미지를 직접 열어 위계·줄바꿈·여백·넘침 확인 |
| 실제 동작 | 탐색·CTA 결과, 키보드 포커스, 관련 입력·빈 결과·오류 상태를 조작하기 |
| 기존 프로젝트 회귀 | 해당 프로젝트의 관련 테스트·빌드 결과 확인 |
| 클론 형식 | `verify`의 종료 코드와 오류 확인 |

`verify` 통과는 출처 정보·요소 ID·에셋 경로·스크립트 제거 등 **클론의 형식 검사**가 통과했다는 뜻입니다. 시각적 유사도 점수나 앱의 기능 검증 결과가 아닙니다. 스크린샷 파일을 생성하는 것과 그 화면을 검토하는 것도 구분해야 합니다.

브라우저 조작 도구나 외부 서비스가 없는 경우에는 해당 동작을 미확인으로 보고합니다. 폰트·이미지 누락으로 측정값이 달라졌다면 그 한계도 결과에 남깁니다.

## 10. 자주 만나는 문제

| 상황 | 다음 확인 |
| --- | --- |
| `~/.design-lens/bin/design-lens`가 없음 | `npx -y design-lens@0.2.0 setup` 실행 후 `--version` 확인. Codex는 훅 신뢰 상태도 확인 |
| `--details` 또는 `--id`를 모름 | 공용 CLI 버전 확인 후 런타임 갱신. 에이전트의 스킬도 별도로 갱신 |
| 스킬이 목록에 안 보임 | 설치 채널과 대상 에이전트 확인 후 새 세션 시작. Claude는 `claude plugin list`, Codex는 `codex plugin list` 확인 |
| 결과 폴더를 못 찾음 | 마지막 `clone` 결과의 `projectDir` 확인. 같은 이름의 이전 캡처와 구분 |
| 모바일 메뉴가 클론에서 작동하지 않음 | 원본 JavaScript가 제거된 결과인지 확인. 원본 동작을 확인하지 못했다면 추정해서 복원됐다고 보고하지 않기 |
| `inspect --kind` 결과가 비어 있음 | 해당 크기에 보이는 역할 후보가 없는지 확인. 요소 ID를 알면 `--id`로 숨김 상태·컨테이너 측정 |
| ID 누락·중복 오류 | 현재 클론에서 실제 `data-dl-id` 확인. 캡처 ID를 수정·복제하지 않았는지 확인 |
| 폰트 경고와 줄바꿈 차이 | `page.fonts`의 상태·실패 폰트와 REPORT 확인. 대체 글꼴로 측정했는지 확인 |
| 캡처가 느리거나 중간에 실패함 | stderr 오류와 REPORT, 부분 결과 확인. 필요에 따라 `clone --timeout 180` 등 전체 캡처 예산 조정 |
| 원본과 캡처 화면이 다름 | 화면 크기·DSF·스크롤 범위·관찰 시점, 누락 리소스와 상태 비교 |

폰트 준비 확인은 탐색 후 최대 5초를 기다립니다. 초기 폰트 응답 지연도 별도로 처리하지만, 이 값은 전체 명령이 5초 안에 끝난다는 뜻이 아닙니다. 이미지·스타일시트·리다이렉트·페이지 탐색에는 추가 시간이 필요할 수 있습니다.

더 자세한 옵션은 `~/.design-lens/bin/design-lens <명령> --help`와 [CLI 문서](../plugin/cli/README.md)를 확인하세요. 실제 두 제품 시나리오의 관찰 결과는 [평가 보고서](../plugin/cli/test/evaluations/RESULTS.md)에 있습니다.
