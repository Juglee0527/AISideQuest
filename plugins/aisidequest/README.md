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

## 현재 범위

`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop` 훅은 개인정보 필터링 후 로컬 `events.jsonl`에 먼저 기록하고 세션 API로 한 번 전송합니다. 전송은 3초 안에 끝내며 실패해도 Codex 작업을 중단하지 않고 로컬 기록과 웹 수동 모드를 유지합니다.

heartbeat, durable queue, 오프라인 재전송과 비정상 종료 복구는 12번 작업에서 구현합니다.
