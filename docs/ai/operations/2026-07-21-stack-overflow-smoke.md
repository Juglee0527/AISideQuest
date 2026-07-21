# Stack Overflow Source Smoke — 2026-07-21

## Scope

- Stack Exchange API v2.3의 고정 Stack Overflow featured·unanswered 요청을 실제 실행했다.
- `StackOverflowAdapter`의 정규화 결과만 aggregate로 검사했다.
- Question ID, 제목, URL, tag, owner와 raw response는 출력하거나 문서에 기록하지 않았다.

## Result

| Check | Result |
|---|---:|
| normalized item | 34 |
| `REPUTATION_BOUNTY` | 4 |
| `DISCUSSION` | 30 |
| `STACK_EXCHANGE` source | 전체 통과 |
| `Stack Overflow` attribution | 전체 통과 |
| Stack Overflow HTTPS question link | 전체 통과 |
| bounty가 reputation-only이고 compensation이 없음 | 전체 통과 |

이 결과는 Task 29B 시점의 실제 source parsing·분류·attribution·HTTPS link smoke 증거다. 외부 feed는 시간에 따라 달라지므로 지속적 availability를 보장하지 않으며, authenticated `/discover` browser flow, PostgreSQL stale 전환, 실제 `backoff` 응답 발생과 전체 접근성 검사를 대신하지 않는다. `backoff`, quota exhaustion, 1분 요청 간격과 stale fallback 경계는 자동 테스트로 검증한다.
