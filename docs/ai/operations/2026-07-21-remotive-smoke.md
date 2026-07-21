# Remotive Adapter Live Smoke

- 검증일: 2026-07-21
- 대상: build된 `RemotiveAdapter`와 Remotive Public API
- fetch host: `remotive.com`
- 요청 범위: `category=software-dev`, 최대 30개

## 결과

| 항목 | 결과 |
|---|---:|
| 전체 normalized item | 10 |
| 급여 문구 제공 | 9 |
| `full-time` | 8 |
| `contract` | 2 |
| `freelance` | 0 |
| `part-time` | 0 |
| `internship` | 0 |
| source·attribution·Remotive HTTPS 원문 URL | 전체 통과 |

검증 출력에는 title, company, location, salary 원문, description, item ID와 전체 URL을 남기지 않았다.

## 판정과 제한

Task 25의 live source parsing, compensation 제공 여부, 고용 형태, attribution과 원문 URL smoke는 통과했다. 결과는 24시간 지연될 수 있는 공개 feed의 1회 관찰이며 채용·급여·지원 가능성을 보장하지 않는다. 또한 Adapter 직접 검증이므로 Task 26의 browser session API, source 부분 장애 UI, mobile·accessibility 검증을 대신하지 않는다.
