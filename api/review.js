export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const model = (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929').trim();
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' });

  try {
    const { imageBase64, mimeType, reviewType, brandName, memo, specCheck, perspectiveKey, overlayBase64 } = req.body || {};
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

    // ✅ 관점별 가이드 주입
    const dg = rulesData?.directorGuidelines;
    const pKey = perspectiveKey || '디자이너';
    const perspectiveLabels = { '디자이너': 'Designer', '마케터': 'Marketer', '디렉터': 'Director' };

    let directorGuidelineText = '';
    if (dg) {
      const forbidden = dg['공통_절대금지'] || [];
      const perspective = dg[pKey] || {};
      const viewpoint = perspective['관점'] || '';
      const criteria = perspective['기준'] || [];
      directorGuidelineText = [
        forbidden.length ? `\nABSOLUTE RULES (never violate):\n${forbidden.map((g,i)=>`${i+1}. ${g}`).join('\n')}` : '',
        viewpoint ? `\nREVIEW PERSPECTIVE — ${perspectiveLabels[pKey] || pKey}: ${viewpoint}` : '',
        criteria.length ? `\nEVALUATION CRITERIA:\n${criteria.map((g,i)=>`${i+1}. ${g}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');
    }

    const designNotes = specCheck?.expected?.designNotes;
    const designNoteText = (Array.isArray(designNotes) && designNotes.length > 0)
      ? `\nBanner-specific rules:\n${designNotes.map((n,i)=>`${i+1}. ${n}`).join('\n')}`
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
- Designer notes: ${memo || 'none'}
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
- Designer notes: ${memo || 'none'}
${directorGuidelineText}

FOCUS ONLY ON visual finish and design quality — look at the IMAGES and VISUALS:
- 이미지·비주얼 합성 품질 — 그림자 방향·광원·누끼 처리가 일관성 있는가. 어색하게 붙여넣은 느낌은 없는가
- 색상 조합 — 색상 충돌, 촌스러운 조합이 있는가
- 비주얼 요소 완성도 — 제품 이미지, 캐릭터, 그래픽 요소의 퀄리티가 균일한가
- 전체 레이아웃 정돈감 — 요소들이 시각적으로 균형 잡혀 있는가, 덩어리감이 있는가
- 반복 요소 정렬 — 체크마크·불릿포인트 등 같은 레벨 요소들의 좌측 기준선이 일치하는가

IMPORTANT: Look very carefully at repeated elements (bullet points, check marks, list items).
If their left edges or starting positions are inconsistent, flag it as an alignment issue.
DO NOT comment on: TV environment, brand strategy, information quantity, QR codes, buttons.
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

    // 3번째 호출: 안전영역 오버레이 분석
    let call3 = null;
    if (overlayBase64) {
      const overlayContent = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: overlayBase64 } };
      const prompt3 = `You are reviewing a TV banner for safe area compliance.

I am giving you TWO images:
1. First image: the actual design
2. Second image: safe area overlay — RED border around edges = danger zone, BLACK center = safe zone

Your job is simple: Look at the first image and the second image together.
Ask yourself: "Are any core elements of the design touching or overlapping the RED border area?"

CORE elements to check: main title text, body text, product images, key information.
IGNORE: background, gradients, decorative elements, navigation arrows (left/right chevrons).

Navigation arrows (< >) are UI elements — even if they touch the red area, do NOT flag them.

If core elements are clearly inside the black center area and NOT touching the red border → verdict 양호.
Only flag if a core element is visibly touching or inside the red border area.

DO NOT place any markers. Text judgment only.

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
          messages: [{ role: 'user', content: [imageContent, overlayContent, { type: 'text', text: prompt3 }] }]
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

    // 세 결과 합치기
    const allSections = [
      ...(p1?.sections_pass1 || []),
      ...(p2?.sections_pass2 || []),
      ...(p3?.sections_pass3 || [])
    ];

    // 마커 ID 중복 방지
    // 마커 ID를 숫자로 강제 변환
    const normalizeMarkers = (markers) => (markers || []).map((m, i) => ({
      ...m,
      id: parseInt(String(m.id).replace(/\D/g, '')) || (i + 1)
    }));

    const markers1 = normalizeMarkers(p1?.markers_pass1);
    const markers2 = normalizeMarkers(p2?.markers_pass2).map(m => ({ ...m, id: m.id + markers1.length }));
    const markers3 = p3 ? [{ id: markers1.length + markers2.length + 1, col: 1, row: 1, severity: p3?.sections_pass3?.[0]?.verdict === '양호' ? 'info' : 'warning', label: '안전영역', comment: p3?.sections_pass3?.[0]?.problem || '안전영역 확인' }] : [];
    const allMarkers = [...markers1, ...markers2, ...markers3];

    // sections의 markerIds도 offset 적용
    (p2?.sections_pass2 || []).forEach(s => {
      if (s.markerIds) s.markerIds = s.markerIds.map(id => id + markers1.length);
    });
    (p3?.sections_pass3 || []).forEach(s => {
      if (s.markerIds !== undefined) s.markerIds = markers3.map(m => m.id);
    });

    // 전체 verdict 계산
    const verdictPriority = { '치명 리스크': 4, '수정 권장': 3, '검토 필요': 2, '양호': 1 };
    const worstVerdict = allSections.reduce((worst, s) => {
      return (verdictPriority[s.verdict] || 0) > (verdictPriority[worst] || 0) ? s.verdict : worst;
    }, '양호');

    // 우선순위 항목
    const priorities = allSections
      .filter(s => s.verdict !== '양호' && s.problem)
      .sort((a,b) => (verdictPriority[b.verdict]||0) - (verdictPriority[a.verdict]||0))
      .slice(0, 3)
      .map(s => s.problem);

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
