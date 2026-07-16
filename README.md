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
- Codex lifecycle hook
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

```powershell
npm.cmd run dev
```

터미널에 표시된 주소(기본 `http://localhost:5173`)로 접속합니다.

## API 개발 서버 실행

필요하면 `.env.example`을 참고하여 루트에 `.env`를 생성합니다. 기본값만 사용할 때는 `.env`가 없어도 실행됩니다.

```powershell
npm.cmd run dev:server
```

기본 API 주소는 `http://127.0.0.1:3000/api/v1`이며 Health Check는 다음 경로에서 확인합니다.

```text
GET http://127.0.0.1:3000/api/v1/health
```

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

- AI 작업 세션 시작, 복구, 종료
- 사이드 퀘스트 완료 및 중복 완료 방지
- LocalStorage 저장, 오류 데이터, 스키마 버전 처리
- 일간, 주간, 월간 활동 통계
- 경과 시간의 정상·경계·잘못된 입력
- Codex hook 개인정보 필터
- API Health Check와 공통 성공 응답
- 전역 입력 검증과 공통 오류 응답
- API 환경설정 기본값과 잘못된 포트 차단
- PostgreSQL migration 적용·되돌리기·재적용
- 개발 퀴즈 seed 멱등성과 핵심 FK·UK 제약

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

1. `AI 작업 시작`을 누른 후 타이머가 증가하는지 확인합니다.
2. 새로고침 후에도 세션과 타이머가 유지되는지 확인합니다.
3. 사이드 퀘스트를 완료하고 같은 퀘스트를 중복 완료할 수 없는지 확인합니다.
4. 대시보드의 오늘·주간·월간 통계에 결과가 반영되는지 확인합니다.
5. `AI 작업 종료` 후 완료된 세션 시간이 보존되는지 확인합니다.
6. 모바일 화면 크기에서 레이아웃과 주요 버튼이 정상적으로 표시되는지 확인합니다.

---

# 👨‍💻 최초 베타 대상 사용자

- Windows 11에서 ChatGPT 데스크톱 앱의 Codex 작업을 사용하는 개발자
- GitHub 계정으로 로그인할 수 있는 초대 기반 파일럿 사용자

---

# 🚧 현재 상태

현재는 브라우저 MVP, Codex 자동 감지 PoC, NestJS API 기반과 PostgreSQL 구조까지 완료된 실사용 베타 개발 단계입니다. 다음 작업은 GitHub OAuth 로그인입니다.

핵심 목표는 다음 한 문장으로 설명할 수 있습니다.

> **"AI가 일하는 동안, 사람도 의미 있는 일을 할 수 있도록."**

---

# 📌 앞으로의 계획

- GitHub OAuth 로그인과 서버 인증 세션
- AI 세션 API와 프런트엔드 서버 동기화
- AISideQuest Codex 플러그인 정식 연동
- 객관식 개발 퀴즈와 포인트 원장
- 서버 통계와 운영 파일럿

---

# 📄 License

MIT License
