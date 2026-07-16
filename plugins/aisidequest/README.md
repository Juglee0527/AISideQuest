# AISideQuest Codex plugin

AISideQuest 계정에 현재 Codex 설치를 연결하고, 개인정보가 제거된 라이프사이클 이벤트를 기록하는 플러그인입니다.

## 개인정보 처리 원칙

- 저장: 이벤트명, UUID 이벤트 ID, 해시된 세션/턴 식별자, 관측 시각
- 저장하지 않음: 프롬프트, 응답, 소스 코드, 파일 경로, transcript, 도구 입력/출력
- GitHub OAuth 자격 증명은 플러그인에 전달하거나 저장하지 않습니다.
- 기기 토큰 원문은 사용자 로컬의 `device.json`에만 저장하고 서버에는 SHA-256 해시만 저장합니다.

## 기기 연결

1. 저장소의 로컬 marketplace에서 `aisidequest` 플러그인을 설치하고 활성화합니다.
2. Codex 앱이 lifecycle hook 신뢰를 요청하면 이벤트명과 실행 명령을 확인한 뒤 승인합니다.
3. AISideQuest 웹의 `Devices` 화면에서 연결 코드를 발급합니다.
4. 플러그인 디렉터리에서 아래 명령을 실행합니다.

```powershell
node .\scripts\connect-device.mjs --code <연결-코드>
```

API가 로컬 기본값과 다르면 `--api-url https://example.com/api/v1`을 추가합니다.

5. 연결 후 테스트 이벤트를 명시적으로 전송해 연결을 확인합니다.

```powershell
node .\scripts\send-test-event.mjs
```

연결 코드는 한 번만 사용할 수 있고 10분 후 만료됩니다. 기기 토큰은 90일 후 만료되며 웹 화면에서 재연결하거나 즉시 폐기할 수 있습니다.

## Event 전송과 장애 복구

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop` hook은 개인정보 필터링 후 다음 순서로 처리합니다.

1. `delivery-queue.jsonl`에 고정 `eventId`와 기기 sequence를 기록합니다.
2. 기기별 delivery worker가 FIFO로 한 건씩 전송합니다.
3. 서버가 event를 수락한 뒤에만 queue에서 제거합니다.
4. 네트워크 오류, `408`, `429`, `5xx`는 `Retry-After` 또는 full jitter 지수 backoff로 재전송합니다.
5. 재시도할 수 없는 event는 `dead-letter.jsonl`로 이동합니다.

active queue는 10,000건 또는 10MiB, 48시간으로 제한합니다. DLQ는 1,000건 또는 1MiB, 7일로 제한합니다. `401`·`403`은 재연결 전까지 queue의 선두 event를 `AUTH_BLOCKED`로 유지하며, 기기 재연결 후 같은 순서로 재개합니다.

활성 turn에서는 30초마다 `Heartbeat`를 같은 FIFO queue에 추가합니다. host process ID는 로컬 heartbeat lease에만 사용하고 서버로 전송하거나 event log에 저장하지 않습니다. `Stop`, 새 `SessionStart`, host process 종료 또는 12시간 안전 상한에서 heartbeat가 중단되며 서버가 마지막 activity 120초 후 세션을 정리합니다.

모든 hook과 worker 오류는 Codex 작업을 중단하지 않습니다. 자동 감지를 사용할 수 없을 때는 웹 수동 모드를 계속 사용할 수 있습니다.
