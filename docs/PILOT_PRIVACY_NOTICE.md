# AISideQuest 폐쇄형 파일럿 개인정보 안내

참여 전 확인할 핵심 내용이다.

수집하는 정보는 GitHub 계정 식별자와 표시용 프로필, 기기 이름·plugin version·마지막 연결 시각, lifecycle 이벤트 종류·UUID·sequence·해시된 세션/turn key·관측 시각, AI 세션 시간과 상태, 퀘스트 답안·채점 결과, 포인트 원장, queue 깊이·최고 age·dead-letter 수 같은 진단 수치다.

프롬프트, Codex 응답, source code·diff, 파일·workspace 경로, transcript, 도구 입력·출력, 원본 hook payload는 수집하지 않는다. OAuth token, 웹 cookie, 기기 token 원문, 연결 code도 분석 데이터로 저장하지 않는다. 지원 문의에도 이 정보를 보내면 안 된다.

보존 기준은 다음과 같다.

- OAuth state와 연결 code: 10분
- 웹 세션: 기본 168시간
- 기기 token hash·metadata: token 만료 90일
- AI 세션과 allowlist event: 파일럿 기준 90일
- 응시·답안·point 원장: 계정 유지 기간
- 로컬 성공 queue: 전송 후 즉시 제거, dead-letter: 최대 7일
- 운영 로그와 암호화 backup: 최대 30일

계정에서 데이터 내보내기와 삭제를 요청할 수 있다. 계정 삭제는 primary data를 transaction으로 지우지만, 사고 복구용 암호화 backup의 사본은 최대 30일 동안 복원 외 목적으로 사용하지 않고 만료된다. plugin을 제거하거나 계정을 삭제해도 사용자 PC의 `device.json`과 queue는 자동 삭제되지 않으므로 설치 안내의 로컬 삭제 절차를 함께 수행해야 한다.

파일럿 참여는 언제든 중단할 수 있다. 장애 공지는 운영 사이트의 상태 공지에 게시하고, 지원 채널은 초대 안내에 실제 주소와 담당 시간을 기입한다. 운영자는 critical 신고를 즉시 확인하고 일반 설치·사용 문의는 영업일 1일 이내 1차 응답하는 것을 목표로 한다.

치명적인 개인정보 노출, 권한 우회, 중복 보상, 복구 불가능한 데이터 유실이 한 건이라도 확인되면 신규 초대와 파일럿 확대를 중단한다.

