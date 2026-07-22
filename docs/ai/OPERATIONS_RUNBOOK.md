# AISideQuest 운영 로그 및 장애 대응 Runbook

작성일: 2026-07-18 · 목표 `RPO ≤ 24시간`, `RTO ≤ 4시간`

## 로컬 우선 실행

기본 사용자는 저장소를 소유한 개발자이며 외부 운영 서버는 필요하지 않다. 루트 `.env`와 GitHub OAuth 값을 준비한 뒤 `npm.cmd run dev:local` 하나로 Docker PostgreSQL, migration·seed, API, 웹을 실행한다. 이 명령은 API readiness와 웹 응답을 확인한 뒤 준비 완료를 표시한다. 사용 중에는 터미널을 열어 두고 `Ctrl+C`로 API와 웹을 함께 종료한다. DB 컨테이너는 데이터를 유지하며 필요할 때 `npm.cmd run db:down`으로 별도 중지한다.

연결 시 로컬 API나 승인 웹이 꺼져 있으면 플러그인은 브라우저의 연결 거부 화면을 열지 않고 통합 실행 명령을 안내한다. 개별 `db:up`, `db:setup`, `dev:server`, `dev` 명령은 통합 실행 장애를 진단할 때만 사용한다.

## 관측 계약

API는 유효한 `X-Request-ID`를 그대로 사용하고 없거나 형식이 잘못되면 UUID를 생성한다. 같은 ID가 응답 header, 성공·오류 envelope의 `meta.requestId`, JSON 요청 로그와 `error_tracking_event`에 기록된다. 로그에는 배포 환경, service version, method, route template, status, latency, 오류 code만 남으며 URL/query/body/cookie/Authorization와 사용자·기기·hash 식별자는 기록하지 않는다.

운영·staging은 `DEPLOYMENT_ENVIRONMENT`로 분리해 서로 다른 log index와 alert route를 사용한다. `error_tracking_event`를 수집하는 log pipeline에서 오류 추적 도구로 전달하며 공통 sanitizer를 지난 JSON 외에는 전송하지 않는다. production image에는 client source map을 넣지 않고 server source map artifact는 운영자 전용 오류 분석 저장소에만 둔다.

Probe:

- `GET /api/v1/health/live`: event loop가 요청을 처리할 수 있는지만 확인한다.
- `GET /api/v1/health/ready`: 2초 내 DB query와 모든 migration 적용을 확인한다. 실패 상세는 공개하지 않고 `503 NOT_READY`만 반환한다.
- `GET /api/v1/health/metrics`: 32자 이상 Bearer secret을 요구하며 Prometheus 형식만 반환한다.

## 배포 및 migration

1. 암호화 백업의 최신 시각과 복원 훈련 결과를 확인한다.
2. 새 artifact로 별도 migration job에서 `npm run db:migrate`를 한 번 실행한다.
3. runner는 PostgreSQL advisory lock을 획득하지 못하거나 migration이 하나라도 남으면 실패한다. 실패 시 새 API로 traffic을 전환하지 않는다.
4. migration 성공 후 새 API 인스턴스의 `/health/ready`가 200인지 확인한다.
5. API traffic을 점진 전환하고 로그인 → active session → quest 목록 smoke test를 수행한다.

이미 적용된 migration 파일 수정, production `synchronize`, 운영에서 임의 `migration:revert`를 금지한다. 스키마는 expand → 양쪽 버전 호환 배포 → backfill → contract 순으로 변경한다.

### migration 실패

- 중단 조건: advisory lock 실패, SQL 오류, pending migration, readiness 503.
- 첫 대응: request ID가 아니라 migration job event `migration_failed`와 DB 오류 code를 확인하고 traffic 전환을 멈춘다.
- 복구: transaction rollback 여부를 확인한다. 부분 DDL이 남았으면 기존 artifact를 유지하고 새 forward migration으로 정리한다.
- 종료 조건: runner 재실행 성공, pending 0, readiness 200, 핵심 smoke test 통과.

### API rollback

- DB schema가 직전 API와 호환되면 직전 immutable artifact로 traffic을 되돌린다.
- 파괴적 down migration은 실행하지 않는다. schema 문제는 forward migration으로 roll-forward한다.
- rollback 뒤 5xx와 readiness가 10분 안정될 때 종료한다.

## 백업과 복원

- production PostgreSQL은 매일 최소 1회 암호화 custom-format backup을 생성해 별도 계정의 object storage에 저장한다.
- 전송·저장 암호화, MFA, write-only backup role, 삭제 보호를 적용하고 30일 후 만료한다.
- `DATABASE_URL`과 암호화 key는 secret manager에서 짧은 수명의 job에만 주입하며 로그나 명령 출력에 남기지 않는다.
- 주 1회 격리 DB에 복원해 table/row count, migration 수, point unique constraint와 로그인·quest smoke test를 검증한다.

로컬 Docker 복원 훈련:

```powershell
$env:BACKUP_ENCRYPTION_PASSPHRASE='<16자 이상의 훈련 전용 값>'
./scripts/backup-restore-drill.ps1
Remove-Item Env:BACKUP_ENCRYPTION_PASSPHRASE
```

스크립트는 고정된 `*_restore_test` DB만 삭제·재생성하고 .NET AES-256-CBC/PBKDF2 암호화, SHA-256, 복원 검증 후 임시 DB와 파일을 정리한다. 실제 RPO는 마지막 성공 backup 시각, RTO는 복원 시작부터 readiness·smoke 완료까지 측정해 훈련 기록에 남긴다.

## 장애 대응

모든 경보 기본 담당자는 `beta-oncall`이다. critical은 즉시 확대와 파일럿 traffic 중단을 검토하고 warning은 15분 내 확인한다.

### Readiness 장애

DB 연결, credential 만료, pending migration을 순서대로 확인한다. liveness도 실패하면 프로세스를 교체한다. readiness만 실패하면 인스턴스를 traffic에서 제외하되 migration job 성공 전 재투입하지 않는다.

### API 5xx 장애

경보 시각의 `http_request`에서 route template과 error code를 찾고 같은 request ID의 `error_tracking_event`를 조회한다. body/query를 수집해 재현하지 않는다. 5xx가 1%를 넘으면 최근 배포를 중단하거나 호환 artifact로 rollback한다.

### Database 장애

pool waiting, connection 수, slow query와 storage를 확인한다. 임의 재시작 전 backup 최신성을 확인한다. 데이터 손상 가능성이 있으면 쓰기 traffic을 중단하고 격리 복원 절차를 시작한다.

### Heartbeat/queue 장애

heartbeat 만료율, deferred 최고 age, late Stop 복구, queue depth/oldest age/dead-letter, device lastSeen을 함께 본다. queue 원문이나 로컬 경로를 요청하지 않는다. 서버 장애면 재시도 가능한 응답을 유지하고 플러그인 장애면 수동 세션 fallback을 안내한다.

플러그인 업데이트 직후 `CORRUPT_QUEUE_RECORD`가 급증하면 먼저 queue schema 호환 회귀를 의심한다. 지원하는 이전 operation-log 또는 raw-event 형식은 queue lock 안에서 현재 형식으로 변환하고, 마지막 ack sequence보다 큰 값으로 재배정한 뒤 FIFO로 전송해야 한다. JSON 파싱 실패나 필수 필드 손상처럼 구조적으로 복구할 수 없는 record만 dead-letter로 격리한다.

### 인증/Rate Limit 이상

OAuth 설정 변경, proxy hop 설정과 공격성 traffic을 확인한다. Rate Limit bucket을 임의 삭제하지 않는다. GitHub 장애가 원인이면 신규 로그인만 중단하고 기존 세션 상태를 확인한다.

### Discover source 장애

`aisidequest_discover_source_fetch_total`의 source·result·고정 failure reason과 `aisidequest_discover_cache_total`의 `FRESH`·`STALE`·`MISS`를 확인한다. URL, item ID, 응답 body, HTML 또는 사용자 식별자를 로그나 metric label에 추가하지 않는다. 한 source 실패는 core readiness 장애가 아니며, maximum stale 이내 cache는 `STALE`, 그 이후는 `UNAVAILABLE`로 처리한다. Task 32 dashboard와 alert는 아래 운영 절차를 따른다.

현재 활성 source의 정상 fresh·maximum stale는 Hacker News 10분·24시간, Remotive 6시간·72시간, DEV 30분·24시간, Stack Overflow 15분·24시간이며, 설정된 경우 GitHub 30분·24시간이다. DEV `429`나 schema 변경은 source-level retry 없이 기존 stale cache로 격리한다. Stack Overflow는 동일 method 요청 1분 간격과 wrapper `backoff`를 우선하며 `quota_remaining`이 0이면 UTC 다음 날까지 새 요청을 차단한다. GitHub `403`·`429`는 `Retry-After`를 우선하고 search bucket remaining이 0이면 reset까지 요청을 차단한다. 장애 진단 중에도 Forem·Stack Exchange·GitHub response body, article·question·issue URL, item ID·title·tag를 로그에 추가하거나 사용자에게 요청하지 않는다.

## Discover source incident

Import `ops/grafana-discover-dashboard.json` and provision
`ops/prometheus-alerts.yml` from version control. The dashboard is UTC and uses
a rolling 30-day window for source freshness, failures, fetch p95 latency,
normalized item count, cache resolutions, and aggregate product events.

- Warning: any sustained refresh failure or fetch p95 above five seconds.
- Critical: an enabled source has no cache or exceeds its maximum stale window
  (24 hours except Remotive at 72 hours).
- Check fixed `source`, `result`, and `reason` labels only. Never add a user ID,
  item ID, URL, title, tag, query, interest, or raw payload to a log or label.
- A source incident degrades Discover to stale/unavailable. It must not fail
  core liveness or database readiness.
- Route warning and critical alerts to `beta-oncall`; validate delivery and ack
  in staging before Task 33. Keep pilot operational metrics and logs for at
  most 30 days.

Pilot aggregation uses `ops/discover-pilot-metrics.sql` with an inclusive UTC
start and exclusive UTC end spanning seven consecutive dates. Report numerator,
denominator, unique users, and raw event counts. Insufficient samples cannot be
reported as success.

## Secret rotation

- GitHub OAuth secret: 새 secret을 secret manager에 등록 → staging callback → production rolling restart → 이전 secret 폐기.
- GitHub Discover token: OAuth secret과 별도로 회전한다. 새 server-only fine-grained token이 승인된 organization/repository scope를 검색하는지 staging에서 집계값만 확인 → production rolling restart → 이전 token 폐기. token 또는 allowlist가 없으면 source는 disabled이며, token 값과 검색 결과 상세는 증거에 남기지 않는다.
- 웹 세션: cookie는 서명 key가 아니라 DB의 hash-only opaque token을 쓴다. 유출 시 해당 또는 전체 `auth_sessions.revoked_at`을 설정하고 재로그인을 요구한다.
- 기기 token: rotation link로 새 token 확인 후 이전 token을 교체한다. 유출 기기는 즉시 revoke한다.
- metrics token: 새 token으로 scraper와 API를 함께 전환하고 짧은 scrape 실패를 감시한 뒤 이전 값을 폐기한다.
- backup key: 새 backup부터 새 key ID를 쓰고 보존 중 backup의 이전 key는 해당 backup 만료까지 decrypt-only로 유지한다.

회전 로그에는 secret 값이 아니라 secret ID/version, 작업자, 시작·종료 시각과 검증 결과만 기록한다.

## 경보 검증

규칙은 [`ops/prometheus-alerts.yml`](../../ops/prometheus-alerts.yml)에 있다. staging에서 `AISideQuestAlertPipelineTest`를 `vector(1)`로 2분만 바꿔 beta-oncall 수신·ack 경로를 확인한 뒤 즉시 `vector(0)`으로 복구한다. 실제 지표 임계값을 낮춰 시험하지 않는다. webhook 자체는 `ALERT_TEST_WEBHOOK_URL`을 주입하고 `node scripts/send-test-alert.mjs`로 시험할 수 있으며 HTTPS가 아닌 외부 주소는 거부한다. 결과에는 수신 시각, 담당자, ack 시간만 남긴다.
