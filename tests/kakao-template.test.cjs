const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAppEnv() {
  const storage = {};
  const mockLocalStorage = {
    getItem: (k) => storage[k] || null,
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]); }
  };

  const context = {
    URLSearchParams: class { get() { return null; } },
    location: { search: '', protocol: 'http:', hostname: 'localhost' },
    navigator: {},
    window: { addEventListener: () => {} },
    document: {
      addEventListener: () => {},
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ rel: '', href: '' }),
      head: { appendChild: () => {} }
    },
    localStorage: mockLocalStorage,
    console
  };
  vm.createContext(context);
  const coreCode = fs.readFileSync(require.resolve('../assets/core.js'), 'utf8');
  vm.runInContext(coreCode, context);
  const billingCode = fs.readFileSync(require.resolve('../assets/billing.js'), 'utf8');
  vm.runInContext(billingCode, context);
  const appCode = fs.readFileSync(require.resolve('../assets/app.js'), 'utf8');
  vm.runInContext(appCode, context);
  return context;
}

test('kakao template replacement, customization and cross-month persistence', () => {
  const env = loadAppEnv();

  const {
    KAKAO_TEMPLATE_STORAGE_KEY,
    getDefaultKakaoTemplate,
    loadKakaoTemplates,
    saveKakaoTemplates,
    getKakaoTemplate,
    isKakaoTemplateCustomized,
    renderKakaoFromTemplate
  } = env;

  // 1. 기본 템플릿 검증
  const simpleDefault = getDefaultKakaoTemplate('simple');
  assert.ok(simpleDefault.includes('{상호}'));
  assert.ok(simpleDefault.includes('{청구월}'));
  assert.ok(simpleDefault.includes('{총입금액}'));
  assert.ok(simpleDefault.includes('[다인빌딩 관리 계좌]'));
  assert.equal(isKakaoTemplateCustomized('simple'), false);

  // 2. 8월 101호(온유) 데이터로 렌더링
  const varsAugustTenant1 = {
    '상호': '온유(201호)',
    '대표자': '김온유',
    '호수': '201호',
    '청구월': '8',
    '청구연도': '2026',
    '월세': '1,500,000원',
    '월세상태': '완납',
    '관리비': '150,000원',
    '관리비상태': '완납',
    '공용전기료': '35,000원',
    '공용전기료상태': '완납',
    '승강기유지비': '25,000원',
    '승강기유지비상태': '완납',
    '수도요금': '정산 예정 / 미부과',
    '총입금액': '0원',
    '입금기한': '해당 월 말일까지',
    '세금계산서발급일': '2026/09/10까지',
    '미납안내': '전액 입금 확인되었습니다. 감사합니다.'
  };

  const renderedAugust1 = renderKakaoFromTemplate(simpleDefault, varsAugustTenant1);
  assert.ok(renderedAugust1.includes('[온유(201호) 8월 임대료 및 관리비 청구 안내]'));
  assert.ok(renderedAugust1.includes('월세: 1,500,000원 (완납)'));
  assert.ok(renderedAugust1.includes('전액 입금 확인되었습니다'));

  // 3. 사용자 양식 수정: 계좌번호 및 고지 안내문구 커스텀 후 영구 저장
  const customTemplate = simpleDefault.replace(
    '[다인빌딩 관리 계좌] (입금 시 상호명 표기 부탁드립니다)',
    '국민은행 123-456-789012 (예금주: 다인빌딩 홍길동)'
  ) + '\n※ 문의사항은 관리실(010-1234-5678)로 연락 부탁드립니다.';

  const templates = loadKakaoTemplates();
  templates['simple'] = customTemplate;
  saveKakaoTemplates(templates);

  // 저장소에 저장되었는지 확인
  assert.equal(isKakaoTemplateCustomized('simple'), true);
  assert.equal(getKakaoTemplate('simple'), customTemplate);

  // 4. 다음 달(9월) 101호에 커스텀 양식 자동 적용 검증
  const varsSeptemberTenant1 = {
    ...varsAugustTenant1,
    '청구월': '9',
    '월세상태': '미납',
    '총입금액': '1,710,000원',
    '세금계산서발급일': '2026/10/10까지',
    '미납안내': '기존 미입금된 9월 월세 1,500,000원 확인 후 입금 부탁드립니다.'
  };

  const currentTemplate = getKakaoTemplate('simple');
  const renderedSeptember1 = renderKakaoFromTemplate(currentTemplate, varsSeptemberTenant1);

  // 수정했던 계좌번호와 문의사항이 9월에도 그대로 유지되는지 확인!
  assert.ok(renderedSeptember1.includes('국민은행 123-456-789012 (예금주: 다인빌딩 홍길동)'));
  assert.ok(renderedSeptember1.includes('※ 문의사항은 관리실(010-1234-5678)로 연락 부탁드립니다.'));
  // 9월 데이터로 정확히 치환되었는지 확인!
  assert.ok(renderedSeptember1.includes('[온유(201호) 9월 임대료 및 관리비 청구 안내]'));
  assert.ok(renderedSeptember1.includes('총 입금 요청금액: 1,710,000원'));
  assert.ok(renderedSeptember1.includes('기존 미입금된 9월 월세 1,500,000원 확인 후 입금 부탁드립니다.'));

  // 5. 다른 세입자(301호 디제이)에게도 동일한 맞춤 양식이 적용되는지 검증
  const varsSeptemberTenant2 = {
    '상호': 'DJ스튜디오',
    '대표자': '이디제이',
    '호수': '301호',
    '청구월': '9',
    '청구연도': '2026',
    '월세': '2,000,000원',
    '월세상태': '미납',
    '관리비': '200,000원',
    '관리비상태': '미납',
    '공용전기료': '40,000원',
    '공용전기료상태': '미납',
    '승강기유지비': '25,000원',
    '승강기유지비상태': '미납',
    '수도요금': '55,000원 (미납)',
    '총입금액': '2,320,000원',
    '입금기한': '해당 월 말일까지',
    '세금계산서발급일': '2026/10/10까지',
    '미납안내': '기존 미입금된 9월 월세 확인 후 입금 부탁드립니다.'
  };

  const renderedSeptember2 = renderKakaoFromTemplate(currentTemplate, varsSeptemberTenant2);
  assert.ok(renderedSeptember2.includes('[DJ스튜디오 9월 임대료 및 관리비 청구 안내]'));
  assert.ok(renderedSeptember2.includes('안녕하세요, DJ스튜디오(301호) 대표님.'));
  assert.ok(renderedSeptember2.includes('국민은행 123-456-789012 (예금주: 다인빌딩 홍길동)'));
  assert.ok(renderedSeptember2.includes('총 입금 요청금액: 2,320,000원'));

  // 6. 기본 복원 검증
  const resetTemplates = loadKakaoTemplates();
  delete resetTemplates['simple'];
  saveKakaoTemplates(resetTemplates);

  assert.equal(isKakaoTemplateCustomized('simple'), false);
  assert.equal(getKakaoTemplate('simple'), simpleDefault);
  const revertedMsg = renderKakaoFromTemplate(getKakaoTemplate('simple'), varsSeptemberTenant2);
  assert.ok(revertedMsg.includes('[다인빌딩 관리 계좌] (입금 시 상호명 표기 부탁드립니다)'));
  assert.ok(!revertedMsg.includes('국민은행 123-456-789012'));
});
