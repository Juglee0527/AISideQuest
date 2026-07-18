# 🚀 AISideQuest

> AI가 일하는 동안, 당신은 사이드 퀘스트를 수행하세요.

AISideQuest는 AI가 작업을 수행하는 동안 발생하는 **대기 시간을 가치 있는 시간으로 바꾸는 플랫폼**입니다.

Codex, Cursor, Claude Code, GitHub Copilot 등 AI 에이전트가 코드를 생성하거나 작업을 수행하는 동안 개발자는 몇 분씩 기다리게 됩니다.

AISideQuest는 이 시간을 활용하여 리워드, 마이크로태스크, 학습 등 다양한 활동을 제공하는 것을 목표로 합니다.

---

# 🤔 왜 만들었나요?

AI는 개발 속도를 크게 높여주었습니다.

하지만 새로운 문제가 생겼습니다.

> **AI가 일하는 동안 사람은 기다립니다.**

한 번의 작업은 몇 초일 수도 있고, 몇 분이 걸릴 수도 있습니다.

하루에 여러 번 반복되는 이 대기 시간은 생각보다 큰 시간입니다.

AISideQuest는 이러한 시간을 단순한 기다림이 아니라 **가치 있는 시간**으로 바꾸기 위해 시작되었습니다.

---

# 🎯 목표

> **AI의 대기 시간을 새로운 기회로 만든다.**

사용자는 AI가 작업하는 동안

- 💰 리워드를 적립하고
- 📋 간단한 미션을 수행하고
- 📚 새로운 지식을 배우고
- 🧠 생산성을 높일 수 있습니다.

---

# ✨ 주요 기능 (계획)

## AI 작업 감지

- AI 작업 시작 감지
- 예상 완료 시간 표시
- 작업 완료 알림

## 사이드 퀘스트

- 리워드 미션
- 설문조사
- 마이크로태스크
- 학습 콘텐츠
- 개발 퀴즈
- 뉴스 브리핑

## 리워드

- 개발 퀴즈 성공 시 서비스 포인트 적립
- 사용자와 퀘스트 version당 1회 적립
- 베타 포인트는 현금 가치·환전·양도·구매 기능 없음

## 대시보드

- 오늘 AI 대기 시간
- 절약한 시간
- 수행한 퀘스트
- 누적 리워드
- 생산성 통계

---

# 🛠 기술 스택

## Frontend

- React
- TypeScript
- Vite
- Tailwind CSS

## Backend

- Node.js 22
- NestJS 11
- PostgreSQL 16
- TypeORM 1.1

## Codex 연동

- Windows ChatGPT 데스크톱 앱용 AISideQuest Codex 플러그인
- 개인정보 필터를 거친 Codex lifecycle hook 자동 전송
- 웹 일회성 연결 코드를 이용한 기기 연결

---

# 💻 로컬 실행

## 준비 사항

- Node.js 22 이상
- npm
- PostgreSQL 로컬 실행 시 Docker Desktop

## 의존성 설치

```powershell
npm.cmd install
```

## 프런트엔드 개발 서버 실행

프런트엔드는 기본적으로 `http://localhost:3000/api/v1`의 세션 API를 사용합니다. 다른 API 주소를 사용할 때는 `.env`의 `VITE_API_BASE_URL`을 변경합니다.

```powershell
npm.cmd run dev
```

터미널에 표시된 주소(기본 `http://localhost:5173`)로 접속합니다.

## API 개발 서버 실행

먼저 PostgreSQL을 실행하고 migration을 적용합니다.

```powershell
npm.cmd run db:up
npm.cmd run db:migrate
```

`.env.example`을 참고하여 루트에 `.env`를 생성합니다. GitHub 로그인을 사용하려면 GitHub OAuth App의 client ID와 secret이 필요합니다.

```powershell
npm.cmd run dev:server
```

브라우저에서 사용하는 기본 API 주소는 `http://localhost:3000/api/v1`이며 Health Check는 다음 경로에서 확인합니다. 서버는 로컬 인터페이스 `127.0.0.1`에 바인딩됩니다.

```text
GET http://localhost:3000/api/v1/health
```

GitHub 로그인은 다음 경로에서 시작합니다.

```text
GET http://localhost:3000/api/v1/auth/github
```

현재 사용자 조회는 `GET /api/v1/auth/me`, 로그아웃은 `POST /api/v1/auth/logout`입니다. OAuth App 설정, cookie와 CSRF 계약은 [`docs/AUTHENTICATION.md`](./docs/AUTHENTICATION.md)를 확인합니다.

AI 세션 API는 다음 경로를 사용합니다.

```text
POST /api/v1/sessions/manual
POST /api/v1/sessions/{sessionId}/end
GET  /api/v1/sessions/active
GET  /api/v1/sessions
POST /api/v1/integration-events
```

변경 API는 UUID `Idempotency-Key`가 필요하며 사용자 cookie 요청은 CSRF header도 함께 전송합니다. 상태 전이와 event 계약은 [`docs/SESSION_STATE_AND_DATA_FLOW.md`](./docs/SESSION_STATE_AND_DATA_FLOW.md)를 확인합니다.

## PostgreSQL 실행

```powershell
npm.cmd run db:up
npm.cmd run db:setup
```

테이블, 제약조건과 migration 기준은 [`docs/DATABASE_SCHEMA.md`](./docs/DATABASE_SCHEMA.md)를 확인합니다.

---

# 🧪 테스트

## 자동 테스트

```powershell
npm.cmd test
```

개발 중 파일 변경을 감지하여 테스트를 반복 실행하려면 다음 명령을 사용합니다.

```powershell
npm.cmd run test:watch
```

현재 자동 테스트는 다음 영역을 검증합니다.

- API 기반 AI 작업 세션 시작, polling, 복구, 종료
- 실제 개발 퀴즈 시작, 답안 저장·복구와 서버 채점
- 최초 통과 100P 적립, 포인트 잔액과 원장 이력 조회
- IANA 시간대 기준 오늘·주·월·직접 선택 서버 통계와 Dashboard
- 기존 LocalStorage 감지, 참고 요약·초기화, 손상 데이터 처리
- 인증 만료, 네트워크 오류 재시도, 서버 시각 보정
- 일간, 주간, 월간 활동 통계
- 경과 시간의 정상·경계·잘못된 입력
- Codex hook 개인정보 필터
- Codex lifecycle event 자동 전송과 연결 실패 시 로컬 fallback
- API Health Check와 공통 성공 응답
- 전역 입력 검증과 공통 오류 응답
- API 환경설정 기본값과 잘못된 포트 차단
- PostgreSQL migration 적용·되돌리기·재적용
- 개발 퀴즈 seed 멱등성과 핵심 FK·UK 제약
- GitHub OAuth state·PKCE, 사용자 연결과 hash 세션 저장
- 현재 사용자 조회, CSRF logout, 세션 만료·폐기
- AI 세션 수동 시작·종료, 활성 조회와 cursor 이력
- 동시 요청 멱등성, Codex event 상태 전이와 역순 event 복구
- 퀴즈 제출 멱등성·동시성, 5분 grace, 만료·재응시와 정답 비노출

DB 통합 테스트는 초기화 가능한 test 전용 DB에서 실행합니다.

```powershell
$env:TEST_DATABASE_URL='postgresql://aisidequest:aisidequest@127.0.0.1:54329/aisidequest_test'
$env:ALLOW_DATABASE_RESET='true'
npm.cmd run test:database
```

## 타입 검사

```powershell
npm.cmd run typecheck
```

## 프로덕션 빌드

```powershell
npm.cmd run build
```

프런트엔드 결과는 `dist`, API 결과는 `server/dist`에 생성됩니다. 프런트엔드 결과물을 로컬에서 확인하려면 다음 명령을 실행합니다.

```powershell
npm.cmd run preview
```

## 수동 검증 체크리스트

1. GitHub 로그인 후 `AI 작업 시작`을 누르면 서버 세션과 타이머가 생성되는지 확인합니다.
2. 새로고침하거나 같은 계정으로 다른 브라우저에서 접속해도 세션과 타이머가 유지되는지 확인합니다.
3. Codex 상태가 `WAITING_FOR_USER`이면 `Codex 확인 필요`가 5초 이내 표시되는지 확인합니다.
4. API를 잠시 중단했을 때 오류와 `다시 시도`가 표시되고 복구되는지 확인합니다.
5. 기존 MVP LocalStorage가 있으면 참고 요약 또는 초기화를 한 번 선택할 수 있는지 확인합니다.
6. 참고 요약의 퀘스트 완료 수가 현재 통계와 포인트에 합산되지 않는지 확인합니다.
7. `AI 작업 종료` 후 완료된 서버 세션 시간이 보존되는지 확인합니다.
8. 모바일 화면 크기에서 레이아웃과 주요 버튼이 정상적으로 표시되는지 확인합니다.
9. 연결된 Codex에서 작업을 시작·대기·재개·종료할 때 웹 상태가 5초 이내 갱신되는지 확인합니다.

---

# 👨‍💻 최초 베타 대상 사용자

- Windows 11에서 ChatGPT 데스크톱 앱의 Codex 작업을 사용하는 개발자
- GitHub 계정으로 로그인할 수 있는 초대 기반 파일럿 사용자

---

# 🚧 현재 상태

현재는 브라우저 MVP, NestJS API, PostgreSQL, GitHub OAuth, AI 세션 API와 AISideQuest Codex 플러그인의 자동 감지 연동을 완료한 실사용 베타 개발 단계입니다. 연결된 플러그인은 lifecycle event와 30초 heartbeat를 durable queue로 전송하며, 서버는 누락된 종료 event와 장시간 수동 세션을 안전 만료 처리합니다. 인증 사용자는 실제 개발 퀴즈 최초 통과 transaction에서 100P를 한 번만 적립받고, 저장된 IANA 시간대와 동일한 서버 기준 시각으로 오늘·주·월·직접 선택 통계를 확인합니다. 보안·개인정보 기준은 [`docs/SECURITY_AND_PRIVACY.md`](./docs/SECURITY_AND_PRIVACY.md), 운영 절차는 [`docs/OPERATIONS_RUNBOOK.md`](./docs/OPERATIONS_RUNBOOK.md), CI·릴리스 gate는 [`docs/CI_AND_RELEASE_GATES.md`](./docs/CI_AND_RELEASE_GATES.md), 실제 배포·파일럿 절차는 [`docs/DEPLOYMENT_AND_PILOT.md`](./docs/DEPLOYMENT_AND_PILOT.md)에 정리했습니다. 운영 패키지의 로컬 Docker 리허설은 통과했고 실제 domain·OAuth·PostgreSQL과 초대 사용자 파일럿은 남아 있습니다.

핵심 목표는 다음 한 문장으로 설명할 수 있습니다.

> **"AI가 일하는 동안, 사람도 의미 있는 일을 할 수 있도록."**

---

# 📌 앞으로의 계획

- 실제 staging·production domain, PostgreSQL, OAuth 자격증명 주입과 live browser 검증
- 초대 사용자 10명 이상·7일·자동 세션 100건 파일럿과 품질 기준 평가

---

# 📄 License

MIT License
