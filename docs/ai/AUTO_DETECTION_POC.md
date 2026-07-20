# AISideQuest AI 작업 자동 감지 기술 검증

- 검증일: 2026-07-15
- 대상: Windows ChatGPT 데스크톱 앱의 Codex 작업
- 앱 패키지: `OpenAI.Codex_26.707.9981.0`
- 관찰된 command runner: `0.144.0-alpha.4`
- 상태: **완료 - 정상 turn의 자동 시작·종료 감지 및 fallback 범위 확정**

---

# 1. 검증 목표

다음 조건을 만족하는 공식 연동 방식이 있는지 확인한다.

1. 사용자 요청 1회에 대한 AI 작업 시작과 종료를 감지할 수 있다.
2. 권한 승인 등 사용자의 추가 입력을 기다리는 구간을 구분할 수 있다.
3. 프롬프트, 응답, 소스 코드, 파일 경로를 수집하지 않는다.
4. hook 실패가 Codex 작업을 중단하지 않는다.
5. 중복 event를 서버에서 식별할 수 있는 session 및 turn 식별자가 있다.

# 2. 공식 문서 확인 결과

- Windows ChatGPT 데스크톱 앱은 플러그인을 지원한다.
- Codex 플러그인은 기본 경로인 `hooks/hooks.json`에 lifecycle hook을 포함할 수 있다.
- `UserPromptSubmit`, `PermissionRequest`, `PreToolUse`, `PostToolUse`, `Stop`은 turn 범위에서 실행된다.
- `SessionStart`는 thread 시작 또는 재개 범위에서 실행된다.
- command hook은 JSON 객체를 표준 입력으로 받는다.
- 공통 입력에는 session ID가 있고 turn 범위 hook에는 turn ID가 포함된다.
- 플러그인 hook에는 설치 위치와 쓰기 가능한 데이터 위치가 환경 변수로 제공된다.
- 비관리 hook은 사용자가 정의를 검토하고 신뢰해야 실행된다.

공식 문서:

- [ChatGPT desktop app for Windows](https://learn.chatgpt.com/docs/windows/windows-app)
- [Build Codex plugins](https://learn.chatgpt.com/docs/build-plugins)
- [Codex hooks](https://learn.chatgpt.com/docs/hooks)

# 3. PoC event 해석

| Event | AISideQuest 상태 후보 | 한계 |
|---|---|---|
| `UserPromptSubmit` | `RUNNING` | turn 시작 후보로 가장 명확함 |
| `PermissionRequest` | `WAITING_FOR_USER` | 승인 요청 시점은 알 수 있으나 승인 완료 전용 hook은 문서에 없음 |
| `PostToolUse` | `RUNNING` 재개 | 실제 재개보다 도구 완료 시점이 늦을 수 있음 |
| `Stop` | `COMPLETED` | 정상 완료는 실측됨. 실패·취소·강제 종료는 `Stop`을 가정하지 않음 |
| `SessionStart` | thread metadata | AI 작업 시간의 직접 시작점으로 사용하지 않음 |

권한 승인 대기 종료를 정확히 구분하지 못하면 첫 베타에서는 `UserPromptSubmit`부터 `Stop`까지의 전체 turn 시간을 사용하고 화면에 `권한 승인 대기 포함`을 표시한다.

# 4. 구현 결과

Repo-local plugin `plugins/aisidequest-hook-poc`를 추가했다.

- lifecycle event 6종 기록
- session ID와 turn ID SHA-256 변환
- 허용 필드만 새 JSON 객체로 생성
- 입력 크기 64 KiB 제한
- 알 수 없는 event와 잘못된 입력 무시
- 기록 실패가 Codex 작업에 영향을 주지 않도록 정상 종료
- Codex가 플러그인별로 제공하는 쓰기 가능 경로인 `PLUGIN_DATA`에 로그 저장

# 5. 자동 검증 결과

다음 항목을 `node:test`로 검증했다.

- 동일 식별자의 hash 일관성
- 원본 식별자 미저장
- 프롬프트, transcript, 경로, 모델, 명령 제거
- 알 수 없는 event와 빈 session ID 거부
- 실제 command entrypoint의 JSONL 기록

2026-07-15 실행 결과

- 기존 React 테스트: 19개 통과
- hook PoC 테스트: 4개 통과
- 플러그인 manifest validation: 통과
- Windows `commandWindows` PowerShell wrapper: JSONL 생성 및 민감정보 제거 확인
- TypeScript 타입 검사: 통과
- Vite 프로덕션 빌드: 통과

# 6. 앱 라이브 검증 결과

Repo-local marketplace의 `aisidequest-hook-poc`를 Windows ChatGPT 데스크톱 앱에 설치하고 6개 hook을 모두 신뢰한 뒤 실제 Codex 작업을 수행했다.

현재 설치 환경에서 event는 Codex가 설정한 `PLUGIN_DATA` 아래에 기록됐다.

```text
%USERPROFILE%\.codex\plugins\data\aisidequest-hook-poc-personal\events.jsonl
```

2026-07-15 실측 결과는 다음과 같다.

| 검증 항목 | 결과 |
|---|---|
| 플러그인 설치 및 신뢰 | 설치됨. `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop` 신뢰 설정 확인 |
| 정상 turn 시작·종료 | `UserPromptSubmit` 1회와 `Stop` 1회가 같은 turn ID로 기록됨 |
| 도구 사용 순서 | `UserPromptSubmit → PreToolUse → PostToolUse → PreToolUse → PostToolUse → Stop` |
| 정상 turn 측정 시간 | hook 수신 시각 기준 약 32.289초 |
| 중복·누락 | 완료된 turn에서 시작·종료 event 중복이나 누락 없음 |
| 개인정보 필터 | 모든 레코드가 허용된 4~5개 필드만 포함. 식별자는 64자리 SHA-256 hash로 기록 |
| 현재 실행 중인 turn | `UserPromptSubmit` 이후 도구 event만 존재하고 `Stop`은 아직 없음. 응답 중인 turn이므로 정상 |

`PermissionRequest`, 실패, 사용자 취소는 이번 로그에서 발생하지 않았다. 정상 완료가 아닌 상황에 `Stop`이 온다고 가정하지 않고 아래 fallback으로 처리하므로 2번 기술 검증의 완료를 막지 않는다.

# 7. 완료 판정 기준

## 7.1 완료 항목

- [x] 공식 lifecycle hook 존재 확인
- [x] 개인정보 필터링 PoC 구현
- [x] 자동 테스트 통과
- [x] Windows 앱에서 플러그인 설치 및 6개 hook 신뢰
- [x] 정상 turn 시작 및 종료 event 실측
- [x] 도구 사용 event 순서 실측
- [x] 완료 turn의 시작·종료 event 누락과 중복 확인
- [x] 자동 감지 가능 여부와 fallback 범위 최종 판정

## 7.2 최종 판정

- `UserPromptSubmit`을 자동 작업 시작으로 사용한다.
- 같은 turn ID의 `Stop`을 정상 작업 완료로 사용한다.
- 프롬프트, 응답, 소스 코드, 파일 경로 없이 event명, hash 식별자, 수신 시각만 전송한다.
- `PermissionRequest`가 발생해도 승인 완료 전용 event가 없으므로 베타에서는 승인 대기를 포함한 전체 turn 시간을 기록한다.
- hook이 비활성·미지원이거나 시작 event 자체가 없으면 수동 시작·종료 모드로 전환한다.
- 시작 후 `Stop`이 오지 않으면 완료로 추측하지 않는다. 후속 heartbeat 만료 시 `ABANDONED` 처리하고 사용자에게 수동 종료 또는 정리를 제공한다.
- 네트워크 재전송과 event 중복은 서버 멱등성으로 방어한다. 세부 키와 상태 전이는 3번 작업에서 정의한다.

결론: **정상 Codex turn의 공식 hook 기반 자동 감지는 가능하다. 비정상 종료와 hook 미수신은 heartbeat 및 수동 모드로 보완한다. 따라서 2번 작업을 완료한다.**

## 7.3 후속 관찰 항목

아래 항목은 운영 안정성을 높이기 위한 추가 관찰 대상이며, 이미 보수적인 fallback을 적용하므로 2번 완료를 막지 않는다.

- `PermissionRequest` 발생 후 event 순서
- 명령 실패 시 `PostToolUse`와 `Stop` 호출 여부
- 사용자 취소와 앱 강제 종료 시 `Stop` 호출 여부
- task 재개 시 `SessionStart`의 반복 호출 조건
