export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const model = (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929').trim();
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' });

  try {
    const { imageBase64, mimeType, reviewType, brandName, memo, specCheck, perspectiveKey } = req.body || {};
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

FOCUS ON:
1. TV 시청 환경 적합성 — 3m 거리에서 한눈에 읽히는가, 텍스트 양이 적절한가
2. 브랜드 톤 & 무드 — 브랜드/이벤트 컨셉에 맞는 분위기인가
3. 정보 전달 & 위계 — 핵심 메시지가 명확한가, 시선 흐름이 자연스러운가

DO NOT comment on: alignment details, spacing measurements, font sizes, QR codes, confirm buttons, navigation arrows.
If nothing is wrong in a section, say 양호. Do not manufacture feedback.

For markers: 7x7 grid (col 1-7 left→right, row 1-7 top→bottom). Only place on genuinely visible problems.

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

FOCUS ONLY ON visual finish and alignment:
- 같은 레벨 요소들(체크마크, 텍스트, 아이콘 등)의 좌측 기준선이 일치하는가
- 반복 요소들의 간격이 균일한가
- 합성 품질 — 그림자 방향·광원·누끼 처리가 일관성 있는가
- 색상 충돌이나 명백히 어색한 부분이 있는가
- 전체 레이아웃이 정돈되어 보이는가

IMPORTANT: Look very carefully at repeated elements (bullet points, check marks, list items). 
If their left edges or starting positions are inconsistent, flag it as an alignment issue.
DO NOT comment on: TV environment, brand tone, information hierarchy, QR codes, buttons.
If nothing is wrong, say 양호. Do not manufacture feedback.

For markers: 7x7 grid (col 1-7 left→right, row 1-7 top→bottom). Mark the exact area with the alignment/quality issue.

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

    // 두 호출 병렬 실행
    const [res1, res2] = await Promise.all([
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: 2000, system: systemPrompt,
          messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt1 }] }]
        })
      }),
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: 2000, system: systemPrompt,
          messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt2 }] }]
        })
      })
    ]);

    const [data1, data2] = await Promise.all([res1.json(), res2.json()]);
    if (!res1.ok) return res.status(res1.status).json({ error: data1?.error?.message || 'API 오류 (1차)' });
    if (!res2.ok) return res.status(res2.status).json({ error: data2?.error?.message || 'API 오류 (2차)' });

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

    // 두 결과 합치기
    const allSections = [
      ...(p1?.sections_pass1 || []),
      ...(p2?.sections_pass2 || [])
    ];

    // 마커 ID 중복 방지
    const markers1 = p1?.markers_pass1 || [];
    const offset = markers1.length;
    const markers2 = (p2?.markers_pass2 || []).map(m => ({ ...m, id: m.id + offset }));
    const allMarkers = [...markers1, ...markers2];

    // sections의 markerIds도 offset 적용
    (p2?.sections_pass2 || []).forEach(s => {
      if (s.markerIds) s.markerIds = s.markerIds.map(id => id + offset);
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
