# AISideQuest - Project Specification

> AI가 작업하는 동안 발생하는 대기 시간을 가치 있는 시간으로 전환하는 플랫폼

- 현재 상태: 브라우저 LocalStorage 기반 MVP, NestJS API, PostgreSQL, GitHub OAuth 및 AI 세션 API 구현
- 애플리케이션 버전: `0.1.0`
- 최종 현행화: 2026-07-16

---

# 1. 문서 역할

이 문서는 AISideQuest의 요구사항과 현재 구현을 설명하는 기준 문서다.

- 기능을 구현하거나 변경할 때 실제 코드와 함께 이 문서를 현행화한다.
- 현재 동작과 향후 계획을 명확히 구분한다.
- 구현되지 않은 기능을 현재 기능처럼 작성하지 않는다.
- 정확한 패키지 버전과 실행 스크립트의 최종 기준은 `package.json`과 `package-lock.json`이다.

---

# 2. 프로젝트 개요

AISideQuest는 Codex, Cursor, Claude Code, GitHub Copilot 등 AI 도구가 작업하는 동안 발생하는 대기 시간을 활용해 사용자가 짧은 활동을 수행하도록 돕는 서비스다.

대기 시간을 다음과 같은 가치로 전환하는 것을 목표로 한다.

- 설문조사
- 개발 퀴즈
- 학습
- 뉴스 읽기
- 마이크로태스크
- 예상 리워드

현재 MVP에서 리워드는 실제 지급하지 않으며 더미 포인트만 표시한다.

---

# 3. 핵심 사용자 흐름

1. 사용자가 Home에서 `AI 작업 시작`을 선택한다.
2. AI 작업 세션이 생성되고 경과 시간 측정이 시작된다.
3. 사용자는 Side Quest에서 원하는 퀘스트를 완료한다.
4. 사용자가 `AI 작업 종료`를 선택한다.
5. 세션 종료 시각과 최종 작업 시간이 확정된다.
6. Home과 Dashboard 통계가 세션 및 퀘스트 완료 이력에서 다시 계산된다.

진행 중인 세션과 퀘스트 완료 이력은 LocalStorage에 저장되므로 새로고침 후에도 복구된다.

---

# 4. 현재 MVP 범위

## 4.1 구현 완료

- React SPA 기본 구성
- Home, Side Quest, Dashboard 화면
- 반응형 데스크톱·모바일 내비게이션
- 인증 사용자 AI 작업 수동 시작·종료 API 연동
- 서버 시각 보정 실시간 경과 시간 표시
- 화면 이동 중 타이머 유지
- 더미 퀘스트 5개 표시
- 활성 세션 내 퀘스트 완료 처리
- 세션별 퀘스트 중복 완료 차단
- 서버 세션 자동 저장, 새로고침·다른 인증 브라우저 복구
- 기존 LocalStorage 감지, 참고 요약 또는 초기화 전환
- 오늘·이번 주·이번 달 통계
- 자동 테스트와 프로덕션 빌드 검증

## 4.2 MVP 제외 범위

- 로그인 및 사용자 계정
- 다중 사용자 데이터 분리
- NestJS 백엔드
- PostgreSQL
- 실제 포인트 또는 현금성 리워드 지급
- AI 작업 자동 감지
- Codex, Cursor, Claude Code API 연동
- 브라우저 및 IDE 확장 프로그램
- 퀘스트별 실제 설문·퀴즈·뉴스 콘텐츠 실행

---

# 5. 화면 및 라우팅

## 5.1 Home (`/`)

표시 정보

- 현재 AI 작업 상태
- 현재 또는 최근 세션 시간
- 오늘 AI 대기 시간
- 오늘 완료한 퀘스트 수
- 오늘 예상 리워드

사용자 동작

- AI 작업 시작
- AI 작업 종료
- Side Quest 이동
- Dashboard 이동

동작 규칙

- 활성 세션이 있으면 시작 버튼을 비활성화한다.
- 활성 세션이 없으면 종료 버튼을 비활성화한다.
- 세션 종료 후 타이머 영역에는 최근 세션 시간을 유지한다.

## 5.2 Side Quest (`/quests`)

표시 정보

- 이용 가능한 퀘스트 목록
- 퀘스트 제목과 설명
- 예상 소요 시간
- 예상 보상
- 현재 세션 완료 수
- 퀘스트별 완료 상태

동작 규칙

- 활성 AI 세션이 있을 때만 퀘스트를 완료할 수 있다.
- 완료된 퀘스트는 현재 세션에서 다시 완료할 수 없다.
- 새 세션에서는 같은 퀘스트를 다시 완료할 수 있다.
- 퀘스트 완료 취소는 제공하지 않는다.

## 5.3 Dashboard (`/dashboard`)

조회 기간

- 오늘
- 이번 주
- 이번 달

표시 정보

- 총 AI 대기 시간
- 완료한 퀘스트 수
- 누적 예상 포인트
- 예상 절약 시간
- 선택 기간 활동 요약

예상 절약 시간은 계산 기준이 정의되지 않았으므로 현재 `-`로 표시한다.

## 5.4 잘못된 경로

정의되지 않은 경로로 접근하면 Home(`/`)으로 이동한다.

---

# 6. 기능 규칙

## 6.1 AI 작업 세션

- 동시에 하나의 세션만 실행할 수 있다.
- 시작 시 고유 ID와 ISO 8601 형식의 `startedAt`을 생성한다.
- 진행 중에는 `endedAt`과 `duration`이 `null`이다.
- 종료 시 `endedAt`과 밀리초 단위 `duration`을 확정한다.
- 실행 중 중복 시작과 대기 중 중복 종료는 상태 변경 없이 무시한다.
- 경과 시간은 매초 값을 누적하지 않고 `현재 시각 - startedAt`으로 계산한다.
- 브라우저가 비활성화되거나 새로고침되어도 실제 시작 시각을 기준으로 시간을 복구한다.
- 예상 대기 시간은 산정 기준이 없으므로 표시하지 않는다.

## 6.2 더미 퀘스트

| ID | 제목 | 예상 시간 | 예상 보상 |
|---|---|---:|---:|
| `survey-ai-workflow` | AI 작업 경험 설문 | 3분 | 500P |
| `quiz-typescript-basics` | TypeScript 기본 퀴즈 | 2분 | 100P |
| `learning-developer-words` | 개발 영어 단어 학습 | 4분 | 80P |
| `news-ai-briefing` | AI·개발 뉴스 읽기 | 5분 | 50P |
| `microtask-copy-review` | UI 문구 검토 | 7분 | 200P |

`reward`는 실제 지급액이 아니라 MVP 검증을 위한 예상 포인트다.

## 6.3 퀘스트 완료

- 완료 시 `QuestHistory`를 생성한다.
- 완료 이력은 활성 세션 ID와 퀘스트 ID를 함께 저장한다.
- `(sessionId, questId)` 조합은 중복될 수 없다.
- 퀘스트 ID가 비어 있거나 활성 세션이 없으면 완료 요청을 무시한다.
- 완료 처리는 단방향이며 완료 취소를 지원하지 않는다.

---

# 7. 데이터 모델

## 7.1 Session

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | `string` | 세션 고유 ID |
| `startedAt` | `string` | ISO 8601 시작 시각 |
| `endedAt` | `string \| null` | ISO 8601 종료 시각 |
| `duration` | `number \| null` | 밀리초 단위 최종 작업 시간 |

## 7.2 Quest

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | `string` | 퀘스트 고유 ID |
| `title` | `string` | 제목 |
| `description` | `string` | 설명 |
| `reward` | `number` | 예상 포인트 |
| `estimatedMinutes` | `number` | 예상 소요 시간(분) |

## 7.3 QuestHistory

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | `string` | 완료 이력 고유 ID |
| `questId` | `string` | 완료한 퀘스트 ID |
| `sessionId` | `string` | 연결된 AI 작업 세션 ID |
| `completed` | `boolean` | 현재 구현에서는 항상 `true` |
| `completedAt` | `string` | ISO 8601 완료 시각 |

## 7.4 서버 User

프런트엔드 MVP 상태에는 아직 연결되지 않았지만 서버는 GitHub OAuth 로그인 사용자를 다음 정보로 관리한다.

| 필드 | 설명 |
|---|---|
| `id` | 내부 UUID |
| `displayName` | GitHub 표시 이름 또는 사용자명 |
| `avatarUrl` | GitHub 프로필 이미지 URL |
| `githubLogin` | GitHub 사용자명 |

GitHub 숫자 ID는 `user_auth_accounts.provider_account_id`에 저장해 사용자명 변경과 관계없이 같은 사용자를 식별한다. 이메일과 GitHub access token은 저장하지 않는다.

---

# 8. 브라우저 저장소와 기존 데이터 전환

## 8.1 저장 키

| 키 | 저장 내용 |
|---|---|
| `aisidequest.sessions` | 구형 세션 데이터, 9번 전환 후 삭제 |
| `aisidequest.questHistories` | 구형 퀘스트 이력, 9번 전환 후 삭제 |
| `aisidequest.legacyMigration` | 초기화 또는 참고 보관 1회 완료 marker |
| `aisidequest.legacyReference` | 통계·포인트에 미반영하는 구형 참고 요약 |
| `aisidequest.questHistories.v2` | 13~14번 서버 전환 전까지 사용하는 신규 임시 퀘스트 이력 |

## 8.2 저장 형식

모든 값은 다음 버전 봉투 구조로 저장한다.

```json
{
  "version": 1,
  "data": {}
}
```

현재 저장 봉투 스키마 버전은 `1`이다. AI 세션은 LocalStorage에 저장하지 않고 세션 API만 사용한다.

## 8.3 검증 및 실패 처리

- JSON 파싱 실패 시 구형 값을 서버 상태로 사용하지 않는다.
- 지원하지 않는 스키마 버전은 사용하지 않는다.
- 필수 필드, 날짜 형식, 음수 시간, 세션 ID 중복을 검증한다.
- 퀘스트 완료 이력 ID와 `(sessionId, questId)` 중복을 검증한다.
- 검증에 실패한 구형 데이터는 참고 보관을 차단하고 초기화만 허용한다.
- LocalStorage 접근이 막혀도 서버 세션 기능은 계속 동작한다.
- 전환 완료 marker를 먼저 기록한 뒤 구형 원본을 삭제하고, 삭제 실패 시 다음 실행에서 정리를 반복한다.
- 구형 활성 세션, 예상 포인트와 개별 퀘스트 보상은 이전하지 않는다.
- 참고 보관은 완료 세션 수, 총 시간, 퀘스트 완료 수만 이 브라우저에 남긴다.

참고 요약과 임시 퀘스트 이력은 현재 브라우저 프로필에만 저장되며 서버 데이터가 아니다.

---

# 9. 통계 계산

## 9.1 기간 기준

- `meta.serverTime`으로 보정한 현재 시각을 사용하고 오늘·주·월 경계는 브라우저 time zone을 사용한다.
- 오늘은 로컬 자정부터 다음 자정 직전까지다.
- 이번 주는 월요일 00:00부터 다음 월요일 직전까지다.
- 이번 달은 매월 1일 00:00부터 다음 달 1일 직전까지다.

## 9.2 AI 대기 시간

- 완료 세션과 진행 중 세션을 포함한다.
- 진행 중 세션은 현재 시각까지만 계산한다.
- 기간 경계를 넘는 세션은 선택 기간과 실제로 겹치는 시간만 합산한다.
- 잘못된 날짜나 미래 구간은 `0`으로 안전 처리한다.

## 9.3 완료 퀘스트와 예상 포인트

- `completedAt`이 선택 기간에 포함되고 현재 시각보다 미래가 아닌 이력만 집계한다.
- 완료 퀘스트 수는 유효한 완료 이력 수다.
- 예상 포인트는 완료 이력의 `questId`로 현재 퀘스트 보상을 찾아 합산한다.
- 현재 목록에 없는 퀘스트 ID는 완료 수에는 포함하지만 예상 포인트는 `0P`로 처리한다.

## 9.4 예상 절약 시간

계산 규칙이 정의되지 않아 현재 값은 `null`이며 화면에는 `-`로 표시한다.

---

# 10. 상태 구조와 데이터 흐름

- `SessionContext`가 세션 API를 통해 활성 세션과 cursor 이력을 관리한다.
- `QuestHistoryContext`가 퀘스트 완료 이력을 관리한다.
- `QuestHistoryContext`는 현재 활성 세션을 확인한 후 완료 이력을 생성한다.
- `SessionContext`는 5초 polling과 focus·visibility 복귀 시 서버 활성 세션을 다시 조회한다.
- `LegacyDataMigrationGate`가 Context 마운트 전에 구형 LocalStorage를 처리한다.
- `QuestHistoryContext`만 v2 LocalStorage를 임시 사용하며 13~14번 작업에서 서버 API로 전환한다.
- Home과 Dashboard는 통계 결과를 별도 저장하지 않고 세션과 완료 이력에서 계산한다.
- 애플리케이션 전용 상태 관리 라이브러리는 사용하지 않는다.

---

# 11. 기술 스택

## 11.1 현재 구현

- React 19
- React DOM 19
- TypeScript 7
- Vite 8
- TailwindCSS 4
- React Router 7
- Lucide React
- Node.js 22
- NestJS 11
- NestJS Config 4
- class-validator
- class-transformer
- cookie-parser

## 11.2 테스트

- Vitest 4
- React Testing Library 16
- Testing Library DOM
- Testing Library Jest DOM
- jsdom 29
- Node.js test runner
- Supertest 7

## 11.3 백엔드 데이터베이스 구성

- PostgreSQL 16
- TypeORM 1.1 SQL migration
- 로컬 Docker Compose 실행 환경

현재 저장소에는 NestJS API, PostgreSQL 스키마·migration·개발 seed, GitHub OAuth 인증과 AI 세션 API가 있다. 퀘스트·포인트 비즈니스 API는 후속 작업에서 구현한다.

---

# 12. 실행 및 검증

## 12.1 실행 명령

```bash
npm install
npm run dev
npm run dev:server
```

## 12.2 검증 명령

```bash
npm test
npm run typecheck
npm run build
```

## 12.3 자동 테스트 범위

- 경과 시간 계산과 타이머 포맷
- 음수, 잘못된 시각, 1분 미만, 1시간 이상 경계값
- 자정을 넘긴 세션의 기간 겹침 계산
- 오늘·이번 주·이번 달 경계
- 진행 중 세션 통계
- 미래 완료 이력 제외
- 알려지지 않은 퀘스트의 보상 처리
- 세션 API cursor 이력, 인증 만료, 서버 응답 형식 검증
- 5초 polling, `WAITING_FOR_USER`, 서버 시각 보정
- 손상된 구형 JSON, 지원하지 않는 스키마와 LocalStorage 접근 실패 처리
- 구형 데이터 참고 요약·초기화, 1회 marker와 신규 키 분리
- `로그인 상태 → 서버 작업 시작 → 타이머 → 새로고침·브라우저 저장소 초기화 복구 → 서버 작업 종료` 통합 흐름
- API Health Check와 공통 성공 응답
- 전역 입력 검증과 공통 오류 응답
- API 환경설정 기본값과 범위 검증
- 빈 PostgreSQL DB migration 적용·되돌리기·재적용
- 개발 퀴즈 seed 반복 실행과 DB FK·UK 제약조건
- GitHub OAuth state·PKCE와 사용자·OAuth 계정 연결
- 서버 인증 세션, 현재 사용자 조회, CSRF logout과 세션 만료
- AI 세션 수동 시작·종료, 활성 조회와 cursor 이력
- Codex event 상태 전이, 동시성·멱등성과 역순 event 재처리

## 12.4 현재 검증 결과

2026-07-16 기준

- React 테스트 파일: 6개 통과
- React 자동 테스트: 31개 통과
- Codex hook 테스트: 4개 통과
- NestJS 통합 테스트: 4개 통과
- DB·인증·AI 세션 PostgreSQL 통합 테스트: 18개 통과
- TypeScript 타입 검사 통과
- Vite 및 NestJS 프로덕션 빌드 통과
- 실제 `GET /api/v1/health` HTTP 200 확인
- npm 패키지 취약점 0건
- `git diff --check` 오류 없음

---

# 13. 현재 제한사항

- AI 세션은 서버에 저장되지만 퀘스트 완료·예상 포인트는 아직 브라우저 임시 데이터다.
- 기존 MVP 참고 요약은 서버로 이전하지 않아 다른 브라우저와 공유되지 않는다.
- 자동 세션 만료 정리와 heartbeat 장애 복구는 12번 작업 전까지 적용되지 않는다.
- 퀘스트는 실제 콘텐츠를 실행하지 않고 완료 상태만 기록한다.
- 퀘스트 완료 취소를 지원하지 않는다.
- 실제 리워드를 지급하지 않는다.
- 예상 대기 시간과 예상 절약 시간의 계산 규칙이 없다.
- GitHub 로그인 진입 UI는 연결됐지만 실제 사용에는 OAuth App 자격 증명이 필요하다.
- AI 세션 API는 프런트엔드가 호출하지만 Codex 플러그인은 아직 호출하지 않는다.
- Codex 기기 token 발급과 플러그인 서버 연동이 없다.
- 세션만 PostgreSQL 데이터를 사용하며 퀘스트·포인트·통계 API 전환은 후속 작업이다.

---

# 14. MVP 개발 현황

구현이 완료될 때마다 실제 동작과 검증 결과를 기준으로 이 문서를 함께 현행화한다.

1. [x] React + TypeScript + Vite + TailwindCSS 구성 (2026-07-15)
2. [x] Home, Side Quest, Dashboard 화면 생성 (2026-07-15)
3. [x] 더미 퀘스트 데이터 작성 (2026-07-15)
4. [x] AI 작업 시작·종료와 타이머 구현 (2026-07-15)
5. [x] 퀘스트 완료 처리 (2026-07-15)
6. [x] LocalStorage 저장 및 새로고침 복구 (2026-07-15)
7. [x] 오늘·이번 주·이번 달 통계 계산 (2026-07-15)
8. [x] 테스트·빌드 검증 (2026-07-15)
9. [x] 실제 구현 내용에 맞춰 `PROJECT_SPEC.md` 최종 점검 (2026-07-15)

---

# 15. 다음 개발 단계

MVP 이후의 실사용 베타 개발은 [`BETA_IMPLEMENTATION_PLAN.md`](./BETA_IMPLEMENTATION_PLAN.md)를 기준으로 20개 작업을 순서대로 진행한다.

2026-07-16 기준 진행 상태

1. [x] 실사용 베타 범위 확정
2. [x] AI 작업 자동 감지 기술 검증 - 정상 turn 자동 감지 및 fallback 범위 확정
3. [x] 세션 상태와 데이터 흐름 설계 - 상태 전이, 책임 분리, API 계약 확정
4. [x] NestJS 백엔드 기본 구성 - Health Check 및 공통 API 기반 구현
5. [x] PostgreSQL 데이터베이스 구성 - migration, 개발 seed, DB 제약 통합 테스트 완료
6. [x] 사용자 로그인 구현 - GitHub OAuth, 서버 세션, 현재 사용자 조회와 logout 완료
7. [x] AI 세션 API 구현 - 상태 전이, 멱등성, 동시성 및 이력 조회 완료
8. [x] 프런트엔드 세션 상태를 API로 전환 - polling, 시각 보정, 인증·오류 상태 완료
9. [x] 기존 LocalStorage 데이터 처리 - 참고 요약·초기화, 손상·재실행 처리 완료
10. [ ] AISideQuest Codex 플러그인 기본 구성 - 다음 작업

확정된 최초 베타 범위

- 최초 지원 도구: Windows ChatGPT 데스크톱 앱의 Codex 작업
- 최초 지원 환경: Windows 11, Windows native agent 및 PowerShell
- 로그인: GitHub OAuth
- 최초 퀘스트: 객관식 개발 퀴즈
- 포인트: 현금 가치가 없는 서비스 포인트
- 파일럿: 초대 기반 폐쇄형 베타
- 개인정보 원칙: 프롬프트, Codex 응답, 소스 코드, 파일 경로를 수집하지 않음

세션 상태와 데이터 흐름의 상세 계약은 [`SESSION_STATE_AND_DATA_FLOW.md`](./SESSION_STATE_AND_DATA_FLOW.md)를 따른다.
PostgreSQL 구조와 실행 방법은 [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)를 따른다.
사용자 인증 계약과 설정 방법은 [`AUTHENTICATION.md`](./AUTHENTICATION.md)를 따른다.

---

# 16. 향후 기능

- VS Code Extension
- Chrome Extension
- Cursor Extension
- Codex API 연동
- Claude Code 연동
- 사용자별 퀘스트 추천
- 생산성 분석 고도화

---

# 17. 확장 아이디어

- Stack Overflow 답변
- GitHub Issue 해결
- 오픈소스 기여
- 데이터 라벨링
- 영어 번역
- 코드 리뷰
- AI 학습 데이터 제작

---

# 18. 최종 목표

AI가 일하는 동안 사람도 성장하거나 수익을 얻을 수 있는 플랫폼을 만든다.

기다림은 더 이상 낭비되는 시간이 아니다.

AISideQuest는 AI 시대의 유휴 시간을 가장 가치 있게 사용하는 서비스를 목표로 한다.
