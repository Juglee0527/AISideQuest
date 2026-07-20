# AISideQuest

> AI가 일하는 동안, 사람도 의미 있는 일을 할 수 있도록.

AISideQuest는 Codex를 사용하는 개발자가 저장소를 내려받아 자신의 PC에서 무료로 실행하는 로컬 우선 도구입니다. Codex가 작업하는 동안 생기는 대기 시간을 짧은 개발 퀴즈와 학습 활동으로 바꾸고, 작업 시간과 활동을 로컬 웹에서 보여줍니다.

## 문서부터 시작하세요

이 프로젝트는 문서를 두 층으로 관리합니다.

| 대상 | 시작 문서 | 내용 |
|---|---|---|
| 사용자·기획자·운영자 | [문서 안내](./docs/문서_안내.md) | 소개, 사용법, 실행, 배포, 보안, 장애 대응 |
| AI 에이전트·개발 도구 | [AI 문서 안내](./docs/ai/README.md) | 현재 상태, 코드 지도, API·DB·상태·보안 계약 |

처음 보는 분은 [프로젝트 소개](./docs/프로젝트_소개.md)를, 바로 실행하려는 분은 [개발 및 실행 가이드](./docs/개발_실행_가이드.md)를 확인하세요.

## 핵심 기능

- Codex lifecycle hook과 30초 heartbeat 기반 AI 작업 감지
- durable JSONL queue, FIFO 재전송, backoff, dead-letter와 late `Stop` 복구
- 게시된 개발 퀴즈, 답안 저장·복구와 서버 채점
- 사용자·퀘스트 버전별 최초 통과 100P 원장
- IANA time zone 기반 오늘·주·월·사용자 지정 통계
- GitHub OAuth, CSRF, 소유권, Rate Limit, 데이터 내보내기·삭제
- 연결 코드 복사 없이 Codex 요청과 브라우저 승인만으로 끝나는 기기 연결
- 한 명령으로 PostgreSQL·API·웹을 준비하는 로컬 통합 실행
- 필요할 때만 사용하는 선택적 Docker 운영 배포 도구

## 빠른 실행

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

`.env`에 GitHub OAuth App의 `GITHUB_CLIENT_ID`와 `GITHUB_CLIENT_SECRET`을 입력한 뒤 실행합니다.

```powershell
npm.cmd run dev:local
```

이 명령 하나가 PostgreSQL, migration·seed, API, 웹을 순서대로 준비합니다. `http://localhost:5173`에 접속하고 Codex에 `AISideQuest 연결해줘`라고 요청하면 됩니다. 실행 창은 사용하는 동안 열어 두고, 종료할 때 `Ctrl+C`를 누릅니다.

환경 변수와 OAuth 설정은 [개발 및 실행 가이드](./docs/개발_실행_가이드.md)를 따릅니다.

## 검증

```powershell
npm.cmd run lint
npm.cmd run docs:check
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

마지막 전체 검증에서는 React 49개, Codex plugin 16개, 운영·로컬 실행 도구 17개, 서버 비DB 19개, PostgreSQL 통합 50개 등 총 151개 테스트를 통과했습니다.

## 현재 상태

핵심 기능은 개발자 개인 PC에서 무료로 사용하는 로컬 실행 흐름을 기본으로 제공합니다. 운영 배포 패키지는 선택 사항으로 보존하지만, 공개 서버 운영은 현재 제품 사용의 필수 조건이나 기본 목표가 아닙니다.

자세한 내용은 [개발 현황](./docs/개발_현황.md)과 [운영 배포 가이드](./docs/운영_배포_가이드.md)를 확인하세요.

## 개인정보 원칙

AISideQuest는 prompt, AI 응답, source code, diff, 파일 경로, transcript, 도구 입력·출력을 수집하지 않습니다. 자세한 내용은 [보안 및 개인정보 안내](./docs/보안_및_개인정보_안내.md)에 있습니다.

## License

MIT License
