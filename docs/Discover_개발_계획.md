# AISideQuest Discover 개발 계획

> AI가 작업하는 동안 개발자가 수익 기회, 개발 정보, 커뮤니티 주제를 안전하게 발견할 수 있도록 기존 베타 이후의 확장 작업을 정의한다.

- 작성일: 2026-07-21
- 상태: Task 21~29 완료, Discover MVP·저장·명시적 개인화·DEV·Stack Overflow 연동 완료
- 작업 번호: 21~33
- 다음 작업: 30. GitHub credential·탐색 범위 확정과 Issues 연동
- 1차 구현 범위: 21~26

---

## 1. 문제 이해

현재 AISideQuest는 Codex 작업 감지, 개발 퀴즈, 100P 포인트와 통계를 제공한다. 다음 확장에서는 사용자가 AI 작업 중 짧은 시간에 다음 가치를 얻도록 한다.

- 외부 채용·계약·바운티 등 수익 가능성이 있는 기회를 발견한다.
- 최신 개발 글과 커뮤니티 토론을 확인한다.
- 관심 있는 항목을 나중에 다시 볼 수 있도록 저장한다.
- 사용자가 직접 선택한 관심 기술을 기준으로 항목을 정렬한다.

AISideQuest는 수익을 보장하거나 직접 지급하지 않는다. 외부 기회를 정제해 보여주고 원문 서비스로 연결하는 역할만 담당한다.

### 1.1 포함 범위

- `/discover` 화면
- 수익 기회, 개발 소식, 커뮤니티 탭
- 외부 API를 호출하는 서버 Adapter
- 외부 데이터 정규화, 일반 텍스트 정제, 캐시와 장애 격리
- 사용자별 관심 항목 저장
- 사용자가 직접 선택한 기술 기반 정렬
- 외부 소스 상태를 확인할 수 있는 운영 지표

### 1.2 제외 범위

- AISideQuest 내부 결제와 현금 지급
- 구직 지원서 자동 제출
- 외부 사이트 계정이나 결제 정보 보관
- 자체 게시글·댓글 커뮤니티
- prompt, AI 응답, 코드, diff, 전체 경로, 원본 명령을 이용한 추천
- LLM을 이용한 외부 글 요약 또는 자동 추천
- 외부 항목 클릭만으로 AISideQuest 포인트 지급

---

## 2. 접근 방식

### 2.1 화면 구조

기존 Side Quest는 퀴즈 기능으로 유지하고 별도 `Discover` 메뉴를 추가한다.

| 탭 | 목적 | 최초 소스 |
|---|---|---|
| 수익 기회 | 채용·계약·프리랜스 기회 탐색 | Remotive, Hacker News Jobs |
| 개발 소식 | 인기 개발 글과 기술 사례 확인 | Hacker News Top·Show |
| 커뮤니티 | 질문과 토론 주제 확인 | Ask HN |
| 저장됨 | 사용자가 나중에 볼 항목 관리 | AISideQuest 서버(Task 27에서 추가) |

Discover 화면과 browser API는 기존 GitHub login을 요구하지만 활성 AI session은 요구하지 않는다. 활성 session이 있을 때만 대기 시간 활용 안내를 강조하며 조회 자체를 session 상태로 제한하지 않는다. Login은 기존 사용자 소유권 경계를 위한 것이며 외부 공고를 이용한 email·marketing 가입 유도에 사용하지 않는다.

### 2.2 가치와 보상 분류

| 분류 | 표시 조건 |
|---|---|
| 현금 바운티 | 외부 제공자가 통화, 금액, 활성 상태를 명시한 경우 |
| 채용·계약 기회 | 채용 또는 계약 가능성이 있는 공고이며 수익을 보장하지 않음 |
| 평판 보상 | Stack Overflow reputation처럼 현금이 아닌 외부 서비스 보상 |
| 오픈소스 기여 | GitHub `good first issue`, `help wanted` 등 포트폴리오 기회 |
| 개발 정보 | 글, 기술 소식, 사례 |
| 커뮤니티 | 질문, 토론, 답변 가능한 주제 |

GitHub label이나 제목에 `bounty`가 있다는 이유만으로 현금 보상으로 표시하지 않는다. 급여나 보상 금액이 없으면 추정하지 않는다.

### 2.3 데이터 흐름

```text
외부 API
  -> source별 고정 fetch host allowlist와 Adapter
  -> 응답 field 제한 및 일반 text 정제
  -> 공통 DiscoverItem 변환
  -> shared PostgreSQL TTL cache 및 stale fallback
  -> GET /api/v1/discover
  -> 표시 link의 HTTPS·제어문자 검증
  -> Discover 화면
```

외부 호출은 NestJS 서버에서만 수행한다. 브라우저에 API key를 노출하지 않으며 사용자가 입력한 임의 URL을 서버가 가져오게 하지 않는다.

### 2.4 외부 소스 우선순위

| 단계 | 소스 | 제공 가치 | 제약 |
|---:|---|---|---|
| 1 | [Hacker News API](https://github.com/HackerNews/API) | Top, Ask, Show, Jobs | 삭제 항목과 누락 필드 처리 필요 |
| 1 | [Remotive API](https://github.com/remotive-io/remote-jobs-api) | 원격 개발·계약·프리랜스 공고 | 출처·원문 링크 필수, 낮은 동기화 빈도 유지 |
| 2 | [Forem API](https://developers.forem.com/api/) | DEV 개발 글과 반응 정보 | API 버전을 Adapter 내부에 격리 |
| 2 | [Stack Exchange API](https://api.stackexchange.com/docs) | 질문, 미답변, reputation bounty | 현금이 아닌 평판 보상으로 표시 |
| 3 | [GitHub REST API](https://docs.github.com/en/rest) | 오픈소스 기여 이슈 | 별도 인증 방식과 rate limit 설계 필요 |
| 3 | [Algora Bounties API](https://api.docs.algora.io/bounties) | USD 현금 바운티 | 전역 공개 탐색 방법과 이용 조건 선확인 |

---

## 3. 개발 계획

### 3.1 1차 마일스톤: Discover MVP

#### 21. 문서 정합성 수정 및 Discover 제품 계약 확정

상태: 완료(2026-07-20)

작업:

- `PROJECT_SPEC.md`의 현재 구현 상태를 실제 코드·테스트와 일치시킨다.
- Discover 목적, 화면, 가치 분류, 개인정보 원칙, 제외 범위를 canonical 문서에 반영한다.
- 관련 한국어 사용자 문서와 AI 계약 문서의 연결을 갱신한다.
- 기존 Task 20 운영 파일럿과 Task 21 이후 제품 확장을 별도 트랙으로 유지한다.

완료 조건:

- 현재 구현과 문서 사이에 포인트·통계·인증 상태 불일치가 없다.
- 수익 가능성과 수익 보장을 구분한다.
- 외부 항목을 AISideQuest 포인트 지급 근거로 사용하지 않는다고 명시한다.
- 구현 전에 미결정 제품 규칙이 남지 않는다.

확정 결과:

- `/discover`와 browser API는 GitHub login을 요구하고 active AI session은 요구하지 않는다.
- AISideQuest는 외부 기회를 중계할 뿐 채용, 수익, 자격과 지급을 보장하지 않는다.
- AISideQuest point, source가 제공한 채용 급여, 검증된 cash bounty와 reputation bounty를 별도 개념으로 분류한다.
- 외부 item 조회·원문 이동·저장에는 AISideQuest point를 지급하지 않는다.
- Raw upstream payload와 HTML은 저장하지 않는다. Shared PostgreSQL cache에는 normalized item만 저장하고 초기 fresh·maximum stale은 Hacker News 10분·24시간, Remotive 6시간·72시간으로 한다. Cache row는 마지막 성공 refresh 후 최대 7일 안에 교체·삭제한다.
- Task 32 전에는 Discover 방문·click analytics를 수집하지 않는다. Pilot용 분석을 구현하면 item 정보 없이 fixed event·source·category만 저장하고 90일 expiry, export와 delete를 적용한다.
- Tasks 22~26 완료는 `Discover MVP 구현 완료`인 release candidate다. Real source smoke, attribution, 부분 장애, 접근성·mobile과 개인정보 gate를 통과해야 release로 판정한다.
- Discover 진행과 기존 Task 20의 external staging·production·pilot 완료는 별도 track이다.

Canonical contract는 [`ai/DISCOVER_CONTRACT.md`](./ai/DISCOVER_CONTRACT.md)를 따른다.

#### 22. Discover API와 공통 데이터 모델 설계

상태: 완료(2026-07-20)

작업:

- `DiscoverItem`, source, kind, reward 모델을 정의한다.
- `GET /api/v1/discover`, `GET /api/v1/discover/sources` 계약을 작성한다.
- 두 endpoint에 browser session 인증을 적용하고 active AI session은 요구하지 않는다.
- category, source, cursor 필터와 공통 오류 응답을 정의한다.
- 목록 응답에 source별 `FRESH`, `STALE`, `UNAVAILABLE` 상태와 nullable 성공 갱신 시각을 포함한다.
- 외부 서비스별 원본 DTO가 Controller와 프런트엔드에 노출되지 않도록 경계를 정한다.

완료 조건:

- 기존 `/api/v1` 응답 envelope, cursor, 입력 검증 규칙과 일치한다.
- 현금, 평판, 채용, 정보 분류가 명시적이다.
- source별 필드 누락을 `null`과 빈 배열로 안전하게 표현한다.

구현 결과:

- `server/src/discover/`에 source, category, kind, cash·reputation reward, job compensation, item, source status와 versioned cursor 계약을 추가했다.
- `GET /api/v1/discover`와 `GET /api/v1/discover/sources`는 browser session을 요구하고 active AI session은 요구하지 않는다.
- Category·source enum, limit 1~50과 cursor를 검증하며 기존 API envelope와 `Cache-Control: no-store`를 유지한다.
- Source adapter 전에는 item을 빈 배열로 반환하고 여섯 planned source를 `enabled: false`, `UNAVAILABLE`, `fetchedAt: null`로 명시한다.
- Client parser는 item ID·분류·reward·compensation 조합, ISO8601 시각, HTTPS URL, 중복 item·source와 freshness metadata를 신뢰하지 않고 다시 검증한다.
- 실제 source 호출, shared cache와 stale fallback은 Task 23으로 유지한다.

#### 23. 외부 소스 Adapter 기반 구현

작업:

- source Adapter interface와 공통 HTTP client를 구현한다.
- timeout, 제한된 재시도, TTL cache, stale fallback을 구현한다.
- Fetch는 source별 고정 HTTPS host만 허용하고 redirect를 차단하거나 매 hop 재검증한다.
- 화면 이동 URL은 server fetch 대상과 분리하고 HTTPS·parse·제어문자 검증을 통과시킨다.
- Normalized item만 shared PostgreSQL cache에 저장하고 동시 miss를 single-flight 또는 동등한 lock으로 합친다.
- 외부 HTML을 렌더링하지 않고 제목·요약을 일반 텍스트로 정제한다.

완료 조건:

- 한 source 장애가 다른 source와 기존 AISideQuest 기능을 막지 않는다.
- 요청이 무한 대기하거나 무한 재시도하지 않는다.
- 임의 host 호출과 악성 URL을 차단한다.
- 외부 응답 원문을 로그에 남기지 않는다.
- Maximum stale age를 넘긴 item은 반환하지 않고 cache row는 마지막 성공 refresh 후 7일 안에 교체·삭제한다.

구현 결과:

- `DiscoverSourceAdapter` interface로 source metadata, fresh TTL, maximum stale와 정규화 item fetch 책임을 고정했다.
- 공통 HTTP client는 exact HTTPS host allowlist, credential·비표준 port·redirect 차단, timeout, 최대 3회 시도와 1 MiB 기본 JSON body 상한을 적용한다.
- HTML·제어문자를 제거한 bounded plain text, HTTPS display URL, category·kind·reward·compensation 조합을 cache write 전에 검증한다.
- `discover_source_cache`에는 normalized item과 마지막 성공 갱신 시각만 저장하며 5 MiB DB 제약과 최대 7일 정리를 적용한다.
- 같은 process의 single-flight와 source별 PostgreSQL advisory lock으로 동시 miss를 합치고, lock을 얻지 못한 instance는 stale 또는 unavailable로 안전하게 응답한다.
- Source별 fresh·stale·miss와 fetch 결과는 fixed low-cardinality metric만 남긴다. Raw body, HTML, URL과 item·user 식별자는 로그와 metric label에 남기지 않는다.
- Task 23 완료 시점에는 concrete source를 등록하지 않았다. 이후 Hacker News는 Task 24에서, Remotive는 Task 25에서 활성화했다.

#### 24. Hacker News 커뮤니티 연동

작업:

- Top, Ask, Show, Jobs 목록과 item 상세를 가져온다.
- 삭제 항목, 중복 ID, 누락된 title·URL을 처리한다.
- Top·Show는 개발 소식, Ask는 커뮤니티, Jobs는 수익 기회로 분류한다.

완료 조건:

- 게시 시각과 원문 링크가 정상 표시된다.
- 삭제되거나 불완전한 item 때문에 전체 목록이 실패하지 않는다.
- source 장애 시 stale cache 또는 명확한 부분 장애 상태를 반환한다.

구현 결과:

- 공식 `hacker-news.firebaseio.com/v0`의 Top·Ask·Show·Jobs 목록과 item 상세를 exact HTTPS host allowlist로 연동했다.
- Feed별 최대 12개, item 동시 요청 최대 8개, 갱신당 logical request 최대 52개로 호출량을 제한했다. Fresh TTL은 10분, maximum stale은 24시간이다.
- 중복 ID는 `Jobs > Ask > Show > Top` 순으로 한 번만 분류하고 Jobs는 `EARNING/PAID_JOB`, Ask는 `COMMUNITY/DISCUSSION`, Top·Show는 `NEWS/ARTICLE`로 변환한다.
- Null·삭제·dead·type/ID 불일치·title/time 누락 item은 개별 제외한다. HTML title·text는 bounded plain text로 정제한다.
- 외부 URL이 없거나 HTTPS 검증에 실패하면 `news.ycombinator.com/item?id=...` 원문 토론 link로 대체하며 salary·reward는 추정하지 않는다.
- Item 상세 실패가 25%를 넘으면 refresh 전체를 실패시켜 기존 stale cache를 보존하고, 그 이하는 정상 item만 부분 반영한다.
- 2026-07-21 [live smoke](./ai/operations/2026-07-21-hacker-news-smoke.md)에서 47개를 정규화했고 `EARNING 12`, `NEWS 23`, `COMMUNITY 12`, attribution·HTTPS link 검증을 통과했다.

#### 25. Remotive 수익 기회 연동

작업:

- Software Development 중심의 원격 공고를 가져온다.
- 계약직, 프리랜스, 정규직, 지역과 급여 제공 여부를 구분한다.
- Remotive 출처와 원문 링크를 항상 표시한다.
- 공개 API 권고에 맞춰 fresh TTL 6시간과 maximum stale 72시간을 기본값으로 사용한다.

완료 조건:

- HTML 공고 설명을 그대로 저장하거나 렌더링하지 않는다.
- 급여가 없는 공고의 금액을 추정하지 않는다.
- 채용 기회를 확정 수익으로 표현하지 않는다.
- attribution과 호출량 조건을 지킨다.

구현 결과:

- `https://remotive.com/api/remote-jobs?category=software-dev&limit=30`만 호출하며 shared fresh TTL 6시간과 maximum stale 72시간을 적용했다.
- Shared cache의 fresh 기간마다 실제 HTTP 요청을 한 번만 보내고 재시도하지 않아 Remotive 권고인 하루 최대 4회를 지킨다. 실패 시에는 maximum stale 안의 마지막 성공 cache를 사용한다.
- Positive ID, Software Development category, title, publication time과 직접 Remotive HTTPS URL을 검증하고 중복 ID는 첫 공고만 유지한다.
- 모든 공고는 `EARNING/PAID_JOB`, attribution `Remotive`, reward `null`로 분류한다. 고용 형태는 full-time·contract·freelance·part-time·internship 고정 tag로만 구분한다.
- Company·지원 가능 지역·HTML description은 bounded plain-text summary로 정제하고, salary가 실제 제공된 경우에만 compensation text로 보존한다. Description 속 금액은 salary로 추정하지 않는다.
- 전체가 invalid이거나 invalid 공고가 3개 이상이면서 25%를 넘으면 refresh를 실패시켜 stale cache를 보존한다.
- 2026-07-21 [live smoke](./ai/operations/2026-07-21-remotive-smoke.md)에서 공고 10개, 급여 제공 9개, full-time 8개, contract 2개와 attribution·Remotive HTTPS URL을 확인했다.

#### 26. Discover 화면 구현

작업:

- `/discover` route와 주요 navigation 항목을 추가한다.
- 수익 기회, 개발 소식, 커뮤니티 탭과 공통 카드를 구현한다.
- source, 유형, tag, 게시 시각, 보상 정보, 원문 링크, 마지막 갱신 시각을 표시한다.
- loading, empty, partial error, total error 상태를 구현한다.

완료 조건:

- 데스크톱과 모바일에서 기존 navigation을 포함해 정상 동작한다.
- 원문 링크에 `noopener`와 `noreferrer`를 적용한다.
- 외부 이동임을 사용자에게 명확히 알린다.
- GitHub login을 요구하고 login을 email·marketing 가입 유도에 사용하지 않는다.
- 활성 AI session 유무와 관계없이 조회할 수 있다.

구현 결과:

- `/discover` route를 desktop·mobile 주요 navigation에 추가하고 수익 기회·개발 소식·커뮤니티 탭을 category API와 연결했다.
- Card는 source·유형·tag·게시일, source-provided compensation 또는 검증된 reward와 외부 원문 동작을 표시한다. 원문은 새 browsing context에서 `noopener noreferrer`로 연다.
- 초기 loading, login 대기, 정상 empty, request error, enabled source 전체 unavailable, 부분 unavailable, stale, 더 보기 loading·error를 구분한다. 더 보기 실패 시 기존 항목을 유지한다.
- Disabled future source는 장애로 표시하지 않고 enabled source의 safe status만 사용자에게 설명한다. 원문 오류, host와 내부 retry 정보는 표시하지 않는다.
- Tab은 tablist·tab·tabpanel 관계와 좌우·Home·End keyboard 이동을 지원한다. Card grid와 5개 항목 mobile navigation은 320px 이상에서 한 열 기반으로 동작하고 큰 화면에서는 두 열로 확장한다.
- 화면은 visit·tab·outbound click analytics를 추가하지 않으며 active AI session 없이도 authenticated browser session만으로 조회한다.
- React 화면·route test 6개로 category 전환, 외부 link 속성, healthy empty, request error, stale·부분·전체 장애, total retry와 pagination 실패 복구를 검증했다.
- 2026-07-21 [local UI smoke](./ai/operations/2026-07-21-discover-ui-smoke.md)에서 1280×720·375×812 navigation 전환, 가로 overflow 없음과 keyboard tab 이동을 확인했다. Authenticated 실제 card browser smoke와 전체 접근성 audit은 release gate로 남긴다.

Task 26까지 완료하면 Discover MVP 구현 범위가 완성되어 release candidate가 된다. 실제 release 판정에는 real Hacker News·Remotive smoke, source attribution·호출량, desktop·mobile·접근성, 부분·전체 장애와 개인정보 gate 증거가 추가로 필요하다.

### 3.2 2차 마일스톤: 저장과 명시적 개인화

#### 27. 관심 항목 저장

상태: 완료 (2026-07-21)

작업:

- 사용자별 저장 table과 소유권 제약을 추가한다.
- 저장 목록 조회, 저장, 삭제 API를 구현한다.
- CSRF, idempotency, cursor를 기존 mutation 규칙에 맞춘다.
- 계정 내보내기와 삭제 대상에 포함한다.

완료 조건:

- 다른 사용자의 저장 항목을 조회·삭제할 수 없다.
- 중복 저장과 반복 삭제가 안전하다.
- 외부 source 장애 중에도 저장 목록을 조회할 수 있다.

구현 결과:

- Browser는 item 전체가 아니라 `itemId`만 보내며, server가 normalized source cache에서 다시 검증한 snapshot을 저장한다.
- `(user_id, source_item_id)` unique 제약, UUID idempotency key와 ownership SQL로 중복 저장·재전송·타 사용자 삭제를 안전하게 처리한다.
- `GET /discover/saved-items`는 source cache와 독립된 cursor 목록을 제공하고 `/discover`는 탐색·저장한 항목 보기를 제공한다.
- 저장 snapshot은 현재 사용자 data export schema version 3와 account delete transaction에 포함된다.

#### 28. 명시적 관심 기술 설정과 정렬

상태: 완료 (2026-07-21)

작업:

- 사용자가 관심 기술을 직접 선택·수정하게 한다.
- 관심 tag 일치, 최신성, 외부 반응도, 보상 정보 명확성을 이용한 결정적 정렬 규칙을 구현한다.
- 추천 이유를 화면에 표시한다.

완료 조건:

- 관심사가 없으면 기본 최신순으로 동작한다.
- prompt, 코드, 전체 경로, 원본 명령을 입력으로 사용하지 않는다.
- 동일 입력은 동일한 정렬 결과를 만든다.

구현 결과:

- 사용자는 20개 고정 allowlist에서 최대 10개 기술을 직접 선택하며, `PUT /discover/interests`가 CSRF와 UUID idempotency key로 전체 set을 교체한다. 빈 선택은 row를 삭제한다.
- 관심사가 없으면 `(publishedAt ?? fetchedAt) DESC, source ASC, id ASC`를 그대로 유지한다. 관심사가 있으면 tag 일치 수, newest item 기준 1·7·30일 최신성 band, source 제공 반응도, 명확한 reward·salary, 기존 시간순으로 정렬한다.
- Hacker News score는 source engagement로 사용하고 Remotive는 현재 `null`이다. 정제한 외부 title·summary의 고정 keyword는 canonical 기술 tag만 추가하며 LLM을 사용하지 않는다.
- 화면은 관심 기술 일치·최신 항목·외부 반응 정보·보상 또는 급여 명확성만 추천 이유로 표시한다. 관심사가 바뀌면 기존 cursor는 `400 INVALID_CURSOR`로 거부한다.
- 관심 기술은 export schema version 3과 account delete transaction에 포함하고 운영 log·metric·analytics에서 제외한다. Prompt, AI response, code, diff, transcript, 명령, tool input/output와 local path는 저장·정렬 입력이 아니다.

### 3.3 3차 마일스톤: 소스 확장

#### 29. DEV와 Stack Overflow 연동

Task 29는 번호를 유지하되 source 계약과 검증을 `29A DEV`, `29B Stack Overflow`로 나눈다. 두 source는 공통 shared cache를 갱신할 때만 외부 API를 호출하며, 사용자 관심 기술별 요청을 만들지 않는다. 관심 기술은 정규화된 item의 태그를 기존 Task 28 정렬에 사용하는 입력일 뿐이다.

##### 29A. DEV

상태: 완료(2026-07-21)

작업:

- API host는 `dev.to`로 고정하고 public `GET /api/articles?per_page=30`의 첫 page만 호출한다.
- Forem V1을 선택하는 `Accept: application/vnd.forem.api-v1+json`과 고정 User-Agent를 보낸다. Public article 목록에는 API key를 요구하지 않고 브라우저에 credential을 노출하지 않는다.
- Refresh당 최대 1 page·1 request·30 article, timeout 5초·source retry 0회·JSON body 1 MiB 상한을 적용한다.
- Fresh TTL은 30분, maximum stale age는 24시간으로 하고, shared lock으로 정상 경로를 최대 하루 48회의 공유 refresh로 제한한다.
- 양의 정수 ID, 일반 text 제목, DEV HTTPS article URL, RFC 3339 게시 시각이 있는 article만 `NEWS/ARTICLE`로 정규화한다.
- Description과 tag는 bounded plain text로 정제하고, `reading_time_minutes`는 nullable 양의 정수, `positive_reactions_count`는 nullable `REACTIONS` engagement로 보존한다. HTML·Markdown body와 raw response는 저장하지 않는다.
- Attribution은 `DEV Community`, 표시 link는 source가 반환한 `https://dev.to/...` URL로 고정한다.

완료 조건:

- 정상 빈 배열은 healthy empty로 cache한다.
- 중복 ID는 첫 article만 남기고 고립된 invalid article은 건너뛴다.
- 빈 배열이 아닌데 유효 item이 0개이거나 invalid article이 3개 이상이면서 25%를 넘으면 refresh를 실패시켜 기존 stale cache를 보존한다.
- V1 Accept header, 호출 상한, cache/stale, 읽기 시간·반응 수, URL·text 정제와 전체 장애 격리를 단위 테스트로 검증한다.

구현 결과:

- `DevAdapter`를 등록해 public Forem V1 article 30개를 하나의 bounded request로 읽고 `DEV Community` source를 `NEWS`에서 활성화했다.
- 공통 HTTP client에 제어문자·과대 길이를 거부하는 명시적 `Accept` 경계를 추가했고 DEV adapter만 Forem V1 media type을 사용한다.
- 공통 item에 nullable `readingTimeMinutes`를 추가해 서버 cache·saved snapshot·client parser와 화면을 일치시켰다. 기존 source와 기존 snapshot은 `null`로 정규화된다.
- DEV tag와 정제한 제목·설명에서 고정 관심 기술만 추출하며, 사용자 관심 기술은 외부 요청에 포함하지 않는다.
- DEV adapter 4개와 Accept header 보안 1개 테스트를 추가하고 기존 Discover 회귀 테스트와 client 읽기 시간 파싱·표시 검증을 갱신했다.
- 2026-07-21 [live smoke](./ai/operations/2026-07-21-dev-smoke.md)에서 정규화 article 30개, DEV HTTPS link·읽기 시간·반응 수 30개와 attribution 전체 통과를 raw item 정보 출력 없이 확인했다.

##### 29B. Stack Overflow

상태: 완료(2026-07-21)

작업:

- API host는 `api.stackexchange.com`으로 고정하고 Stack Exchange API v2.3의 Stack Overflow `questions/featured`와 `questions/unanswered`를 source-wide 고정 요청으로 조회한다.
- Refresh당 최대 2 method·각 1 page·page size 30으로 제한하고, `has_more`를 파싱하되 초기 범위에서 추가 page를 자동 호출하지 않는다.
- Fresh TTL은 15분, maximum stale age는 24시간으로 하고, 의미상 동일한 method 요청을 1분보다 자주 보내지 않는다.
- 정상 HTTP 응답에서도 wrapper의 `backoff`, `quota_remaining`, `has_more`를 파싱한다. `backoff`가 있으면 동일 method의 다음 호출 가능 시각을 shared source state로 준수하고, quota가 소진되면 stale 또는 unavailable로 전환한다.
- Active bounty는 `REPUTATION_BOUNTY`, 미답변 질문은 `DISCUSSION`으로만 표시하고 현금·급여·AISideQuest point로 설명하지 않는다.
- 사용자 관심 태그를 Stack Exchange 요청 query로 보내지 않고 source가 제공한 tag를 정규화한 뒤 기존 정렬에서만 사용한다.

완료 조건:

- `backoff`와 1분 동일-request 제한이 다중 API instance에서도 깨지지 않는다.
- Bounty는 `평판 보상`으로 표시하고 외부 HTML·Markdown을 그대로 렌더링하지 않는다.
- 정상 empty, 부분 invalid, wrapper error, timeout·quota·backoff와 source 장애 격리를 검증한다.

구현 결과:

- `StackOverflowAdapter`를 등록해 Stack Exchange API v2.3의 featured·unanswered 고정 요청을 각각 최대 1 page·30개로 읽고 `Stack Overflow` source를 `COMMUNITY`에서 활성화했다.
- `StackExchangeRequestGate`가 두 method의 의미상 동일한 요청을 최소 1분 간격으로 예약하고 wrapper `backoff`를 method별로 연장한다. `quota_remaining`이 0이면 현재 refresh를 `RATE_LIMITED`로 실패시키고 UTC 다음 날까지 새 source 요청을 차단하며, cache service가 기존 24시간 이내 stale snapshot으로 전환한다.
- `has_more`는 boolean으로 검증하지만 추가 page는 호출하지 않는다. HTTP client retry도 0회로 고정해 내부 재시도가 1분 계약을 우회하지 못한다.
- Featured question의 양의 `bounty_amount`만 `REPUTATION_BOUNTY`로 저장한다. 미답변 질문은 `DISCUSSION`이며 compensation·현금·AISideQuest point를 만들지 않는다.
- Title은 bounded plain text로 정제하고 owner·body·HTML·Markdown·raw wrapper는 저장하거나 로그로 남기지 않는다. 원문은 question ID와 일치하는 `https://stackoverflow.com/questions/...`만 허용한다.
- Request gate 2개와 adapter 4개 단위 테스트에서 정상·empty·부분 invalid·전체 invalid·중복·`has_more` 상한·quota·backoff·1분 간격을 검증했다.
- 2026-07-21 [live smoke](./ai/operations/2026-07-21-stack-overflow-smoke.md)는 raw question 정보를 출력하지 않고 반환 수, 평판 bounty·discussion 분류, attribution과 HTTPS link만 집계한다.

#### 30. GitHub 오픈소스 기회 연동

작업:

- API host는 `api.github.com`으로 고정하고 Search Issues endpoint의 고정 query로 `good first issue`, `help wanted`, `documentation` issue를 탐색한다.
- 기존 로그인 과정에서 폐기하는 GitHub OAuth access token을 재사용하지 않는다.
- 별도 GitHub App 또는 서버 전용 credential 정책을 먼저 확정한다.
- Refresh당 최대 1 page·30 item을 기본으로 하고 fresh TTL 30분·maximum stale 24시간을 credential·rate-limit 조사 결과와 함께 확정한 뒤 adapter를 등록한다.
- Query에 `is:issue is:open no:assignee`를 포함하고 응답에 `pull_request` 필드가 있는 item을 다시 제외하여 닫힘, 할당, Pull Request 혼입을 방어한다.

완료 조건:

- Search API의 별도 rate-limit bucket을 인식하고 `Retry-After`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `403`, `429`를 처리한다.
- label만 보고 현금 보상을 추정하지 않는다.
- credential이 브라우저, 응답, 로그에 노출되지 않는다.

#### 31. Algora 조사 및 조건부 연동

선행 조사:

- 전역 공개 바운티 탐색 지원 여부
- 조직 목록 확보 방법
- API 이용 조건과 attribution
- 지급 국가와 통화 제한
- Public `GET /api/orgs/{org}/bounties`에 넣을 수 있는 신뢰 가능한 조직 allowlist와 갱신 주기를 제품 범위로 승인할 수 있는지
- Authenticated `GET /api/bounties`는 자기 조직용이며 전역 공개 탐색 경로로 사용하지 않는다는 경계

완료 조건:

- 제공자가 반환한 금액, 통화, 활성 상태만 표시한다.
- AISideQuest가 지급을 중개하지 않는다.
- 전역 탐색 조건을 확보하지 못하면 구현을 강행하지 않고 조사 결과를 문서화한다.
- 조사 결과에 API host, 인증, 조직 선정, attribution, fresh TTL, maximum stale, page/request 상한과 rate-limit을 포함한 `GO`·`NO-GO` 판정을 남긴다. `GO`가 아니면 adapter·schema·UI를 변경하지 않는 것이 Task 31의 정상 완료다.

### 3.4 4차 마일스톤: 안정화와 파일럿

#### 32. 관측성과 운영 안전장치

작업:

- Task 23부터 존재하는 source fetch/cache counter를 신규 adapter에서 계속 사용하고 중복 구현하지 않는다.
- Source 요청 latency와 반환 item 수를 fixed source·result 차원의 aggregate histogram 또는 동등한 저카디널리티 지표로 추가한다.
- source별 timeout, rate limit, parsing 실패를 구분한다.
- 외부 응답 원문과 전체 원문 URL을 운영 로그에서 제외한다.
- Source freshness·failure·latency·item count dashboard와 warning·critical alert를 코드로 관리하고, pilot 운영 metric·log 보존을 30일로 고정한다.
- Pilot에 필요한 `DISCOVER_VIEW`, `TAB_VIEW`, `OUTBOUND_CLICK`, `SAVE`만 owned 분석 event로 추가한다.
- 분석 dimension은 fixed source·category만 허용하고 item ID·제목·URL·tag·검색어·관심 기술은 수집하지 않는다.
- Owned 분석 row에 90일 expiry, account export와 primary delete를 적용한다.
- `DISCOVER_VIEW`는 route 진입 후 초기 category를 표시했을 때, `TAB_VIEW`는 명시적 tab 전환, `OUTBOUND_CLICK`은 사용자가 원문 link를 활성화했을 때, `SAVE`는 idempotent 재전송이 아닌 최초 `created: true` 성공 시점에만 기록한다.

완료 조건:

- source 장애 원인을 운영 지표로 구분할 수 있다.
- 로그와 metrics label에 금지 데이터나 높은 cardinality 값이 없다.
- 기존 health와 readiness 의미를 외부 source 장애가 훼손하지 않는다.
- 사용자·item 식별자가 Prometheus label이나 운영 로그에 없고 분석 row의 소유권·만료·내보내기·삭제가 검증된다.

#### 33. Discover 파일럿과 다음 범위 결정

집계 계약:

- 파일럿 기간은 연속 7일이며 시각 경계는 저장된 UTC를 기준으로 계산하되 보고서에는 파일럿 timezone을 명시한다. 표본 사용자 수와 event 수를 함께 보고하고 표본 부족을 성공으로 간주하지 않는다.
- Discover 진입률은 기간 내 AI session을 1회 이상 시작한 고유 사용자를 분모, `DISCOVER_VIEW`를 1회 이상 만든 고유 사용자를 분자로 한다.
- 탭별 사용량은 category별 `TAB_VIEW` 총합과 고유 사용자 수를 함께 보고한다.
- 원문 이동률은 `DISCOVER_VIEW` 고유 사용자 중 `OUTBOUND_CLICK`을 1회 이상 만든 고유 사용자 비율이다. Click 횟수 집계는 보조 지표로만 분리한다.
- 저장률은 `DISCOVER_VIEW` 고유 사용자 중 최초 `SAVE` 성공을 1회 이상 만든 고유 사용자 비율이다. Item impression을 수집하지 않으므로 item 기준 저장률을 계산하지 않는다.
- 반복 방문률은 `DISCOVER_VIEW` 사용자 중 7일 안에 서로 다른 UTC 날짜 2일 이상 방문한 고유 사용자 비율이다.
- Source 빈 결과율은 정상 refresh 중 item 0개인 횟수, 장애율은 refresh attempt 중 failure 횟수를 각각 분자로 삼는다. 사용자 행동과의 비교는 1시간 source·category time bucket에서 aggregate로만 결합하고 분석 row에 장애 상세를 복제하지 않는다.
- Task 32에서 위 지표의 분자·분모·중복 제거·경계 시각을 구현한 SQL과 test fixture를 확정한 후에만 파일럿을 시작한다.

판정 원칙:

- 사용량이 낮으면 source 확대를 중단한다.
- 저장률이 낮으면 복잡한 개인화를 추가하지 않는다.
- 현금 바운티 공급이 부족하면 수익 탭을 채용·계약 중심으로 유지한다.
- 자체 커뮤니티는 반복 사용자가 확보된 뒤에만 재검토한다.

기존 Task 20의 staging·production 증거와 10명·7일 파일럿 완료 조건은 별도로 유지하며 Discover 구현만으로 완료 처리하지 않는다.

---

## 4. 코드 계약 초안

```ts
export type DiscoverKind =
  | 'PAID_JOB'
  | 'CASH_BOUNTY'
  | 'REPUTATION_BOUNTY'
  | 'OSS_TASK'
  | 'ARTICLE'
  | 'DISCUSSION'

export interface DiscoverItem {
  id: string
  source: 'REMOTIVE' | 'HACKER_NEWS' | 'DEV' | 'STACK_EXCHANGE' | 'GITHUB' | 'ALGORA'
  category: 'EARNING' | 'NEWS' | 'COMMUNITY'
  kind: DiscoverKind
  title: string
  summary: string | null
  tags: string[]
  reward:
    | { type: 'CASH_BOUNTY'; amountMinor: number; currency: string }
    | { type: 'REPUTATION_BOUNTY'; amount: number }
    | null
  compensation: {
    provided: boolean
    text: string | null
  } | null
  engagement:
    | { type: 'SCORE' | 'REACTIONS'; value: number }
    | null
  readingTimeMinutes: number | null
  originalUrl: string
  attribution: string
  publishedAt: string | null
  fetchedAt: string
}
```

이 코드는 Task 22에서 확정한 공통 item 계약의 요약이다. `compensation`은 source가 제공한 채용 급여 문구이고 `reward`는 검증된 cash·reputation bounty만 표현한다. 전체 source status, page와 cursor type은 `server/src/discover/discover.types.ts`, client mirror는 `src/types/discover.ts`를 기준으로 한다.

---

## 5. 검증 원칙

각 작업은 다음 항목을 정상·경계·실패 케이스로 검증한다.

- 정상 응답, 빈 응답, 일부 필드 누락, 중복 item
- timeout, `429`, `500`, 잘못된 JSON, 응답 크기 초과
- 악성 HTML, 제어문자, `javascript:` URL, 허용되지 않은 host
- cursor 첫 페이지·마지막 페이지와 정렬 안정성
- source별 attribution과 최신 확인 시각
- 현금, 평판, 채용, 정보 분류 정확성
- prompt, AI 응답, 코드, diff, 전체 경로, 원본 명령 비수집
- 기존 auth, session, quest, point, statistics 회귀 여부
- 모바일 navigation과 접근성
- 외부 source가 실패해도 기존 AISideQuest 기능이 정상인지

검증 명령은 구현 작업마다 관련 테스트를 우선 실행하고 마지막에 다음 전체 gate를 적용한다.

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

---

## 6. 실행 순서 요약

```text
1차 개발  Task 21~26  문서 계약 -> 공통 Adapter -> Hacker News -> Remotive -> Discover 화면
2차 개발  Task 27~28  저장 -> 명시적 관심 기술 정렬
3차 개발  Task 29~31  DEV·Stack Overflow -> GitHub -> Algora
안정화    Task 32~33  관측성 -> Discover 파일럿과 다음 범위 결정
```

한 번에 한 Task만 구현하고 해당 완료 조건과 문서·테스트를 충족한 뒤 다음 Task로 이동한다.
