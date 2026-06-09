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
      ? `\nBanner-specific rules:\n${designNotes.map((n,i)=>`${i+1}. ${n}`).join('\n')}` : '';

    const memoText = (memo && memo.trim())
      ? `\n【IMPORTANT — Designer's notes】The designer left the following notes. You MUST take these into account. If intentional, respect it and do not flag it:\n"${memo.trim()}"` : '';

    const imageContent = { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } };
    const systemPrompt = 'You are a JSON API. Respond with ONLY a valid JSON object. No markdown code fences, no explanation text, no preamble.';

    const GNB_IGNORE = `CRITICAL — DO NOT REVIEW these system UI elements (fixed platform UI, not banner content):
- Top GNB: GENIE TV logo, 검색/마이메뉴/영화.TV.VOD/월정액/무료/키즈랜드/혜택 menus
- Top-right icons: 키즈랜드, NETFLIX, Disney+, TVING, YouTube, APPs, settings, notification bell
Ignore them completely. Never mention them.`;

    const prompt1 = `You are a senior TV design director. Review the OVERALL design.
Design info:
- Banner type: ${reviewType || 'unknown'}
- Brand: ${brandName || 'unknown'}
${memoText}
${specNote}
${directorGuidelineText}
${designNoteText}
${GNB_IGNORE}

FOCUS ON these 3 areas with detailed analysis:
1. TV 시청 환경 적합성 — TV 환경 고유 특성만: 3m 거리에서 텍스트가 물리적으로 읽히는가, 리모컨 조작 맥락. 정보 위계나 텍스트 양은 3번에서 다룸.
2. 브랜드 톤 & 무드 — 브랜드/이벤트 컨셉에 맞는 분위기인가. 양호여도 구체적으로 어떤 점이 잘 됐는지 설명.
3. 정보 전달 & 위계 — 핵심 메시지가 명확한가, 시선 흐름, 텍스트 양, 정보 위계

DO NOT comment on: alignment details, spacing, font sizes, QR codes, confirm buttons, navigation arrows.
If nothing is wrong, say 양호 but fill in "reason". Do not manufacture problems.
Markers use 10x10 grid (col 1-10 left→right, row 1-10 top→bottom). Place marker at exact position of flagged element.

Return ONLY this exact JSON structure (no extra fields, no extra sections):
{"sections_pass1":[{"id":"tv","title":"TV 시청 환경 적합성","verdict":"양호","cause":null,"problem":"","reason":"","suggestion":"","markerIds":[]},{"id":"brand","title":"브랜드 톤 & 무드","verdict":"양호","cause":null,"problem":"","reason":"","suggestion":"","markerIds":[]},{"id":"hierarchy","title":"정보 전달 & 위계","verdict":"양호","cause":null,"problem":"","reason":"","suggestion":"","markerIds":[]}],"markers_pass1":[]}
verdict values: 치명 리스크, 수정 권장, 검토 필요, 양호
severity values: critical, warning, info. All text in Korean.`;

    const prompt2 = `You are a senior TV design director. Review ONLY visual quality.
Design info:
- Banner type: ${reviewType || 'unknown'}
${memoText}
${directorGuidelineText}
${GNB_IGNORE}

FOCUS ONLY ON visual finish:
- 이미지·비주얼 합성 품질 — 그림자 방향·광원·누끼 처리 일관성
- 색상 조합 — 색상 충돌, 촌스러운 조합
- 비주얼 요소 완성도 — 퀄리티 균일성
- 전체 레이아웃 정돈감 — 시각적 균형, 덩어리감

DO NOT comment on: alignment, spacing, TV environment, brand strategy, QR codes, buttons.
If nothing is wrong, say 양호 but fill in "reason". Do not manufacture problems.
Markers use 10x10 grid. Place marker at exact position of flagged element.

IMPORTANT: Return EXACTLY ONE section with id "finish". Do NOT split into multiple sections.
Return ONLY this exact JSON structure:
{"sections_pass2":[{"id":"finish","title":"시각적 완성도","verdict":"양호","cause":null,"problem":"","reason":"","suggestion":"","markerIds":[]}],"markers_pass2":[]}
verdict values: 치명 리스크, 수정 권장, 검토 필요, 양호
severity values: critical, warning, info. All text in Korean.`;

    const [res1, res2] = await Promise.all([
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 2000, system: systemPrompt,
          messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt1 }] }] })
      }),
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 2000, system: systemPrompt,
          messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt2 }] }] })
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

    const pass2Sections = (p2?.sections_pass2 || []).filter(s => s.id === 'finish');
    const pass2FallbackSection = pass2Sections.length === 0 && (p2?.sections_pass2 || []).length > 0
      ? [{ ...p2.sections_pass2[0], id: 'finish', title: '시각적 완성도' }]
      : pass2Sections;

    // 마커 ID를 순서 기반으로 강제 재할당, 섹션 markerIds도 동기화
    const normalizeMarkers = (markers, sections, startId) => {
      const raw = markers || [];
      const idMap = {};
      const normalized = raw.map((m, i) => {
        const newId = startId + i;
        idMap[String(m.id)] = newId;
        return { ...m, id: newId };
      });
      (sections || []).forEach(s => {
        if (s.markerIds) s.markerIds = s.markerIds.map(old => idMap[String(old)] ?? old);
      });
      return normalized;
    };

    const hasOverlay = overlayType === 'safearea' || overlayType === 'zone';
    const offset = hasOverlay ? 1 : 0;

    const markers1 = normalizeMarkers(p1?.markers_pass1, p1?.sections_pass1, 1 + offset);
    const markers2 = normalizeMarkers(p2?.markers_pass2, pass2FallbackSection, 1 + offset + markers1.length);

    const tvSection = (p1?.sections_pass1 || []).filter(s => s.id === 'tv');
    const mainSections = (p1?.sections_pass1 || []).filter(s => s.id !== 'tv');
    const allSections = [...mainSections, ...pass2FallbackSection, ...tvSection];
    const allMarkers = [...markers1, ...markers2];

    // ===== safearea 타입: 좌표 기반 판정 (AI 시각 판단 제거) =====
    if (overlayType === 'safearea') {
      const imgW = specCheck?.actual?.width || 1920;
      const imgH = specCheck?.actual?.height || 1080;

      // 안전영역 경계 (1920x1080 기준 픽셀, PNG에서 추출한 값)
      // 다른 해상도면 비율로 환산
      const SAFE = {
        left:   Math.round(80  * imgW / 1920),
        right:  Math.round(1839 * imgW / 1920),
        top:    Math.round(61  * imgH / 1080),
        bottom: Math.round(1019 * imgH / 1080),
      };

      const coordPrompt = `This is a TV banner image (${imgW}x${imgH}px). x=0 is left edge, y=0 is top edge.

Find the bounding box (x, y, w, h) in pixels for each of these elements:
1. "logo" — brand logo or service logo text (top-left area)
2. "title" — main headline text (largest text)
3. "body" — body text block (bullet items, description text)
4. "cta" — CTA button if present

IGNORE: background images, decorative elements, navigation arrows (< >), confirm/close buttons at bottom, QR codes, GNB bar at top.

If an element is NOT present, set x to -1.
Return ONLY valid JSON: {"logo":{"x":0,"y":0,"w":0,"h":0},"title":{"x":0,"y":0,"w":0,"h":0},"body":{"x":0,"y":0,"w":0,"h":0},"cta":{"x":0,"y":0,"w":0,"h":0}}`;

      const rCoord = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 300, system: systemPrompt,
          messages: [{ role: 'user', content: [imageContent, { type: 'text', text: coordPrompt }] }] })
      });
      const dCoord = await rCoord.json();
      const coords = parseJSON(dCoord);
      console.log('[safearea] coords:', JSON.stringify(coords), '| SAFE:', JSON.stringify(SAFE));

      // 각 요소가 안전영역을 벗어나는지 체크
      const violations = [];
      const labelMap = { logo: '로고', title: '메인 타이틀', body: '본문 텍스트', cta: 'CTA 버튼' };
      for (const [key, label] of Object.entries(labelMap)) {
        const el = coords?.[key];
        if (!el || el.x < 0) continue;
        const elLeft = el.x, elRight = el.x + el.w;
        const elTop = el.y, elBottom = el.y + el.h;
        if (elLeft < SAFE.left || elRight > SAFE.right || elTop < SAFE.top || elBottom > SAFE.bottom) {
          const sides = [];
          if (elLeft < SAFE.left) sides.push('좌측');
          if (elRight > SAFE.right) sides.push('우측');
          if (elTop < SAFE.top) sides.push('상단');
          if (elBottom > SAFE.bottom) sides.push('하단');
          violations.push({ label, sides });
        }
      }

      const isViolation = violations.length > 0;
      const problemText = isViolation
        ? violations.map(v => `${v.label}이(가) ${v.sides.join(', ')} 안전영역 경계에 근접하거나 벗어날 수 있습니다.`).join(' ')
        : '';
      const suggestionText = isViolation
        ? `안전영역 안쪽으로 여유 있게 배치해주세요. 특히 ${violations.map(v=>v.label).join(', ')}의 ${[...new Set(violations.flatMap(v=>v.sides))].join('/')} 여백을 확보하세요.`
        : '';

      allMarkers.unshift({
        id: 1, col: 2, row: 2,
        severity: isViolation ? 'critical' : 'info',
        label: '안전영역',
        comment: isViolation ? problemText : '모든 핵심 요소가 안전영역 안에 있습니다.'
      });

      allSections.push({
        id: 'safearea', title: '안전영역 준수',
        verdict: isViolation ? '치명 리스크' : '양호',
        cause: isViolation ? '안전영역 이탈' : null,
        problem: problemText,
        reason: isViolation
          ? '핵심 요소의 좌표를 안전영역 기준과 비교했습니다.'
          : '핵심 요소가 모두 안전영역 안에 배치되어 있습니다.',
        suggestion: suggestionText,
        markerIds: [1]
      });
    }

    // ===== zone 타입: 좌표 + 시각 판단 병렬 =====
    if (overlayBase64 && overlayType === 'zone') {
      const zoneCoords = specCheck?.expected?.zoneCoords;
      const coordPrompt = `You are analyzing a TV banner image (1920x900px).
Identify pixel coordinates (x, y, w, h) of these 4 elements. x=0 is left, y=0 is top.
IGNORE: Top GNB bar, top-right icons (NETFLIX, Disney+, TVING, YouTube, APPs etc).
Find ONLY: 1.subtitle(small text above title) 2.title(main large text) 3.button(CTA button e.g.바로보기) 4.mainImage(right side key visual)
If NOT present set all to -1.
Return ONLY valid JSON: {"subtitle":{"x":0,"y":0,"w":0,"h":0},"title":{"x":0,"y":0,"w":0,"h":0},"button":{"x":0,"y":0,"w":0,"h":0},"mainImage":{"x":0,"y":0,"w":0,"h":0}}`;

      const yesnoPrompt = `이 이미지는 ICP 빅배너 시안 위에 콘텐츠 배치 가이드를 파란색 박스로 합성한 것입니다.
파란색 박스 4개: 좌측상단 가로긴박스=서브타이틀, 그아래큰박스=메인타이틀, 그아래작은박스=버튼, 우측큰박스=메인이미지
각 파란 박스 안에 해당 콘텐츠가 있는지 YES/NO/PARTIAL로 판단하세요.
IGNORE: 상단 GNB(GENIE TV 로고, 메뉴, 우측 아이콘들)
Return ONLY valid JSON: {"subtitle":"YES","title":"YES","button":"YES","mainImage":"YES"}`;

      const [rZa, rZb] = await Promise.all([
        fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: 300, system: systemPrompt,
            messages: [{ role: 'user', content: [imageContent, { type: 'text', text: coordPrompt }] }] })
        }),
        fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: 200, system: systemPrompt,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: overlayBase64 } },
              { type: 'text', text: yesnoPrompt }
            ]}] })
        })
      ]);
      const [dZa, dZb] = await Promise.all([rZa.json(), rZb.json()]);
      const coordResult = parseJSON(dZa);
      const yesnoResult = parseJSON(dZb);

      const isInZone = (el, zone) => {
        if (!el || !zone || el.x < 0) return null;
        const m = 0.2;
        const cx = el.x + el.w/2, cy = el.y + el.h/2;
        return cx >= zone.x - zone.w*m && cx <= zone.x + zone.w*(1+m)
            && cy >= zone.y - zone.h*m && cy <= zone.y + zone.h*(1+m);
      };

      const labelMap = { subtitle:'서브 타이틀', title:'메인 타이틀', button:'버튼', mainImage:'메인 이미지' };
      const zoneKeyMap = { subtitle:'subtitleZone', title:'titleZone', button:'buttonZone', mainImage:'mainImageZone' };
      const zChecks = ['subtitle', 'title', 'button', 'mainImage'];
      const coordBadSet = new Set(), yesnoBadSet = new Set();

      for (const key of zChecks) {
        const zone = zoneCoords?.[zoneKeyMap[key]];
        const el = coordResult?.[key];
        if (!el || el.x < 0) coordBadSet.add(key);
        else if (zone && isInZone(el, zone) === false) coordBadSet.add(key);
        const v = (yesnoResult?.[key] || '').toUpperCase();
        if (v === 'NO' || v === 'PARTIAL') yesnoBadSet.add(key);
      }

      const critical = [], caution = [];
      for (const key of zChecks) {
        const coordBad = coordBadSet.has(key), yesnoBad = yesnoBadSet.has(key);
        if (key === 'subtitle' || key === 'title') {
          if (coordBad || yesnoBad) critical.push(labelMap[key]);
        } else {
          if (coordBad && yesnoBad) critical.push(labelMap[key]);
          else if (coordBad || yesnoBad) caution.push(labelMap[key]);
        }
      }

      const hasAnyIssue = critical.length > 0 || caution.length > 0;
      const onlyButtonIssue = critical.length === 0 && caution.length > 0 && caution.every(l => l === '버튼');
      let verdictZone = '양호', markerSeverity = 'info';
      let problemText = '', suggestionText = '';

      if (critical.length > 0) {
        verdictZone = '치명 리스크'; markerSeverity = 'critical';
        problemText = `${critical.join(', ')}이(가) 지정된 배치 영역 안에 없습니다.`;
        if (caution.length > 0) problemText += ` ${caution.join(', ')}도 확인 필요.`;
        suggestionText = `${critical.join(', ')}을(를) 각각의 지정 영역 안에 배치해주세요.`;
      } else if (onlyButtonIssue) {
        verdictZone = '검토 필요'; markerSeverity = 'info';
        problemText = '버튼 영역이 비어있습니다. 개발에서 별도 삽입되지만 디자인 가이드를 확인하세요.';
        suggestionText = problemText;
      } else if (caution.length > 0) {
        verdictZone = '수정 권장'; markerSeverity = 'warning';
        problemText = `${caution.join(', ')} 배치를 확인해주세요.`;
        suggestionText = problemText;
      }

      allMarkers.unshift({ id: 1, col: 2, row: 5, severity: markerSeverity, label: '영역 배치',
        comment: hasAnyIssue ? problemText : '모든 콘텐츠가 지정 영역 안에 배치되어 있습니다.' });

      allSections.push({
        id: 'safearea', title: '영역 배치 준수', verdict: verdictZone,
        cause: hasAnyIssue ? '콘텐츠 영역 이탈' : null,
        problem: hasAnyIssue ? problemText : '',
        reason: hasAnyIssue ? '좌표 비교 및 시각 확인 두 방식으로 검증.' : '모든 콘텐츠가 지정 영역 안에 배치되어 있습니다.',
        suggestion: suggestionText, markerIds: [1]
      });

      console.log('[zone] critical:', critical, 'caution:', caution);
    }

    // 마커 ID 재정렬
    const seenIds = new Set();
    let nextId = 2;
    const finalMarkers = allMarkers.map(m => {
      if (m.id === 1) { seenIds.add(1); return m; }
      while (seenIds.has(nextId)) nextId++;
      const newId = nextId++;
      seenIds.add(newId);
      allSections.forEach(s => {
        if (s.markerIds) s.markerIds = s.markerIds.map(id => id === m.id ? newId : id);
      });
      return { ...m, id: newId };
    });

    const verdictPriority = { '치명 리스크': 4, '수정 권장': 3, '검토 필요': 2, '양호': 1 };
    const worstVerdict = allSections.reduce((worst, s) =>
      (verdictPriority[s.verdict] || 0) > (verdictPriority[worst] || 0) ? s.verdict : worst, '양호');

    const priorities = allSections
      .filter(s => s.verdict !== '양호' && s.problem)
      .sort((a,b) => (verdictPriority[b.verdict]||0) - (verdictPriority[a.verdict]||0))
      .slice(0, 3)
      .map(s => ({ text: s.problem, verdict: s.verdict }));

    let finalComment = '전체적으로 양호한 시안입니다.';
    const problemSections = allSections.filter(s => s.verdict !== '양호' && s.problem);
    if (problemSections.length > 0) {
      const summaryPrompt = `당신은 TV 배너 디자인 디렉터입니다. 아래는 디자인 검수 결과입니다.

${problemSections.map(s => `[${s.title} — ${s.verdict}] ${s.problem}`).join('\n')}

위 검수 결과를 바탕으로 디자이너에게 전달할 디렉터 코멘트를 한국어로 2~3문장으로 작성하세요.
- 가장 중요한 수정 사항을 먼저 언급하세요
- 구체적이고 실행 가능한 조언을 담으세요
- "전체적으로", "대체로" 같은 막연한 표현 대신 구체적으로 쓰세요
- JSON이나 마크다운 없이 순수 텍스트만 반환하세요`;

      try {
        const rComment = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model, max_tokens: 600, system: '당신은 TV 배너 디자인 디렉터입니다. 요청한 텍스트만 반환하세요.',
            messages: [{ role: 'user', content: summaryPrompt }]
          })
        });
        const dComment = await rComment.json();
        const commentText = (dComment?.content || []).map(c => c.text || '').join('').trim();
        if (commentText) finalComment = commentText;
      } catch(e) {
        console.warn('director comment generation failed:', e.message);
        finalComment = problemSections.map(s => s.suggestion).filter(Boolean).join(' ');
      }
    }

    const parsed = { verdict: worstVerdict, markers: finalMarkers, sections: allSections, priorities, finalComment };
    console.log('[review] sections:', allSections.length, '| markers:', finalMarkers.length);
    return res.status(200).json({ model_used: model, text: JSON.stringify(parsed), parsed });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
