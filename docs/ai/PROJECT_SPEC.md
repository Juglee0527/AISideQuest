# AISideQuest - Project Specification

> AI가 작업하는 동안 발생하는 대기 시간을 가치 있는 시간으로 전환하는 로컬 우선 개발자 도구

- 현재 상태: 실사용 베타 Task 1~19 구현 완료, Task 20 외부 증거 대기, Discover Task 21~22 완료
- 애플리케이션 버전: `0.1.0`
- 최종 현행화: 2026-07-20

---

# 1. 문서 역할과 기준

이 문서는 AISideQuest의 현재 제품 형태와 확정된 다음 범위를 설명한다.

- 현재 동작과 계획을 분리하고 구현되지 않은 기능을 현재 기능처럼 쓰지 않는다.
- DB constraint와 migration, server type·guard·service, 자동 테스트, canonical domain 문서 순으로 실제 동작을 판단한다.
- 기능을 변경할 때 코드, 테스트, 관련 `docs/ai/` 계약과 사용자용 한국어 문서를 같은 변경에서 현행화한다.
- 세부 상태 전이와 보안 규칙은 [`DOMAIN_CONTRACTS.md`](./DOMAIN_CONTRACTS.md), endpoint 목록은 [`API_CONTRACTS.md`](./API_CONTRACTS.md)를 따른다.
- 정확한 패키지 버전과 실행 script는 `package.json`과 `package-lock.json`이 최종 기준이다.

---

# 2. 제품 개요

AISideQuest는 Windows ChatGPT 데스크톱 앱의 Codex 작업을 감지하고, 개발자가 AI 작업 중 짧은 개발 퀴즈를 수행하도록 돕는 도구다. 기본 제품 경로는 사용자가 저장소를 내려받아 자신의 PC에서 무료로 실행하는 local-first 방식이다.

현재 제품이 제공하는 가치는 다음과 같다.

- Codex 작업 turn 자동 감지와 경과 시간 확인
- 장애 중에도 유실을 줄이는 local durable queue와 server recovery
- 실제 객관식 개발 퀴즈, 답안 복구와 server 채점
- 최초 통과에 한 번만 지급하는 100P service point
- 사용자 time zone 기준 작업·퀘스트·point 통계
- 기기 연결·폐기, 데이터 내보내기와 계정 삭제

100P는 AISideQuest 내부의 비현금 service point다. 환전·양도·구매할 수 없고, 외부 채용·바운티 지급과 관계가 없다.

---

# 3. 현재 사용자 흐름

1. 사용자가 `npm.cmd run dev:local`로 PostgreSQL, migration·seed, API와 web을 실행한다.
2. GitHub OAuth로 로그인한다. Server는 GitHub numeric ID로 사용자를 식별하고 OAuth access token과 email을 저장하지 않는다.
3. Codex plugin 연결을 요청하고 browser에서 10분 유효 연결 요청을 승인한다.
4. 사용자가 Codex에 prompt를 제출하면 plugin과 server가 AI session을 자동 생성·갱신한다.
5. Home은 현재 실행 중인 여러 Codex turn을 read-only card로 표시한다. Card는 server 시각 기준 경과 시간, 정제된 마지막 folder명과 고정 operation 분류만 보여준다.
6. 활성 AI session이 있을 때 게시된 개발 퀴즈를 시작하고 답안을 저장·제출한다.
7. Server가 답안을 채점하고 최초 통과 transaction에서 100P를 한 번 적립한다.
8. Dashboard에서 time zone 기준 오늘·주·월·직접 선택 기간의 AI 시간, 퀘스트와 point를 확인한다.
9. Devices에서 연결 token을 교체·폐기하고, 계정에서 data export 또는 delete를 수행할 수 있다.

Home에는 수동 시작·종료 button이 없다. 수동 session endpoint는 자동 감지가 불가능한 환경을 위한 recovery API 호환성으로만 남는다.

---

# 4. 현재 구현 범위

## 4.1 Web과 인증

- React SPA와 desktop·mobile navigation
- GitHub OAuth state + PKCE
- hash-only server session과 secure cookie
- browser mutation의 CSRF 검증
- 최근 인증을 요구하는 export·account delete
- device browser 승인, rotation과 revoke

## 4.2 AI session과 plugin

- `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, `Heartbeat` lifecycle 처리
- 서로 다른 hashed Codex session key의 동시 자동 session
- 같은 turn의 중복·역순 event 멱등 처리
- 30초 heartbeat와 120초 자동 timeout
- append-only JSONL FIFO queue, retry, tail recovery와 dead-letter
- same-device late `Stop` recovery와 `DEGRADED` timing 구분
- Home의 여러 active session polling과 server-time elapsed display
- plugin 연결 장애 시 recovery-only manual API

## 4.3 퀴즈와 point

- PostgreSQL에 게시된 객관식 개발 퀴즈 5개
- 활성 AI session에 고정되는 quest attempt와 version snapshot
- 원자적 답안 교체와 새로고침 복구
- server-only 정답과 채점
- AI session 종료 후 정확히 5분 submission grace
- retry policy와 이미 통과한 version의 재응시 차단
- 최초 통과 100P transaction
- user + quest version과 attempt별 DB uniqueness
- balance와 immutable cursor ledger

## 4.4 통계와 운영

- 저장된 IANA time zone 기준 today·week·month·custom 통계
- DST와 기간 경계를 반영한 PostgreSQL 집계
- active session을 동일 응답의 `serverTime`까지만 계산
- `DEGRADED` timing 별도 count
- request ID, structured privacy-safe logs와 protected Prometheus metrics
- liveness·readiness, rate limit, alerts, backup·restore tooling
- PostgreSQL integration, migration upgrade와 Chromium E2E CI gate
- immutable API·web image, staging·production template, smoke와 rollback tooling

## 4.5 Discover API baseline

- Server·client 공통 개념의 source, category, kind, reward, compensation과 source status type
- GitHub login을 요구하고 active AI session은 요구하지 않는 `GET /api/v1/discover`
- Safe source catalog를 반환하는 `GET /api/v1/discover/sources`
- Category·source enum, limit 1~50과 versioned opaque cursor 검증
- Strict client response parser와 HTTPS original URL 검증
- Adapter 구현 전 명시적 empty item과 disabled·`UNAVAILABLE` source 상태

현재 endpoint는 외부 network를 호출하거나 cache를 읽지 않는다. Source adapter와 shared PostgreSQL cache는 Task 23 범위다.

## 4.6 현재 제외 범위

- 현금 지급, 환전, 구매, escrow와 외부 결제
- Codex 외 Cursor·Claude Code·Copilot 자동 감지
- VS Code·Chrome·Cursor extension
- 외부 application 자동 제출
- 공개 service 운영을 기본 사용 경로로 강제하는 기능
- 실제 staging·production과 초대 사용자 pilot을 완료했다는 주장
- Discover source adapter·외부 호출·cache·screen·saved item·interest·analytics 구현

---

# 5. 현재 화면과 route

| Route | 현재 기능 |
|---|---|
| `/` | 모든 active AI session의 상태·경과 시간과 오늘 요약 |
| `/quests` | 게시 quest catalog와 최근 응시 상태 |
| `/quests/:code` | quest detail 확인과 attempt 시작 |
| `/quest-attempts/:attemptId` | 답안 복구·저장·제출 |
| `/dashboard` | 기간 통계, point balance와 ledger |
| `/devices` | 연결 device 조회, rotation과 revoke |
| `/devices/connect/:requestId` | local Codex device 연결 승인 |

정의되지 않은 route는 `/`로 이동한다. `/discover`는 Task 26 전까지 존재하지 않는다.

---

# 6. 핵심 기능 계약

## 6.1 인증과 소유권

- GitHub numeric user ID가 안정적인 외부 identity다.
- Browser resource는 authenticated user의 `user_id`를 SQL 조건에 포함한다.
- Browser mutation은 session cookie와 CSRF를 함께 검증한다.
- Device event는 browser cookie가 아닌 device bearer token hash로 인증한다.
- Account delete는 owned primary data를 한 transaction으로 지우고, 사용자가 local plugin data를 별도로 삭제하도록 안내한다.

## 6.2 AI session

- 상태는 `RUNNING`, `WAITING_FOR_USER`, `COMPLETED`, `FAILED`, `ABANDONED`다.
- 자동 session은 hashed Codex session key별 active turn 하나를 허용하고 서로 다른 key는 동시에 실행할 수 있다.
- 순수 manual session은 user별 하나만 허용한다.
- 자동 session은 마지막 valid activity 후 120초, 순수 manual session은 시작 후 12시간에 만료한다.
- Heartbeat timeout으로 abandon된 same-device, same-turn session만 24시간 안의 late `Stop`으로 복구할 수 있다.
- 진행 시간은 browser counter가 아니라 server-owned timestamp와 response `serverTime`을 기준으로 표시한다.

## 6.3 Quest와 point

- Catalog와 detail은 published current version과 사용자의 최근 상태만 노출하고 문제·option·정답을 미리 노출하지 않는다.
- Attempt는 시작 시 quest version과 content를 고정한다.
- 제출은 row lock과 transaction 안에서 server-only grading과 point ledger insertion을 함께 처리한다.
- 동일 user + quest version의 첫 pass만 pinned 100P를 지급한다.
- Reward kill switch가 꺼져 있으면 grading 전에 submission을 차단한다.

## 6.4 통계

- 한 통계 request는 DB의 하나의 기준 시각을 모든 aggregate와 pagination에 사용한다.
- 기간은 user의 검증된 IANA time zone으로 만든 반열린 UTC interval이다.
- Active session은 request 기준 시각까지만, 경계를 넘는 session은 실제 겹친 구간만 합산한다.
- 완료 quest count와 point는 최초 pass ledger의 생성 시각을 기준으로 집계한다.

---

# 7. 데이터와 저장소

## 7.1 Server-owned primary data

- user와 GitHub authentication account
- web authentication session과 CSRF state
- device, 연결 request와 hash-only credential
- AI session과 allowlist integration event
- published quest, question과 option
- quest attempt, answer와 point ledger
- shared rate-limit과 idempotency record

DB의 정확한 table, FK, UK, check와 index는 [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)를 따른다.

## 7.2 Browser LocalStorage

AI session, quest attempt, point와 통계의 현재 source of truth는 server다. Browser LocalStorage에는 과거 browser-only MVP 전환을 위한 다음 값만 남을 수 있다.

| Key | 역할 |
|---|---|
| `aisidequest.legacyMigration` | 구형 data 처리 완료 marker |
| `aisidequest.legacyReference` | server 통계에 포함하지 않는 구형 참고 요약 |
| `aisidequest.questHistories.v2` | 과거 임시 history; 현재 통계·point에 미반영 |

구형 `aisidequest.sessions`와 `aisidequest.questHistories`는 전환 후 삭제하며 current session 복구에 사용하지 않는다.

---

# 8. 보안과 개인정보

수집하지 않는 원문은 다음과 같다.

- prompt와 AI response
- source code와 diff
- 전체 file·workspace path
- raw command, argument, environment와 tool input/output
- transcript와 raw hook payload
- raw OAuth·session·CSRF·device token과 연결 code

표시를 위해 허용하는 derivative는 plugin이 local persistence 전에 만든 separator-free 마지막 folder명과 fixed-allowlist operation label뿐이다. Request log에는 body, raw query, credential과 사용자 content를 남기지 않는다.

AI session과 allowlist event는 beta 기준 90일, 운영 log와 encrypted backup은 최대 30일 보존한다. 상세 matrix, export·delete와 retention은 [`SECURITY_AND_PRIVACY.md`](./SECURITY_AND_PRIVACY.md)를 따른다.

---

# 9. 실행과 검증

## 9.1 Local 실행

```powershell
npm.cmd install
npm.cmd run dev:local
```

기본 web은 `http://localhost:5173`, API는 `http://localhost:3000/api/v1`를 사용한다.

## 9.2 Repository gate

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run docs:check
git diff --check
```

## 9.3 마지막 검증 상태

2026-07-20 기준 자동 test 166개가 통과했다.

| Suite | 통과 |
|---|---:|
| React | 54 |
| Codex plugin | 20 |
| 운영·local startup script | 17 |
| Server non-database | 24 |
| PostgreSQL integration | 51 |

Lint, client·server typecheck와 production build, migration 14개 revert·reapply, Docker API·web build와 deployment smoke 10개도 통과했다.

---

# 10. 현재 제한과 외부 미완료

- 기본 사용자는 local service process를 실행 중인 상태로 유지해야 한다.
- 실제 GitHub 로그인에는 사용자가 만든 OAuth App credential이 필요하다.
- 자동 감지는 현재 Windows ChatGPT desktop의 Codex lifecycle hook만 지원한다.
- 강제 종료에는 전용 completion hook이 없어 heartbeat 중단 뒤 timeout으로 정리될 수 있다.
- 기존 browser-only 참고 summary는 server로 migrate하지 않고 다른 browser와 공유하지 않는다.
- 예상 절약 시간은 계산 규칙이 없어 `null`이며 화면에는 `-`로 표시한다.
- Task 20의 deployment package와 local rehearsal은 준비됐지만 real staging·production, backup·rollback evidence와 10-user 7-day pilot은 완료되지 않았다.

---

# 11. Discover 제품 계약과 다음 단계

Task 21에서 제품 규칙을 확정했고 Task 22에서 common model과 인증된 read API를 구현했다. 외부 source item과 화면은 아직 제공하지 않는다.

- `/discover`와 browser API는 GitHub login을 요구하지만 active AI session은 요구하지 않는다.
- AISideQuest는 외부 item을 정제·분류하고 원문으로 연결할 뿐 채용, 수익, 자격, 지급을 보장하지 않는다.
- AISideQuest point, job compensation, verified cash bounty와 reputation bounty를 별도 개념으로 표시한다.
- 외부 item 조회·click·save에는 AISideQuest point를 지급하지 않는다.
- Server만 고정 source API host를 fetch하고 raw response·HTML은 저장하거나 log하지 않는다.
- Shared PostgreSQL cache에는 normalized item만 저장한다. 초기 fresh·maximum stale은 Hacker News 10분·24시간, Remotive 6시간·72시간이며 cache row는 마지막 성공 refresh 후 7일 안에 교체·삭제한다.
- Task 32 전에는 visit·click analytics를 암묵적으로 수집하지 않는다. Pilot용 owned analytics를 구현하면 item detail 없이 fixed event·source·category만 저장하고 90일 expiry, export와 delete를 적용한다.
- Tasks 22~26 완료는 `Discover MVP implementation complete`인 release candidate다. Real source smoke, attribution, failure, accessibility와 privacy evidence가 있어야 release할 수 있다.
- Discover 완료는 별도 track인 Task 20 완료 증거가 아니다.

정확한 기준은 [`DISCOVER_CONTRACT.md`](./DISCOVER_CONTRACT.md), 순서는 [`../Discover_개발_계획.md`](../Discover_개발_계획.md)를 따른다.

다음 작업은 Task 23의 safe source Adapter, bounded HTTP client, shared normalized cache와 stale fallback 구현이다.

---

# 12. Roadmap 상태

## 기존 실사용 beta

- Task 1~19: 구현·repository 검증 완료
- Task 20: repository package와 local rehearsal 완료, 외부 staging·production과 pilot evidence 대기

## Discover 확장

- Task 21: 제품·개인정보·분류·release 계약 완료
- Task 22: common model, authenticated read API, source catalog와 strict client parser 완료
- Task 23~26: adapter, Hacker News, Remotive와 screen 미구현
- Task 27~28: saved item과 explicit interest 미구현
- Task 29~31: additional source 미구현
- Task 32~33: Discover observability와 product pilot 미구현

최종 목표는 AI가 일하는 동안 개발자가 안전하게 학습하거나 외부 기회를 발견하도록 돕는 것이다. AISideQuest는 사용자의 작업 content를 수집하거나 외부 보상을 보장하는 방식으로 이 목표를 달성하지 않는다.
