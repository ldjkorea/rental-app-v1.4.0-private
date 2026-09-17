# Google 동기화 서버 계약

## 읽기

GET 성공 응답은 저장된 기존 JSON, 현재 원문의 SHA-256 revision, 지원 기능을 반환한다.

```json
{
  "status": "ok",
  "data": {"tenants": [], "bills": {}},
  "revision": "sha256-...",
  "protocol": "rental-sync-v2",
  "capabilities": {"conditionalWrite": true, "currentStatus": true, "contractCalendar": true}
}
```

클라이언트는 `conditionalWrite`와 revision이 없으면 불러오기만 허용하고 업로드를 차단한다.

## 조건부 저장

```json
{
  "protocol": "rental-sync-v2",
  "action": "save",
  "expectedRevision": "sha256-...",
  "requestId": "고유 요청 ID",
  "data": {"tenants": [], "bills": {}}
}
```

서버는 스크립트 잠금 안에서 revision을 비교하고, 전체 이전 원문을 `_RentalSyncRecovery`에 분할 백업해 재확인한 뒤 저장한다. 저장 결과도 다시 읽어 확인한다. 같은 request ID와 같은 내용의 재시도는 중복 쓰기 없이 성공하고, 오래된 revision은 `conflict`, 구형 무조건 쓰기는 `unsupported`로 거절한다.

DB 성공과 Google Docs 결과는 분리한다.

```json
{
  "status": "ok",
  "revision": "sha256-...",
  "requestId": "동일한 요청 ID",
  "capabilities": {"conditionalWrite": true, "currentStatus": true},
  "docs": {"status": "ok", "documentId": "...", "updatedAt": "..."}
}
```

문서 갱신 실패도 최상위 `status`는 `ok`이며, `docs.status`만 `error`가 된다. 클라이언트는 DB 저장 완료를 유지하고 문서 경고와 수동 재생성 동작을 제공한다.

## 현재현황 수동 재생성

```json
{
  "protocol": "rental-sync-v2",
  "action": "regenerateCurrentStatus",
  "expectedRevision": "sha256-...",
  "requestId": "고유 요청 ID"
}
```

이 요청에는 `data`를 보내지 않는다. 서버는 revision이 일치할 때 현재 저장 DB로만 문서를 갱신하며 DB 원문은 변경하지 않는다.

## 계약 Calendar 수동 동기화

```json
{
  "protocol": "rental-sync-v2",
  "action": "syncContractCalendar",
  "expectedRevision": "sha256-...",
  "requestId": "고유 요청 ID"
}
```

이 요청에도 `data`를 보내지 않는다. 서버는 revision이 일치하는 저장 DB의 현재 계약 종료일만 사용해 Google Calendar 일정을 생성하거나 기존 event를 갱신한다. Calendar event ID는 Script Properties에 보관하며 DB 원문은 변경하지 않는다. Calendar 실패 시 최상위 저장 계약은 `ok`, `calendar.status`만 `error`로 반환한다. 일정 자동 삭제와 Calendar에서 DB로 가져오는 역방향 동기화는 수행하지 않는다.
