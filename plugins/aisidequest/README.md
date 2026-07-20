# AISideQuest Codex plugin

AISideQuest 계정에 현재 Codex 설치를 연결하고, 개인정보가 제거된 라이프사이클 이벤트를 기록하는 플러그인입니다.

기본 대상은 AISideQuest 저장소를 내려받아 로컬에서 무료로 실행하는 개발자입니다. 연결 전에 프로젝트 루트에서 `npm.cmd run dev:local`을 실행해 API와 승인 웹을 함께 준비합니다.

## 개인정보 처리 원칙

- 저장: 이벤트명, UUID 이벤트 ID, 기기별 증가 sequence, 해시된 세션/턴 식별자, 관측 시각
- 저장하지 않음: 프롬프트, 응답, 소스 코드, 파일 경로, transcript, 도구 입력/출력
- GitHub OAuth 자격 증명은 플러그인에 전달하거나 저장하지 않습니다.
- 기기 토큰 원문은 사용자 로컬의 `device.json`에만 저장하고 서버에는 SHA-256 해시만 저장합니다.
- 브라우저 연결 verifier 원문은 로컬 연결 프로세스에만 존재하고 서버에는 S256 challenge만 저장합니다.

## 기기 연결

1. 저장소의 로컬 marketplace에서 `aisidequest` 플러그인을 설치하고 활성화합니다.
2. Codex 앱이 lifecycle hook 신뢰를 요청하면 이벤트명과 실행 명령을 확인한 뒤 승인합니다.
3. Codex에 `AISideQuest 연결해줘`라고 요청합니다.
4. 자동으로 열린 브라우저에서 GitHub 로그인을 확인하고 **이 기기 연결 승인**을 누릅니다.
5. 플러그인이 연결 정보를 로컬에 저장하고 테스트 이벤트까지 확인하면 완료됩니다.

사용자가 연결 코드를 복사하거나 PowerShell 명령을 실행할 필요가 없습니다. 브라우저 승인 요청은 10분 후 만료되고, 기기 토큰은 90일 후 만료되며 웹 Devices에서 즉시 폐기할 수 있습니다.

로컬 API 또는 승인 웹이 꺼져 있으면 연결 명령은 브라우저 오류 화면을 열지 않고 `npm.cmd run dev:local`을 실행하라는 진단을 반환합니다.

선택적으로 외부 서버를 사용하는 bundle만 `AISIDEQUEST_API_URL` 환경 또는 배포된 plugin 설정으로 API 주소를 제공합니다. 기본값은 `http://localhost:3000/api/v1`입니다.

### 복구용 연결 코드

브라우저를 열 수 없는 환경에서만 웹 Devices의 **복구용 연결 코드**를 발급하고 다음 명령을 사용합니다.

```powershell
node .\scripts\connect-device.mjs --code <연결-코드> --api-url https://example.com/api/v1
```

연결 정보는 사용자 로컬 기본 데이터 위치에 한 번만 저장합니다. hook은 queue와 진단 파일에 Codex가 제공한 `PLUGIN_DATA`를 사용하지만, 기기 인증 정보는 항상 사용자 로컬 기본 위치를 먼저 읽습니다. 과거 버전이 plugin data directory에 남긴 설정은 기본 위치에 연결 정보가 없을 때만 호환용으로 읽습니다. `device.json`을 plugin data directory로 복사하지 마세요.

## 현재 범위

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop` 훅은 개인정보 필터링 후 로컬 `events.jsonl`과 durable JSONL delivery queue에 먼저 기록합니다. 활성 turn에는 30초 간격 `Heartbeat`를 생성합니다.

기기별 FIFO worker는 같은 event ID를 유지해 재전송하며 네트워크 오류, `408`, `429`, `5xx`에 지수 backoff와 full jitter를 적용합니다. 영구 실패와 손상 record는 7일 dead-letter에 보관하고 `401`·`403`은 자동 재시도를 멈춰 기기 재연결을 기다립니다. queue와 worker 상태는 플러그인 데이터 디렉터리의 `delivery-diagnostic.json`에서 확인할 수 있습니다.

진단 파일은 상태 기록마다 `updatedAt`을 갱신하고, 전송 상태가 `READY`로 회복되면 이전 `lastErrorCode`를 제거합니다.

queue 파일은 최대 10,000건 또는 10MiB, 48시간으로 제한됩니다. heartbeat를 먼저 정리하고 다른 event를 제거해야 하는 경우에도 dead-letter와 진단 상태에 이유를 남깁니다. 전송 실패는 Codex 작업을 중단하지 않으며 웹 수동 모드를 계속 사용할 수 있습니다.

플러그인 업데이트 시 지원하는 이전 queue 형식은 잠금 안에서 현재 형식으로 자동 변환되고, 기존 event 순서와 event ID를 유지해 재전송됩니다. 이전 버전 형식이라는 이유만으로 event를 dead-letter 처리하지 않으며, 구조적으로 복구할 수 없는 record만 `CORRUPT_QUEUE_RECORD`로 격리합니다.
