# AISideQuest PostgreSQL 데이터베이스 구성

- 작성일: 2026-07-20
- PostgreSQL: 16
- ORM 및 migration: TypeORM 1.1
- 드라이버: `pg` 8.22
- 기준 migration: `1784160000000`부터 `1784275200000-add-discover-interests`까지 17개

---

# 1. 구현 원칙

NestJS가 공식 통합 모듈을 제공하고 현재 서버의 데코레이터·CommonJS 구조와 일관된 TypeORM을 선택했다.

이번 작업에서는 SQL migration을 스키마의 기준으로 사용한다.

- `synchronize`는 항상 `false`로 유지한다.
- 운영 스키마는 migration으로만 변경한다.
- 아직 서비스에서 사용하지 않는 Entity 클래스는 미리 만들지 않는다.
- Entity와 repository는 6번 이후 실제 API 모듈을 구현할 때 필요한 범위만 추가한다.
- 개발 seed는 운영 환경에서 실행되지 않도록 차단한다.

# 2. 테이블 구조

| 테이블 | 역할 |
|---|---|
| `users` | 사용자 기본 정보와 시간대 |
| `user_auth_accounts` | GitHub OAuth 계정 식별 정보 |
| `oauth_login_states` | 1회용 OAuth state hash, PKCE verifier와 같은 origin 복귀 경로 |
| `auth_sessions` | hash token 기반 웹 인증 세션 |
| `api_idempotency_keys` | 사용자 변경 API의 request hash와 응답 snapshot |
| `device_link_codes` | 10분 유효 일회성 연결 코드 hash와 소비 상태 |
| `device_link_requests` | 10분 유효 브라우저 승인 요청, verifier challenge와 기기 token hash |
| `devices` | Codex 플러그인 연결 기기와 hash token |
| `ai_sessions` | 자동·수동 AI 작업 세션과 상태 |
| `integration_events` | 개인정보가 제거된 Codex lifecycle event |
| `quests` | 버전이 부여된 객관식 퀘스트 |
| `quest_questions` | 퀘스트 문항 |
| `quest_options` | 문항 선택지와 서버 정답 |
| `quest_attempts` | 사용자별 퀘스트 응시와 판정 결과 |
| `quest_attempt_answers` | 제출한 선택지와 판정 snapshot |
| `point_ledger` | 변경하지 않는 퀘스트 보상 원장 |
| `discover_source_cache` | source별 정규화 Discover item과 마지막 성공 갱신 시각 |
| `discover_saved_items` | 사용자별 정규화 Discover item snapshot과 저장 시각 |
| `discover_user_interests` | 사용자별 명시적 관심 기술 tag와 수정 시각 |

원래 계획의 5개 핵심 테이블만으로는 GitHub 계정 연결, 기기 인증, event 멱등성, 객관식 답안 저장을 보장할 수 없어 필요한 보조 테이블을 최초 migration에 포함했다.

# 3. 주요 데이터 제약

## 3.1 사용자와 인증

- `(provider, provider_account_id)`는 유일하다.
- 한 사용자는 provider별 계정을 하나만 연결한다.
- OAuth state는 hash로 식별하고 10분 안에 한 번만 소비한다.
- 웹 세션과 CSRF token은 원문이 아니라 64자리 SHA-256 hash로 저장한다.
- 인증 세션 token hash는 유일하며 만료와 logout 폐기를 시각으로 기록한다.
- `(user_id, idempotency_key)`는 유일하며 같은 key의 다른 request hash를 거부한다.
- 멱등성 응답은 JSON object snapshot으로 저장해 재요청 시 논리 결과를 그대로 반환한다.
- 기기 token 원문은 저장하지 않고 64자리 SHA-256 hash만 저장한다.
- 브라우저 연결 verifier 원문은 저장하지 않고 43자리 S256 challenge만 저장한다.
- 브라우저 연결 요청은 승인 전에는 사용자와 기기가 없고, 승인 transaction에서 둘을 함께 확정한다.
- 연결 코드 원문도 저장하지 않고 64자리 SHA-256 hash만 저장하며 10분 안에 한 번만 소비한다.
- 신규 기기 연결과 기존 기기 token 회전을 구분하고, 모든 변경 요청은 멱등하게 처리한다.
- 기기는 만료와 해제를 삭제 대신 시각으로 기록한다.
- 사용자 time zone은 미검증 `UTC`에서 시작하며 PostgreSQL `pg_timezone_names`로 확인된 IANA ID만 `time_zone_verified=true`로 저장한다.

## 3.2 AI 세션과 event

- 사용자당 `RUNNING` 또는 `WAITING_FOR_USER` 세션은 최대 1개다.
- `(user_id, provider, external_turn_key)`는 중복될 수 없다.
- 활성 상태에는 종료 시각과 종료 사유가 없어야 한다.
- 종료 상태에는 종료 시각과 종료 사유가 모두 있어야 한다.
- `(device_id, event_id)` unique key로 event 재전송을 한 번만 저장한다.
- integration event에는 request hash와 처리 당시 응답 snapshot을 저장한다.
- event의 사용자와 기기 소유자, 연결 세션의 사용자가 일치하도록 복합 FK를 사용한다.
- `workspace_label`은 전체 경로가 아닌 마지막 폴더명만 최대 64자로 저장하며 경로 구분자와 제어문자를 DB 제약으로 거부한다.
- `operation_label`은 `npm test`, `git status`, `Gradle test`, `코드 변경`, `기타 명령` 등 migration에 정의된 고정 허용 목록만 저장한다.
- 프롬프트, 응답, 코드, 전체 파일 경로, 원본 명령·인자, 도구 출력, 원본 hook JSON을 저장할 컬럼은 두지 않는다.
- 기기 진단은 최근 queue depth·oldest age·dead-letter count와 보고 시각만 저장한다.

## 3.3 퀘스트와 포인트

- 퀘스트는 `(code, version)`으로 식별한다.
- 같은 code에는 공개 버전이 하나만 존재한다.
- 공개된 version의 메타데이터·문항·선택지는 불변이며 변경은 새 version으로 게시한다.
- 베타 보상은 성공 시 100P로 고정한다.
- 한 문항에는 정답 선택지를 최대 하나만 둘 수 있다.
- 응시 답안의 문항과 선택지가 같은 퀘스트·문항에 속하도록 복합 FK를 사용한다.
- 저장 중 답안의 `is_correct`는 `NULL`이며 제출 transaction에서만 확정한다.
- 응시는 AI 세션 종료 후 5분이 지나면 점수 없는 `EXPIRED` 상태로 전이한다.
- `point_ledger`는 사용자와 퀘스트 버전 조합당 보상 1건만 허용한다.
- 포인트 잔액 컬럼은 두지 않고 원장의 합으로 계산한다.

## 3.4 Discover source cache

- `source`는 계획된 6개 source allowlist 중 하나이며 source당 row는 하나다.
- `items`는 JSON array만 허용하고 5 MiB를 넘지 않는다. Raw upstream body와 HTML은 저장하지 않는다.
- `refreshed_at`은 마지막 성공 갱신 시각이며 stale 판정과 최대 7일 보존의 기준이다.
- 애플리케이션은 source별 PostgreSQL transaction advisory lock으로 동시 refresh를 직렬화한다.
- 실행 시작과 30분 간격 정리에서 7일을 넘기기 전에 오래된 row를 삭제한다.

## 3.5 Discover 저장 항목

- 각 row는 `user_id`, allowlist `source`, namespaced `source_item_id`, 최대 16 KiB JSON object snapshot, `saved_at`만 저장한다.
- `(user_id, source_item_id)` unique 제약으로 중복 저장을 방지한다.
- JSON의 `id`·`source`가 row identity와 일치해야 하며, API는 browser card 전체가 아니라 cache에서 다시 검증한 normalized item만 저장한다.
- 목록 cursor index는 `(user_id, saved_at DESC, id DESC)`다. Source cache가 삭제되어도 snapshot 목록은 독립적으로 조회된다.
- 계정 삭제는 FK cascade에 더해 서비스 transaction에서 명시적으로 삭제하며, 계정 내보내기 schema version 3에 포함한다.

## 3.6 Discover 관심 기술

- 사용자당 row는 최대 하나이며 `user_id`가 PK이자 `users`를 참조하는 cascade FK다.
- `tags`는 1~10개의 고유 text 배열이고 20개 고정 allowlist의 부분집합이어야 한다. 관심사가 없으면 빈 배열 row를 저장하지 않는다.
- API는 전체 set을 교체하며 canonical allowlist 순서로 저장한다. 동일 의미 update는 `updated_at`을 바꾸지 않고, UUID idempotency response를 재사용한다.
- 관심 기술은 계정 소유 data로 export schema version 3과 account delete transaction에 포함한다. 운영 log, metric label, 분석 event에는 복제하지 않는다.

# 4. 개발용 퀘스트 seed

다음 객관식 개발 퀴즈 5개를 version 1, 성공 보상 100P로 제공한다.

1. TypeScript 타입 좁히기
2. HTTP 멱등성
3. PostgreSQL 유일성 제약
4. Git 안전한 이력 관리
5. 경계값 테스트

seed는 동일한 `code`와 `version`을 다시 생성하지 않으며 반복 실행해도 데이터 수가 증가하지 않는다. 공개된 퀘스트 내용은 덮어쓰지 않고, 변경이 필요하면 새 version을 추가한다.

# 5. 로컬 실행

```powershell
npm.cmd run db:up
npm.cmd run db:migrate
npm.cmd run db:seed
```

한 번에 실행하려면 다음 명령을 사용한다.

```powershell
npm.cmd run db:up
npm.cmd run db:setup
```

기본 개발 DB 주소는 다음과 같다.

```text
postgresql://aisidequest:aisidequest@127.0.0.1:54329/aisidequest
```

운영 환경에서는 `DATABASE_URL`과 `DATABASE_SSL`을 환경변수로 설정한다.

# 6. migration 명령

```powershell
npm.cmd run db:show
npm.cmd run db:migrate
npm.cmd run db:revert
```

`db:migrate`는 PostgreSQL advisory lock으로 배포당 한 번만 실행되고 pending migration이 남으면 실패한다. `db:revert`는 마지막 migration의 데이터를 제거할 수 있으므로 운영에서는 사용하지 않고 백업과 forward 복구 migration을 사용한다.

# 7. 통합 테스트

통합 테스트는 명시적으로 초기화 가능한 이름에 `test`가 포함된 전용 DB에서만 실행한다.

```powershell
$env:TEST_DATABASE_URL='postgresql://aisidequest:aisidequest@127.0.0.1:54329/aisidequest_test'
$env:ALLOW_DATABASE_RESET='true'
npm.cmd run test:database
```

검증 범위는 다음과 같다.

- 빈 DB에 전체 migration 적용
- migration 재실행 시 변경 없음
- 마지막 migration 되돌리기 후 재적용
- OAuth state 1회 사용과 인증 session hash 저장
- 현재 사용자 조회, CSRF logout, 만료·폐기 세션 차단
- 수동 세션 시작·종료 멱등성과 동시 시작 직렬화
- cursor 이력, 세션 소유권과 Codex event 상태 전이
- 의미 중복 event, 새 turn 대체와 역순 `Stop` 재처리
- 연결 코드 1회 소비, 기기 token hash 저장, 소유권 격리
- 브라우저 승인 요청의 verifier challenge, token hash, 만료, 승인 소유권과 완료 polling
- token 회전 후 구 token 차단과 연결 폐기 후 인증 차단
- 개발 seed 반복 실행
- 사용자당 활성 세션 1개
- 기기별 event 중복 방지와 FK 소유권
- 기기별 event sequence 중복 방지
- 자동 120초·수동 12시간 만료, orphan 정리와 late `Stop` 복구
- 사용자와 퀘스트 버전당 포인트 보상 1회

# 8. 다음 작업 경계

5번에서 기본 DB 구조를 구성하고 6번에서 인증, 7번에서 세션 API 멱등성 migration과 런타임 연결을 추가했다. 다음 기능은 해당 번호에서 구현한다.

- 6번 완료: GitHub OAuth, 웹 인증 세션과 인증 guard
- 7번 완료: AI 세션과 integration event transaction
- 10번 완료: 일회성 기기 연결 코드와 token 발급·회전·해제
- 12번 구현 완료: integration event sequence, 세션 만료 정리와 late `Stop` 복구
- 13번 구현 완료: 게시 퀘스트 콘텐츠 제약, 목록·상세 조회와 사용자별 최근 응시 상태
- 14번 구현 완료: 응시·답안 복구, 서버 채점, `EXPIRED`, 제출 멱등성과 5분 grace
- 15번 구현 완료: 퀘스트 완료·포인트 원장 기록 transaction, 기존 통과 backfill, 잔액·cursor 이력 API
- 16번 구현 완료: 미검증 UTC와 IANA time zone 저장, 세션 구간·통과 응시 index, 서버 기간 통계
- 17번 구현 완료: endpoint 보안 matrix, 공유 Rate Limit과 개인정보 보호
- 18번 구현 완료: queue 진단 컬럼, advisory-lock migration runner와 readiness 검증
- Discover Task 27 완료: 사용자별 저장 snapshot과 소유권·cursor 제약
- Discover Task 28 완료: 고정 allowlist 관심 기술과 idempotent 전체 교체
- 연결 UX 개선 완료: 브라우저 승인 요청과 OAuth 승인 화면 복귀 경로
