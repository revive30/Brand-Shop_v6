export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const model = (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929').trim();
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' });

  try {
    const { imageBase64, mimeType, reviewType, brandName, memo, specCheck, serviceKey, overlayBase64, overlayType } = req.body || {};
    if (!imageBase64 || !mimeType) return res.status(400).json({ error: '이미지가 없습니다.' });

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

    const dg = rulesData?.directorGuidelines;
    const svc = serviceKey || '브랜드샵';

    let directorGuidelineText = '';
    if (dg) {
      const forbidden = dg['공통_절대금지'] || [];
      const svcGuide = dg[svc] || {};
      const criteria = svcGuide['기준'] || [];
      directorGuidelineText = [
        forbidden.length ? `\nABSOLUTE RULES (never violate):\n${forbidden.map((g,i)=>`${i+1}. ${g}`).join('\n')}` : '',
        criteria.length ? `\nEVALUATION CRITERIA:\n${criteria.map((g,i)=>`${i+1}. ${g}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');
    }

    const designNotes = specCheck?.expected?.designNotes;
    const designNoteText = (Array.isArray(designNotes) && designNotes.length > 0)
      ? `\nBanner-specific rules:\n${designNotes.map((n,i)=>`${i+1}. ${n}`).join('\n')}`
      : '';

    const memoText = (memo && memo.trim())
      ? `\n【IMPORTANT — Designer's notes】The designer left the following notes about intent, context, or concerns. You MUST take these into account. If the designer explains something was intentional, respect it and do not flag it as a problem. If the designer asks you to check something specific, prioritize it:\n"${memo.trim()}"`
      : '';

    const imageContent = { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } };
    const systemPrompt = 'You are a JSON API. Respond with ONLY a valid JSON object. No markdown code fences, no explanation text, no preamble.';

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

    // ===== 3번 call: zone 타입은 코드 좌표 비교, safearea 타입은 AI 판단 =====
    let call3 = null;
    const zoneCoords = specCheck?.expected?.zoneCoords;

    if (overlayBase64 && overlayType === 'zone' && zoneCoords) {
      // zone 타입: AI한테 각 요소 위치(픽셀 좌표)만 물어보고 코드에서 판단
      const zonePrompt = `You are analyzing a TV banner image (1920x900px).

Identify the pixel coordinates of these 4 content elements. For each element, give the bounding box (x, y, width, height) where x=0 is left edge, y=0 is top edge.

IGNORE these fixed UI elements (they are system UI, not banner content):
- Top GNB bar: GENIE TV logo, search/menu/VOD/subscription navigation menus
- Top-right buttons: Kidzland, NETFLIX, Disney+, TVING, YouTube, APPs, settings, notification icons

Find ONLY these banner content elements:
1. subtitle: The smaller text above the main title (sub-headline)
2. title: The main large title text
3. button: The CTA button (바로보기 or similar)
4. mainImage: The key visual image on the right side

If an element is NOT present in the image, set all values to -1.

Return ONLY valid JSON:
{
  "subtitle": {"x": 0, "y": 0, "w": 0, "h": 0},
  "title": {"x": 0, "y": 0, "w": 0, "h": 0},
  "button": {"x": 0, "y": 0, "w": 0, "h": 0},
  "mainImage": {"x": 0, "y": 0, "w": 0, "h": 0}
}`;

      call3 = fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: 500, system: systemPrompt,
          messages: [{ role: 'user', content: [imageContent, { type: 'text', text: zonePrompt }] }]
        })
      });
    } else if (overlayBase64 && overlayType === 'safearea') {
      // safearea 타입: 기존 방식 유지
      const safeareaPrompt = `이 이미지는 TV 배너 시안 위에 안전영역 가이드를 합성한 것입니다.

안전영역 바깥(가장자리 띠) 안에 핵심 콘텐츠(메인 텍스트, 핵심 비주얼)가 걸쳐 있는지 확인하세요.
- 배경 이미지, 그라데이션, 장식 요소, 네비게이션 화살표가 걸치는 건 무시하세요.
- 핵심 텍스트나 주요 비주얼이 안전영역을 벗어난 경우만 지적하세요.

Return ONLY valid JSON:
{
  "sections_pass3": [
    {"id": "safearea", "title": "안전영역 준수", "verdict": "양호", "cause": null, "problem": "", "reason": "", "suggestion": "", "markerIds": []}
  ]
}
verdict values: 치명 리스크, 수정 권장, 검토 필요, 양호
All text in Korean.`;

      call3 = fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: 1000, system: systemPrompt,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: overlayBase64 } },
            { type: 'text', text: safeareaPrompt }
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

    const tvSection = (p1?.sections_pass1 || []).filter(s => s.id === 'tv');
    const mainSections = (p1?.sections_pass1 || []).filter(s => s.id !== 'tv');
    const allSections = [
      ...mainSections,
      ...(p2?.sections_pass2 || []),
      ...tvSection,
    ];

    const normalizeMarkers = (markers) => (markers || []).map((m, i) => ({
      ...m,
      id: parseInt(String(m.id).replace(/\D/g, '')) || (i + 1)
    }));

    const markers1 = normalizeMarkers(p1?.markers_pass1);
    const markers2 = normalizeMarkers(p2?.markers_pass2).map(m => ({ ...m, id: m.id + markers1.length }));
    const allMarkers = [...markers1, ...markers2];

    // ===== zone 타입: 코드에서 좌표 비교 판단 =====
    if (overlayType === 'zone' && zoneCoords && p3) {
      const elements = p3;
      const IW = specCheck?.actual?.width || 1920;
      const IH = specCheck?.actual?.height || 900;

      const isInZone = (el, zone) => {
        if (!el || el.x < 0) return null; // 요소 없음
        // 요소 중심점이 zone 안에 있는지 (여유 20% 허용)
        const margin = 0.2;
        const elCx = el.x + el.w / 2;
        const elCy = el.y + el.h / 2;
        const zx1 = zone.x - zone.w * margin;
        const zx2 = zone.x + zone.w * (1 + margin);
        const zy1 = zone.y - zone.h * margin;
        const zy2 = zone.y + zone.h * (1 + margin);
        return elCx >= zx1 && elCx <= zx2 && elCy >= zy1 && elCy <= zy2;
      };

      const checks = [
        { key: 'subtitle', zone: zoneCoords.subtitleZone, label: '서브 타이틀' },
        { key: 'title',    zone: zoneCoords.titleZone,    label: '메인 타이틀' },
        { key: 'button',   zone: zoneCoords.buttonZone,   label: '버튼' },
        { key: 'mainImage',zone: zoneCoords.mainImageZone,label: '메인 이미지' },
      ];

      const violations = [];
      for (const c of checks) {
        const el = elements[c.key];
        if (!el || el.x < 0) continue; // 없는 요소는 스킵
        const ok = isInZone(el, c.zone);
        if (ok === false) {
          violations.push(c.label);
        }
      }

      const hasViolation = violations.length > 0;
      const safeMarkerId = allMarkers.length + 1;
      const problemText = hasViolation
        ? `${violations.join(', ')}이(가) 지정된 배치 영역을 벗어났습니다.`
        : '모든 콘텐츠가 지정 영역 안에 배치되어 있습니다.';
      const suggestionText = hasViolation
        ? `${violations.join(', ')}을(를) 각각의 지정 영역 안으로 이동해주세요.`
        : '';

      const zoneSection = {
        id: 'safearea',
        title: '영역 배치 준수',
        verdict: hasViolation ? '치명 리스크' : '양호',
        cause: hasViolation ? '콘텐츠 영역 이탈' : null,
        problem: hasViolation ? problemText : '',
        reason: hasViolation ? '배치 가이드 기준 좌표와 비교한 결과입니다.' : '모든 콘텐츠가 지정 영역 안에 배치되어 있습니다.',
        suggestion: suggestionText,
        markerIds: hasViolation ? [safeMarkerId] : []
      };

      allSections.push(zoneSection);

      if (hasViolation) {
        allMarkers.push({
          id: safeMarkerId, col: 2, row: 5,
          severity: 'critical', label: '영역 배치',
          comment: problemText
        });
      }

    } else if (p3?.sections_pass3?.length) {
      // safearea 타입
      const safeVerdict = p3.sections_pass3[0]?.verdict;
      const isViolation = safeVerdict && safeVerdict !== '양호';
      if (isViolation) p3.sections_pass3[0].verdict = '치명 리스크';
      const safeSeverity = isViolation ? 'critical' : 'info';
      const safeMarkerId = allMarkers.length + 1;
      allMarkers.push({
        id: safeMarkerId, col: 1, row: 1,
        severity: safeSeverity, label: '안전영역',
        comment: p3.sections_pass3[0]?.problem || '안전영역을 확인하세요'
      });
      p3.sections_pass3.forEach(s => { s.markerIds = [safeMarkerId]; });
      allSections.push(...p3.sections_pass3);
    }

    (p2?.sections_pass2 || []).forEach(s => {
      if (s.markerIds) s.markerIds = s.markerIds.map(id => id + markers1.length);
    });

    const verdictPriority = { '치명 리스크': 4, '수정 권장': 3, '검토 필요': 2, '양호': 1 };
    const worstVerdict = allSections.reduce((worst, s) => {
      return (verdictPriority[s.verdict] || 0) > (verdictPriority[worst] || 0) ? s.verdict : worst;
    }, '양호');

    const priorities = allSections
      .filter(s => s.verdict !== '양호' && s.problem && s.id !== 'safearea')
      .sort((a,b) => (verdictPriority[b.verdict]||0) - (verdictPriority[a.verdict]||0))
      .slice(0, 3)
      .map(s => ({ text: s.problem, verdict: s.verdict }));

    const problemSections = allSections.filter(s => s.verdict !== '양호' && s.suggestion);
    const finalComment = problemSections.length > 0
      ? problemSections.map(s => s.suggestion).join(' ')
      : '전체적으로 양호한 시안입니다.';

    const parsed = { verdict: worstVerdict, markers: allMarkers, sections: allSections, priorities, finalComment };
    const combinedText = JSON.stringify(parsed);
    console.log('[review] sections:', allSections.length, '| markers:', allMarkers.length, '| zone:', overlayType);
    return res.status(200).json({ model_used: model, text: combinedText, parsed });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
