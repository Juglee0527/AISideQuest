# AISideQuest 개발 진행 요약

- 작성일: 2026-07-16
- 애플리케이션 버전: `0.1.0`
- 전체 실사용 베타 작업: 20개
- 완료: 1~6번, 총 6개
- 다음 작업: 7. AI 세션 API 구현

---

# 1. 현재 상태 요약

AISideQuest는 브라우저 LocalStorage 기반 MVP에서 실제 사용 가능한 폐쇄형 베타로 전환 중이다.

현재까지 다음 기반을 확보했다.

1. 최초 베타 대상, 로그인, 퀘스트, 포인트, 개인정보 범위를 확정했다.
2. Windows ChatGPT 데스크톱 앱의 Codex hook으로 작업 시작과 종료를 실제 감지했다.
3. 자동 감지와 수동 조작을 하나의 서버 세션으로 처리하는 상태 및 API 계약을 확정했다.
4. NestJS API 실행 환경과 공통 응답, 오류 처리, 입력 검증, Health Check를 구현했다.
5. PostgreSQL 스키마, migration, 개발 퀴즈 seed와 DB 제약조건 검증을 구현했다.
6. GitHub OAuth 로그인, 서버 저장형 인증 세션, 현재 사용자 조회와 logout을 구현했다.

현재 인증 API는 PostgreSQL에 연결됐지만 프런트엔드는 아직 로그인 UI와 서버 API를 사용하지 않고 세션·퀘스트 데이터를 LocalStorage에 저장한다.

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
- [플러그인 hook 설정](../plugins/aisidequest-hook-poc/hooks/hooks.json)
- [개인정보 필터](../plugins/aisidequest-hook-poc/scripts/event-recorder.mjs)
- [hook 테스트](../plugins/aisidequest-hook-poc/tests/event-recorder.test.mjs)

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

- [서버 진입점](../server/src/main.ts)
- [애플리케이션 모듈](../server/src/app.module.ts)
- [환경설정 검증](../server/src/config/environment.ts)
- [애플리케이션 공통 설정](../server/src/bootstrap/configure-application.ts)
- [공통 성공 응답](../server/src/common/http/api-response.interceptor.ts)
- [공통 오류 응답](../server/src/common/http/api-exception.filter.ts)
- [Health Check](../server/src/health/health.controller.ts)
- [서버 통합 테스트](../server/test/app.e2e.test.ts)

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

# 4. 현재 디렉터리 구조

```text
AISideQuest/
├─ src/                         React MVP
├─ server/
│  ├─ src/
│  │  ├─ auth/                  GitHub OAuth, cookie 세션과 인증 guard
│  │  ├─ bootstrap/             전역 API 설정
│  │  ├─ common/http/           공통 성공·오류 응답
│  │  ├─ config/                환경설정 검증
│  │  ├─ database/              DataSource, migration, 개발 seed
│  │  ├─ health/                Health Check
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
| React 테스트 | 19개 통과 |
| Codex hook 테스트 | 4개 통과 |
| NestJS 통합 테스트 | 4개 통과 |
| 인증·PostgreSQL 통합 테스트 | 9개 통과 |
| 전체 자동 테스트 | 36개 통과 |
| 프런트·서버 타입 검사 | 통과 |
| Vite 프로덕션 빌드 | 통과 |
| NestJS 프로덕션 빌드 | 통과 |
| 실제 Health Check | HTTP 200 확인 |
| `git diff --check` | 오류 없음 |

# 6. 현재 제한사항

- GitHub OAuth와 인증 API는 구현됐지만 실제 OAuth App 자격 증명과 프런트엔드 로그인 UI는 아직 연결되지 않았다.
- 서버 세션 API는 설계만 있고 구현되지 않았다.
- 프런트엔드 `SessionContext`는 여전히 LocalStorage를 사용한다.
- 기존 LocalStorage 데이터 전환 정책은 구현되지 않았다.
- Codex 플러그인은 로컬 PoC이며 서버로 event를 전송하지 않는다.
- heartbeat, 오프라인 queue, 재전송은 설계만 있고 구현되지 않았다.
- DB에는 개발 퀘스트 seed가 있지만 프런트엔드는 여전히 더미 데이터를 사용하며 서버 판정이 없다.
- 포인트 원장 테이블과 중복 제약은 있지만 적립 transaction 서비스가 없다.
- 통계는 브라우저 데이터로 계산되며 다른 기기와 공유되지 않는다.
- API 서버에는 운영 로그, 오류 추적, DB 백업이 아직 없다.
- API 개발 명령은 서버를 빌드한 뒤 실행하며 hot reload는 제공하지 않는다.

# 7. 다음 작업: AI 세션 API 구현

7번 작업에서 다음 항목을 진행한다.

1. 인증된 사용자의 수동 세션 시작·종료 API 구현
2. 현재 활성 세션과 cursor 기반 이력 조회 구현
3. 서버 기준 시각과 상태 전이 transaction 적용
4. `Idempotency-Key`, request hash와 DB unique 제약으로 중복 요청 처리
5. 사용자 소유권, 동시 시작, 중복·역순 종료 통합 테스트

# 8. 기준 문서

| 문서 | 역할 |
|---|---|
| [PROJECT_SPEC.md](./PROJECT_SPEC.md) | 현재 MVP와 프로젝트 요구사항 기준 |
| [BETA_IMPLEMENTATION_PLAN.md](./BETA_IMPLEMENTATION_PLAN.md) | 20개 실사용 베타 작업과 진행 상태 |
| [AUTO_DETECTION_POC.md](./AUTO_DETECTION_POC.md) | Codex 자동 감지 기술 검증과 라이브 결과 |
| [SESSION_STATE_AND_DATA_FLOW.md](./SESSION_STATE_AND_DATA_FLOW.md) | 세션 상태, 장애 규칙, 책임 분리, API 계약 |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | PostgreSQL 테이블, 제약, migration, seed와 실행 방법 |
| [AUTHENTICATION.md](./AUTHENTICATION.md) | GitHub OAuth, cookie 세션, CSRF와 인증 API 계약 |

---

현재 결론: **GitHub OAuth와 서버 인증 세션까지 구현됐다. 다음 단계에서는 인증된 사용자별 AI 세션 API와 멱등성 경계를 구현한다.**
