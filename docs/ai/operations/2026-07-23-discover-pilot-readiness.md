# Discover 파일럿 준비 기록 — 2026-07-23

이 기록은 Task 33의 repository 준비 상태와 아직 확보하지 않은 외부 증거를 분리한다. 실제 사용자가 참여한 파일럿 결과가 아니다.

## Repository 검증

| 항목 | 결과 | 근거 |
|---|---|---|
| UTC 7일 경계 | 통과 | UTC 자정 두 시각이 정확히 7일 차이인지 collector와 test가 검증 |
| 분자·분모와 중복 제거 | 통과 | 실제 PostgreSQL fixture에서 AI session 사용자 3, Discover 사용자 2, click·save·repeat 사용자 각 1 확인 |
| 반복 방문 UTC 날짜 | 통과 | 동일 사용자의 서로 다른 UTC 날짜 `DISCOVER_VIEW` 2일을 한 repeat user로 집계 |
| 탭 사용량 | 통과 | 최초 표시에는 `TAB_VIEW` 없음, 다른 category 명시 전환에만 1건 기록 |
| analytics 만료·export·delete | 통과 | 90일 constraint·cleanup 및 계정 export/delete 통합 테스트 |
| 금지 필드 | 통과 | endpoint DTO, DB dimension constraint, dashboard·alert label 검사 |
| source empty/failure 분리 | 통과 | 정상 refresh `EMPTY`·`NON_EMPTY` counter와 failure counter 분리 |
| 표본 부족 처리 | 통과 | 사전 승인 sample target 미달 시 `EXTEND_PILOT`, 성공 판정 없음 |

Fixture 결과는 테스트 데이터의 검증값일 뿐 제품 성과 지표가 아니다.

## 외부 미검증

- staging Grafana dashboard provisioning
- warning·critical alert의 실제 전달 시각과 담당자 ack
- 파일럿 시작 전 sample plan과 decision plan 승인
- 실제 사용자의 연속 7일 관찰
- 실제 source별 refresh attempt·failure·empty aggregate
- 실제 cash bounty 공급량과 다음 범위 결정

위 항목이 없으므로 현재 상태는 `Task 33 repository ready, real pilot pending`이다. `READY_FOR_PRODUCT_DECISION` 출력과 운영 증적이 모두 생기기 전에는 Task 33을 완료로 표시하지 않는다. 이 상태는 별도 Task 20의 staging·production·10명·7일 완료 여부를 변경하지 않는다.
