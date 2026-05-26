export default async function handler(req, res) {
  const hasKey = Boolean((process.env.ANTHROPIC_API_KEY || '').trim());
  const model = (process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-0').trim();
  return res.status(200).json({ ok: true, hasAnthropicKey: hasKey, model });
}
