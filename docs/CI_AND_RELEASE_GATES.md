# CI와 릴리스 게이트

AISideQuest의 PR 검사는 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)에서 실행한다. 모든 job은 `pull_request`의 신뢰되지 않은 코드를 전제로 `contents: read` 권한만 사용하며 OAuth, 운영 DB, 기기 token을 주입하지 않는다.

## 자동 검사

| Job | 차단하는 회귀 |
|---|---|
| `Quality / lint, types, build, audit` | oxlint 경고, client/server type 오류, 양쪽 production build 실패, high 이상 의존성 취약점 |
| `Tests / client, server, plugin, operations` | React, Nest 비DB 계약, hook fixture/fake sender, queue/운영 스크립트 회귀 |
| `Tests / PostgreSQL integration` | OAuth mock, 인증·CSRF·소유권, idempotency, 동시 session/submit/reward, 통계와 개인정보 회귀 |
| `Tests / migration, seed, upgrade` | PostgreSQL 16 빈 DB migration, seed 재실행, migration 재실행, 이전 schema에서 최신 schema로 forward upgrade 실패 |
| `Tests / Chromium core flow` | 로그인 → 연결 기기 → 자동 session 반영 → 퀴즈 → 답안 새로고침 복구 → 제출 → 100P/dashboard 핵심 흐름 |
| `Required checks` | 위 job의 실패·취소·skip 중 하나라도 merge 가능한 상태가 되는 문제 |

PostgreSQL job은 이름에 `test`가 포함된 격리 DB와 `ALLOW_DATABASE_RESET=true`가 동시에 있어야만 실행된다. migration job은 실제 migration을 단계적으로 되돌려 대표 데이터를 넣은 뒤 최신 4개 migration을 다시 적용하므로 직전 기능 schema의 point backfill과 최신 운영 진단 column까지 함께 검증한다.

OAuth는 실제 GitHub credential 대신 서버 프로세스 안의 mock provider를 사용해 state/PKCE 성공, 사용자 거절, state replay, callback 입력 오류, logout, session 만료·폐기를 검증한다. 실제 GitHub OAuth는 아래 staging smoke에서만 확인한다.

플러그인은 Codex Desktop을 headless로 실행하지 않는다. hook payload fixture와 별도 Node 프로세스 fake sender로 lifecycle, 30초 heartbeat, 프로세스 재시작, FIFO, 네트워크 단절, `429 Retry-After`, `5xx` backoff, queue 부분 손상과 dead letter를 검증한다. 역순 event, timeout, 24시간 이내 late `Stop`은 PostgreSQL session 통합 테스트의 고정 시각으로 검증한다.

## 재현 명령

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd audit --audit-level=high
```

PostgreSQL 검사는 Docker Desktop의 test 전용 DB에서 실행한다.

```powershell
$env:TEST_DATABASE_URL='postgresql://aisidequest:aisidequest@127.0.0.1:54329/aisidequest_test'
$env:ALLOW_DATABASE_RESET='true'
npm.cmd run test:database
```

브라우저 검사는 client build와 preview가 준비된 뒤 실행한다.

```powershell
npm.cmd run build:client
npm.cmd run preview -- --host 127.0.0.1
# 별도 터미널
npm.cmd run test:e2e
```

E2E는 `Asia/Seoul`과 고정 API 시각, 가짜 사용자·CSRF·기기 데이터만 사용한다. flaky 재실행으로 성공 처리하지 않는다. 실패한 경우에만 screenshot과 trace를 3일 보관하며 원본 서버 로그, cookie, OAuth code, 실제 token은 artifact에 포함하지 않는다.

## Branch protection 설정

GitHub 저장소 관리자가 default branch의 ruleset 또는 branch protection에서 다음을 활성화한다.

1. merge 전에 pull request를 요구한다.
2. merge 전에 status check를 요구하고 `CI / Required checks`를 required로 지정한다.
3. branch가 최신 상태일 것을 요구한다.
4. 승인 없이 required check를 우회하지 못하게 하고 관리자에게도 규칙을 적용한다.
5. force push와 branch 삭제를 차단한다.
6. stale approval 해제와 마지막 push에 대한 별도 승인을 활성화한다.

저장소 설정은 코드만으로 변경되지 않으므로 최초 운영 배포 전에 관리자가 한 번 적용하고, 보호된 branch에서 의도적으로 실패하는 draft PR로 merge 차단을 확인한다.

## Staging·데스크톱 릴리스 체크리스트

자동 검사가 통과한 동일 commit으로 다음을 수동 확인한다.

- staging 전용 GitHub OAuth App에서 로그인 성공, 사용자 거절, logout 후 재로그인을 확인한다.
- staging callback URL과 CORS origin이 production과 분리되어 있는지 확인한다.
- clean Windows 사용자 계정에서 플러그인을 설치하고 Codex hook 신뢰 승인을 완료한다.
- 실제 `UserPromptSubmit`, `PermissionRequest`, `Stop`과 heartbeat가 서버에 도착하되 prompt, 코드, 경로가 저장·로그되지 않는지 확인한다.
- 네트워크를 잠시 끊고 복구한 뒤 같은 event ID가 FIFO로 전달되고 중복 point가 생기지 않는지 확인한다.
- 검증 결과와 commit SHA, 담당자, 실행 시각을 릴리스 기록에 남긴다.

staging OAuth나 실제 Codex Desktop 확인이 실패하면 CI가 green이어도 릴리스하지 않는다.
