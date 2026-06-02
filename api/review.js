export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const model = (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929').trim();
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' });

  try {
    const { imageBase64, mimeType, reviewType, brandName, memo, specCheck, serviceKey, overlayBase64, overlayType } = req.body || {};
    if (!imageBase64 || !mimeType) return res.status(400).json({ error: '이미지가 없습니다.' });

    // ✅ design-guide-rules.json 로드
    let rulesData = {};
    try {
      const fs = await import('fs');
      const path = await import('path');
      const rulesPath = path.join(process.cwd(), 'public', 'rules', 'design-guide-rules.json');
      rulesData = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    } catch(e) { console.warn('rules load failed:', e.message); }

    const specNote = specCheck ? `
Spec check:
- Size: ${specCheck.actual?.width}x${specCheck.actual?.height} (standard: ${specCheck.expected?.width || 'flexible'}x${specCheck.expected?.height})
- Safe area: ${specCheck.expected?.safeArea}
- File size shown is a preview thumbnail — do NOT flag it.
- Safe area: only flag CORE ELEMENTS (main text, key visuals) outside safe zone. Background/decorations are fine.` : '';

    // ✅ 서비스별 가이드 주입 (브랜드샵은 기존 디자이너/마케터/디렉터 기준 통합)
    const dg = rulesData?.directorGuidelines;
    const svc = serviceKey || '브랜드샵';

    let directorGuidelineText = '';
    if (dg) {
      const forbidden = dg['공통_절대금지'] || [];
      // 브랜드샵: 디자이너+마케터+디렉터 기준 모두 적용 (기존 누적 기준)
      const perspectiveKeys = ['디자이너', '마케터', '디렉터'];
      let allCriteria = [];
      perspectiveKeys.forEach(pk => {
        const crit = dg[pk]?.['기준'] || [];
        allCriteria = allCriteria.concat(crit);
      });
      directorGuidelineText = [
        forbidden.length ? `\nABSOLUTE RULES (never violate):\n${forbidden.map((g,i)=>`${i+1}. ${g}`).join('\n')}` : '',
        allCriteria.length ? `\nEVALUATION CRITERIA:\n${allCriteria.map((g,i)=>`${i+1}. ${g}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');
    }

    const designNotes = specCheck?.expected?.designNotes;
    const designNoteText = (Array.isArray(designNotes) && designNotes.length > 0)
      ? `\nBanner-specific rules:\n${designNotes.map((n,i)=>`${i+1}. ${n}`).join('\n')}`
      : '';

    // ✅ 디자이너 메모 강조 — 의도/맥락을 반드시 반영
    const memoText = (memo && memo.trim())
      ? `\n【IMPORTANT — Designer's notes】The designer left the following notes about intent, context, or concerns. You MUST take these into account. If the designer explains something was intentional, respect it and do not flag it as a problem. If the designer asks you to check something specific, prioritize it:\n"${memo.trim()}"`
      : '';

    const imageContent = { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } };
    const systemPrompt = 'You are a JSON API. Respond with ONLY a valid JSON object. No markdown code fences, no explanation text, no preamble.';

    // ============================
    // 1번 호출: 무드·브랜드톤·정보전달·TV환경
    // ============================
    const prompt1 = `You are a senior TV design director. Review the OVERALL design.

Design info:
- Banner type: ${reviewType || 'unknown'}
- Brand: ${brandName || 'unknown'}
${memoText}
${specNote}
${directorGuidelineText}
${designNoteText}

FOCUS ON these 3 areas with detailed analysis:
1. TV 시청 환경 적합성 — 3m 거리에서 한눈에 읽히는가, 텍스트 양이 적절한가, 레이아웃이 단순하고 명확한가
2. 브랜드 톤 & 무드 — 브랜드/이벤트 컨셉에 맞는 분위기인가, 색감·무드·톤앤매너가 어울리는가, 이벤트 성격과 비주얼이 맞는가. 양호여도 구체적으로 어떤 점이 잘 됐는지 설명할 것.
3. 정보 전달 & 위계 — 핵심 메시지가 명확한가, 시선 흐름이 자연스러운가, 타이틀·본문·부가정보 위계가 느껴지는가

DO NOT comment on: alignment details, spacing measurements, font sizes, QR codes, confirm buttons, navigation arrows.
If nothing is wrong in a section, say 양호 — but still fill in the "reason" field explaining why it looks good. Do not manufacture problems.

For markers: 10x10 grid (col 1-10 left→right, row 1-10 top→bottom). IMPORTANT: For each marker, first identify the specific element you flagged as a problem, then look at where that element actually appears in the image, and place the marker at that exact grid position. Do not guess — look at the element you just described.

Return ONLY valid JSON:
{
  "sections_pass1": [
    {"id": "tv", "title": "TV 시청 환경 적합성", "verdict": "양호", "cause": null, "problem": "", "reason": "", "suggestion": "", "markerIds": []},
    {"id": "brand", "title": "브랜드 톤 & 무드", "verdict": "양호", "cause": null, "problem": "", "reason": "", "suggestion": "", "markerIds": []},
    {"id": "hierarchy", "title": "정보 전달 & 위계", "verdict": "양호", "cause": null, "problem": "", "reason": "", "suggestion": "", "markerIds": []}
  ],
  "markers_pass1": [
    {"id": 1, "col": 3, "row": 2, "severity": "warning", "label": "레이블", "comment": "구체적 문제 2문장"}
  ]
}
verdict values: 치명 리스크, 수정 권장, 검토 필요, 양호
severity values: critical, warning, info
All text in Korean.`;

    // ============================
    // 2번 호출: 정렬·디테일·완성도 집중
    // ============================
    const prompt2 = `You are a senior TV design director. Review ONLY the visual quality and alignment details.

Design info:
- Banner type: ${reviewType || 'unknown'}
${memoText}
${directorGuidelineText}

FOCUS ONLY ON visual finish and design quality — look at the IMAGES and VISUALS:
- 이미지·비주얼 합성 품질 — 그림자 방향·광원·누끼 처리가 일관성 있는가. 어색하게 붙여넣은 느낌은 없는가
- 색상 조합 — 색상 충돌, 촌스러운 조합이 있는가
- 비주얼 요소 완성도 — 제품 이미지, 캐릭터, 그래픽 요소의 퀄리티가 균일한가
- 전체 레이아웃 정돈감 — 요소들이 시각적으로 균형 잡혀 있는가, 덩어리감이 있는가

DO NOT comment on: alignment, spacing measurements, TV environment, brand strategy, information quantity, QR codes, buttons.
If nothing is wrong, say 양호 — but still fill in the "reason" field explaining why it looks good. Do not manufacture problems.

For markers: 10x10 grid (col 1-10 left→right, row 1-10 top→bottom). IMPORTANT: For each marker, first identify the specific element you flagged as a problem, then look at where that element actually appears in the image, and place the marker at that exact grid position. Do not guess — look at the element you just described.

Return ONLY valid JSON:
{
  "sections_pass2": [
    {"id": "finish", "title": "시각적 완성도 & 정렬", "verdict": "양호", "cause": null, "problem": "", "reason": "", "suggestion": "", "markerIds": []}
  ],
  "markers_pass2": [
    {"id": 1, "col": 2, "row": 3, "severity": "warning", "label": "레이블", "comment": "구체적 문제 2문장"}
  ]
}
verdict values: 치명 리스크, 수정 권장, 검토 필요, 양호
severity values: critical, warning, info
All text in Korean.`;

    // 두 호출 병렬 실행 (오버레이 있으면 3번째 호출 추가)
    const call1 = fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 2000, system: systemPrompt,
        messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt1 }] }]
      })
    });

    const call2 = fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 2000, system: systemPrompt,
        messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt2 }] }]
      })
    });

    // 3번째 호출: 오버레이 분석 (타입별 분기)
    let call3 = null;
    if (overlayBase64) {
      const isZone = overlayType === 'zone';

      const safeareaPrompt = `이 이미지는 TV 배너 시안 위에 안전영역 가이드를 빨간색으로 합성한 것입니다.

【이미지 해석】
- 이미지 가장자리를 둘러싼 빨간색 띠 = 안전영역 바깥 (위험 구역)
- 빨간 띠 안쪽 = 안전영역 (안전 구역)
- 빨간 띠의 두께는 좌우 약 80px, 상하 약 60px 입니다.

【판단 방법 — 반드시 순서대로】
1. 먼저 이미지에서 메인 타이틀(가장 큰 글자)을 찾으세요.
2. 그 타이틀의 가장 왼쪽 글자가 빨간 띠에 닿거나 겹쳐 있는지 보세요.
3. 본문 텍스트, 불릿 항목들의 왼쪽 끝도 빨간 띠에 닿는지 보세요.
4. QR코드, 로고 등 핵심 요소도 빨간 띠에 닿는지 보세요.

【중요】
- 텍스트나 핵심 요소가 빨간 띠에 조금이라도 닿거나 겹치면 → "수정 권장" 또는 "치명 리스크"
- 핵심 요소가 모두 빨간 띠 안쪽(중앙 검은 영역)에 있으면 → "양호"
- 배경 이미지, 그라데이션, 좌우 화살표(< >), 장식 요소가 빨간 띠에 걸치는 건 무시하세요.

【주의】 타이틀이나 텍스트가 화면 왼쪽 끝에 바짝 붙어 있으면 거의 확실히 빨간 띠에 닿아 있는 것입니다. 꼼꼼히 보세요.

problem 필드에는 어떤 요소가 어느 쪽 빨간 띠에 닿았는지 구체적으로 적으세요.

Return ONLY valid JSON:
{
  "sections_pass3": [
    {"id": "safearea", "title": "안전영역 준수", "verdict": "양호", "cause": null, "problem": "", "reason": "", "suggestion": "", "markerIds": []}
  ]
}
verdict values: 치명 리스크, 수정 권장, 검토 필요, 양호
All text in Korean.`;

      const zonePrompt = `이 이미지는 ICP 빅배너 시안 위에 콘텐츠 배치 영역 가이드를 파란색으로 합성한 것입니다.

【이미지 해석】
파란색 박스들은 각 콘텐츠가 들어가야 하는 지정 영역입니다:
- 좌측 상단의 가로로 긴 파란 박스 = "서브 타이틀" 영역
- 그 아래 큰 파란 박스 = "메인 타이틀" 영역
- 그 아래 작은 파란 박스 = "버튼" 영역
- 우측의 큰 파란 박스 = "메인 이미지" 영역

【판단 방법】
각 콘텐츠 요소가 지정된 파란 영역 "안에" 제대로 배치되어 있는지 확인하세요.
1. 서브 타이틀 텍스트가 좌측 상단 파란 박스 안에 들어가 있는가
2. 메인 타이틀 텍스트가 메인 타이틀 파란 박스 안에 들어가 있는가
3. 버튼이 버튼 영역 파란 박스 안에 있는가
4. 키 비주얼(메인 이미지)이 우측 메인 이미지 파란 박스 안에 배치되어 있는가

【중요 — BOM 상세와 반대 개념】
- 이것은 "침범하면 안 되는 안전영역"이 아닙니다.
- 각 콘텐츠가 자기 지정 영역(파란 박스) "안에" 들어가야 하는 배치 가이드입니다.
- 콘텐츠가 파란 영역을 벗어나 있거나, 엉뚱한 위치에 있으면 → "수정 권장" 또는 "치명 리스크"
- 각 콘텐츠가 지정 영역 안에 잘 배치되어 있으면 → "양호"

problem 필드에는 어떤 콘텐츠가 어느 지정 영역을 벗어났는지 구체적으로 적으세요.
reason 필드에는 왜 그렇게 판단했는지 적으세요.

Return ONLY valid JSON:
{
  "sections_pass3": [
    {"id": "safearea", "title": "영역 배치 준수", "verdict": "양호", "cause": null, "problem": "", "reason": "", "suggestion": "", "markerIds": []}
  ]
}
verdict values: 치명 리스크, 수정 권장, 검토 필요, 양호
All text in Korean.`;

      const prompt3 = isZone ? zonePrompt : safeareaPrompt;

      call3 = fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: 1000, system: systemPrompt,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: overlayBase64 } },
            { type: 'text', text: prompt3 }
          ]}]
        })
      });
    }

    const promises = call3 ? [call1, call2, call3] : [call1, call2];
    const responses = await Promise.all(promises);
    const [res1, res2, res3] = responses;
    const [data1, data2, data3] = await Promise.all(responses.map(r => r.json()));
    if (!res1.ok) return res.status(res1.status).json({ error: data1?.error?.message || 'API 오류 (1차)' });
    if (!res2.ok) return res.status(res2.status).json({ error: data2?.error?.message || 'API 오류 (2차)' });
    if (res3 && !res3.ok) return res.status(res3.status).json({ error: data3?.error?.message || 'API 오류 (3차)' });

    const parseJSON = (data) => {
      const raw = (data?.content || []).map(c => c.type === 'text' ? (c.text || '') : '').join('').trim();
      const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```\s*$/i,'').trim();
      for (const t of [cleaned, raw]) {
        try { const r = JSON.parse(t); if (r) return r; } catch(e) {}
        try { const m = t.match(/\{[\s\S]*\}/); if (m) { const r = JSON.parse(m[0]); if (r) return r; } } catch(e) {}
      }
      return null;
    };

    const p1 = parseJSON(data1);
    const p2 = parseJSON(data2);
    const p3 = data3 ? parseJSON(data3) : null;

    // 결과 합치기 — TV환경·안전영역은 맨 뒤로
    const tvSection = (p1?.sections_pass1 || []).filter(s => s.id === 'tv');
    const mainSections = (p1?.sections_pass1 || []).filter(s => s.id !== 'tv');
    const allSections = [
      ...mainSections,
      ...(p2?.sections_pass2 || []),
      ...tvSection,
      ...(p3?.sections_pass3 || [])
    ];

    // 마커 ID를 숫자로 강제 변환
    const normalizeMarkers = (markers) => (markers || []).map((m, i) => ({
      ...m,
      id: parseInt(String(m.id).replace(/\D/g, '')) || (i + 1)
    }));

    const markers1 = normalizeMarkers(p1?.markers_pass1);
    const markers2 = normalizeMarkers(p2?.markers_pass2).map(m => ({ ...m, id: m.id + markers1.length }));
    // 안전영역 마커는 없음 — 오버레이로 눈으로 확인
    const allMarkers = [...markers1, ...markers2];

    // 안전영역 섹션 있으면 좌측 상단 고정 마커 추가
    if (p3?.sections_pass3?.length) {
      const safeVerdict = p3.sections_pass3[0]?.verdict;
      const isViolation = safeVerdict && safeVerdict !== '양호';
      // 안전영역은 정확한 가이드 위반이므로 위반 시 무조건 치명(빨강)
      if (isViolation) {
        p3.sections_pass3[0].verdict = '치명 리스크';
      }
      const safeSeverity = isViolation ? 'critical' : 'info';
      const safeMarkerId = markers1.length + markers2.length + 1;
      const safeLabel = overlayType === 'zone' ? '영역 배치' : '안전영역';
      allMarkers.push({ id: safeMarkerId, col: 1, row: 1, severity: safeSeverity, label: safeLabel, comment: p3.sections_pass3[0]?.problem || (overlayType==='zone'?'영역 배치를 확인하세요':'안전영역을 확인하세요') });
      p3.sections_pass3.forEach(s => { s.markerIds = [safeMarkerId]; });
    }

    (p2?.sections_pass2 || []).forEach(s => {
      if (s.markerIds) s.markerIds = s.markerIds.map(id => id + markers1.length);
    });

    // 전체 verdict 계산
    const verdictPriority = { '치명 리스크': 4, '수정 권장': 3, '검토 필요': 2, '양호': 1 };
    const worstVerdict = allSections.reduce((worst, s) => {
      return (verdictPriority[s.verdict] || 0) > (verdictPriority[worst] || 0) ? s.verdict : worst;
    }, '양호');

    // 우선순위 항목 — verdict 포함해서 색상 매칭
    const priorities = allSections
      .filter(s => s.verdict !== '양호' && s.problem)
      .sort((a,b) => (verdictPriority[b.verdict]||0) - (verdictPriority[a.verdict]||0))
      .slice(0, 3)
      .map(s => ({ text: s.problem, verdict: s.verdict }));

    // finalComment — 문제 있는 섹션들의 suggestion 조합
    const problemSections = allSections.filter(s => s.verdict !== '양호' && s.suggestion);
    const finalComment = problemSections.length > 0
      ? problemSections.map(s => s.suggestion).join(' ')
      : '전체적으로 양호한 시안입니다.';

    const parsed = {
      verdict: worstVerdict,
      markers: allMarkers,
      sections: allSections,
      priorities,
      finalComment
    };

    const combinedText = JSON.stringify(parsed);
    console.log('[review] pass1 stop:', data1.stop_reason, '| pass2 stop:', data2.stop_reason, '| sections:', allSections.length, '| markers:', allMarkers.length);
    return res.status(200).json({ model_used: model, text: combinedText, parsed });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
