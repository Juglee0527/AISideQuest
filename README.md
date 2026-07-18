# AISideQuest

> AI가 일하는 동안, 사람도 의미 있는 일을 할 수 있도록.

AISideQuest는 Codex가 작업하는 동안 생기는 대기 시간을 짧은 개발 퀴즈와 학습 활동으로 바꾸는 서비스입니다. AI 작업을 자동 감지하고, 퀴즈 최초 통과 시 100P를 적립하며, 작업 시간과 활동을 대시보드에서 보여줍니다.

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
- Docker 운영 배포, migration-first rollout, rollback, metrics·alerts

## 빠른 실행

```powershell
npm.cmd ci
npm.cmd run db:up
npm.cmd run db:setup
npm.cmd run dev:server
```

별도 터미널:

```powershell
npm.cmd run dev
```

환경 변수와 OAuth 설정은 [개발 및 실행 가이드](./docs/개발_실행_가이드.md)를 따릅니다.

## 검증

```powershell
npm.cmd run lint
npm.cmd run docs:check
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

마지막 전체 검증에서는 React 47개, Codex plugin 10개, 운영 도구 11개, 서버 비DB 19개, PostgreSQL 통합 45개 등 총 132개 테스트를 통과했습니다.

## 현재 상태

핵심 기능과 운영 배포 패키지의 로컬 Docker 리허설은 완료했습니다. 실제 staging·production 인프라 연결과 10명 이상·7일 이상 파일럿은 아직 진행하지 않았습니다.

자세한 내용은 [개발 현황](./docs/개발_현황.md)과 [운영 배포 가이드](./docs/운영_배포_가이드.md)를 확인하세요.

## 개인정보 원칙

AISideQuest는 prompt, AI 응답, source code, diff, 파일 경로, transcript, 도구 입력·출력을 수집하지 않습니다. 자세한 내용은 [보안 및 개인정보 안내](./docs/보안_및_개인정보_안내.md)에 있습니다.

## License

MIT License
