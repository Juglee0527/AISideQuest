# Discover UI Local Smoke

- 검증일: 2026-07-21
- 대상: local web의 `/discover`
- 범위: route, login boundary, navigation, responsive layout, tab semantics와 keyboard interaction

## 결과

| 항목 | 결과 |
|---|---|
| Desktop 1280×720 | desktop navigation 표시, mobile navigation 숨김, 가로 overflow 없음 |
| Mobile 375×812 | desktop navigation 숨김, 5열 mobile navigation 표시, 가로 overflow 없음 |
| Mobile tab 영역 | 320px 안에 3개 tab 배치 확인 후 small viewport에서 icon을 숨겨 전체 label을 표시하도록 보완 |
| Keyboard | 수익 기회에서 `ArrowRight` 입력 후 개발 소식이 selected tab이 되고 대응 tabpanel label 연결 확인 |
| 인증 경계 | active AI session과 무관한 GitHub browser-session login 안내와 `/discover` route 표시 확인 |

검증 중 외부 원문 link를 열거나 외부 사이트에 데이터를 전송하지 않았다. Browser에는 authenticated AISideQuest session이 없어서 실제 source card와 source 장애 전환은 local UI smoke에서 직접 확인하지 않았다. 해당 상태는 React test에서 정상 item, healthy empty, stale/부분·전체 장애, 전체 장애 retry, pagination 실패 후 기존 item 유지와 재시도를 검증했다.

이 결과는 repository/local Task 26 구현 증거이며 hosted staging·production, 실제 로그인 browser의 source card, 전체 접근성 audit와 Discover release 판정을 대신하지 않는다.
