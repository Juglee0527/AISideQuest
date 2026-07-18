# 2026-07-18 backup·restore 훈련 기록

- 대상: 로컬 Docker PostgreSQL 16 `aisidequest`
- 격리 복원 DB: `aisidequest_restore_test` (검증 후 삭제)
- 목표: `RPO ≤ 24시간`, `RTO ≤ 4시간`
- 측정 RPO: 훈련 시작 시점 즉시 생성한 backup, 1분 미만
- 측정 RTO: 암호화 backup 생성부터 복원 검증까지 5.1초
- 암호화: .NET AES-256-CBC, PBKDF2 100,000회, 훈련 전용 passphrase
- 무결성: 암호화 파일 SHA-256 계산 완료

검증 결과:

- 사용자 row: 0
- 게시·개발 퀘스트 row: 5
- 적용 migration: 11
- point 중복 방지 unique constraint: 존재
- 임시 복원 DB와 평문·암호화 임시 파일: 정리 완료

첫 실행에서는 `postgres:16-alpine`에 `openssl` 실행 파일이 없어 암호화 단계에서 중단됐다. 스크립트를 컨테이너 도구에 의존하지 않는 .NET 암호화로 수정한 뒤 재실행해 통과했다. 운영 훈련에서는 실제 object storage, KMS key, production 규모와 readiness·로그인 smoke 시간을 별도로 측정해야 한다.
