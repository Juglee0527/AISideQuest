# AISideQuest 실사용 베타 구현 계획

> 브라우저 LocalStorage 기반 MVP를 실제 사용 가능한 폐쇄형 베타로 전환하기 위한 기준 문서

- 작성일: 2026-07-15
- 최종 보완일: 2026-07-18
- 전체 작업: 20개
- 현재 완료: 16개
- 다음 작업: 17. 보안과 개인정보 보호 최종 점검
- 기준 원칙: 한 번에 한 작업만 구현하고 각 작업의 완료 기준을 검증한 뒤 다음 작업으로 이동한다.

---

# 1. 진행 현황

| 번호 | 작업 | 상태 |
|---:|---|---|
| 1 | 실사용 베타 범위 확정 | 완료 (2026-07-15) |
| 2 | AI 작업 자동 감지 기술 검증 | 완료 (2026-07-15) |
| 3 | 세션 상태와 데이터 흐름 설계 | 완료 (2026-07-15) |
| 4 | NestJS 백엔드 기본 구성 | 완료 (2026-07-15) |
| 5 | PostgreSQL 데이터베이스 구성 | 완료 (2026-07-16) |
| 6 | 사용자 로그인 구현 | 완료 (2026-07-16) |
| 7 | AI 세션 API 구현 | 완료 (2026-07-16) |
| 8 | 프런트엔드 세션 상태를 API로 전환 | 완료 (2026-07-16) |
| 9 | 기존 LocalStorage 데이터 처리 | 완료 (2026-07-16) |
| 10 | AISideQuest Codex 플러그인 기본 구성 | 완료 (2026-07-16) |
| 11 | AI 작업 자동 감지 연동 | 완료 (2026-07-16) |
| 12 | Heartbeat와 장애 복구 구현 | 완료 (2026-07-18) |
| 13 | 퀘스트 목록 API 구현 | 완료 (2026-07-18) |
| 14 | 실제 개발 퀴즈 구현 | 완료 (2026-07-18) |
| 15 | 포인트 원장 구현 | 완료 (2026-07-18) |
| 16 | 통계 API와 대시보드 전환 | 완료 (2026-07-18) |
| 17 | 보안과 개인정보 보호 최종 점검 | 다음 작업 |
| 18 | 운영 로그와 장애 대응 구성 | 대기 |
| 19 | 통합 테스트와 CI 구성 | 대기 |
| 20 | 운영 배포와 파일럿 진행 | 대기 |

---

# 2. 전체 작업 목록

## 1. 실사용 베타 범위 확정

- 최초 지원 AI 도구 1개 선정
- 로그인 방식, 최초 퀘스트 종류, 포인트 정책 결정
- 현금성 리워드를 베타 범위에서 제외
- 완료 기준: 미결정 핵심 요구사항 없이 범위 문서 확정

상태: **완료**

## 2. AI 작업 자동 감지 기술 검증

- 선정한 AI 도구의 공식 API, 이벤트, hook 조사
- 작업 시작과 종료를 실제로 감지하는 최소 PoC 작성
- 프롬프트와 소스 코드 없이 감지 가능한지 검증
- 완료 기준: 자동 감지 가능 여부와 수동 모드 전환 기준 확정

상태: **완료**

검증 결과: 정상 Codex turn에서 `UserPromptSubmit`과 `Stop`으로 시작·종료를 자동 감지했다. hook 미수신과 비정상 종료는 heartbeat 만료 및 수동 모드로 처리한다.

상세 검증 기록: [`AUTO_DETECTION_POC.md`](./AUTO_DETECTION_POC.md)

## 3. 세션 상태와 데이터 흐름 설계

- 세션 상태를 `RUNNING`, `WAITING_FOR_USER`, `COMPLETED`, `FAILED`, `ABANDONED`로 정의
- 자동 감지와 수동 시작의 충돌 규칙 정의
- 서버, 웹, Codex 데스크톱 앱 플러그인의 책임 구분
- 완료 기준: 상태 전이, 예외 상황, API 계약 문서화

상태: **완료**

설계 결과: Codex turn 1개를 세션 단위로 사용하고 서버가 상태와 시각을 소유한다. 사용자당 활성 세션 1개, 자동·수동 충돌 규칙, heartbeat 만료, 멱등성 및 API 계약을 확정했다.

상세 설계: [`SESSION_STATE_AND_DATA_FLOW.md`](./SESSION_STATE_AND_DATA_FLOW.md)

## 4. NestJS 백엔드 기본 구성

- 백엔드 프로젝트 생성
- 환경설정, 공통 응답, 오류 처리, 입력 검증 구성
- Health Check API와 기본 테스트 추가
- 완료 기준: 개발 환경에서 서버 실행 및 Health Check 통과

상태: **완료**

구현 결과: `server/`에 NestJS 11 API를 추가하고 환경설정 검증, 공통 성공·오류 응답, 전역 ValidationPipe, CORS, `GET /api/v1/health`를 구성했다. 서버 통합 테스트와 실제 HTTP Health Check를 통과했다.

## 5. PostgreSQL 데이터베이스 구성

- PostgreSQL 16과 TypeORM 기반 migration 실행 환경 구성
- 사용자, OAuth 계정, 기기, 세션, integration event, 퀘스트, 응시, 포인트 원장 설계
- FK, UK, 부분 unique index, check constraint와 조회 index 작성
- 버전이 부여된 객관식 개발 퀴즈 5개를 idempotent seed로 추가
- migration 적용, 재실행, 되돌리기, 재적용과 핵심 제약조건 통합 테스트
- 완료 기준: 빈 DB에서 migration만으로 전체 구조를 만들고 seed와 제약조건 테스트 통과

상태: **완료**

구현 결과: PostgreSQL 16 로컬 실행 환경, TypeORM SQL migration, 11개 테이블, 개발 퀴즈 5개 seed를 추가했다. 사용자당 활성 세션 1개, 기기별 event 멱등성, 사용자와 퀘스트 버전당 보상 1회를 DB 제약으로 보장하며 통합 테스트 5개를 통과했다. 상세 기준은 [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)에 기록했다.

## 6. 사용자 로그인 구현

- GitHub OAuth 단일 로그인과 `user_auth_accounts` 연결 구현
- 서버 저장형 웹 인증 세션과 `HttpOnly`, `Secure`, `SameSite` cookie 적용
- OAuth `state`, 세션 고정 공격, CSRF, 만료와 logout 시 세션 폐기 처리
- 현재 사용자 조회, logout, 탈퇴 전 계정 식별 경계 구현
- 인증·소유권 검증과 로그인 callback 통합 테스트
- 완료 기준: 로그인 사용자만 자신의 API에 접근하고 logout·만료 후 재사용 불가

상태: **완료**

구현 결과: GitHub OAuth state와 PKCE를 적용하고 GitHub 숫자 ID로 사용자를 연결했다. 서버 저장형 hash 세션, 안전한 cookie, CSRF guard, 현재 사용자 조회와 logout을 구현했으며 실제 PostgreSQL을 사용하는 인증·DB 통합 테스트 9개를 통과했다. 상세 기준은 [`AUTHENTICATION.md`](./AUTHENTICATION.md)에 기록했다.

## 7. AI 세션 API 구현

- 수동 시작·종료, 현재 세션, cursor 기반 이력 조회 API 구현
- Codex integration event 수신 API와 상태 전이 transaction 구현
- 서버 수신 시각을 기준으로 기록하고 응답에 `meta.serverTime` 포함
- `Idempotency-Key`, request hash, event unique key로 중복·본문 변경 구분
- 사용자별 활성 세션 잠금과 DB unique 제약으로 동시 시작 직렬화
- 인증, 소유권, 상태 전이, 중복·역순 요청 통합 테스트
- 완료 기준: 동시·중복 시작과 종료에도 상태 및 event가 한 번만 변경

상태: **완료**

구현 결과: 인증 사용자용 수동 시작·종료·활성 세션·cursor 이력 API와 device token 기반 Codex event API를 구현했다. 사용자 단위 PostgreSQL advisory lock, 활성 세션 unique index, 요청 hash와 응답 snapshot을 저장하는 멱등성 원장으로 동시·중복 요청을 처리한다. 실제 PostgreSQL에서 인증·DB·세션 통합 테스트 18개를 통과했다. 세부 계약은 [`SESSION_STATE_AND_DATA_FLOW.md`](./SESSION_STATE_AND_DATA_FLOW.md)를 따른다.

## 8. 프런트엔드 세션 상태를 API로 전환

- `SessionContext`의 LocalStorage 의존 제거
- 서버에서 활성 세션과 이력 복구
- `RUNNING`, `WAITING_FOR_USER`, 종료 상태를 명시적으로 표현
- 5초 polling, 창 focus 즉시 조회, 서버 시각 보정 적용
- 로딩, 인증 만료, 오류, 재시도와 수동 fallback 상태 추가
- 완료 기준: 새로고침 및 다른 인증 기기에서도 같은 활성 세션과 경과 시간 확인

상태: **완료**

구현 결과: `SessionContext`를 cookie 인증 기반 세션 API adapter로 전환하고 활성 세션·cursor 이력 복구, 5초 polling, focus·visibility 즉시 조회, `meta.serverTime` 시각 보정을 적용했다. `RUNNING`과 `WAITING_FOR_USER`를 구분하며 로딩, 인증 만료, 네트워크 오류, 재시도, 변경 요청 중 상태를 화면에 연결했다.

## 9. 기존 LocalStorage 데이터 처리

- 기존 MVP 데이터 감지
- 사용자 선택에 따라 초기화하거나 보상 없는 참고 이력으로 1회 이전
- 조작 가능한 기존 포인트는 서버 포인트로 인정하지 않음
- 이전 완료 marker와 실패 시 재시도·초기화 경로 제공
- 민감하지 않은 로컬 데이터만 읽고 이전 후 잔존 데이터 정리
- 완료 기준: 재실행과 일부 손상 데이터에서도 중복 없이 서버 방식으로 전환

상태: **완료**

구현 결과: 구형 `aisidequest.sessions`, `aisidequest.questHistories`를 앱 시작 전에 검증해 사용자 선택으로 초기화하거나 보상 없는 로컬 참고 요약으로 1회 보관한다. 완료 marker 이후 원본을 반복 정리하고, 손상 데이터는 참고 보관을 차단한다. 기존 활성 세션과 예상 포인트는 서버 세션·통계·포인트로 이전하지 않으며 신규 임시 퀘스트 이력은 별도 v2 키를 사용한다.

## 10. AISideQuest Codex 플러그인 기본 구성

- Codex 데스크톱 앱에 설치할 AISideQuest 플러그인 구성
- PoC lifecycle hook과 개인정보 필터를 정식 플러그인 구조로 이전
- 플러그인 설치, 활성화, hook 신뢰 승인 흐름 구현
- 웹 일회성 연결 코드로 기기 token 발급, hash 저장, 만료·회전·연결 해제 구현
- 서버로 테스트 이벤트를 전송하는 기능 구현
- 완료 기준: GitHub 자격 증명 저장 없이 로컬 event를 서버 사용자와 안전하게 연결 가능

상태: **완료**

구현 결과: 공식 Codex 플러그인 구조와 repo-local marketplace를 구성하고, PoC hook 개인정보 필터를 서버 event 계약에 맞게 이전했다. 웹이 생성한 10분 유효 일회성 코드는 서버에 hash로만 저장하며 플러그인이 생성한 90일 기기 token도 원문은 로컬에만 보관한다. 연결, 회전, 폐기 API는 인증·CSRF·소유권·멱등성을 검증하고, 명시적 `SessionStart` 테스트 event로 기기를 서버 사용자와 연결한다. hook의 자동 서버 전송은 11번 범위로 유지한다.

## 11. AI 작업 자동 감지 연동

- 2번 PoC 결과를 Codex 데스크톱 앱 플러그인에 적용
- 시작, 사용자 응답 대기, 재개, 종료 이벤트를 세션 API에 연결
- hook 원본이 아니라 허용 필드와 hash 식별자만 전송
- 웹에서 자동 감지 연결 상태와 마지막 수신 시각 표시
- 지원하지 않는 상황에서는 수동 모드 제공
- 완료 기준: Codex 작업 상태가 웹 화면에 자동 반영

상태: **완료**

구현 결과: 정식 플러그인의 6개 lifecycle hook이 개인정보 필터를 거친 event를 로컬에 먼저 기록하고 세션 API로 자동 전송한다. 서버는 유효 event transaction에서만 기기의 `lastSeenAt`과 세션 상태를 갱신하며, 웹은 5초 polling으로 세션과 기기 상태를 반영한다. 기기 화면은 활성 연결 없음, 첫 event 대기, event 수신을 구분하고 자동 전송 실패 또는 hook 미지원 시 기존 수동 시작·종료를 유지한다. heartbeat와 durable 재전송은 12번 범위로 남긴다.

## 12. Heartbeat와 장애 복구 구현

- 자동 turn에 연결된 활성 세션에서만 30초 간격 `Heartbeat`를 생성하고, lifecycle event와 동일하게 로컬 queue에 먼저 기록한 뒤 전송
- 현재 플러그인 배포 구조를 유지하기 위해 네이티브 의존성 없는 append-only JSONL spool과 원자적 checkpoint/compaction으로 durable queue 구현
- event마다 기기 단위 증가 `sequence`와 재전송에도 바뀌지 않는 `eventId`를 저장하고, 기기별 single-flight worker가 FIFO로 한 건씩 전송
- 연속된 미전송 `Heartbeat`만 안전하게 병합하고 `UserPromptSubmit`, `PermissionRequest`, `PostToolUse`, `Stop`의 상대 순서는 변경하지 않음
- 성공 또는 서버의 멱등 중복 응답을 받은 뒤에만 queue에서 ack 처리하고, 프로세스 강제 종료와 부분 파일 쓰기 이후에도 미확인 event를 복구
- 네트워크 오류, `408`, `429`, `5xx`는 `Retry-After`를 우선하고 `1초 → 2초 → 4초` 지수 backoff, 최대 5분, full jitter, event당 최대 300회 또는 24시간까지 재시도
- 재시도할 수 없는 `4xx`와 최대 횟수·기간을 소진한 event는 영구 실패로 분류하고, `401`·`403`은 기기 재연결이 필요한 `AUTH_BLOCKED`로 표시해 무한 재시도를 중단
- 활성 queue는 10,000건 또는 10MiB, 48시간으로 제한하고 만료된 heartbeat를 먼저 제거하며, 나머지 영구 실패 event는 실패 사유와 함께 7일 제한 dead-letter queue에 보관
- queue 초과 시 lifecycle event를 조용히 폐기하지 않고 로컬 진단 상태와 웹의 재연결·수동 fallback 안내에 반영
- 서버 정리 job은 다중 인스턴스에서도 한 번만 적용되도록 DB lock과 조건부 update를 사용하고, 자동 연결 세션은 마지막 유효 활동 후 120초, 순수 수동 세션은 시작 후 12시간에 `ABANDONED` 처리
- 만료 job이 늦게 실행돼도 자동 세션의 `endedAt`은 `lastActivityAt + 120초`, 수동 세션은 `startedAt + 12시간`으로 기록해 통계가 scheduler 지연만큼 늘어나지 않게 처리
- 시작 event 없이 24시간이 지난 `DEFERRED` event는 `IGNORED_ORPHAN`으로 정리
- `HEARTBEAT_TIMEOUT`으로 끝난 같은 사용자·기기·turn의 `Stop`만 만료 후 24시간 안에 `COMPLETED/RECOVERED_LATE_STOP`으로 복구하고, 기존 `endedAt`은 유지하며 `timingQuality=DEGRADED`로 표시
- 수동 종료, 새 turn에 의한 종료 또는 24시간이 지난 terminal event는 과거 상태를 다시 열지 않음
- 플러그인 시작 시 queue 복구와 전송을 먼저 수행하고, Codex·플러그인 비정상 종료는 별도 추측 상태가 아니라 heartbeat 만료와 재시작 reconciliation으로 정리
- 정상, 중복, 역순, 오프라인, queue 손상, 용량 초과, 프로세스 강제 종료와 다중 scheduler 경쟁을 자동 테스트
- 완료 기준: 정의한 queue 용량·보존 범위에서 네트워크 단절, 앱 강제 종료, 재시작, 중복·역순 event 이후에도 event 유실이나 중복 상태 전이 없이 서버 세션이 하나의 일관된 terminal 상태에 도달함

## 13. 퀘스트 목록 API 구현

- 프런트엔드 더미 퀘스트를 제거하고 DB의 `PUBLISHED` 상태 퀘스트를 source of truth로 전환
- 여기서 공개는 비로그인 공개가 아니라 게시 상태를 뜻하며, 사용자별 응시 상태를 포함하는 목록·상세 API는 로그인 사용자에게만 제공
- `GET /api/v1/quests`는 code별 현재 `PUBLISHED` version 한 건만 안정적인 정렬과 제한된 cursor pagination으로 반환
- `GET /api/v1/quests/:code`는 조회 시점의 게시 version 메타데이터를 반환하고 `DRAFT`, `ARCHIVED`, 존재하지 않는 code는 `404` 처리
- 목록·상세 응답에 quest `id`, `code`, `version`, 제목, 설명, 예상 시간, 100P 보상, 통과 점수, 재응시 정책과 사용자의 최근 응시 상태를 명시
- 현재 schema에 없는 재응시 정책은 `retry_allowed` additive migration으로 추가하고, 이미 통과한 version은 정책과 무관하게 완료 상태로 처리
- 목록·상세에서는 문제·선택지까지 반환하지 않고, 14번의 응시 시작 응답에서 고정 version의 문제를 제공
- entity나 SQL row를 그대로 직렬화하지 않고 응답 DTO allowlist를 사용해 `isCorrect`, 정답 option ID, 내부 판정 필드, draft 정보가 어떤 중첩 경로에도 노출되지 않게 처리
- 게시 전 검증으로 문항 1개 이상, 문항별 선택지 2개 이상, 정확히 1개의 정답과 유효한 통과 점수를 보장
- 프런트엔드에 최초 loading, 재조회 loading, empty, 인증 만료, error, retry 상태를 분리하고 이전 성공 데이터가 있으면 재조회 중 화면 깜빡임 방지
- 목록·상세 계약, 인증·게시 상태, pagination, 금지 필드 부재를 API 통합 테스트로 검증
- 완료 기준: 더미 데이터 없이 서버의 게시 퀘스트만 표시되고, 응답 JSON 전체를 검사해 정답과 내부 판정 정보가 클라이언트에 노출되지 않음

## 14. 실제 개발 퀴즈 구현

- `POST /api/v1/quests/:code/attempts`에서 게시 version과 사용자의 AI 세션을 하나의 응시에 고정하고 `Idempotency-Key`로 중복 시작 방지
- 응시는 본인 소유의 활성 AI 세션에서만 시작할 수 있고, 시작 이후에는 새 version이 게시되어도 고정된 `quest_id`의 문항·선택지·통과 점수·보상 기준을 사용
- `GET /api/v1/quest-attempts/:attemptId`로 새로고침 이후에도 같은 응시와 저장 답안을 복구하되 다른 사용자의 응시는 `404`로 숨김
- `PUT /api/v1/quest-attempts/:attemptId/answers`는 `IN_PROGRESS`에서만 전체 답안 집합을 원자적으로 교체하고, 해당 version의 문항·선택지 소속 관계와 중복 문항을 서버에서 검증
- 문제, 선택지, 답안 저장 상태, 제출 확인, 통과·실패와 재응시 가능 상태를 화면에 구현하고 클라이언트에는 정답 판정 로직을 두지 않음
- 제출 시 응시 row를 잠그고 저장 답안을 기준으로 서버에서 채점하며, 미응답 문항·다른 version의 선택지·빈 퀘스트·정답이 하나가 아닌 게시 데이터는 명시적으로 거부
- 점수는 `floor(정답 수 × 100 / 전체 문항 수)`로 계산하고 저장된 `pass_score` 이상일 때만 통과
- `POST /api/v1/quest-attempts/:attemptId/submissions`는 `Idempotency-Key`, request hash와 저장된 결과 snapshot으로 같은 제출의 재요청에 동일한 결과를 반환하고 다른 본문의 key 재사용은 거부
- DB row lock과 상태 조건으로 동시 제출 중 한 건만 `COMPLETED` 또는 `FAILED`로 전이하고 답안별 `is_correct`, 점수, 통과 여부와 `reward_points_snapshot=100`을 같은 transaction에 저장
- 응시가 연결된 AI 세션이 활성 상태이면 제출 가능하고, terminal 상태이면 서버의 `endedAt + 5분`을 초과하기 전에만 제출 가능하도록 서버 시각으로 검증
- 제한 시간이 지나면 점수 없는 terminal 상태인 `EXPIRED`로 전이해 활성 응시 unique index를 해제하고, 이를 위한 status·check constraint migration과 만료 정리 job 추가
- 실패 또는 만료 후 `retry_allowed=true`일 때만 새 응시를 허용하고, 같은 quest version을 이미 통과한 사용자는 재응시와 추가 보상을 차단
- 재응시가 가능한 실패 응답에는 점수와 통과 여부만 제공하고 정답 option은 노출하지 않으며, 통과했거나 재응시 불가일 때만 정답·해설 공개 여부를 별도 응답 DTO로 통제
- 경계 시각 정확히 5분, 동시 제출, 만료와 제출 경쟁, 새 version 게시, 재응시와 소유권 우회를 실제 PostgreSQL 통합 테스트로 검증
- 완료 기준: 실제 저장 답안을 서버가 판정해야만 응시가 완료되고, 새로고침·중복·동시 제출·만료 이후에도 한 응시의 최종 결과가 한 번만 확정됨

## 15. 포인트 원장 구현

- 14번의 제출 application service 경계를 확장해 최초 통과 판정, `reward_points_snapshot=100` 확정과 `point_ledger` insert를 하나의 DB transaction으로 처리
- point 원장 insert가 실패하면 응시의 최초 통과 전이도 rollback하고, API는 포인트 없는 완료 상태를 성공으로 반환하지 않음
- 원장에는 사용자, 고정된 quest version, attempt, `QUEST_REWARD`, 지급 당시 100P와 생성 시각을 저장하고 이후 퀘스트 수정과 관계없이 변경하지 않음
- `(user_id, quest_id)`와 `quest_attempt_id` unique 제약, 제출 멱등성 원장과 attempt row lock을 함께 사용해 재요청·동시 요청에도 한 번만 적립
- 이미 통과한 version의 다른 attempt, `FAILED`, `EXPIRED`, 보상 없는 LocalStorage 참고 이력에는 원장을 생성하지 않음
- 일반 애플리케이션 DB 권한과 service에는 원장 `UPDATE`·`DELETE` 또는 운영자 수동 정정 API를 제공하지 않으며, 베타 중 정정이 필요하면 DB 직접 수정 대신 원인·처리 절차를 먼저 확정
- 계정 삭제는 일반 포인트 정정과 구분된 개인정보 삭제 절차로 처리하며, 사용자에 연결된 원장도 확정한 보존 정책에 따라 함께 삭제
- `GET /api/v1/points/balance`는 `COALESCE(SUM(points), 0)`으로 잔액을 계산하고, cursor 기반 원장 이력은 본인 데이터만 제한된 page 크기로 반환
- 큰 합계에서도 overflow가 나지 않도록 DB 합계와 API 타입을 검증하고 원장 조회 index의 실행 계획 확인
- point insert 실패, transaction rollback, 동일·다른 idempotency key, 동시 통과와 이미 보상된 재응시를 실제 PostgreSQL에서 검증
- 완료 기준: 동일 사용자와 quest version 조합의 최초 통과 transaction에서만 100P가 적립되고, 어떤 재요청·경쟁 조건에서도 완료 상태와 잔액이 서로 어긋나지 않음

## 16. 통계 API와 대시보드 전환

- AI 작업 대기 시간, 최초 통과한 퀘스트 수와 point 원장 합계를 서버 통계 API에서 집계하고 LocalStorage 통계 계산 제거
- 사용자 time zone은 브라우저가 최초 로그인·변경 시 IANA zone ID로 전송하고 서버가 검증해 사용자 설정으로 저장하며, 잘못된 값은 조용히 추정하지 않고 `UTC` fallback과 수정 안내 제공
- DB 시각은 `timestamptz`로 저장하고, 오늘은 로컬 자정, 이번 주는 월요일 00:00, 이번 달은 1일 00:00 기준의 반열린 구간 `[start, end)`을 UTC로 변환해 조회
- DST 전환일, 월·연도 경계와 서버·브라우저 시계 차이는 `meta.serverTime`과 IANA time zone 기준 자동 테스트로 검증
- AI 작업 시간은 상태와 관계없이 선택 기간과 세션 `[startedAt, endedAt)`이 실제로 겹치는 구간만 합산하며, 활성 세션은 응답의 동일한 `meta.serverTime`까지 계산
- `DEGRADED` timing 세션 수를 함께 반환해 복구된 시간이 정확한 측정치처럼 숨겨지지 않게 처리
- 완료 퀘스트 수는 기간 내 최초 통과한 사용자·quest version 수, 포인트는 같은 기간에 생성된 append-only 원장 합계로 계산하고 LocalStorage 참고 이력은 제외
- `GET /api/v1/stats/summary?period=today|week|month|custom` 계약을 정의하고 custom 기간은 최대 366일, 상세 이력 cursor page는 기본 20건·최대 100건으로 제한
- 모든 집계 값과 목록이 동일한 사용자·시간 경계를 사용하도록 한 요청 안에서 기준 시각을 한 번만 확정
- 세션 구간 조회, 완료 응시와 point 원장 집계를 위한 복합·부분 index를 점검하고 현실적인 대량 fixture에서 `EXPLAIN (ANALYZE, BUFFERS)` 결과 기록
- 대시보드에 loading, empty, error, retry, time zone 변경 상태를 연결하고 기기 local clock으로 집계 값을 다시 계산하지 않음
- 완료 기준: 동일 계정의 서로 다른 기기·브라우저에서 같은 time zone과 `meta.serverTime` 기준의 오늘·주·월 통계가 표시되고 경계·대량 데이터 테스트를 통과함

## 17. 보안과 개인정보 보호 최종 점검

- 전체 endpoint를 인증 방식, CSRF 필요 여부, 소유권 대상, 입력 크기, 멱등성, Rate Limit 기준으로 표로 만들고 누락된 guard를 각 기능 계층에서 수정
- 웹 cookie의 `HttpOnly`, 운영 `Secure`, `SameSite`, 만료·logout 폐기와 정확한 CORS origin·credential 설정을 실제 preflight·cross-site 요청으로 재검증
- 로그인 시작·callback은 IP와 OAuth state, 기기 연결·회전은 사용자와 IP, integration event는 device와 IP를 조합한 endpoint별 Rate Limit 적용
- 다중 API 인스턴스에서 우회되지 않도록 공유 저장소 기반 limiter를 사용하고 `429`와 `Retry-After`를 반환하되 정상 heartbeat burst는 허용 범위에 포함
- payload 크기, 허용 event 이름, turn별 event 수, 미래 시각, 중복·replay, idempotency key 본문 변경과 비정상 상태 전이를 제한
- 프롬프트, Codex 응답, source code, 파일 경로, 원본 hook payload와 token·cookie가 요청 DTO, DB column, 구조화 로그, 오류 추적, 오류 응답에 남지 않는지 fixture 기반 자동 검사
- 예외 stack과 validation 오류가 요청 원문을 포함하지 않게 하고 token, cookie, authorization header, OAuth code, 기기 연결 code는 공통 redaction
- 사용자 데이터 조회·내보내기, 기기 연결 해제, 모든 웹 세션·기기 token 폐기와 계정 삭제 API에 재인증·CSRF·소유권 검증 적용
- 계정 삭제 시 OAuth 연결, 세션, 기기, AI 세션, event, 응시·답안과 point 원장을 어떤 순서로 삭제할지 transaction과 FK 정책으로 확정하고 로컬 플러그인 token 폐기 안내 제공
- 인증 세션, OAuth state, 연결 code, integration event, dead-letter 진단, 운영 로그, 백업별 보존 기간과 계정 삭제 시 예외 범위를 문서화
- IDOR, CSRF, CORS 오설정, OAuth state replay, 탈취·만료 token, 다른 사용자 attempt·session 접근, 중복 보상과 Rate Limit 우회 테스트 추가
- `npm audit` 결과를 검토하고 실제 도달 가능한 high·critical 취약점은 배포 차단, 예외는 영향·보완 통제·만료일을 기록
- 완료 기준: endpoint 보안 matrix, 개인정보 보존·삭제 문서, 금지 데이터 자동 검사와 공격·권한 우회 통합 테스트가 모두 통과함

## 18. 운영 로그와 장애 대응 구성

- 외부의 유효한 request ID는 전달하고 없거나 잘못된 값은 서버가 생성해 응답 header, 구조화 JSON 로그와 오류 추적 event에 동일하게 연결
- 로그에 환경, service version, route template, status, latency와 오류 code만 남기고 body·query 원문, cookie, authorization, OAuth code, 기기 token과 hash 식별자 원문은 redaction
- 오류 추적 도구는 운영·스테이징 환경을 분리하고 source map 접근을 제한하며, 전송 전 공통 sanitizer와 sample event 검사 적용
- liveness는 프로세스 event loop만 확인하고, readiness는 DB 연결·간단 query·필수 migration 적용 여부를 확인하는 별도 endpoint로 분리하며 공개 응답에는 내부 상세를 노출하지 않음
- migration은 애플리케이션 인스턴스 자동 실행이 아니라 배포당 한 번 실행하는 별도 단계와 DB advisory lock으로 직렬화하고, 실패 시 새 버전 traffic 전환을 중단
- backward-compatible expand/contract migration을 원칙으로 하고, 이미 적용된 운영 migration 파일 수정과 운영 DB에서의 임의 `synchronize`를 금지
- 자동 백업 주기·보존·암호화·접근 권한을 구성하고 별도 환경에 복원한 뒤 row count, 핵심 제약, 로그인·퀘스트 smoke test까지 확인
- 파일럿 전 운영 목표를 확정하며 초기안은 `RPO ≤ 24시간`, `RTO ≤ 4시간`으로 두고 실제 복원 훈련 결과와 차이를 기록
- migration 실패, API rollback, DB roll-forward, 백업 복원, OAuth secret·cookie 서명 key·기기 token 회전에 대한 실행 명령, 판단 기준과 중단 조건을 runbook으로 작성
- secret은 저장소와 이미지에 포함하지 않고 운영 secret manager에서 주입하며 시작 시 필수값·금지 기본값·production cookie/CORS 설정을 fail-fast 검증
- 활성 세션 수, heartbeat 만료율, deferred event 수와 최고 age, late `Stop` 복구율, API queue 실패 보고, 인증 실패·Rate Limit, DB pool과 `5xx` 지표·경보 구성
- 로컬 queue는 서버가 직접 볼 수 없으므로 연결 시 민감정보 없는 depth·oldest age·dead-letter count만 진단 지표로 전송하고 장기 미접속은 device `lastSeenAt`으로 탐지
- 각 경보에 담당자, severity, 확인 dashboard, 첫 대응과 종료 조건을 연결하고 test alert로 전달 경로 확인
- 완료 기준: request ID 하나로 오류와 관련 상태를 추적하고, readiness가 잘못된 배포를 차단하며, 문서만 보고 백업 복원·migration 실패·secret 회전을 재현할 수 있음

## 19. 통합 테스트와 CI 구성

- 1~18번에서 누적한 프런트엔드, 서버 단위, 플러그인, 실제 PostgreSQL 통합 테스트를 격리된 CI job으로 연결하고 실패 원인이 구분되게 구성
- 빈 PostgreSQL 16에 모든 migration 적용·seed 검증·재실행 안전성 검사를 수행하고, 직전 release schema에서 최신 schema로 upgrade하는 job 추가
- GitHub OAuth는 CI에서 제어 가능한 mock OAuth provider로 성공, 거절, state replay, callback 오류와 logout을 검증하고 실제 GitHub OAuth는 staging 수동 smoke test로 분리
- Codex 데스크톱 앱 자체는 headless CI에서 실행할 수 없으므로 hook fixture와 가짜 event sender로 자동 감지 계약을 검증하고, 실제 앱 설치·신뢰 승인·hook 수신은 release 체크리스트에서 검증
- 브라우저 E2E는 로그인 → 기기 연결 상태 → 자동 세션 반영 → 퀴즈 시작·답안 복구·제출 → 100P 잔액과 dashboard 확인 흐름을 포함
- 중복 idempotency key, 다른 본문의 key 재사용, 동시 시작·제출·보상 요청을 실제 DB transaction과 여러 connection으로 검증
- 네트워크 단절, `429`·`5xx`, queue 부분 손상, 플러그인 프로세스 강제 종료·재시작, 역순 event와 24시간 late `Stop`을 fake clock으로 재현
- 보안 테스트에 다른 사용자 리소스 접근, CSRF, CORS, token 만료·폐기, 금지 데이터 로그·DB 유입 검사를 포함
- PR마다 lint, client·server typecheck, unit/integration/E2E test, client·server build, migration과 dependency audit를 실행하고 branch protection의 required check로 설정
- 테스트 시간 의존성은 fake clock과 고정 time zone을 사용하고, flaky 재실행으로 성공을 덮지 않으며 실패 screenshot·서버 로그는 redaction 후 제한 보존
- CI secret은 최소 권한과 환경 분리를 적용하고 fork PR이나 artifact에 OAuth·DB·기기 자격 증명이 노출되지 않게 검증
- 완료 기준: 핵심 사용자 흐름, 보안 불변식, 동시성 또는 DB migration 중 하나라도 깨지면 required check가 실패해 병합할 수 없음

## 20. 운영 배포와 파일럿 진행

- staging과 production의 프런트엔드, API, PostgreSQL, domain, secret, OAuth App을 분리하고 동일한 배포 artifact를 승격
- HTTPS 강제, HSTS, 운영 `Secure` cookie, 정확한 GitHub OAuth callback URL과 CORS allowlist를 실제 브라우저에서 확인
- 배포 순서는 백업 확인 → migration 단일 실행 → readiness 확인 → API → 프런트엔드 → end-to-end smoke test로 고정하고 각 단계의 중단·rollback 조건 기록
- 애플리케이션은 직전 호환 버전으로 rollback할 수 있게 유지하고, 운영 DB schema는 검증된 forward migration으로 복구하며 파괴적 down migration에 의존하지 않음
- 배포 전 암호화 백업을 별도 환경에 실제 복원해 RPO·RTO를 측정하고 migration 실패·부분 배포·secret 오설정 훈련 통과
- 자동 감지 수신과 퀘스트 보상 transaction을 각각 중단할 수 있는 운영 kill switch를 두되, 보상 중단 시에는 제출 자체를 차단해 point 없는 통과를 만들지 않고 event 수신 중단 시에는 재시도 가능한 응답과 수동 fallback 안내 제공
- 내부 사용자로 먼저 smoke pilot을 수행한 뒤 초대 사용자 10명 이상에게 단계적으로 확대하고 사용자별 설치·로그인·기기 연결·퀘스트 완료 확인
- 수집 정보, 저장하지 않는 정보, 보존·삭제, 플러그인 해제와 계정 삭제 방법을 가입·설치 전에 안내하고 지원 채널·장애 공지·문의 응답 기준 제공
- 자동 감지 성공률은 시작된 turn 중 수동 보정 없이 terminal 상태에 도달한 비율, 세션 유실은 수신된 시작 event 중 세션이 생성되지 않은 건, 중복 point는 unique 위반이 아니라 실제 중복 원장 건수로 정의
- 최소 7일과 자동 세션 100건 이상을 관찰하고, 초기 베타 종료 기준을 자동 감지 성공률 95% 이상, 복구 불가능한 세션 유실 0건, 중복 point 0건, API `5xx` 1% 미만으로 설정
- 초대 사용자 10명 이상이 각각 가입 → Codex 작업 감지 → 퀘스트 제출 → 100P 확인을 한 번 이상 완료했는지 확인
- 오류·이탈 구간, 수동 fallback 사용률, queue 복구율, 퀴즈 통과·재응시와 정성 피드백을 함께 검토하고 표본이 부족하면 수치만으로 베타 종료를 판단하지 않음
- 치명적 개인정보 노출, 권한 우회, 중복 보상 또는 복구 불가능한 데이터 유실이 한 건이라도 발생하면 확대를 중단하고 incident runbook 수행
- 완료 기준: 실제 초대 사용자 10명 이상이 전체 흐름을 수행하고, 복원·rollback 훈련과 최소 관찰 기간·운영 지표·보안 중단 기준을 모두 충족해 베타 지속 또는 종료를 근거 있게 결정할 수 있음

---

# 2.1 전 작업 공통 적용 원칙

- 보안, 입력 검증, 인증·소유권 검증은 17번까지 미루지 않고 각 API 작업에서 함께 구현한다.
- 테스트는 19번에 한꺼번에 추가하지 않고 각 작업의 완료 기준으로 누적한다. 19번은 전체 E2E와 CI gate를 완성하는 작업이다.
- DB 변경은 `synchronize`가 아니라 추가 migration으로만 수행한다.
- 외부 event와 변경 API는 멱등성, transaction, DB 제약을 함께 사용한다.
- 프롬프트, Codex 응답, 소스 코드, 파일 경로와 원본 hook payload는 저장하거나 로그로 남기지 않는다.
- 목록·상세 응답은 DB entity를 직접 반환하지 않고 명시적 DTO allowlist와 금지 필드 계약 테스트를 사용한다.
- 서버가 시각과 상태의 source of truth이며 클라이언트 시각과 event `observedAt`은 판정 기준으로 신뢰하지 않는다.
- 14번의 퀘스트 통과 판정과 15번의 point 지급은 최종적으로 하나의 transaction 경계가 되어야 하며, 15번 완료 전에는 실제 point 기능을 운영에 공개하지 않는다.
- 17~19번은 앞 작업의 보안·테스트를 처음 추가하는 단계가 아니라 누락을 닫고 운영 gate를 완성하는 단계다.

---

# 3. 1번 작업 결과: 실사용 베타 범위

## 3.1 베타 목표

실사용 베타는 다음 사용자 흐름을 실제 환경에서 검증하는 것을 목표로 한다.

1. 사용자가 GitHub 계정으로 AISideQuest에 로그인한다.
2. 사용자가 Windows ChatGPT 데스크톱 앱에 AISideQuest 플러그인을 설치하고 계정을 연결한다.
3. 사용자가 데스크톱 앱의 Codex 작업에 요청을 전송한다.
4. AISideQuest가 AI 작업 구간을 감지해 세션을 기록한다.
5. 사용자가 AI 작업 중 개발 퀴즈를 시작한다.
6. 서버가 답안을 판정하고 비현금성 서비스 포인트를 적립한다.
7. 사용자가 다른 브라우저에서도 동일한 기록과 통계를 확인한다.

## 3.2 확정 결정사항

| 항목 | 결정 | 이유 |
|---|---|---|
| 최초 지원 AI 도구 | **Windows ChatGPT 데스크톱 앱(이하 Codex 데스크톱 앱)의 Codex 작업** | 사용자가 실제로 사용하는 표면이며, Windows 앱은 플러그인과 공통 Codex 설정을 지원하고 공식 lifecycle hook을 통한 감지 PoC 경로가 있다. |
| 지원 환경 | Windows 11, 현재 안정 버전 ChatGPT 데스크톱 앱, Windows native agent, PowerShell | 현재 사용자 환경과 동일하게 제한해 설치와 복구 문제를 재현 가능하게 만든다. |
| 지원 브라우저 | 현재 안정 버전 Chrome 및 Edge 데스크톱 | Chromium 기반 데스크톱 환경으로 파일럿 범위를 제한한다. |
| 감지 단위 | 앱 실행 전체가 아닌 **사용자 요청 1회에 대한 agent turn** | 사용자가 실제로 기다리는 구간과 통계 단위를 맞춘다. |
| 자동 감지 후보 | `UserPromptSubmit` 시작, `Stop` 종료, 필요 시 `PermissionRequest` 보조 | 공식 hook 이벤트를 우선 사용하고 실제 동작은 2번 PoC에서 검증한다. |
| 자동 감지 실패 시 | 웹의 수동 시작 및 종료 기능 제공 | 자동 감지 실패가 전체 서비스 사용 불가로 이어지지 않게 한다. |
| 웹 로그인 | **GitHub OAuth 단일 방식** | 개발자 대상 서비스에 맞고 별도 비밀번호 저장을 피할 수 있다. |
| 앱 연동 방식 | **AISideQuest Codex 플러그인과 lifecycle hook** | 앱 UI나 프로세스를 감시하지 않고 Codex가 제공하는 확장 지점을 사용한다. |
| 로컬 연동 인증 | 웹에서 발급한 일회성 연결 코드로 기기 토큰 발급 | GitHub 또는 웹 세션 자격 증명을 플러그인 hook에 저장하지 않는다. |
| 최초 퀘스트 종류 | **객관식 개발 퀴즈** | 서버 판정과 중복 완료 검증이 명확하며 실제 콘텐츠 흐름을 가장 작게 구현할 수 있다. |
| 초기 콘텐츠 | 버전이 부여된 개발 퀴즈 최소 5개 | 하나의 범용 퀘스트 엔진이나 관리자 CMS 없이 반복 사용을 검증한다. |
| 정답 기준 | 퀘스트별 서버 설정 점수 이상 | 정답과 완료 여부를 클라이언트가 결정하지 않게 한다. |
| 포인트 | 퀴즈 성공 시 **100P** | 난이도별 보상 정책을 추가하지 않고 원장 정합성만 검증한다. |
| 포인트 중복 기준 | 사용자와 퀘스트 버전 조합당 1회만 적립 | 세션을 반복 생성해 같은 콘텐츠 보상을 무한 적립하는 것을 막는다. |
| 포인트 가치 | 현금 가치 없음, 환전·양도·구매·출금 불가 | 지급, 세무, 제휴, 부정 사용 문제를 베타 범위에서 분리한다. |
| 포인트 만료 | 베타 기간에는 만료하지 않음 | 만료 정책과 배치 작업을 초기 범위에 추가하지 않는다. |
| 파일럿 방식 | 초대 기반 폐쇄형 베타, 10명 이상 | 운영 위험을 제한하면서 실제 환경 데이터를 확보한다. |
| UI 언어 | 한국어 | 현재 UI와 초기 사용자 범위를 유지한다. |

## 3.3 AI 작업 시간 정의

- 측정 대상은 사용자가 Codex에 요청을 전송한 뒤 Codex의 해당 turn이 종료될 때까지의 시간이다.
- 권한 승인이나 추가 입력을 기다리는 구간은 AI가 일하는 시간이 아니므로 통계에서 제외하는 것을 목표로 한다.
- 승인 대기 시작과 재개 시점을 안정적으로 감지할 수 있는지는 2번 PoC에서 검증한다.
- 안정적으로 구분할 수 없으면 베타에서는 전체 turn 시간을 표시하되 `권한 승인 대기 포함`임을 명시한다.
- 동시에 여러 Codex turn이 감지되더라도 베타 통계는 사용자당 하나의 활성 세션만 인정한다.
- 새 turn이 시작됐는데 이전 세션이 남아 있으면 이전 세션은 `ABANDONED` 처리하고 새 세션을 시작한다.

## 3.4 퀘스트 및 포인트 규칙

- 퀘스트 시도는 활성 AI 세션이 있을 때만 시작할 수 있다.
- AI 세션 중 시작한 퀘스트는 AI 작업이 먼저 끝나더라도 종료 후 5분 이내에 제출할 수 있다.
- 정답과 통과 점수는 서버에만 저장한다.
- 성공한 퀘스트만 포인트를 적립한다.
- 포인트 적립액은 퀘스트 완료 당시 값으로 원장에 저장한다.
- 초기 베타의 모든 퀴즈 성공 보상은 100P로 동일하게 적용한다.
- 같은 퀘스트 버전에 대한 재도전은 허용할 수 있지만 포인트는 사용자당 한 번만 적립한다.
- 기존 LocalStorage의 예상 포인트는 서버 포인트로 이전하지 않는다.
- 관리자 지급, 포인트 차감, 환불, 출금은 베타 범위에 포함하지 않는다.

## 3.5 개인정보 최소 수집 원칙

Codex hook이 여러 정보를 제공하더라도 AISideQuest 플러그인은 다음 정보만 서버에 전송한다.

- 사용자에게 귀속된 폐기 가능한 기기 ID
- Codex 세션 ID와 turn ID를 서버 중복 방지에 필요한 형태로 변환한 값
- 이벤트 종류
- 로컬 발생 시각과 서버 수신 시각
- ChatGPT 데스크톱 앱의 Codex runtime 버전과 AISideQuest 플러그인 버전

사용자 계정은 GitHub 숫자 ID, 사용자명, 표시 이름, 프로필 이미지 URL만 저장하며 이메일은 요구하거나 저장하지 않는다.

다음 정보는 수집하거나 서버에 전송하지 않는다.

- 사용자 프롬프트 원문
- Codex 응답과 대화 transcript
- 소스 코드와 파일 내용
- 파일 경로와 작업 디렉터리
- 실행 명령과 도구 입력 및 출력
- Git 저장소 주소
- 사용 모델명

보관 정책은 다음과 같다.

- hook 전달 및 운영 로그는 30일간 보관한다.
- 세션, 퀘스트 시도, 포인트 원장은 사용자가 계정을 유지하는 동안 보관한다.
- 계정 삭제 시 운영 DB의 사용자 데이터는 즉시 삭제하고 백업본은 최대 30일 이내 만료한다.

## 3.6 베타 포함 범위

- GitHub OAuth 로그인과 로그아웃
- 사용자별 서버 데이터 분리
- Windows 데스크톱 앱의 Codex turn 자동 감지와 수동 fallback
- 서버 기반 세션 저장 및 다른 브라우저에서 복구
- 객관식 개발 퀴즈 조회, 응시, 서버 판정
- 비현금성 포인트 원장
- 오늘, 이번 주, 이번 달 통계
- 기기 연결 해제와 사용자 데이터 삭제
- 운영 로그, 오류 추적, DB 백업 및 복원
- 핵심 흐름 자동 테스트와 폐쇄형 배포

## 3.7 베타 제외 범위

- Codex CLI, Codex IDE 확장, Codex Cloud, macOS 앱 자동 감지
- Cursor, Claude Code, GitHub Copilot, Windsurf 연동
- 현금, 기프티콘, 캐시백, 결제, 환전, 출금
- 사용자 간 포인트 양도
- 설문, 뉴스, 학습, 마이크로태스크 등 추가 퀘스트 종류
- 퀘스트 관리자 CMS
- AI 기반 개인화 추천
- 팀, 조직, 관리자 기능
- 모바일 앱과 다국어 UI
- 예상 절약 시간 계산
- 기존 LocalStorage 포인트의 서버 포인트 이전

## 3.8 베타 성공 기준

최종 20번 파일럿에서 다음 기준을 확인한다.

- 파일럿 사용자 10명 이상
- 실제 Codex turn 50건 이상 기록
- 지원 환경에서 시작 및 종료 이벤트 감지 성공률 95% 이상
- 이벤트 발생 후 웹 상태 반영 지연 p95 5초 이하
- 중복 세션 및 중복 포인트 적립 0건
- 금지된 프롬프트, 응답, 소스 코드, 경로 정보 서버 전송 0건
- 파일럿 사용자의 80% 이상이 로그인, 기기 연결, 세션 감지, 퀴즈 완료 흐름을 1회 이상 완료
- 새로고침 및 다른 브라우저에서 동일한 기록과 포인트 확인
- 사용자 데이터 삭제 요청 시 관련 데이터 삭제 완료

## 3.9 자동 감지 장애에 대한 결정

hook 비활성, 신뢰 해제, 네트워크 단절 등으로 자동 감지를 사용할 수 없는 경우 다음 원칙을 적용한다.

1. 최초 지원 대상은 Windows ChatGPT 데스크톱 앱의 Codex 작업으로 유지한다.
2. 공식 hook으로 안정적으로 식별 가능한 이벤트만 자동화한다.
3. 누락 가능성이 있는 구간은 사용자가 확인하거나 수동으로 시작 및 종료한다.
4. transcript 파일 감시, 화면 DOM 감시, 키 입력 감시처럼 개인정보와 안정성 위험이 큰 우회 방식은 사용하지 않는다.
5. 자동 감지는 `실험 기능`으로 표시하고 정확도가 확보된 뒤 기본 기능으로 전환한다.

## 3.10 1번 완료 판정

- [x] 최초 지원 도구를 Windows ChatGPT 데스크톱 앱의 Codex 작업으로 확정했다.
- [x] 최초 지원 OS와 실행 환경을 확정했다.
- [x] 로그인 방식을 GitHub OAuth로 확정했다.
- [x] 최초 퀘스트 종류와 판정 방식을 확정했다.
- [x] 포인트의 적립, 중복, 가치, 만료 정책을 확정했다.
- [x] 수집 데이터와 금지 데이터를 확정했다.
- [x] 베타 포함 및 제외 범위를 확정했다.
- [x] 자동 감지 실패 시 fallback 정책을 확정했다.
- [x] 파일럿 성공 기준을 확정했다.

결론: **1번 실사용 베타 범위 확정 작업을 완료한다.**

---

# 4. 3번 작업 결과

[`SESSION_STATE_AND_DATA_FLOW.md`](./SESSION_STATE_AND_DATA_FLOW.md)에 다음 항목을 확정했다.

1. `RUNNING`, `WAITING_FOR_USER`, `COMPLETED`, `FAILED`, `ABANDONED` 상태 전이
2. Codex hook과 상태의 매핑
3. 자동 감지와 수동 조작의 충돌 우선순위
4. 중복·역순 event, heartbeat 만료, 네트워크 단절 및 앱 종료 처리
5. 플러그인, API 서버, 웹의 책임
6. session 및 integration event API 계약

결론: **3번 세션 상태와 데이터 흐름 설계 작업을 완료한다.**

---

# 5. 4번 작업 결과

1. root npm 패키지를 유지하고 `server/`에 독립된 NestJS 빌드 경계를 추가했다.
2. `NODE_ENV`, `API_HOST`, `API_PORT`, `CORS_ORIGIN` 기본값과 형식 검증을 구성했다.
3. `{ data, meta.serverTime }` 성공 응답과 `{ error, meta.serverTime }` 오류 응답을 구성했다.
4. whitelist 기반 전역 ValidationPipe와 CORS를 적용했다.
5. `GET /api/v1/health` 및 환경설정·검증·404 통합 테스트 4개를 추가했다.
6. 서버 타입 검사, 빌드, 실제 HTTP Health Check를 통과했다.

결론: **4번 NestJS 백엔드 기본 구성 작업을 완료한다.**

---

# 6. 5번 작업 결과

1. NestJS 공식 통합 경로를 제공하는 TypeORM과 PostgreSQL 16을 선택했다.
2. `users`, OAuth 계정, 기기, AI 세션, integration event, 퀘스트, 응시, 답안, 포인트 원장까지 11개 테이블을 설계했다.
3. 사용자당 활성 세션, event 멱등성, 퀘스트 version, 답안 소유 관계와 포인트 중복 방지를 DB 제약으로 작성했다.
4. 빈 DB에서 전체 구조를 생성하고 되돌릴 수 있는 최초 migration을 작성했다.
5. version 1 개발 퀴즈 5개와 객관식 문항·선택지를 반복 실행 가능한 seed로 작성했다.
6. migration 적용·재실행·되돌리기·재적용과 핵심 FK·UK 통합 테스트 5개를 통과했다.

상세 구조와 실행 방법은 [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)를 기준으로 한다.

결론: **5번 PostgreSQL 데이터베이스 구성 작업을 완료한다.**

---

# 7. 6번 작업 결과

1. GitHub OAuth callback과 `user_auth_accounts` upsert를 구현했다.
2. OAuth `state` 1회 사용과 PKCE `S256`을 적용했다.
3. 서버 저장형 인증 세션과 hash token 저장, `HttpOnly`, `Secure`, `SameSite` cookie를 구성했다.
4. `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`, 인증 guard와 CSRF guard를 구현했다.
5. 실제 PostgreSQL과 모의 GitHub API로 로그인, 재로그인, state 재사용, CSRF, logout, 만료를 검증했다.

상세 구현과 실행 방법은 [`AUTHENTICATION.md`](./AUTHENTICATION.md)를 기준으로 한다.

결론: **6번 사용자 로그인 구현 작업을 완료한다.**

---

# 8. 7번 작업 결과

1. `POST /api/v1/sessions/manual`, `POST /api/v1/sessions/{sessionId}/end`를 구현했다.
2. `GET /api/v1/sessions/active`, cursor 기반 `GET /api/v1/sessions`를 구현했다.
3. device bearer token을 검증하는 `POST /api/v1/integration-events`와 Codex 상태 전이를 구현했다.
4. 사용자 단위 DB advisory lock과 기존 active unique index로 동시 시작을 직렬화했다.
5. `api_idempotency_keys`와 integration event 응답 snapshot으로 동일 요청을 재생하고, 같은 key의 다른 요청은 `409`로 차단했다.
6. 수동·자동 연결, 새 turn 대체, 대기·복귀·완료, 역순 `Stop` 보류·재처리를 구현했다.
7. 인증, CSRF, 소유권, 동시성, 멱등성, cursor, 개인정보 입력 차단 통합 테스트를 통과했다.

결론: **7번 AI 세션 API 구현 작업을 완료한다.**

---

# 9. 8번 작업 결과

1. `SessionContext`에서 세션 LocalStorage 읽기·쓰기를 제거하고 서버 API를 권위 저장소로 연결했다.
2. 초기 진입과 변경 요청 후 활성 세션 및 cursor 전체 이력을 복구한다.
3. 활성 탭 5초 polling, focus·visibility 복귀 조회와 `meta.serverTime` 보정을 구현했다.
4. 로딩, 인증 만료, 네트워크 오류, 재시도, 시작·종료 처리 중 상태를 구현했다.
5. `RUNNING`, `WAITING_FOR_USER`, 종료 상태와 GitHub 로그인 진입점을 화면에 연결했다.
6. Provider 재생성, 브라우저 저장소 초기화, 시각 오차, polling을 포함한 프런트엔드 테스트를 통과했다.

결론: **8번 프런트엔드 세션 상태 API 전환 작업을 완료한다.**

---

# 10. 9번 작업 결과

1. 구형 두 LocalStorage 키를 새 Context가 읽기 전에 감지하고 스키마를 검증한다.
2. 정상 데이터는 완료 세션 수·총 시간·퀘스트 완료 수만 참고 요약으로 보관하거나 초기화할 수 있다.
3. 구형 활성 세션은 서버 세션으로 이어 붙이지 않고, 기존 예상 포인트는 어떤 서버 값에도 반영하지 않는다.
4. 신규 임시 퀘스트 이력은 `aisidequest.questHistories.v2`로 분리해 과거 이력이 통계에 섞이지 않는다.
5. 완료 marker, 원본 반복 정리, 저장 실패 재시도, 손상 데이터 초기화 경로를 구현했다.
6. API client, 전체 화면 흐름, LocalStorage 전환을 포함한 프런트엔드 테스트 31개를 통과했다.

결론: **9번 기존 LocalStorage 데이터 처리 작업을 완료한다.**

---

# 11. 10번 작업 결과

1. `.codex-plugin/plugin.json`, hook, script와 repo-local marketplace를 갖춘 정식 `aisidequest` 플러그인을 구성했다.
2. prompt, 응답, 코드, 경로, transcript, tool 입출력을 버리고 event와 hash 식별자만 남기는 개인정보 필터를 이전했다.
3. 10분 유효 연결 코드와 90일 기기 token을 각각 hash로만 서버에 저장하고 token 회전·폐기를 구현했다.
4. 웹 `Devices` 화면에서 연결 코드 발급, 기기 목록, 재연결과 폐기를 제공한다.
5. 플러그인 연결 script와 명시적 테스트 event 전송으로 서버의 사용자 식별과 `lastSeenAt` 갱신을 검증했다.
6. DB 통합 테스트 22개, 프런트엔드 테스트 34개, 플러그인 테스트 3개와 공식 플러그인 검증을 통과했다.

결론: **10번 AISideQuest Codex 플러그인 기본 구성 작업을 완료한다.**

---

# 12. 11번 작업 결과

1. 6개 lifecycle hook event를 로컬에 먼저 기록한 뒤 기기 token과 event ID 멱등성 키로 자동 전송한다.
2. 시작, 대기, 재개와 종료 event가 기존 서버 상태 전이를 통해 하나의 사용자 세션에 반영된다.
3. prompt, 응답, 코드, 경로, transcript와 도구 입출력은 플러그인 요청에 포함하지 않는다.
4. 서버는 유효한 event가 transaction에 저장된 경우에만 기기의 마지막 event 수신 시각을 갱신한다.
5. 웹은 세션과 기기를 5초마다 조회하고 자동 감지 준비·event 수신·수동 모드를 구분해 표시한다.
6. 자동 전송 실패는 Codex 실행을 막지 않으며 수동 시작·종료를 계속 사용할 수 있다.
7. React 테스트 38개, 플러그인 테스트 5개, PostgreSQL 통합 테스트 22개와 타입 검사를 통과했다.

결론: **11번 AI 작업 자동 감지 연동을 완료한다.**

---

# 13. 12번 작업 결과

1. 활성 turn 상태를 원자적으로 저장하고 별도 단일 worker에서 30초 간격 heartbeat를 생성한다.
2. 기기 단위 증가 sequence와 고정 event ID를 가진 append-only JSONL queue, 원자적 state·compaction과 FIFO single-flight worker를 구현했다.
3. 네트워크·`408`·`429`·`5xx` 재시도, `Retry-After`, 지수 backoff·full jitter, 300회·24시간 제한과 7일 dead-letter를 구현했다.
4. queue 손상, 48시간·10,000건·10MiB 제한과 인증 차단 진단을 구현했으며 lifecycle event를 제거할 때도 이유를 dead-letter에 남긴다.
5. 다중 서버 인스턴스 경쟁을 advisory lock으로 막는 30초 정리 job을 구현하고 자동 세션은 마지막 활동 120초, 순수 수동 세션은 시작 12시간 경계로 `ABANDONED` 처리한다.
6. 24시간 지난 deferred event를 `IGNORED_ORPHAN`으로 정리하고, 같은 기기·turn의 heartbeat 만료 세션만 24시간 내 late `Stop`으로 복구한다.
7. 플러그인 테스트 9개, React 테스트 38개, NestJS 비DB 테스트 6개, TypeScript 타입 검사와 프로덕션 빌드를 통과했다.
8. PostgreSQL 16에서 migration 되돌리기·재적용, sequence 제약, 자동·수동 만료, orphan 정리와 late `Stop` 복구를 포함한 DB 통합 테스트 25개를 통과했다.

판정: **12번 Heartbeat와 장애 복구 구현을 완료하고 다음 작업을 13번 퀘스트 목록 API로 전환한다.**

---

# 14. 13번 작업 결과

1. `retry_allowed`와 최근 응시 조회 index를 추가하고, 게시 퀘스트가 문항 1개 이상·문항별 선택지 2개 이상·정답 정확히 1개를 갖도록 deferred DB constraint trigger를 구현했다.
2. 인증 사용자용 `GET /api/v1/quests`와 `GET /api/v1/quests/:code`를 구현하고 게시된 현재 version만 반환한다.
3. 목록은 게시 시각·code·ID 기준의 안정적인 cursor pagination과 최대 50건 제한을 사용한다.
4. 응답 DTO는 퀘스트 메타데이터와 사용자 본인의 최근 응시 상태만 허용하며 문제·선택지·정답·draft 내부 정보는 반환하지 않는다.
5. 프런트엔드 `mockQuests`를 제거하고 전역 서버 catalog로 Home·Side Quest·Dashboard를 전환했다.
6. 초기 loading, empty, 인증 만료, error, retry와 기존 목록을 유지하는 refresh 상태를 구현했다.
7. React 테스트 43개, 플러그인 테스트 9개, NestJS 비DB 테스트 6개와 PostgreSQL 통합 테스트 29개를 통과했다.

판정: **13번 퀘스트 목록 API 구현을 완료하고 다음 작업을 14번 실제 개발 퀴즈 구현으로 전환한다.**

---

# 15. 14번 작업 결과

1. 활성 AI 세션과 게시 `quest_id`에 고정되는 멱등 응시 시작 API를 구현하고 게시 버전의 문제·선택지만 제공한다.
2. 응시 조회와 전체 답안 원자 교체 API로 새로고침 이후 동일 응시와 선택 답안을 복구한다.
3. 제출 transaction에서 응시·세션 row를 잠그고 저장 답안을 기준으로 `floor(정답 수 × 100 / 전체 문항 수)` 점수를 계산한다.
4. 제출 `Idempotency-Key`와 advisory lock으로 같은 요청 재시도와 다른 key의 동시 제출 모두 하나의 최종 결과로 수렴시킨다.
5. AI 세션 종료 정확히 5분까지 제출을 허용하고 이후 `EXPIRED`로 정리하는 다중 인스턴스 안전 cleanup을 추가했다.
6. 실패·만료는 `retry_allowed=true`일 때만 재응시하며 이미 통과한 version은 다시 시작할 수 없다.
7. 게시 version 콘텐츠를 DB에서 불변으로 만들고, 새 version 게시 후에도 기존 응시는 시작 당시 문제를 유지한다.
8. 프런트엔드에 문제·선택지, 선택 즉시 저장, 새로고침 복구, 제출 확인, 통과·실패·만료와 재응시 화면을 구현했다.
9. React 테스트 44개, 플러그인 테스트 9개, NestJS 비DB 테스트 8개와 PostgreSQL 통합 테스트 35개를 통과했다.

판정: **14번 실제 개발 퀴즈 구현을 완료하고 다음 작업을 15번 포인트 원장 구현으로 전환한다.**

---

# 16. 15번 작업 결과

1. 서버 채점과 최초 통과 상태 전이, `reward_points_snapshot=100`, `point_ledger` INSERT를 하나의 transaction으로 통합했다.
2. 사용자·퀘스트 version과 attempt unique 제약, attempt row lock, 제출 멱등 응답을 결합해 같은 key·다른 key·동시 제출에도 한 원장 항목만 생성한다.
3. 원장 INSERT 강제 실패 시 답안 판정과 응시 완료까지 rollback되는 실제 PostgreSQL 테스트를 추가했다.
4. 기존에 완료된 통과 응시를 100P 원장으로 backfill하고 `(user_id, created_at DESC, id DESC)` cursor 조회 index를 추가하는 migration을 구현했다.
5. 인증 사용자 전용 `GET /api/v1/points/balance`와 `GET /api/v1/points/ledger`를 구현하고 합계 overflow, 소유권 격리, page 크기와 cursor를 검증한다.
6. 제출 응답에 적립 snapshot을 포함하고 Home·Dashboard에 서버 잔액과 최근 원장 loading·empty·error·retry 상태를 연결했다.
7. 실패·만료 응시에는 원장이 생기지 않고, 이미 통과한 version은 재응시와 중복 적립이 모두 차단됨을 검증했다.
8. React 테스트 46개, 플러그인 테스트 9개, NestJS 비DB 테스트 8개와 PostgreSQL 통합 테스트 37개를 통과했다.

판정: **15번 포인트 원장 구현을 완료하고 다음 작업을 16번 통계 API와 대시보드 전환으로 이동한다.**

---

# 17. 16번 작업 결과

1. 인증 사용자용 `GET /api/v1/stats/summary`와 cursor 기반 `GET /api/v1/stats/activity`를 구현하고 오늘·주·월·최대 366일 custom 기간을 지원한다.
2. 요청마다 DB `transaction_timestamp()`를 한 번 확정해 응답 `meta.serverTime`, 활성 세션 cutoff, 기간 경계와 모든 집계가 같은 기준 시각을 사용한다.
3. 저장된 IANA time zone의 로컬 자정·월요일·월초를 PostgreSQL에서 UTC 반열린 구간으로 변환하고 DST 23시간·25시간, 월·연도 경계를 검증했다.
4. 사용자 time zone 기본값을 미검증 `UTC`로 전환하고 CSRF 보호 변경 API, 브라우저 최초 자동 저장과 수동 수정·오류 안내를 구현했다.
5. 기간과 실제로 겹치는 세션 구간만 합산하고 활성 세션을 `asOf`까지만 계산하며 `DEGRADED` 세션 수를 별도 반환한다.
6. 기간 내 최초 통과 수와 point 원장 합계는 서버 원장만 집계하며 LocalStorage 통계 계산기와 runtime provider를 제거했다.
7. Home·Dashboard를 서버 통계로 전환하고 오늘·주·월·직접 선택, loading·empty·error·retry, 시간대 변경과 저품질 세션 표시를 연결했다.
8. 세션 구간·통과 응시 index를 추가하고 3,000건 fixture의 `EXPLAIN (ANALYZE, BUFFERS)`에서 구간 index 사용을 검증했다.
9. React 테스트 47개, 플러그인 테스트 9개, NestJS 비DB 테스트 8개와 PostgreSQL 통합 테스트 41개를 통과했다.

판정: **16번 통계 API와 대시보드 전환을 완료하고 다음 작업을 17번 보안과 개인정보 보호 최종 점검으로 이동한다.**
