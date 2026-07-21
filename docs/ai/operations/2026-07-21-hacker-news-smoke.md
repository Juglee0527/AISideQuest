# Hacker News Adapter Live Smoke

- 검증일: 2026-07-21
- 대상: build된 `HackerNewsAdapter`와 공식 Hacker News v0 API
- fetch host: `hacker-news.firebaseio.com`
- 범위: Top, Ask, Show, Jobs feed와 bounded item detail 정규화

## 결과

| 항목 | 결과 |
|---|---:|
| 전체 normalized item | 47 |
| `EARNING` | 12 |
| `NEWS` | 23 |
| `COMMUNITY` | 12 |
| source가 `HACKER_NEWS`인 item | 전체 통과 |
| attribution이 `Hacker News`인 item | 전체 통과 |
| HTTPS original URL | 전체 통과 |

검증 출력에는 title, summary, tag, item ID, 원문 URL과 upstream response를 남기지 않았다.

## 판정과 제한

Task 24의 live source parsing과 attribution·HTTPS link smoke는 통과했다. 이 결과는 시점에 따라 변하는 외부 feed의 1회 관찰이며 availability 보장이 아니다. 또한 build된 Adapter 직접 검증이므로 Task 26의 browser session API, PostgreSQL cache 전환, stale UI, mobile·accessibility 검증을 대신하지 않는다.
