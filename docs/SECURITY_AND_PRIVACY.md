# AISideQuest 보안 및 개인정보 보호 기준

작성일: 2026-07-18

## 1. 핵심 원칙

- 브라우저는 서버 세션 cookie와 CSRF double-submit token을 사용한다.
- Codex 플러그인은 기기별 Bearer token을 사용하며 token 원문은 서버 DB에 저장하지 않는다.
- 모든 사용자 리소스 조회와 변경은 인증 주체의 `user_id`를 SQL 조건에 포함한다.
- prompt, AI response, source code, 파일 경로, 원본 hook payload는 수집하지 않는다.
- 오류 응답과 로그에는 body, query 원문, cookie, Authorization, OAuth code, 연결 code를 남기지 않는다.

## 2. Endpoint 보안 matrix

입력 크기는 전체 JSON 요청에 공통으로 16 KiB가 적용된다. `Idem`은 UUID `Idempotency-Key`가 필수라는 뜻이다.

| Endpoint | 인증 | CSRF | 소유권 | 입력·멱등성 | Rate Limit |
|---|---|---:|---|---|---|
| `GET /health` | 공개 | 아니오 | 없음 | body 없음 | 없음 |
| `GET /auth/github` | 공개 | 아니오 | 없음 | body 없음 | IP 10회/10분 |
| `GET /auth/github/callback` | OAuth state+PKCE | 아니오 | state 1회 소비 | query 길이 제한 | IP+state 20회/10분 |
| `GET /auth/me` | 웹 세션 | 아니오 | 본인 | body 없음 | 없음 |
| `PATCH /auth/me/time-zone` | 웹 세션 | 예 | 본인 | IANA ID 100자 | 없음 |
| `POST /auth/logout` | 웹 세션 | 예 | 현재 세션 | body 없음 | 없음 |
| `POST /auth/me/export` | 웹 세션+15분 내 인증 | 예 | 본인 | 빈 DTO | 사용자+IP 10회/시간 |
| `DELETE /auth/me` | 웹 세션+15분 내 인증 | 예 | 본인 | `confirmation=DELETE` | 사용자+IP 5회/시간 |
| `POST /device-links` | 웹 세션 | 예 | 본인 | UUID, Idem | 사용자+IP 20회/10분 |
| `POST /device-links/redeem` | 연결 code | 아니오 | code가 지정한 사용자 | token/name/version 제한, Idem | IP+code 30회/10분 |
| `GET /devices` | 웹 세션 | 아니오 | 본인 기기만 | body 없음 | 없음 |
| `POST /devices/:id/rotation-links` | 웹 세션 | 예 | 본인 기기 | UUID, Idem | 사용자+IP 20회/10분 |
| `POST /devices/:id/revoke` | 웹 세션 | 예 | 본인 기기 | body 없음, Idem | 사용자+IP 20회/10분 |
| `POST /sessions/manual` | 웹 세션 | 예 | 본인 | body 없음, Idem | 없음 |
| `POST /sessions/:id/end` | 웹 세션 | 예 | 본인 세션 | enum, Idem | 없음 |
| `GET /sessions/active` | 웹 세션 | 아니오 | 본인 | body 없음 | 없음 |
| `GET /sessions` | 웹 세션 | 아니오 | 본인 | cursor, 최대 100건 | 없음 |
| `POST /integration-events` | 기기 token | 아니오 | 기기 소유 사용자 | event allowlist, eventId와 Idem 일치 | 기기+IP 240회/분 |
| `GET /quests`, `GET /quests/:code` | 웹 세션 | 아니오 | 본인 응시 상태만 | cursor, 최대 50건 | 없음 |
| `POST /quests/:code/attempts` | 웹 세션 | 예 | 본인·활성 세션 | body 없음, Idem | 없음 |
| `GET /quest-attempts/:id` | 웹 세션 | 아니오 | 본인 응시 | UUID | 없음 |
| `PUT /quest-attempts/:id/answers` | 웹 세션 | 예 | 본인 응시 | 답안 최대 100개 | 없음 |
| `POST /quest-attempts/:id/submissions` | 웹 세션 | 예 | 본인 응시 | body 없음, Idem | 없음 |
| `GET /points/balance`, `GET /points/ledger` | 웹 세션 | 아니오 | 본인 | cursor, 최대 100건 | 없음 |
| `GET /stats/summary`, `GET /stats/activity` | 웹 세션 | 아니오 | 본인 | 기간 최대 366일, cursor 최대 100건 | 없음 |

Rate Limit bucket은 PostgreSQL에 저장되므로 API 인스턴스를 늘려도 공유된다. state·연결 code·기기 token을 바꾸는 우회를 막기 위해 복합 식별자 bucket과 별도의 IP ceiling을 함께 소비한다. 초과 응답은 `429 RATE_LIMITED`와 `Retry-After`를 포함한다.

## 3. Cookie, CSRF, CORS

- 세션과 OAuth state cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`.
- CSRF cookie: JavaScript가 header에 복사해야 하므로 `HttpOnly`가 아니며 `SameSite=Lax`다.
- production: 모든 cookie에 `Secure`와 `__Host-` prefix를 적용한다.
- logout, 만료·폐기된 세션 인증 실패, 계정 삭제 시 인증 cookie를 만료시킨다.
- production의 callback, redirect, CORS origin은 HTTPS가 아니면 시작 단계에서 실패한다.
- CORS는 설정된 단일 origin만 credential 요청에 허용한다. 다른 origin의 preflight에는 허용 header를 반환하지 않는다.
- API 응답에는 `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`를 공통 적용한다.

## 4. 이벤트와 금지 데이터

허용 이벤트는 `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, `Heartbeat`뿐이다. turn당 저장 이벤트는 500개, 미래 관측 시각은 서버 시각 기준 5분까지다. event ID와 기기 sequence 재사용, 같은 idempotency key의 본문 변경, 불가능한 세션 상태 전이는 거부한다.

서버 DTO와 DB는 아래 원문을 받을 필드가 없다.

- 사용자 prompt와 AI 응답
- source code와 diff
- 로컬 파일·workspace 경로
- 원본 lifecycle hook payload
- OAuth access token, 웹 session·CSRF token, 기기 token, 연결 code

식별이 필요한 외부 session·turn, token, idempotency 본문은 SHA-256 hash만 저장한다. 예외 로그는 stack과 요청 원문 대신 redaction된 오류 종류와 메시지만 남긴다.

## 5. 데이터 내보내기와 계정 삭제

`POST /auth/me/export`는 profile, 연결 계정의 provider/login, 안전한 기기 metadata, AI 세션, allowlist 이벤트 metadata, 응시·답안, point 원장을 반환한다. token/hash, 외부 session·turn key, idempotency 응답 snapshot은 내보내지 않는다.

`DELETE /auth/me`는 확인 문자열, CSRF, 15분 이내 인증을 요구하며 다음 순서로 한 transaction에서 삭제한다.

1. point 원장
2. 퀘스트 응시와 cascade 답안
3. integration event
4. AI 세션
5. 기기 연결 code와 기기
6. idempotency record
7. 웹 인증 세션과 OAuth 연결
8. 사용자

성공 응답은 사용자의 기기에 남은 플러그인 연결 정보와 durable queue도 삭제하도록 안내한다. 서버는 사용자 기기의 로컬 파일을 원격 삭제할 수 없다.

## 6. 보존 정책

| 데이터 | 보존 기간 | 계정 삭제 시 처리 |
|---|---|---|
| OAuth state, 기기 연결 code | 10분 | 즉시 삭제 |
| 웹 인증 세션 | 설정값 1~720시간, 기본 168시간 | 즉시 삭제 |
| 기기 token hash·metadata | 만료 90일 | 즉시 삭제 |
| AI 세션, allowlist integration event | 계정 유지 중 90일을 beta 운영 기준으로 사용 | 즉시 삭제 |
| 응시·답안·point 원장 | 계정 유지 기간 | 즉시 삭제 |
| 로컬 queue 성공 record | 전송 완료 즉시 제거 | 사용자가 로컬 삭제 |
| 로컬 dead-letter 진단 | 최대 7일 | 사용자가 로컬 삭제 |
| 운영 로그 | 최대 30일 | 직접 식별자 금지, 정기 만료 |
| 암호화 백업 | 최대 30일 | primary에서는 즉시 삭제, 백업은 복원 목적 외 사용 금지 후 30일 내 만료 |

90일 integration event 정리, 로그와 백업 만료 job은 운영 구성 작업에서 강제한다. 백업에서 복원할 때 삭제 계정 목록을 다시 적용한다.

## 7. 검증과 배포 차단 기준

- CORS allow/deny preflight, CSRF, OAuth state 1회 소비, 만료·폐기 token을 자동 검사한다.
- 다른 사용자의 device/session/attempt 접근은 사용자 조건과 통합 테스트로 차단한다.
- 제출·보상은 row lock, transaction, unique constraint, idempotency로 중복을 막는다.
- 16 KiB 초과, 허용하지 않은 필드, turn event 500개 초과를 거부한다.
- 금지 데이터 fixture는 응답과 공통 redaction 결과에 token·경로가 남지 않는지 검사한다.
- 2026-07-18 `npm audit --audit-level=high`: 취약점 0건. 이후 high·critical이 발견되면 영향과 보완 통제를 문서화한 기한부 예외가 없는 한 배포를 차단한다.
