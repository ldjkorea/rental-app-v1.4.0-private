# Google 동기화 — 현재 클라이언트가 요구하는 규격

**서버 구현 완료 문서가 아닙니다.** 현재 저장소에는 실제 Google Apps Script 소스가 없으며 아래 조건을 만족하는 모의 응답으로 클라이언트만 검증했습니다.

## 읽기 응답

```json
{"status":"ok","data":{"tenants":[],"bills":{}},"revision":"r1","capabilities":{"conditionalWrite":true}}
```

`data`는 기존 JSON 데이터 구조입니다. capability나 revision이 없는 구형 서버는 불러오기만 사용할 수 있습니다.

## 조건부 쓰기 요청과 성공 응답

```json
{"protocol":"rental-sync-v2","expectedRevision":"r1","requestId":"고유 요청 ID","data":{"tenants":[],"bills":{}}}
```

```json
{"status":"ok","revision":"r2","requestId":"동일한 요청 ID","capabilities":{"conditionalWrite":true}}
```

클라이언트는 업로드 전 읽은 revision과 로컬 기준을 비교하고, 응답의 requestId·새 revision·capability를 검사합니다. 충돌 응답 `{"status":"conflict"}`은 실패로 처리하며 로컬 변경을 유지합니다.

## 서버에서 실제로 검증해야 할 조건

버전 검사와 데이터 저장이 하나의 원자 작업이어야 합니다. `conditionalWrite: true` 문구만 추가하는 것으로는 충분하지 않습니다. 인증·권한, 서버 저장 성공 후 응답, 동시 기기 충돌, 재시도 requestId의 중복 처리, CORS·리다이렉트 및 오류 응답도 실제 배포 환경에서 검증해야 합니다.

파일 복원·초기화 시 클라이언트 기준 revision은 초기화됩니다. 이후 서버 자료를 대조하고 수동 저장을 선택해야 하며, 구형 서버로의 무조건 덮어쓰기를 허용하지 않습니다.
