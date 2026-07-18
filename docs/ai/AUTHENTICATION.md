# AISideQuest 사용자 인증

- 작성일: 2026-07-16
- 로그인 방식: GitHub OAuth Web Application Flow
- 세션 방식: PostgreSQL 서버 저장형 세션 + cookie
- 기준 migration: `1784163600000-add-authentication`, `1784188800000-add-server-statistics`의 time zone 검증 상태

---

# 1. 구현 범위

6번 작업에서는 GitHub 계정으로 사용자를 식별하고 이후 사용자별 API를 보호할 수 있는 인증 경계를 구현했다.

- GitHub OAuth 로그인 시작과 callback
- OAuth `state` 1회 사용 및 PKCE `S256`
- GitHub 숫자 ID 기준 사용자·OAuth 계정 생성 또는 갱신
- 서버 저장형 인증 세션 생성, 조회, 만료와 폐기
- 현재 사용자 조회
- CSRF 검증이 적용된 logout
- 인증 guard와 CSRF guard

GitHub access token은 사용자 식별을 위한 `GET /user` 요청에만 사용하고 DB나 cookie에 저장하지 않는다. 이메일 scope도 요청하지 않는다.

# 2. 인증 흐름

1. 브라우저가 `GET /api/v1/auth/github`로 이동한다.
2. 서버는 무작위 `state`와 PKCE verifier를 만들고, `state` hash와 verifier를 10분 동안 DB에 저장한다.
3. 원본 `state`는 `HttpOnly` cookie에 저장하고 브라우저를 GitHub로 이동시킨다.
4. GitHub callback에서 query의 `state`, cookie의 `state`, DB의 hash와 만료를 모두 검증한다.
5. 유효한 state는 성공·거부 여부와 관계없이 한 번만 소비한다.
6. authorization code와 PKCE verifier로 GitHub access token을 교환하고 `GET /user`로 숫자 ID를 확인한다.
7. `(provider, provider_account_id)` 기준으로 사용자와 GitHub 계정을 생성하거나 최신 프로필로 갱신한다.
8. 로그인마다 새 인증 세션과 CSRF token을 만들고 원문 대신 SHA-256 hash만 DB에 저장한다.
9. 인증 cookie를 발급한 뒤 설정된 프런트엔드 주소로 이동한다.

# 3. API 계약

| Method | Path | 인증 | 설명 |
|---|---|---|---|
| `GET` | `/api/v1/auth/github` | 불필요 | GitHub 로그인 시작 |
| `GET` | `/api/v1/auth/github/callback` | OAuth state | GitHub callback 처리 |
| `GET` | `/api/v1/auth/me` | 세션 cookie | 현재 로그인 사용자 조회 |
| `PATCH` | `/api/v1/auth/me/time-zone` | 세션 cookie + CSRF | 검증된 IANA time zone 저장 |
| `POST` | `/api/v1/auth/logout` | 세션 cookie + CSRF | 현재 세션 폐기 |

`GET /api/v1/auth/me`의 `data` 예시는 다음과 같다.

```json
{
  "id": "34ff1c3e-0c5d-4b67-978f-8cb8556de132",
  "displayName": "AISideQuest User",
  "avatarUrl": "https://avatars.githubusercontent.com/u/123456",
  "githubLogin": "aisidequest-user",
  "timeZone": "Asia/Seoul",
  "timeZoneVerified": true
}
```

신규·기존 사용자는 16번 migration 이후 미검증 `UTC`에서 시작한다. 브라우저가 `Intl.DateTimeFormat().resolvedOptions().timeZone`으로 확인한 IANA ID를 명시적으로 저장한 뒤 `timeZoneVerified=true`가 된다. 서버가 지원하지 않는 ID는 `INVALID_TIME_ZONE`으로 거부하며 기존 값을 조용히 변경하지 않는다.

인증이 없거나 만료·폐기된 세션이면 `401`을 반환한다. logout과 time zone 변경 요청은 CSRF cookie 값을 `x-csrf-token` header에도 동일하게 보내야 하며, 누락 또는 불일치 시 `403`을 반환한다.

```ts
const csrfToken = readCookie('aisidequest_csrf')

await fetch('http://localhost:3000/api/v1/auth/logout', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'x-csrf-token': csrfToken,
  },
})
```

운영 환경에서는 cookie 이름 앞에 `__Host-`가 붙으므로 프런트엔드는 실행 환경에 맞는 CSRF cookie 이름을 사용해야 한다.

인증 cookie와 프런트엔드의 `document.cookie`가 같은 host 경계를 사용해야 하므로 `GITHUB_CALLBACK_URL`과 `CORS_ORIGIN`의 hostname은 같아야 한다. 로컬에서도 `localhost`와 `127.0.0.1`을 혼용하지 않는다. 운영 배포에서는 같은 hostname의 `/api` reverse proxy 구성을 기본으로 한다.

# 4. Cookie와 세션 보안

| Cookie | HttpOnly | 역할 |
|---|---:|---|
| `aisidequest_oauth_state` | 예 | OAuth callback 위조 방지, 10분 만료 |
| `aisidequest_session` | 예 | 무작위 서버 세션 token |
| `aisidequest_csrf` | 아니요 | 변경 요청의 double-submit CSRF token |

공통 속성은 `Path=/`, `SameSite=Lax`다. 운영 환경에서는 `Secure`와 `__Host-` prefix가 추가된다. 세션 기본 만료는 168시간이며 `AUTH_SESSION_TTL_HOURS`로 1~720시간 범위에서 설정한다.

서버는 다음 경우 인증 cookie를 제거하고 요청을 거부한다.

- 세션 token이 DB에 없음
- logout으로 폐기됨
- 만료됨
- 연결 사용자가 삭제됨

DB 장애처럼 인증 실패가 아닌 서버 오류에는 cookie를 삭제하지 않는다.

# 5. 데이터베이스

인증 migration은 다음 테이블을 추가한다.

| 테이블 | 저장 내용 |
|---|---|
| `oauth_login_states` | state hash, PKCE verifier, 10분 만료 시각 |
| `auth_sessions` | 사용자, 세션·CSRF token hash, 만료·폐기·마지막 사용 시각 |

세션 token과 CSRF token 원문은 DB에 저장하지 않는다. `auth_sessions.token_hash`는 unique이며 사용자 삭제 시 관련 세션도 삭제된다.

# 6. 로컬 설정과 실행

GitHub OAuth App에서 다음 값을 설정한다.

```text
Homepage URL: http://localhost:5173
Authorization callback URL: http://localhost:3000/api/v1/auth/github/callback
```

루트 `.env`에는 발급받은 값을 넣는다. client secret은 저장소에 commit하지 않는다.

```dotenv
GITHUB_CLIENT_ID=github-oauth-app-client-id
GITHUB_CLIENT_SECRET=github-oauth-app-client-secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/v1/auth/github/callback
AUTH_SUCCESS_REDIRECT_URL=http://localhost:5173/
AUTH_FAILURE_REDIRECT_URL=http://localhost:5173/?authError=github_oauth_failed
AUTH_SESSION_TTL_HOURS=168
```

DB migration을 적용하고 API를 실행한다.

```powershell
npm.cmd run db:up
npm.cmd run db:migrate
npm.cmd run dev:server
```

로그인은 브라우저에서 다음 주소로 시작한다.

```text
http://localhost:3000/api/v1/auth/github
```

# 7. 검증

DB·인증 통합 테스트는 실제 PostgreSQL과 모의 GitHub 응답을 사용한다.

```powershell
$env:TEST_DATABASE_URL='postgresql://aisidequest:aisidequest@127.0.0.1:54329/aisidequest_test'
$env:ALLOW_DATABASE_RESET='true'
npm.cmd run test:database
```

검증 범위는 다음과 같다.

- 비로그인 사용자의 보호 API 접근 거부
- OAuth state, PKCE challenge와 1회 사용
- 사용자·GitHub 계정 생성 및 재로그인 시 재사용
- session·CSRF token 원문 미저장
- 현재 사용자 조회
- CSRF 없는 logout 거부와 정상 logout 후 세션 재사용 차단
- 만료된 세션 차단
- GitHub 승인 거부 callback 처리

실제 GitHub 로그인은 개인 OAuth App의 client ID와 secret을 설정한 환경에서 별도로 확인해야 한다.
