# AISideQuest - Project Specification

> AI가 작업하는 동안 발생하는 대기 시간을 가치 있는 시간으로 전환하는 플랫폼

---

# 1. 프로젝트 개요

## 목표

AISideQuest는 AI(Codex, Cursor, Claude Code, GitHub Copilot 등)가 작업을 수행하는 동안 발생하는 대기 시간을 활용하여 사용자가 리워드를 얻거나 생산적인 활동을 할 수 있도록 지원하는 서비스이다.

기존에는 AI 응답을 기다리는 동안 아무것도 하지 않는 시간이 발생했다.

AISideQuest는 이 시간을 다음과 같은 가치로 전환한다.

- 리워드
- 설문조사
- 마이크로태스크
- 학습
- 개발 퀴즈
- 뉴스
- 기타 생산성 활동

---

# 2. 핵심 컨셉

메인 퀘스트

↓

AI가 코드 생성 중

↓

사이드 퀘스트 수행

↓

AI 작업 완료

↓

원래 작업으로 복귀

---

# 3. MVP 목표

첫 번째 버전에서는 최대한 단순하게 구현한다.

필수 기능

- AI 작업 시작 버튼
- AI 작업 종료 버튼
- 대기 시간 측정
- 사이드 퀘스트 목록 표시
- 퀘스트 완료 체크
- 누적 대기 시간 표시

실제 리워드 지급은 구현하지 않는다.

더미 데이터 기반으로 동작한다.

---

# 4. 사용자 흐름

## 1단계

사용자가 AI 작업을 시작한다.

예)

- Codex
- Cursor
- Claude Code

↓

"AI 작업 시작"

버튼 클릭

---

## 2단계

타이머 시작

경과 시간 표시

예상 대기 시간은 산정 기준이 확정되기 전까지 표시하지 않는다.

예)

```
AI 작업 진행 중

경과 시간

3분 42초
```

---

## 3단계

사이드 퀘스트 표시

예)

- 설문조사
- 개발 퀴즈
- 영어 단어
- 뉴스 읽기
- 마이크로태스크

---

## 4단계

사용자가 원하는 퀘스트 수행

---

## 5단계

AI 작업 종료

↓

타이머 종료

↓

오늘의 통계 업데이트

---

# 5. 화면 구성

## Home (`/`)

표시 정보

- 현재 AI 상태
- 진행 시간
- 오늘 대기 시간
- 오늘 수행한 퀘스트
- 예상 리워드

버튼

- AI 작업 시작
- AI 작업 종료

---

## Side Quest (`/quests`)

카드 형태

예)

설문조사

예상 시간

3분

예상 보상

500P

---

개발 퀴즈

예상 시간

2분

예상 보상

100P

---

뉴스 읽기

예상 시간

5분

예상 보상

50P

---

## Dashboard (`/dashboard`)

오늘

이번 주

이번 달

표시

- 총 AI 대기 시간
- 완료한 퀘스트
- 누적 포인트
- 예상 절약 시간

---

# 6. 데이터 모델

## User

- id
- nickname
- createdAt

---

## Session

AI 작업

- id
- startedAt
- endedAt
- duration

동시에 하나의 세션만 실행할 수 있다.
진행 중인 세션의 `endedAt`, `duration`은 `null`이며, 종료 시 `duration`을 밀리초 단위로 확정한다.
화면의 경과 시간은 누적 카운터가 아니라 현재 시각과 `startedAt`의 차이로 계산한다.
화면 이동과 새로고침 후에도 진행 중인 세션을 복구하고 기존 `startedAt`부터 경과 시간을 이어서 계산한다.

---

## Quest

- id
- title
- description
- reward
- estimatedMinutes

MVP에서는 설문조사, 개발 퀴즈, 영어 단어 학습, 뉴스 읽기, 마이크로태스크로 구성된 더미 데이터를 사용한다.
`reward`는 실제 지급액이 아닌 예상 포인트이다.

---

## QuestHistory

- id
- questId
- sessionId
- completed
- completedAt

활성 세션이 있을 때만 퀘스트를 완료할 수 있다.
완료 시 `completed`가 `true`인 이력을 생성하며 완료 취소는 제공하지 않는다.
같은 세션에서 같은 퀘스트는 한 번만 완료할 수 있고, 새 세션에서는 다시 완료할 수 있다.

---

## LocalStorage

- `aisidequest.sessions`: 진행 중 세션과 완료 세션
- `aisidequest.questHistories`: 퀘스트 완료 이력

현재 저장 스키마 버전은 `1`이며, 저장 데이터는 스키마 버전과 필드 형식을 검증한다.
손상 데이터나 지원하지 않는 버전은 안전한 초기 상태로 복구하며, 저장소 접근이 실패해도 현재 메모리 상태로 계속 동작한다.

---

# 7. 기술 스택

Frontend

- React
- TypeScript
- Vite
- TailwindCSS

Backend

- NestJS
- PostgreSQL

---

# 8. 개발 순서

구현이 완료될 때마다 실제 동작과 검증 결과를 기준으로 이 문서를 함께 현행화한다.

1. [x] React + TypeScript + Vite + TailwindCSS 구성 (2026-07-15)

2. [x] Home, Side Quest, Dashboard 화면 생성 (2026-07-15)

3. [x] 더미 퀘스트 데이터 작성 (2026-07-15)

4. [x] AI 작업 시작·종료와 타이머 구현 (2026-07-15)

5. [x] 퀘스트 완료 처리 (2026-07-15)

6. [x] LocalStorage 저장 및 새로고침 복구 (2026-07-15)

7. [ ] 오늘·이번 주·이번 달 통계 계산

8. [ ] 테스트·빌드 검증

9. [ ] 실제 구현 내용에 맞춰 PROJECT_SPEC.md 최종 점검

MVP 완료 후 PostgreSQL 연동, 로그인, 실제 리워드 연동을 순차적으로 진행한다.

---

# 9. 향후 기능

AI 자동 감지

VS Code Extension

Chrome Extension

Cursor Extension

Codex API 연동

Claude Code 연동

---

# 10. 아이디어

향후에는 다음과 같은 활동도 사이드 퀘스트가 될 수 있다.

- Stack Overflow 답변
- GitHub Issue 해결
- 오픈소스 기여
- 데이터 라벨링
- 영어 번역
- 코드 리뷰
- AI 학습 데이터 제작

---

# 11. 최종 목표

AI가 일하는 동안 사람도 성장하거나 수익을 얻을 수 있는 플랫폼을 만든다.

기다림은 더 이상 낭비되는 시간이 아니다.

AISideQuest는 AI 시대의 유휴 시간을 가장 가치 있게 사용하는 서비스를 목표로 한다.
