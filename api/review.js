export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const model = (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929').trim();
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' });

  try {
    const { imageBase64, mimeType, reviewType, brandName, purpose, benefit, cta, memo, specCheck, perspectiveKey } = req.body || {};
    if (!imageBase64 || !mimeType) return res.status(400).json({ error: '이미지가 없습니다.' });

    // ✅ design-guide-rules.json 로드 (directorGuidelines 계층 구조 포함)
    let rulesData = {};
    try {
      const fs = await import('fs');
      const path = await import('path');
      const rulesPath = path.join(process.cwd(), 'public', 'rules', 'design-guide-rules.json');
      rulesData = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    } catch(e) { console.warn('rules load failed:', e.message); }


    const specNote = specCheck ? `
Spec check (for reference only):
- Size: ${specCheck.actual?.width}x${specCheck.actual?.height} (standard: ${specCheck.expected?.width || 'flexible'}x${specCheck.expected?.height})
- Format: ${specCheck.actual?.mime} 
- File size: ${specCheck.actual?.kb}KB (NOTE: this is a preview/thumbnail file, NOT the actual submission file. Do NOT flag file size as an issue.)
- Safe area: ${specCheck.expected?.safeArea}

IMPORTANT SAFE AREA RULE: Only flag safe area violations when CORE ELEMENTS (main text, key visuals, CTA buttons, product images) are outside the safe zone. Background decorations, gradients, and ornamental elements extending beyond the safe area are ACCEPTABLE and should NOT be flagged as errors.` : '';

    // ✅ directorGuidelines: 관점별 기준 주입
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
        forbidden.length ? `\nABSOLUTE RULES (never violate these under any circumstances):\n${forbidden.map((g,i)=>`${i+1}. ${g}`).join('\n')}` : '',
        viewpoint ? `\nREVIEW PERSPECTIVE — ${perspectiveLabels[pKey] || pKey}: ${viewpoint}` : '',
        criteria.length ? `\nEVALUATION CRITERIA for this perspective:\n${criteria.map((g,i)=>`${i+1}. ${g}`).join('\n')}` : '',
      ].filter(Boolean).join('\n');
    }

    // ✅ designNotes: JSON에서 넘어온 배너별 디자인 룰을 프롬프트에 주입
    const designNotes = specCheck?.expected?.designNotes;
    const designNoteText = (Array.isArray(designNotes) && designNotes.length > 0)
      ? `\nDesign rules for this banner type (from official guide):\n${designNotes.map((n, i) => `${i + 1}. ${n}`).join('\n')}\nThese are mandatory rules. Check whether the submitted design follows each of them.`
      : '';

    const prompt = `You are a senior TV design director reviewing a design draft.

Design info:
- Banner type: ${reviewType || 'unknown'}
- Brand: ${brandName || 'unknown'}
- Designer notes: ${memo || 'none'}
${directorGuidelineText}
${designNoteText}

WHAT YOU CAN AND CANNOT DO:
- You are looking at a screenshot. You CANNOT measure pixel values, safe area boundaries, font pt sizes, or identify UI templates.
- You CAN judge: overall mood, brand tone, visual hierarchy, whether information reads clearly at a glance, obvious quality issues (bad compositing, clashing colors, cluttered layout).

REVIEW SCOPE — only judge these 4 things:
1. TV 시청 환경 적합성 — 3m 거리에서 핵심 메시지가 한눈에 읽히는가, 텍스트 양이 TV에 적절한가, 전체 레이아웃이 단순하고 명확한가. 단, 안전영역 수치·폰트 pt·QR·버튼 템플릿·네비게이션 UI는 절대 판단하지 않는다.
2. 브랜드 톤 & 무드 — 브랜드/이벤트 컨셉에 맞는 분위기인가
3. 정보 전달 & 위계 — 핵심 메시지가 한눈에 읽히는가, 시선 흐름이 자연스러운가, 타이틀·본문·부가정보 위계가 느껴지는가
4. 시각적 완성도 — 명백히 어색한 합성, 색상 충돌, 지저분한 레이아웃이 있는가

STRICT RULES:
- Do NOT comment on: safe area, pixel alignment, font pt sizes, QR codes, navigation arrows, confirm/close buttons, template UI elements, file size.
- Do NOT flag things you cannot visually confirm from the image.
- If something looks intentional (mixed styles, bold color, perspective break), assume it's deliberate.
- Distinguish clearly: 치명 리스크 = would reject, 수정 권장 = should fix, 검토 필요 = minor, 양호 = fine.
- If nothing is wrong in a section, say 양호. Do not manufacture feedback.

For markers: divide the image into a 7x7 grid (col 1-7 left to right, row 1-7 top to bottom). Only place markers on genuinely visible problems.

Return ONLY a valid JSON object. No markdown, no code fences.

{
  "verdict": "양호",
  "summary": ["핵심 문제 1문장"],
  "markers": [
    {"id": 1, "col": 3, "row": 2, "severity": "warning", "label": "레이블", "comment": "구체적으로 눈에 보이는 문제 2문장"}
  ],
  "sections": [
    {"id": "tv", "title": "TV 시청 환경 적합성", "verdict": "양호", "cause": null, "problem": "내용", "reason": "이유", "suggestion": "제안", "markerIds": []},
    {"id": "brand", "title": "브랜드 톤 & 무드", "verdict": "양호", "cause": null, "problem": "내용", "reason": "이유", "suggestion": "제안", "markerIds": []},
    {"id": "hierarchy", "title": "정보 전달 & 위계", "verdict": "양호", "cause": null, "problem": "내용", "reason": "이유", "suggestion": "제안", "markerIds": []},
    {"id": "finish", "title": "시각적 완성도", "verdict": "양호", "cause": null, "problem": "내용", "reason": "이유", "suggestion": "제안", "markerIds": []}
  ],
  "priorities": ["1순위 수정 항목"],
  "finalComment": "전체 총평 2문장"
}

verdict values: 치명 리스크, 수정 권장, 검토 필요, 양호
severity values: critical, warning, info
All text in Korean.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        system: 'You are a JSON API. Respond with ONLY a valid JSON object. No markdown code fences, no explanation text, no preamble.',
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'API 오류' });

    if (data.stop_reason === 'max_tokens') {
      console.warn('[review] max_tokens hit — response truncated');
    }

    const raw = (data?.content || []).map(c => c.type === 'text' ? (c.text || '') : '').join('').trim();
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    let parsed = null;
    for (const t of [cleaned, raw]) {
      if (parsed) break;
      try { const r = JSON.parse(t); if (r?.verdict) { parsed = r; break; } } catch(e) {}
      try {
        const m = t.match(/\{[\s\S]*\}/);
        if (m) { const r = JSON.parse(m[0]); if (r?.verdict) { parsed = r; break; } }
      } catch(e) {}
      try {
        const r = JSON.parse(JSON.parse(t));
        if (r?.verdict) { parsed = r; break; }
      } catch(e) {}
    }

    console.log('[review] stop_reason:', data.stop_reason, '| parsed:', !!parsed, '| raw_len:', raw.length);
    return res.status(200).json({ model_used: model, stop_reason: data.stop_reason, text: cleaned, parsed });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
