# 현재현황 문서 기능 배포 안내

## 적용 파일

Apps Script 프로젝트에는 `server/Code.gs`, `server/Billing.gs`, `server/CurrentStatus.gs` 세 파일을 함께 반영한다. `Billing.gs`는 `assets/billing.js`에서 `npm run build`로 생성하므로 직접 수정하지 않는다.

## 최초 권한과 문서 ID

새 서버 버전의 첫 저장 또는 `현재현황 다시 생성` 실행 시 Google Docs 권한 승인이 필요할 수 있다. `server/CurrentStatus.gs`의 운영 문서 ID를 고정 기본값으로 사용하며, Script Property `RENTAL_STATUS_DOCUMENT_ID`가 있으면 그 값을 우선한다. Property가 없으면 운영 문서 ID를 Property에 복구한 뒤 `DocumentApp.openById`로 연다. 문서 제목은 표시용 heading일 뿐 연결에 사용하지 않는다.

문서 ID가 잘못됐거나 접근할 수 없는 경우에는 이름 검색이나 새 문서 생성을 시도하지 않고 명확한 오류를 반환한다. 이 경우 Apps Script 프로젝트 설정에서 `RENTAL_STATUS_DOCUMENT_ID`를 올바른 문서 ID로 수정한다. 운영 기본 ID는 `1-HZYrBDD8HPZYO8sNCy33Q298DJ91LJIJAWRuWdQgFI`이다.

## 자동생성 영역

문서에서 다음 두 단독 문단 사이만 앱이 갱신한다.

```text
[RENTAL_CURRENT_STATUS_BEGIN]
[RENTAL_CURRENT_STATUS_END]
```

수동 메모는 이 영역 밖에 작성한다. 표지가 삭제·중복되거나 순서가 바뀌면 자동 갱신은 중단되며 DB 저장은 유지된다.

## 배포·검증 순서

1. 현재 활성 Apps Script 버전과 소스 백업을 확인한다.
2. 세 서버 파일을 반영하고 기존 웹 앱 배포를 새 버전으로 업데이트한다. URL, 실행 계정, 접근 범위는 바꾸지 않는다.
3. GET에서 `conditionalWrite`와 `currentStatus` capability 및 SHA-256 revision을 확인한다.
4. 샘플 또는 사용자가 승인한 동일 데이터 조건부 저장으로 DB acknowledgement와 별도 `docs` 결과를 확인한다.
5. Docs 실패를 모의해 DB 저장 성공이 유지되는지 확인하고, `현재현황 다시 생성`이 서버에 저장된 최신 DB만 사용하는지 확인한다.

## 2026-09-17 운영 반영 결과

- 기존 Apps Script 웹 앱 배포를 버전 4로 갱신했다. 웹 앱 URL, 실행 계정, 접근 범위는 유지했다.
- 실제 GET에서 `rental-sync-v2`, SHA-256 revision, `conditionalWrite: true`, `currentStatus: true`를 확인했다.
- Drive와 Docs 권한을 승인한 뒤 저장된 운영 DB만 사용하는 `regenerateCurrentStatus`를 두 차례 실행했다.
- 두 실행 모두 같은 `임대관리_현재현황` 문서 ID를 반환했으며, 문서에는 BEGIN/END 표지 사이에 네 개 층별 세로형 섹션이 생성됐다.
- 문서 재생성 전후 DB revision, 임차인 수, 월별 bills 원문이 같음을 확인했다. 이 검증에서는 운영 DB 저장을 실행하지 않았다.
- 현재현황 문서 ID는 Script Property에 저장되어 이후 갱신이 파일명 검색에 의존하지 않는다.
- 기존 소유자 전용 Sites 프로젝트에 프런트엔드 버전 3을 배포했다. 기존 HTTPS 주소와 접근 정책은 유지했다.
- 배포 주소의 HTML과 서비스 워커를 다시 읽어 `현재현황 다시 생성`, 임대상태 선택지, 새 캐시 버전을 확인했다. 390×844 격리 브라우저에서는 HTTP 200, 예시 임차인 4개, 메뉴 5개, 콘솔 오류 0건을 확인했다.

## 2차 건물 운영현황 운영 반영 결과

- Git `main`을 2차 완료 커밋 `0ae23e1`로 fast-forward하고 원격에 푸시했다.
- 운영 Apps Script에서 기존 `Billing`의 수동 현재현황 생성 함수와 `CurrentStatus`를 보존하고, `Code`의 선택적 `floorOperations` 검증만 반영했다.
- 기존 웹 앱 배포 ID와 URL을 유지한 채 Apps Script 버전 5 `건물 운영현황 2차 개발_2026-09-17`로 갱신했다.
- 기존 소유자 전용 Sites 프로젝트의 접근 정책과 HTTPS 주소를 유지한 채 버전 4를 배포했다. 배포 ID는 `appgdep_6aabbc26f2e8819180e608af898f4fc3`이며 최종 상태는 `succeeded`다.
- Apps Script 연속 GET 두 번에서 상태 `ok`, 동일 revision, 동일 응답 SHA-256을 확인했다. 운영 DB POST와 migration은 실행하지 않았다.
- 운영 Sites 390×844 격리 브라우저에서 임차인 4명을 GET으로 불러와 메뉴 6개, 1~5층 순서, 5층 `공실(정리중)`, 필터 무변경, 가로 넘침 없음과 콘솔 오류 0건을 확인했다.
- 롤백 기준은 Git `backup/phase1-complete-20260917`, Apps Script 버전 4, Sites 버전 3이다.

## 3차 계약기한 경고·Calendar 연동 운영 반영 결과

- Git `backup/phase2-complete-20260917`에서 `work/contract-alert-calendar-phase3-20260917`을 만들고 검증한 `bcfd55f`를 `main`에 fast-forward했다.
- 기존 웹 앱 배포 ID와 URL을 유지한 채 Apps Script 버전 6 `계약기한 경고·Calendar 연동 3차 개발_2026-09-17`로 갱신했다.
- Apps Script 연속 GET 두 번에서 HTTP 200, `status=ok`, 동일 revision, 동일 응답 SHA-256, `contractCalendar=true`를 확인했다. 운영 DB POST와 Calendar 동기화는 실행하지 않았다.
- 기존 소유자 전용 Sites 프로젝트의 접근 정책과 HTTPS 주소를 유지한 채 버전 5를 배포했다. 배포 ID는 `appgdep_6aabee7eed88819191432f600017e308`이며 최종 상태는 `succeeded`다.
- 운영 Sites 390×844 격리 브라우저에서 확인 필요 영역, Calendar 버튼, 메뉴 6개, 1~5층, 데이터 불변, 가로 넘침 없음, 콘솔 오류 0건을 확인했다. Google 요청은 GET 한 번뿐이었다.
- 롤백 기준은 Git `backup/phase2-complete-20260917`, Apps Script 버전 5, Sites 버전 4다.
