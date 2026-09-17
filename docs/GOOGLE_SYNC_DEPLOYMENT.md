# Google 동기화 서버 적용 결과

> 이 문서는 2026-09-14 버전 2 배포 기록이다. 2026-09-17 확인 결과 활성 배포는 2026-09-15 버전 3이며 35,000자 다중 행 저장을 사용한다. 새 현재현황 기능의 배포 절차는 `CURRENT_STATUS_DEPLOYMENT.md`를 따른다.

## 결과

2026-09-14 12:41 KST, 기존 Apps Script 웹 앱 배포를 버전 2로 업데이트했다. 배포 URL, 실행 계정, 접근 권한은 유지했다. 12:42 KST 실제 서버 조건부 저장과 재조회 검증을 완료했다.

## 원인과 변경

앱은 conditionalWrite 지원과 revision을 요구했으나 기존 서버는 status/data만 반환하고 시트를 지운 뒤 저장했다. 앱의 업로드 차단은 의도된 안전장치였다.

server/Code.gs는 스크립트 잠금 안에서 현재 A1의 SHA-256 revision을 비교하고, 일치할 때만 저장한다. 저장 전 _RentalSyncRecovery 시트에 이전 원문을 보존하고 flush 후 A1을 갱신한다. 저장 후 재조회로 결과를 확인한다. requestId와 요청 해시로 중복 재전송을 처리하며 구형 무조건 덮어쓰기 요청은 거절한다. 기존 임대 자료의 필드는 유지하고 A1에는 자료와 동기화 메타데이터를 함께 저장한다.

## 검증

- npm run test:all: 빌드 일치·문법 검사 통과, 단위 테스트 61개 및 브라우저 시나리오 61개 통과. 브라우저 모음 5개 모두 종료 코드 0.
- Apps Script 편집기 전체 소스가 로컬 server/Code.gs와 일치함을 확인한 뒤 배포했다.
- 실제 GET: conditionalWrite=true 및 revision 반환 확인.
- 실제 POST: 방금 GET으로 읽은 동일 자료를 expectedRevision과 함께 저장하고 requestId·새 revision 확인.
- 실제 재조회: 저장 전후 임대 자료의 깊은 동등성 확인.
- 동일 요청 재전송: duplicate=true, revision 유지 확인.
- 오래된 revision의 별도 요청: conflict 응답 및 최종 자료·revision 유지 확인.

## 복구 및 증거

다음 파일은 gitignored test-results/google-sync에 보관한다. 운영 자료가 포함되어 있으므로 소스 배포에 포함하지 않는다.

- original-Code.gs: 기존 서버 원본
- before-response.json: 이전 작업에서 확보한 배포 전 응답
- before-live-verification.json: 이번 실제 저장 직전 응답
- after-live-verification.json: 최종 재조회 응답
- live-verification-summary.json: 실서버 검증 요약

전체 테스트 로그는 test-results/google-sync-resumed.log, 모음 결과는 test-results/browser-suite-summary.json에 있다.

## 범위와 운영 안내

이번 배포는 Apps Script 서버 변경이다. 사용자 기기의 현재 앱 화면에서 실제 버튼을 누르는 최종 동작은 별도로 실행하지 않았으며, 앱 UI 동기화 검사는 격리된 브라우저의 모의 서버 응답으로 검증했다. 실제 서버 GET/POST 검증은 위와 같이 별도로 완료했다.

이미 열려 있는 앱에서는 수동 저장으로 재시도할 수 있다. 서버 기준 버전이 없는 경우 앱의 기존 자료 대조 확인이 표시된다. 현재 기기에 미업로드 변경이 있다면 먼저 JSON 백업을 내보내고 자료를 대조한다. 불러오기는 현재 기기 자료를 교체하는 작업이다.

당시 버전 2는 서버 메타데이터를 포함해 49,000자를 넘는 자료를 거절했다. 이후 활성 버전 3에서 다중 행 저장으로 변경됐으며, 이번 개발본은 다중 행 복구 백업도 전체 원문을 보존하도록 보완한다.
