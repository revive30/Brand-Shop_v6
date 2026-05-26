export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const model = (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5').trim();
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' });

  try {
    const { imageBase64, mimeType, reviewType, brandName, purpose, benefit, cta, memo, specCheck, directorType } = req.body || {};
    if (!imageBase64 || !mimeType) return res.status(400).json({ error: '이미지가 없습니다.' });

    const directorProfiles = {
      A: {
        name: '완성도 디렉터',
        persona: '10년 경력의 시니어 디자인 디렉터. 픽셀 단위 마감감과 합성 품질에 극도로 예민하다. "이 시안을 지금 당장 TV에 올려도 부끄럽지 않은가?"가 기준이다. 정렬이 어긋나거나 합성이 어색하면 즉시 리턴한다. 단순히 규칙을 체크하는 것이 아니라 전체 완성도의 "급"을 본다.',
        priority: '완성도와 마감감. 정렬, 간격, 합성 품질, 그림자 처리, 누끼, 텍스트-이미지 관계. 브랜드 톤보다 "완성된 느낌의 급"을 우선시한다.'
      },
      B: {
        name: '브랜드 디렉터',
        persona: '브랜드 전략과 비주얼 아이덴티티 전문가. "이 화면에서 브랜드가 즉각적으로 느껴지는가?"가 기준이다. 색감, 무드, 톤앤매너에 극도로 예민하다. 프리미엄 브랜드가 저가 프로모션처럼 보이거나, 브랜드 개성 없이 안전하게만 만들어진 시안은 절대 통과시키지 않는다.',
        priority: '브랜드 톤과 감도. 색감, 무드, 키비주얼 존재감, 브랜드 아이덴티티 표현력. "브랜드답게 느껴지는가"를 완성도보다 우선시한다.'
      },
      C: {
        name: '구조 디렉터',
        persona: 'TV UX와 정보 설계 전문가. "3미터 거리에서 리모컨을 들고 서 있는 시청자가 5초 안에 핵심을 파악할 수 있는가?"가 기준이다. 텍스트가 조금이라도 많거나, CTA가 약하거나, 시선이 분산되면 즉시 리턴한다.',
        priority: 'TV 시청 환경 적합성과 정보 위계. 한눈에 읽히는가, CTA가 명확한가, 핵심 메시지가 3초 안에 전달되는가.'
      }
    };
    const dp = directorProfiles[directorType] || directorProfiles.A;

    const specNote = specCheck ? `
Spec check (for reference only):
- Size: ${specCheck.actual?.width}x${specCheck.actual?.height} (standard: ${specCheck.expected?.width || 'flexible'}x${specCheck.expected?.height})
- Format: ${specCheck.actual?.mime} 
- File size: ${specCheck.actual?.kb}KB (NOTE: this is a preview/thumbnail file, NOT the actual submission file. Do NOT flag file size as an issue.)
- Safe area: ${specCheck.expected?.safeArea}

IMPORTANT SAFE AREA RULE: Only flag safe area violations when CORE ELEMENTS (main text, key visuals, CTA buttons, product images) are outside the safe zone. Background decorations, gradients, and ornamental elements extending beyond the safe area are ACCEPTABLE and should NOT be flagged as errors.` : '';

    const prompt = `You are reviewing a TV service design draft. 

Director persona: ${dp.name}
${dp.persona}
Review priority: ${dp.priority}

Design info:
- Banner type: ${reviewType || 'unknown'}
- Brand: ${brandName || 'unknown'}  
- Purpose: ${purpose || 'unknown'}
- Key benefit: ${benefit || 'unknown'}
- CTA: ${cta || 'unknown'}
- Designer notes: ${memo || 'none'}
${specNote}

REVIEW GUIDELINES:
1. Think like the director persona described above, not like a checklist robot.
2. Judge the overall "quality level" and "design sensibility" of the work.
3. Ask yourself: "Would this pass a real design director's review?"
4. For safe area: only flag if CORE ELEMENTS (text, key visuals, CTA) are outside. Background elements crossing the boundary is fine.
5. File size shown is a PREVIEW file, ignore it completely.
6. Be specific about what you see in the actual image.
7. Markers should point to actual problem areas you can see in the image.

Return ONLY a valid JSON object. No markdown, no code fences.

{
  "verdict": "치명 리스크",
  "directorType": "${directorType || 'A'}",
  "summary": ["핵심 문제 1문장", "핵심 문제 1문장"],
  "markers": [
    {"id": 1, "x": 25, "y": 30, "severity": "critical", "label": "제목", "comment": "구체적 문제 설명 2-3문장"}
  ],
  "sections": [
    {"id": "tv", "title": "TV 시청 환경 적합성", "verdict": "치명 리스크", "cause": "복합 리스크", "problem": "구체적 문제", "reason": "이유", "suggestion": "개선 제안", "markerIds": [1]},
    {"id": "hierarchy", "title": "정보 위계", "verdict": "수정 권장", "cause": "기획/UX 구조 리스크", "problem": "구체적 문제", "reason": "이유", "suggestion": "개선 제안", "markerIds": []},
    {"id": "brand", "title": "브랜드 톤 유지", "verdict": "검토 필요", "cause": null, "problem": "구체적 문제", "reason": "이유", "suggestion": "개선 제안", "markerIds": []},
    {"id": "finish", "title": "완성도 / 마감감", "verdict": "수정 권장", "cause": null, "problem": "구체적 문제", "reason": "이유", "suggestion": "개선 제안", "markerIds": []}
  ],
  "priorities": ["1순위 수정 항목", "2순위 수정 항목", "3순위 수정 항목"],
  "finalComment": "디렉터 전달 가능 여부와 핵심 이유 2-3문장"
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

    const raw = data?.content?.map(c => c.text || '').join('').trim();
    const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim();
    let parsed = null;
    for (const t of [cleaned, raw]) {
      if (parsed) break;
      try { const r = JSON.parse(t); if (r?.verdict) { parsed = r; break; } } catch(e) {}
      try { const m = t.match(/\{[\s\S]*\}/); if (m) { const r = JSON.parse(m[0]); if (r?.verdict) { parsed = r; } } } catch(e) {}
    }
    return res.status(200).json({ model_used: model, text: cleaned, parsed });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
