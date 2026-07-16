# AISideQuest Codex Hook PoC

> 이 디렉터리는 2번 기술 검증 결과를 보존하기 위한 자료입니다. 실제 연동에는 정식 [`aisidequest`](../aisidequest/README.md) 플러그인을 사용합니다.

Windows ChatGPT 데스크톱 앱에서 Codex 작업 lifecycle event를 감지할 수 있는지 검증하는 로컬 플러그인이다.

## 기록 이벤트

| Hook | 검증 목적 |
|---|---|
| `SessionStart` | 앱 task 시작 및 재개 시점 확인 |
| `UserPromptSubmit` | AI 작업 turn 시작 후보 |
| `PreToolUse` | 권한 요청 전후 event 순서 확인 |
| `PermissionRequest` | 사용자 승인 대기 시작 후보 |
| `PostToolUse` | 승인 후 AI 작업 재개 후보 |
| `Stop` | AI 작업 turn 종료 후보 |

## 개인정보 보호

Hook의 원본 JSON 전체를 저장하지 않는다. 다음 필드만 `events.jsonl`에 기록한다.

- schema version
- hook event name
- SHA-256으로 단방향 변환한 session ID
- SHA-256으로 단방향 변환한 turn ID
- 로컬 수신 시각

프롬프트, 응답, transcript 경로, 작업 디렉터리, 모델명, 명령, 도구 입력 및 출력은 저장하지 않는다.

## Windows 로그 경로

로그는 Codex가 플러그인에 제공하는 `PLUGIN_DATA`에 저장한다. 현재 repo-local marketplace 설치 기준 실제 경로는 다음과 같다.

```text
%USERPROFILE%\.codex\plugins\data\aisidequest-hook-poc-personal\events.jsonl
```

## 자동 테스트

저장소 루트에서 실행한다.

```powershell
npm.cmd run test:hooks
```

## 앱 라이브 검증

1. ChatGPT 데스크톱 앱을 재시작한다.
2. AISideQuest 프로젝트의 로컬 marketplace에서 `aisidequest-hook-poc`를 설치한다.
3. 새 task를 열고 hook 정의를 검토한 뒤 신뢰한다.
4. 일반 요청, 도구 사용 요청, 권한 승인이 필요한 요청, 실패 요청, 사용자 취소를 각각 실행한다.
5. `events.jsonl`에서 event 순서와 누락 여부를 확인한다.

PoC hook은 Codex 작업을 방해하지 않도록 잘못된 입력과 로컬 기록 실패를 무시하고 항상 정상 종료한다.
