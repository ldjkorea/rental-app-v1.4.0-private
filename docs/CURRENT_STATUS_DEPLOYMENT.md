# 현재현황 문서 기능 배포 안내

## 적용 파일

Apps Script 프로젝트에는 `server/Code.gs`, `server/Billing.gs`, `server/CurrentStatus.gs` 세 파일을 함께 반영한다. `Billing.gs`는 `assets/billing.js`에서 `npm run build`로 생성하므로 직접 수정하지 않는다.

## 최초 권한과 문서 ID

새 서버 버전의 첫 저장 또는 `현재현황 다시 생성` 실행 시 Google Docs와 Drive 권한 승인이 필요할 수 있다. 정확한 이름의 `임대관리_현재현황` 문서가 하나 있으면 그 문서를 사용하고, 없으면 한 번 생성한 뒤 Script Property `RENTAL_STATUS_DOCUMENT_ID`에 ID를 보관한다.

동일한 이름의 문서가 여러 개면 자동 선택하지 않는다. 저장된 문서 ID가 잘못됐거나 접근할 수 없는 경우에도 다른 문서를 만들지 않으며 앱에 경고를 반환한다. 이 경우 Apps Script 프로젝트 설정에서 `RENTAL_STATUS_DOCUMENT_ID`를 올바른 문서 ID로 수정한다.

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
