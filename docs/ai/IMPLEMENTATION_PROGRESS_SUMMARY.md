# AISideQuest 개발 진행 요약

- 최종 현행화: 2026-07-21
- 애플리케이션 버전: `0.1.0`
- 전체 실사용 베타 작업: 20개
- 완료: 1~19번, 총 19개
- Task 20: 배포 패키지 구현 완료, 외부 운영 배포·파일럿 증거 대기
- Discover 확장: Task 21~28 완료, Task 29~33 대기

---

# 1. 현재 상태 요약

AISideQuest는 브라우저 LocalStorage 기반 MVP를 서버 소유 데이터와 로컬 우선 실행 구조로 전환했고, Discover MVP·저장·명시적 개인화까지 구현했다.

현재까지 다음 기반을 확보했다.

1. 최초 베타 대상, 로그인, 퀘스트, 포인트, 개인정보 범위를 확정했다.
2. Windows ChatGPT 데스크톱 앱의 Codex hook으로 작업 시작과 종료를 실제 감지했다.
3. 자동 감지와 수동 조작을 하나의 서버 세션으로 처리하는 상태 및 API 계약을 확정했다.
4. NestJS API 실행 환경과 공통 응답, 오류 처리, 입력 검증, Health Check를 구현했다.
5. PostgreSQL 스키마, migration, 개발 퀴즈 seed와 DB 제약조건 검증을 구현했다.
6. GitHub OAuth 로그인, 서버 저장형 인증 세션, 현재 사용자 조회와 logout을 구현했다.
7. 인증 사용자별 AI 세션 API, Codex event 상태 전이와 멱등성 처리를 구현했다.
8. React 세션 상태를 API adapter로 전환하고 polling, 서버 시각 보정, 인증·오류 상태를 구현했다.
9. 기존 LocalStorage를 참고 요약 또는 초기화로 1회 처리하고 신규 데이터와 분리했다.
10. 정식 Codex 플러그인, 일회성 연결 코드, hash 기기 token, 회전·폐기와 테스트 event를 구현했다.
11. Codex lifecycle event 자동 전송, 서버 세션 상태 반영, 마지막 event 표시와 수동 fallback을 구현했다.
12. 30초 heartbeat, durable FIFO queue, 재시도·dead-letter와 서버 세션 만료·late Stop 복구를 구현했다.
13. 게시 퀘스트 목록·상세 API, 사용자별 최근 응시 상태와 cursor pagination을 구현하고 프런트엔드의 `mockQuests`를 제거했다.
14. 활성 AI 세션 기반 실제 퀴즈, 답안 저장·복구, 서버 채점, 제출 멱등성과 만료·재응시 정책을 구현했다.
15. Hacker News·Remotive source, 안전한 adapter/cache/stale fallback과 `/discover` 화면을 구현했다.
16. 사용자별 저장 snapshot과 고정 allowlist 관심 기술, 결정적 정렬과 추천 이유를 구현했다.

현재 React 프런트엔드는 GitHub 로그인, PostgreSQL 기반 세션·퀘스트·채점·포인트·기간 통계·Discover API를 사용한다. 기간 통계는 저장된 IANA time zone과 응답의 동일한 서버 기준 시각으로만 표시하며, Discover는 저장 snapshot과 명시적 관심 기술을 사용자 소유 데이터로 처리한다.

# 2. 출발점: 기존 MVP

실사용 베타 작업 전 저장소에는 다음 MVP 기능이 구현돼 있었다.

- React 19, TypeScript 7, Vite 8, TailwindCSS 4 기반 웹
- Home, Side Quest, Dashboard 화면
- 사용자가 직접 누르는 AI 작업 시작·종료 버튼과 타이머
- 브라우저 LocalStorage 세션·퀘스트 이력 저장 및 복구
- 더미 퀘스트와 클라이언트 완료 처리
- 오늘·이번 주·이번 달 통계
- React 자동 테스트 19개

MVP는 화면과 사용자 흐름을 확인하는 목적에는 충분하지만, 로그인·서버 데이터·자동 감지·실제 퀴즈 판정·포인트 원장이 없어 사용자에게 배포할 수 있는 상태는 아니었다.

# 3. 완료 작업

## 3.1 1번: 실사용 베타 범위 확정

### 확정 결과

| 항목 | 결정 |
|---|---|
| 최초 지원 AI 도구 | Windows ChatGPT 데스크톱 앱의 Codex 작업 |
| 지원 환경 | Windows 11, Windows native agent, PowerShell |
| 지원 브라우저 | Chrome 및 Edge 데스크톱 |
| 감지 단위 | 사용자 요청 1회에 대응하는 Codex turn |
| 로그인 | GitHub OAuth |
| 로컬 기기 연결 | 웹 일회성 연결 코드로 기기 토큰 발급 |
| 최초 퀘스트 | 객관식 개발 퀴즈 |
| 초기 콘텐츠 | 버전이 있는 개발 퀴즈 최소 5개 |
| 퀴즈 보상 | 성공 시 100P |
| 중복 적립 | 사용자와 퀘스트 버전 조합당 1회 |
| 포인트 가치 | 현금 가치 없음, 환전·양도·구매·출금 불가 |
| 파일럿 | 초대 기반 폐쇄형 베타, 10명 이상 |
| UI 언어 | 한국어 |

### 개인정보 원칙

수집 대상은 기기 ID, hash 처리한 Codex session·turn ID, event 종류, event 시각, 앱·플러그인 버전으로 제한했다.

다음 데이터는 수집하거나 서버로 전송하지 않는다.

- 프롬프트와 Codex 응답
- 대화 transcript
- 소스 코드와 파일 내용
- 파일 경로와 작업 디렉터리
- 실행 명령과 도구 입출력
- Git 저장소 주소
- 사용 모델명

### 관련 문서

- [전체 베타 구현 계획](./BETA_IMPLEMENTATION_PLAN.md)
- [프로젝트 명세](./PROJECT_SPEC.md)

## 3.2 2번: AI 작업 자동 감지 기술 검증

### 구현

Repo-local Codex 플러그인 `aisidequest-hook-poc`를 구성했다.

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PermissionRequest`
- `PostToolUse`
- `Stop`

Hook 원본 JSON을 저장하지 않고 다음 필드만 JSONL로 기록한다.

- schema version
- event 이름
- SHA-256으로 변환한 session ID
- SHA-256으로 변환한 turn ID
- 로컬 수신 시각

### 라이브 검증 결과

Windows ChatGPT 데스크톱 앱에 플러그인을 설치하고 6개 hook을 신뢰한 뒤 실제 Codex 작업을 실행했다.

완료된 turn에서 다음 순서를 확인했다.

```text
UserPromptSubmit
→ PreToolUse
→ PostToolUse
→ PreToolUse
→ PostToolUse
→ Stop
```

- 같은 turn에서 시작과 종료가 각각 1회 기록됨
- hook 수신 시각 기준 약 32.289초 측정
- 허용된 필드 외 데이터 저장 없음
- 원본 식별자 대신 64자리 SHA-256 hash만 저장

### 최종 판정

- `UserPromptSubmit`을 자동 시작으로 사용한다.
- 같은 turn ID의 `Stop`을 정상 완료로 사용한다.
- `PermissionRequest` 발생 시 사용자 확인 대기로 처리한다.
- 승인 완료 전용 hook이 없으므로 승인 대기는 전체 turn 시간에 포함한다.
- 시작 후 `Stop`이 없으면 완료로 추측하지 않고 heartbeat 만료 후 `ABANDONED` 처리한다.
- hook 미지원·비활성·신뢰 해제 시 웹 수동 모드를 제공한다.

### 남은 관찰 항목

- 실제 `PermissionRequest` 이후 event 순서
- 명령 실패 시 `PostToolUse`와 `Stop` 호출 여부
- 사용자 취소·앱 강제 종료 시 `Stop` 호출 여부
- task 재개 시 `SessionStart` 반복 조건

### 관련 구현 및 문서

- [자동 감지 PoC 결과](./AUTO_DETECTION_POC.md)
- [플러그인 hook 설정](../../plugins/aisidequest-hook-poc/hooks/hooks.json)
- [개인정보 필터](../../plugins/aisidequest-hook-poc/scripts/event-recorder.mjs)
- [hook 테스트](../../plugins/aisidequest-hook-poc/tests/event-recorder.test.mjs)

## 3.3 3번: 세션 상태와 데이터 흐름 설계

### 세션 기준

- Codex thread 전체가 아니라 turn 1개를 세션 1개로 취급한다.
- 베타에서는 사용자당 활성 세션을 최대 1개만 허용한다.
- 플러그인과 웹은 event와 명령만 보내고 API 서버가 상태와 기준 시각을 소유한다.
- 웹은 5초 polling과 창 focus 시 즉시 조회로 서버 상태를 반영한다.
- WebSocket과 SSE는 파일럿에서 5초 반영 목표를 충족하지 못할 때만 검토한다.

### 상태

| 상태 | 의미 |
|---|---|
| `RUNNING` | Codex 작업 또는 수동 추적 진행 중 |
| `WAITING_FOR_USER` | 권한 승인 등 사용자 입력 대기 |
| `COMPLETED` | hook `Stop` 또는 수동 정상 완료 |
| `FAILED` | 사용자가 작업 실패로 명시적 종료 |
| `ABANDONED` | heartbeat 만료, 새 turn 대체, 사용자 취소, 안전 만료 |

### Event 매핑

| Event | 처리 |
|---|---|
| `UserPromptSubmit` | 세션 생성 또는 기존 수동 세션 연결, `RUNNING` |
| `PreToolUse` | 상태 유지, 마지막 활동 시각 갱신 |
| `PermissionRequest` | `WAITING_FOR_USER` |
| `PostToolUse` | `RUNNING` 복귀 |
| `Stop` | 같은 turn을 `COMPLETED` 처리 |
| `Heartbeat` | 상태 유지, 마지막 활동 시각 갱신 |

### 장애 및 중복 기준

- 자동 연결 세션 heartbeat: 30초 간격
- 자동 세션 만료: 마지막 유효 event 이후 120초
- 순수 수동 세션 안전 만료: 시작 후 12시간
- 지연 `Stop` 정정 가능 시간: 24시간
- 전송 중복: `(deviceId, eventId)` unique key
- 의미 중복: `(userId, provider, externalTurnKey)`와 상태로 방어
- 모든 변경 API: `Idempotency-Key` 필수
- 세션 기준 시각: API 서버 event 수신 시각

### 자동·수동 충돌 처리

- 수동 세션 중 자동 시작이 감지되면 새 세션을 만들지 않고 현재 수동 세션에 turn을 연결한다.
- 활성 자동 세션에서 수동 시작을 누르면 기존 활성 세션을 반환한다.
- 같은 turn 시작이 중복되면 `startedAt`을 변경하지 않는다.
- 다른 turn이 시작되면 기존 활성 세션을 `ABANDONED` 처리하고 새 세션을 만든다.
- 수동 종료 후 늦게 도착한 같은 turn event는 상태를 중복 변경하지 않는다.

### API 계약

- `POST /api/v1/integration-events`
- `POST /api/v1/sessions/manual`
- `POST /api/v1/sessions/{sessionId}/end`
- `GET /api/v1/sessions/active`
- `GET /api/v1/sessions`

### 관련 문서

- [세션 상태와 데이터 흐름 설계](./SESSION_STATE_AND_DATA_FLOW.md)

## 3.4 4번: NestJS 백엔드 기본 구성

### 구현 환경

- Node.js 22
- NestJS 11.1.28
- NestJS Config 4.0.4
- TypeScript 7
- class-validator 및 class-transformer
- Node.js test runner 및 Supertest

Root npm 패키지는 유지하고 `server/`에 별도 CommonJS 컴파일 경계를 두어 Vite ESM 설정과 충돌하지 않도록 구성했다.

### 구현 내용

- 환경설정 기본값 및 시작 시 검증
  - `NODE_ENV`
  - `API_HOST`
  - `API_PORT`
  - `CORS_ORIGIN`
- API prefix: `/api/v1`
- 공통 성공 응답: `{ data, meta.serverTime }`
- 공통 오류 응답: `{ error, meta.serverTime }`
- 허용 필드만 받는 전역 ValidationPipe
- CORS와 cookie 인증을 위한 credentials 설정
- 처리되지 않은 서버 오류의 내부 내용 비노출
- `GET /api/v1/health`

Health Check 응답 형식은 다음과 같다.

```json
{
  "data": {
    "status": "ok",
    "service": "aisidequest-api"
  },
  "meta": {
    "serverTime": "2026-07-15T08:55:04.517Z"
  }
}
```

### 실행 명령

```powershell
npm.cmd run dev:server
```

기본 주소:

```text
http://localhost:3000/api/v1
```

### 관련 구현

- [서버 진입점](../../server/src/main.ts)
- [애플리케이션 모듈](../../server/src/app.module.ts)
- [환경설정 검증](../../server/src/config/environment.ts)
- [애플리케이션 공통 설정](../../server/src/bootstrap/configure-application.ts)
- [공통 성공 응답](../../server/src/common/http/api-response.interceptor.ts)
- [공통 오류 응답](../../server/src/common/http/api-exception.filter.ts)
- [Health Check](../../server/src/health/health.controller.ts)
- [서버 통합 테스트](../../server/test/app.e2e.test.ts)

## 3.5 5번: PostgreSQL 데이터베이스 구성

### 도구 선택

- PostgreSQL 16
- TypeORM 1.1과 NestJS 공식 TypeORM 통합 패키지
- PostgreSQL `pg` driver
- Docker Compose 기반 로컬 개발 DB

`synchronize`는 사용하지 않고 SQL migration을 스키마 기준으로 삼았다. 아직 API에서 사용하지 않는 Entity와 repository는 미리 만들지 않고 6번 이후 실제 기능 모듈에서 필요한 범위만 추가한다.

### 구현 구조

다음 11개 테이블을 최초 migration에 추가했다.

1. `users`
2. `user_auth_accounts`
3. `devices`
4. `ai_sessions`
5. `integration_events`
6. `quests`
7. `quest_questions`
8. `quest_options`
9. `quest_attempts`
10. `quest_attempt_answers`
11. `point_ledger`

원래 계획의 핵심 테이블 외에 GitHub OAuth 식별, Codex 기기 인증, event 멱등성, 객관식 답안 관계를 실제로 보장하는 보조 테이블을 포함했다.

### DB 불변 조건

- 사용자당 활성 AI 세션 최대 1개
- 사용자·provider·외부 turn key 중복 금지
- 기기와 event ID 조합당 event 1건
- event 사용자와 기기·세션 소유자 일치
- 같은 code의 공개 퀘스트 version 최대 1개
- 사용자와 퀘스트 version당 포인트 보상 1회
- 포인트는 변경 가능한 잔액이 아니라 append-only 원장으로 저장
- 프롬프트, 응답, 코드, 경로, 원본 hook payload 저장 컬럼 없음

### 개발 seed

100P 보상의 version 1 객관식 개발 퀴즈 5개를 추가했다.

- TypeScript 타입 좁히기
- HTTP 멱등성
- PostgreSQL 유일성 제약
- Git 안전한 이력 관리
- 경계값 테스트

seed는 반복 실행해도 중복되지 않으며 공개된 version의 내용을 덮어쓰지 않는다.

### 검증

- 빈 PostgreSQL DB에 전체 migration 적용
- migration 재실행 시 변경 없음
- migration 되돌리기 후 재적용
- seed 두 번 실행 후 퀘스트 5개·문항 5개·선택지 20개 유지
- 활성 세션, integration event, FK 소유권, 포인트 중복 제약 테스트

관련 문서: [PostgreSQL 데이터베이스 구성](./DATABASE_SCHEMA.md)

## 3.6 6번: 사용자 로그인 구현

### 구현 방식

- GitHub OAuth Web Application Flow
- OAuth `state` 1회 사용과 PKCE `S256`
- GitHub 숫자 ID를 기준으로 `users`, `user_auth_accounts` 생성 또는 갱신
- PostgreSQL 서버 저장형 인증 세션
- 세션·CSRF token 원문 대신 SHA-256 hash 저장
- 개발 환경 `SameSite=Lax`, `HttpOnly` session cookie
- 운영 환경 `Secure`, `__Host-` prefix 추가

### 인증 API

| Method | Path | 역할 |
|---|---|---|
| `GET` | `/api/v1/auth/github` | GitHub 로그인 시작 |
| `GET` | `/api/v1/auth/github/callback` | state·PKCE 검증과 로그인 완료 |
| `GET` | `/api/v1/auth/me` | 현재 사용자 조회 |
| `POST` | `/api/v1/auth/logout` | CSRF 검증 후 현재 세션 폐기 |

GitHub access token은 사용자 식별 요청에만 사용하고 저장하지 않는다. 이메일도 요청하거나 저장하지 않는다.

### 검증

- 비로그인 보호 API 접근 거부
- state·PKCE 적용과 state 재사용 차단
- 사용자·OAuth 계정 생성 및 재로그인 시 재사용
- session·CSRF token 원문 미저장
- CSRF 누락 logout 거부
- logout·만료 후 세션 재사용 차단
- GitHub 승인 거부 callback 처리

관련 문서: [사용자 인증](./AUTHENTICATION.md)

## 3.7 7번: AI 세션 API 구현

### 사용자 세션 API

- 수동 시작과 완료·실패·취소 종료
- 활성 세션 조회
- 상태 필터와 opaque cursor 기반 이력 조회
- 다른 사용자 세션의 존재를 노출하지 않는 소유권 `404`
- 모든 응답의 `meta.serverTime` 유지

### Codex event 처리

- device bearer token hash 인증
- `UserPromptSubmit`, `PermissionRequest`, `PostToolUse`, `Stop`, `Heartbeat` 상태 전이
- 수동 세션과 자동 turn 연결
- 새 turn이 기존 활성 세션을 대체하는 transaction
- 시작보다 먼저 도착한 event의 `DEFERRED` 저장과 24시간 내 재처리
- 프롬프트, 코드, 경로 같은 허용되지 않은 요청 필드 차단

### 멱등성과 동시성

- 사용자 단위 PostgreSQL advisory transaction lock
- 사용자당 활성 세션 unique index
- UUID `Idempotency-Key`, request hash와 최초 응답 snapshot 저장
- 같은 key의 동일 요청 재생과 다른 요청 재사용 `409`
- `(device_id, event_id)` unique key와 event request hash 검증

관련 문서: [세션 상태와 데이터 흐름](./SESSION_STATE_AND_DATA_FLOW.md)

## 3.8 8번: 프런트엔드 세션 상태 API 전환

- `SessionContext`의 세션 LocalStorage 의존 제거
- cookie 인증, CSRF와 UUID `Idempotency-Key`를 사용하는 API client 추가
- 활성 세션과 cursor 전체 이력 복구
- 활성 탭 5초 polling과 focus·visibility 복귀 즉시 조회
- `meta.serverTime` 기반 브라우저 시각 보정
- `RUNNING`, `WAITING_FOR_USER`, 종료 상태 표현
- 로딩, 인증 만료, 네트워크 오류, 재시도와 변경 요청 중 UI 추가

## 3.9 9번: 기존 LocalStorage 데이터 처리

- 앱 Context 마운트 전 구형 세션·퀘스트 저장값 감지 및 검증
- 초기화 또는 보상 없는 로컬 참고 요약 1회 보관
- 손상 데이터의 참고 보관 차단과 안전한 초기화 경로
- 완료 marker 기록 후 구형 원본 반복 정리
- 구형 활성 세션과 예상 포인트의 서버 이전 차단
- 신규 임시 퀘스트 이력을 v2 키로 분리

# 4. 현재 디렉터리 구조

```text
AISideQuest/
├─ src/                         React 웹과 세션 API adapter
│  ├─ api/                      공통 API·세션 client
│  ├─ components/               레이아웃과 구형 데이터 전환 화면
│  ├─ contexts/                 서버 세션·임시 퀘스트 상태
│  └─ storage/                  구형 데이터 검증과 1회 처리
├─ server/
│  ├─ src/
│  │  ├─ auth/                  GitHub OAuth, cookie 세션과 인증 guard
│  │  ├─ bootstrap/             전역 API 설정
│  │  ├─ common/http/           공통 성공·오류 응답
│  │  ├─ config/                환경설정 검증
│  │  ├─ database/              DataSource, migration, 개발 seed
│  │  ├─ health/                Health Check
│  │  ├─ sessions/              AI 세션 API와 Codex event 상태 전이
│  │  ├─ app.module.ts
│  │  └─ main.ts
│  ├─ test/                     NestJS·PostgreSQL 통합 테스트
│  ├─ tsconfig.json
│  └─ tsconfig.test.json
├─ plugins/
│  └─ aisidequest-hook-poc/     Codex lifecycle hook PoC
├─ docs/                        기준 문서와 기술 검증 기록
├─ compose.yaml                 PostgreSQL 16 로컬 개발 환경
├─ .env.example
└─ package.json                 프런트·hook·서버 통합 명령
```

# 5. 실행 및 검증

## 5.1 설치

```powershell
npm.cmd install
```

## 5.2 프런트엔드 실행

```powershell
npm.cmd run dev
```

## 5.3 API 실행

```powershell
npm.cmd run dev:server
```

## 5.4 PostgreSQL 실행

```powershell
npm.cmd run db:up
npm.cmd run db:setup
```

## 5.5 전체 검증

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

DB 통합 테스트는 초기화 가능한 test 전용 DB에서 실행한다.

```powershell
$env:TEST_DATABASE_URL='postgresql://aisidequest:aisidequest@127.0.0.1:54329/aisidequest_test'
$env:ALLOW_DATABASE_RESET='true'
npm.cmd run test:database
```

## 5.6 현재 검증 결과

| 구분 | 결과 |
|---|---:|
| React 테스트 | 47개 통과 |
| Codex 플러그인 테스트 | 9개 통과 |
| 운영 스크립트 테스트 | 3개 통과 |
| NestJS 비DB 테스트 | 17개 통과 |
| 인증·PostgreSQL·세션·퀘스트·통계 통합 테스트 | 45개 통과 |
| 전체 자동 테스트 | 121개 통과 |
| 프런트·서버 타입 검사 | 통과 |
| Vite 프로덕션 빌드 | 통과 |
| NestJS 프로덕션 빌드 | 통과 |
| 실제 Health Check | HTTP 200 확인 |
| `git diff --check` | 오류 없음 |

# 6. 현재 제한사항

- GitHub 로그인 진입점은 연결됐지만 실제 사용에는 OAuth App 자격 증명이 필요하다.
- 기존 참고 요약과 기간 통계용 퀘스트 이력은 브라우저 로컬 데이터이며 다른 기기와 공유되지 않는다.
- lifecycle hook event와 heartbeat는 durable JSONL queue에서 FIFO로 전송·재시도하며 실패 이벤트는 dead-letter로 격리한다.
- 실제 응시와 채점은 서버 transaction으로 처리하지만 통과 포인트는 아직 적립하지 않는다.
- 포인트 원장 테이블과 중복 제약은 있지만 적립 transaction 서비스가 없다.
- 통계는 브라우저 데이터로 계산되며 다른 기기와 공유되지 않는다.
- API 서버에는 운영 로그, 오류 추적, DB 백업이 아직 없다.
- API 개발 명령은 서버를 빌드한 뒤 실행하며 hot reload는 제공하지 않는다.

# 7. 12번 구현 결과

12번에서 다음 항목을 구현했다.

1. 활성 turn의 30초 heartbeat와 프로세스 재시작 가능한 상태 파일
2. append-only JSONL durable queue, 기기 sequence, FIFO single-flight 전송
3. 지수 backoff·full jitter·`Retry-After`, 재시도 한도와 7일 dead-letter
4. 자동 120초·순수 수동 12시간 만료와 24시간 orphan event 정리
5. 동일 기기·turn heartbeat 만료에 한정한 late `Stop` 복구

플러그인 9개, React 38개, NestJS 비DB 6개 테스트와 타입 검사·프로덕션 빌드를 통과했다. PostgreSQL 16에서는 migration 되돌리기·재적용, sequence 제약, 자동·수동 만료, orphan 정리와 late `Stop` 복구를 포함한 DB 통합 테스트 25개를 통과했다.

# 8. 13번 구현 결과

13번에서 다음 항목을 구현했다.

1. `PUBLISHED` 상태의 콘텐츠 유효한 최신 퀘스트만 반환하는 인증 목록·상세 API
2. 게시 시각·code·ID 기준의 안정적인 cursor pagination과 최대 50건 제한
3. 현재 사용자의 최근 응시 상태와 완료 상태를 분리해 제공하는 응답 DTO
4. 문제·선택지·정답·draft 내부 정보 비노출과 미게시 퀘스트 `404` 처리
5. 불완전한 퀘스트 게시와 게시 퀘스트의 정답 선택지 삭제를 막는 DB 제약
6. `mockQuests` 제거와 Home·Side Quest·Dashboard의 서버 catalog 전환
7. loading·empty·인증 만료·error·retry·기존 데이터를 유지하는 refresh 상태

React 43개, 플러그인 9개, NestJS 비DB 6개, PostgreSQL 통합 테스트 29개를 통과했다.

# 9. 14번 구현 결과

14번에서 다음 항목을 구현했다.

1. 활성 AI 세션과 게시 version에 고정되는 `Idempotency-Key` 기반 응시 시작
2. 소유권을 숨기는 응시 조회와 전체 답안 집합의 원자 교체
3. 새로고침 이후 문제·선택지와 저장 답안을 복구하는 실제 퀴즈 화면
4. 응시·세션 row lock과 저장 답안 기반 서버 채점 및 결과 snapshot
5. 동시 제출·중복 key·다른 본문의 key 재사용 방어
6. AI 세션 종료 후 정확히 5분까지 제출 허용과 `EXPIRED` cleanup
7. 실패·만료 재응시 정책, 통과 version 재응시 차단과 게시 콘텐츠 불변성
8. 응답 전체에서 정답 option과 답안별 판정 정보 비노출

React 44개, 플러그인 9개, NestJS 비DB 8개, PostgreSQL 통합 테스트 35개를 통과했다.

# 10. 15번 구현 결과

15번에서 다음 항목을 구현했다.

1. 최초 통과 채점과 100P 원장 INSERT의 단일 DB transaction
2. 사용자·quest version·attempt unique 제약과 row lock·멱등성 기반 이중 적립 방어
3. 기존 통과 응시 backfill과 안정적인 원장 cursor 조회 index
4. 본인 전용 포인트 잔액·원장 이력 API와 합계 overflow 검증
5. Home·Dashboard의 서버 잔액과 최근 원장 loading·empty·error·retry 표시
6. 강제 INSERT 실패 rollback, 같은·다른 key, 동시 제출, 실패·만료·소유권 PostgreSQL 검증

React 46개, 플러그인 9개, NestJS 비DB 8개, PostgreSQL 통합 테스트 37개를 통과했다.

# 11. 16번 구현 결과

16번에서 다음 항목을 구현했다.

1. 오늘·주·월·최대 366일 custom 서버 통계와 cursor 활동 이력 API
2. IANA time zone 검증·저장, 미확인 UTC fallback과 Dashboard 수정 안내
3. 동일 `meta.serverTime`을 사용하는 반열린 기간 경계와 활성 세션 overlap 집계
4. 최초 통과 수·point 원장 합계, `DEGRADED` 세션 수와 소유권 격리
5. LocalStorage 통계 계산 제거와 Home·Dashboard 서버 집계 전환
6. DST·월·연도 경계, cursor, 대량 fixture 실행 계획과 loading·error UI 검증

React 47개, 플러그인 9개, NestJS 비DB 8개, PostgreSQL 통합 테스트 41개를 통과했다.

# 12. 기준 문서

| 문서 | 역할 |
|---|---|
| [PROJECT_SPEC.md](./PROJECT_SPEC.md) | 현재 MVP와 프로젝트 요구사항 기준 |
| [BETA_IMPLEMENTATION_PLAN.md](./BETA_IMPLEMENTATION_PLAN.md) | 20개 실사용 베타 작업과 진행 상태 |
| [AUTO_DETECTION_POC.md](./AUTO_DETECTION_POC.md) | Codex 자동 감지 기술 검증과 라이브 결과 |
| [SESSION_STATE_AND_DATA_FLOW.md](./SESSION_STATE_AND_DATA_FLOW.md) | 세션 상태, 장애 규칙, 책임 분리, API 계약 |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | PostgreSQL 테이블, 제약, migration, seed와 실행 방법 |
| [AUTHENTICATION.md](./AUTHENTICATION.md) | GitHub OAuth, cookie 세션, CSRF와 인증 API 계약 |
| [SECURITY_AND_PRIVACY.md](./SECURITY_AND_PRIVACY.md) | Endpoint 보안 matrix, Rate Limit, 개인정보 보존·내보내기·삭제 기준 |
| [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md) | Request ID 로그, probe, 지표·경보, migration, backup·복원과 secret 회전 절차 |
| [CI_AND_RELEASE_GATES.md](./CI_AND_RELEASE_GATES.md) | CI job, branch protection, artifact 정책과 staging·Codex 릴리스 체크리스트 |
| [DISCOVER_CONTRACT.md](./DISCOVER_CONTRACT.md) | Discover source·저장·개인화·개인정보·release 계약 |
| [../Discover_개발_계획.md](../Discover_개발_계획.md) | Discover Task 21~33 순서와 완료 결과 |

---

당시 19번 완료 시점 결론: **분리된 GitHub Actions, PostgreSQL 16 migration·통합 gate와 Chromium 핵심 흐름을 구현했다.** 이후 20번 배포 패키지와 Discover Task 21~28 구현 결과는 아래에 이어서 기록한다.

# 13. 17번 구현 결과

17번에서는 다음 항목을 구현했다.

1. 전체 endpoint의 인증·CSRF·소유권·입력·멱등성·Rate Limit matrix
2. PostgreSQL 공유 bucket 기반 OAuth·기기 연결·integration event Rate Limit과 `429`, `Retry-After`
3. 16 KiB JSON 제한, 정확한 CORS origin, production HTTPS 강제, turn당 500 event 제한
4. token·cookie·OAuth code·경로를 제거하는 공통 redaction과 stack 비노출 오류 처리
5. CSRF와 15분 내 재인증을 요구하는 개인정보 내보내기·계정 삭제 API
6. 삭제 transaction 순서, 로컬 플러그인 정리 안내, 데이터별 보존·삭제 예외 정책
7. CORS·payload·금지 데이터·최근 인증·Rate Limit·삭제 격리 테스트와 의존성 audit

세부 기준은 [SECURITY_AND_PRIVACY.md](./SECURITY_AND_PRIVACY.md)에 기록했다.

React 47개, 플러그인 9개, NestJS 비DB 12개, PostgreSQL 통합 테스트 44개와 양쪽 production build를 통과했다. `npm audit --audit-level=high` 결과는 취약점 0건이다.

# 14. 18번 구현 결과

18번에서는 request ID 구조화 로그와 오류 event, DB·migration readiness, protected Prometheus metrics와 alert rule을 구현했다. 플러그인 heartbeat는 queue 원문 대신 depth·oldest age·dead-letter count만 보고한다. advisory lock migration runner와 암호화 backup·격리 복원 스크립트를 추가하고 실제 Docker PostgreSQL에서 복원 훈련을 완료했다.

운영 절차와 장애·secret 회전 기준은 [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md), 훈련 증적은 [2026-07-18-backup-restore-drill.md](./operations/2026-07-18-backup-restore-drill.md)에 기록했다.

# 15. 19번 구현 결과

19번에서는 읽기 전용 GitHub Actions를 quality, 비DB unit, PostgreSQL integration, migration·seed·upgrade, Chromium E2E로 분리했다. hook 자동 session이 반영된 브라우저에서 퀴즈 답안을 저장하고 새로고침으로 복구한 뒤 제출해 100P 원장과 Dashboard까지 확인한다. 플러그인에는 `429 Retry-After`, `5xx` backoff와 worker 재시작 검증을 추가했다.

React 47개, 플러그인 10개, 운영 3개, NestJS 비DB 17개, PostgreSQL 통합 45개, Chromium 핵심 흐름 1개 등 자동 테스트 123개와 lint·typecheck·production build를 통과했다. CI·branch protection·staging OAuth·실제 Codex 릴리스 기준은 [CI_AND_RELEASE_GATES.md](./CI_AND_RELEASE_GATES.md)에 기록했다.

# 16. 20번 구현 및 실행 준비 결과

20번에서는 Node 22 API와 Caddy 웹 운영 이미지, staging·production Compose와 secret template, digest 고정 release workflow를 추가했다. backup 증거→one-shot migration→readiness→웹→HTTPS·CORS·OAuth smoke 순서를 배포 스크립트에 고정하고 app-only rollback과 DB forward-fix 원칙을 구현했다.

event 수신과 퀘스트 제출·보상을 독립적으로 멈추는 kill switch를 추가했다. event 중단은 `503`과 `Retry-After`로 plugin queue를 보존하고, 보상 중단은 채점 transaction 전에 제출을 막는다. plugin bundle·설치 안내·개인정보 안내, 7일·10명·50건 checkpoint·100건 최종 표본과 품질 기준을 평가하는 파일럿 판정기도 추가했다.

Docker 리허설에서 11개 migration 적용과 재실행 `applied: []`, API·PostgreSQL health, Caddy 경유 health·CORS·OAuth state/PKCE·cookie·SPA smoke 10개를 통과했다. 세부 실행서는 [DEPLOYMENT_AND_PILOT.md](./DEPLOYMENT_AND_PILOT.md)에 기록했다. 실제 domain·DB·OAuth 자격증명, production 복원·rollback 증거, 초대 사용자 10명과 최소 7일 관찰이 완료되기 전까지 20번 전체는 미완료다.

# 17. Discover Task 21~28 구현 결과

Task 21~28에서 다음 범위를 구현했다.

1. Discover 제품·보상 분류·개인정보·release 계약과 공통 `DiscoverItem` API model
2. HTTPS host allowlist, timeout, 제한된 retry, plain-text 정제, PostgreSQL cache, source별 single-flight와 stale fallback
3. Hacker News Top·Ask·Show·Jobs와 Remotive Software Development adapter
4. GitHub login은 요구하지만 active AI session과 독립적인 `/discover` 화면, 세 category tab과 loading·empty·부분/전체 장애·pagination 상태
5. Server cache의 normalized item을 다시 검증하는 사용자별 저장 snapshot, CSRF·UUID idempotency·ownership·cursor 목록
6. 20개 고정 allowlist에서 최대 10개를 직접 선택하는 관심 기술 전체 교체 API와 DB 중복·허용값 제약
7. 관심 tag 일치 수, newest item 기준 상대 최신성 band, source 제공 engagement, 명확한 reward·compensation, 기존 시간순의 결정적 정렬
8. 관심 기술 일치·최신 항목·외부 반응·보상 정보 명확성으로 제한한 화면 추천 이유와 관심 변경 시 기존 cursor 거부
9. 저장 snapshot과 관심 기술을 포함하는 사용자 export schema version 3과 account delete transaction
10. Prompt, AI response, code, diff, transcript, raw command, tool input/output와 local path를 개인화·분석·운영 log에서 제외하는 경계

2026-07-21 현재 React 64개, Codex plugin 20개, 운영·local startup 17개, server non-database 47개, PostgreSQL integration 58개로 자동 테스트 총 206개를 통과했다. Lint, client·server typecheck, production build, 문서 link 검사, 17개 migration 전체 revert·reapply와 `git diff --check`도 통과했다.

다음 구현 작업은 Task 29의 DEV 개발 글과 Stack Overflow 미답변·reputation bounty 연동이다. Task 20은 repository package와 local rehearsal만 완료된 상태이며 실제 staging·production·pilot 증거 없이는 완료로 판정하지 않는다.
