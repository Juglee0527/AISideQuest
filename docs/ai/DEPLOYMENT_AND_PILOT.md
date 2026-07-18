# 운영 배포와 파일럿 실행서

작성일: 2026-07-18

이 문서는 20번 작업의 실행 계약이다. 저장소에는 운영 배포 패키지와 검증·rollback·파일럿 판정 도구까지 구현되어 있다. 실제 완료 판정에는 별도 도메인과 서버, staging/production PostgreSQL 및 GitHub OAuth App, 초대 사용자 10명 이상, 최소 7일 관찰이 추가로 필요하다.

## 1. 배포 구조와 환경 분리

- `release-images.yml`은 한 commit에서 API와 웹 이미지를 만들고 GHCR에 push한 뒤 digest가 고정된 `release-manifest.json`을 생성한다.
- staging에서 검증한 API·웹 digest와 `SERVICE_VERSION`을 변경하지 않고 production에 승격한다.
- staging과 production은 domain, PostgreSQL, DB 계정, GitHub OAuth App, metrics token, 로그·경보 대상을 공유하지 않는다.
- API는 외부 port를 열지 않는다. Caddy만 80/443을 받고 `/api/*`를 내부 API로 전달한다.
- Caddy는 인증서 발급·갱신, HTTP→HTTPS 전환, HSTS와 보안 header를 담당한다. OAuth code가 URL query로 들어오므로 reverse proxy access log는 기본 비활성이다.
- secret은 env example, 이미지, release manifest, release state에 저장하지 않는다. 실제 env 파일은 host의 접근 제한 경로 또는 secret manager에서 배포 시점에 만든다.

`deploy/staging.env.example`과 `deploy/production.env.example`을 각 환경의 비추적 secret 파일로 복사한다. `REPLACE`와 `.example` 값은 검증기에서 거부된다. 두 환경을 함께 검사하면 secret·DB·domain 분리와 동일 artifact 승격도 검사한다.

```powershell
node .\scripts\validate-deployment-env.mjs staging C:\secure\aisidequest\staging.env C:\secure\aisidequest\production.env
```

필수 외부 설정:

1. 두 환경의 DNS A/AAAA record가 각 배포 host를 가리키고 80/443 inbound가 허용되어야 한다.
2. GitHub OAuth App을 환경별로 만들고 callback을 각각 `https://<host>/api/v1/auth/github/callback` 하나로 정확히 등록한다.
3. PostgreSQL은 TLS를 요구하고 환경별 최소권한 계정과 database를 사용한다.
4. production secret은 staging 값을 복사하지 않고 별도로 생성한다.

## 2. 이미지 생성과 승격

1. 보호된 `main`의 `CI / Required checks`가 성공한 commit에서 GitHub Actions의 `Release images`를 수동 실행한다.
2. `release-manifest-<sha>`와 `aisidequest-codex-plugin-<sha>` artifact를 받는다.
3. manifest의 `serviceVersion`, `apiImage`, `webImage`를 staging env에 기록한다. 이미지 값에는 반드시 `@sha256:<64자리>`가 있어야 한다.
4. staging 배포·실제 OAuth·Codex plugin 흐름을 통과한 뒤 같은 세 값을 production env에 기록한다. 다시 build하지 않는다.

## 3. 고정 배포 순서

배포 전 암호화 backup 결과를 파일로 남긴다. production은 최근 격리 복원 훈련 결과도 요구한다. 배포 스크립트는 다음 순서를 바꿀 수 없게 고정한다.

1. env와 digest, environment separation 검증
2. backup·복원 증거 확인
3. 이미지 pull
4. 동일 API 이미지로 one-shot migration
5. API readiness
6. 웹·reverse proxy 기동
7. HTTPS/HSTS, CORS allowlist, OAuth state·PKCE·Secure cookie, SPA smoke
8. 성공한 release state 기록

```powershell
.\scripts\deploy-release.ps1 `
  -Environment staging `
  -EnvironmentFile C:\secure\aisidequest\staging.env `
  -PublicOrigin https://staging.example.com `
  -BackupEvidence C:\secure\evidence\staging-backup.json

.\scripts\deploy-release.ps1 `
  -Environment production `
  -EnvironmentFile C:\secure\aisidequest\production.env `
  -PublicOrigin https://app.example.com `
  -BackupEvidence C:\secure\evidence\production-backup.json `
  -RestoreDrillEvidence C:\secure\evidence\restore-drill.json
```

migration 실패 시 기존 service는 변경하지 않는다. readiness 또는 smoke 실패 시 확대를 중단하고 request ID 기반 로그를 확인한다. 배포 후 실제 Chrome/Edge에서 로그인, 거부 후 재로그인, logout, 새로고침, 다른 브라우저의 데이터 일치를 확인한다.

## 4. rollback과 장애 리허설

성공한 배포의 현재·직전 image digest만 `ops/release-state`에 저장된다. application rollback은 다음 명령으로 수행한다.

```powershell
.\scripts\rollback-release.ps1 `
  -Environment production `
  -EnvironmentFile C:\secure\aisidequest\production.env `
  -PublicOrigin https://app.example.com
```

DB down migration은 실행하지 않는다. 직전 앱과 호환되지 않는 schema 문제는 새 migration으로 forward-fix한다. production 전에 staging에서 다음을 각각 한 번 재현하고 시작·종료 시각, RPO/RTO, 결과를 evidence로 보관한다.

- 잘못된 OAuth secret, HTTP callback, mutable image tag가 시작 전 차단되는지
- 의도적으로 실패하는 migration이 기존 API를 바꾸지 않는지
- 웹만 새 버전인 partial deploy를 직전 digest로 복구하는지
- 격리 DB restore 후 migration 수, 퀘스트 수, point unique constraint와 smoke가 통과하는지

목표는 RPO 24시간 이하, RTO 4시간 이하다.

## 5. 운영 kill switch

- `INTEGRATION_EVENTS_ENABLED=false`: 기기 인증 뒤 event 처리 전에 `503 INTEGRATION_EVENTS_PAUSED`와 `Retry-After: 60`을 반환한다. plugin은 durable queue를 보존하고 재시도한다. 사용자는 웹 수동 세션을 사용할 수 있다.
- `QUEST_REWARDS_ENABLED=false`: 채점 transaction 전에 제출을 `503 QUEST_REWARDS_PAUSED`로 차단한다. 통과했지만 100P가 없는 상태를 만들지 않는다.

값 변경은 env 교체 후 API 재기동과 readiness 확인이 필요하다. 개인정보 노출, 인증 우회, 중복 보상, 복구 불가능한 유실은 한 건만 발생해도 신규 초대를 중단하고 관련 switch를 내린 뒤 incident runbook을 수행한다.

## 6. 파일럿 진행

1. 운영자 1~2명이 내부 smoke로 설치→로그인→기기 연결→실제 Codex turn→자동 세션 종료→퀘스트 제출→100P를 확인한다.
2. 2명, 5명, 10명 이상 순으로 초대한다. 앞 단계에서 critical incident가 0일 때만 확대한다.
3. 각 사용자가 전체 흐름을 한 번 이상 마쳤는지 익명 운영 ID로 체크한다. 이메일, GitHub login, prompt, 코드, 경로는 관찰표에 적지 않는다.
4. 최소 7일을 관찰한다. 50 turn은 조기 checkpoint이고 최종 판정 표본은 자동 세션 100건 이상을 기본으로 한다.
5. `deploy/pilot-observation.example.json`을 복사해 집계값만 채우고 판정한다.

```powershell
node .\scripts\evaluate-pilot.mjs C:\secure\evidence\pilot-observation.json
```

판정은 `CONTINUE_BETA`, `EXTEND_PILOT`, `FIX_BEFORE_EXPANSION`, `STOP_PILOT` 중 하나다. 표본 부족은 성공으로 간주하지 않는다.

## 7. 지표 정의와 합격선

| 지표 | 정의 | 기준 |
|---|---|---:|
| 자동 감지 성공률 | 시작된 지원 turn 중 수동 보정 없이 terminal 상태에 도달한 수 / 대상 turn 수 | 95% 이상 |
| 상태 반영 지연 | event 관측 시각부터 웹 조회에서 상태가 보인 시각 | p95 5초 이하 |
| 세션 유실 | 수신된 시작 event가 어떤 세션에도 연결되지 않고 복구 불가능한 건 | 0 |
| 중복 세션 | 같은 기기·turn이 둘 이상의 실제 세션이 된 건 | 0 |
| 중복 point | 같은 사용자·퀘스트 version에 실제 원장 적립이 둘 이상 생긴 건 | 0 |
| API 5xx | 전체 API 응답 중 5xx 응답 비율 | 1% 미만 |
| 금지 데이터 | prompt, 응답, 코드, 경로가 plugin 요청·서버 로그·artifact에서 발견된 건 | 0 |
| 전체 흐름 | 가입→감지→제출→100P를 완료한 서로 다른 사용자 | 10명 이상 |

queue 복구율, 수동 fallback 사용률, 퀴즈 재응시, 이탈 지점과 정성 피드백은 보조 지표다. 수치 기준이 맞아도 심각한 개인정보·권한 문제가 있으면 계속하지 않는다.

## 8. 실제 완료 체크

- [x] staging/production 구성 template과 동일 artifact 승격 계약
- [x] HTTPS reverse proxy, production cookie/CORS fail-fast, deployment smoke
- [x] migration-first 배포와 app-only rollback 자동화
- [x] event/reward kill switch와 단위 테스트
- [x] plugin 배포 bundle, 설치 가이드, 개인정보 안내, 파일럿 판정기
- [ ] 실제 staging domain·DB·OAuth로 live browser smoke
- [ ] 실제 production backup·restore·rollback evidence
- [ ] 초대 사용자 10명 이상이 전체 흐름 완료
- [ ] 최소 7일·자동 세션 100건 관찰과 최종 판정

마지막 네 항목이 완료되기 전에는 20번 전체를 완료로 표시하지 않는다.
