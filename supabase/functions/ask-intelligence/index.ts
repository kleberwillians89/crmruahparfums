import { context, json, audit } from '../_shared/security.ts'

Deno.serve(async (req) => {
  const ctx = await context(req)
  if ('response' in ctx) return ctx.response
  const { client, user, body, organizationId } = ctx
  const question = String(body.question ?? '').trim().slice(0, 1000)
  const start = String(body.period_start ?? '')
  const end = String(body.period_end ?? '')
  if (!question || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return json({ error: { code: 'invalid_payload', message: 'Pergunta e período são obrigatórios.' } }, 400)
  const { data: metrics, error } = await client.rpc('sales_metrics', { org_id: organizationId, start_date: start, end_date: end })
  if (error) return json({ error: { code: 'metrics_error', message: 'Não foi possível calcular as métricas.' } }, 500)
  const run = await client.from('ai_runs').insert({ organization_id: organizationId, user_id: user.id, run_type: 'question', status: 'running', metric_keys: Object.keys(metrics ?? {}) }).select('id').single()
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    await client.from('ai_runs').update({ status: 'failed', error_code: 'missing_ai_key', completed_at: new Date().toISOString() }).eq('id', run.data?.id)
    return json({ error: { code: 'ai_unavailable', message: 'A inteligência ainda não foi configurada.' } }, 503)
  }
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      input: [
        { role: 'system', content: 'Você é a inteligência comercial da RUAH Parfums. Use somente as métricas fornecidas. Não invente números. Responda em pt-BR com resposta direta, período, métricas, explicação, recomendação e limitações.' },
        { role: 'user', content: JSON.stringify({ question, authorized_aggregated_metrics: metrics }) },
      ],
      text: { format: { type: 'json_schema', name: 'commercial_answer', strict: true, schema: {
        type: 'object', additionalProperties: false, required: ['answer','period','metrics_used','explanation','recommendation','limitations'],
        properties: { answer:{type:'string'},period:{type:'string'},metrics_used:{type:'array',items:{type:'string'}},explanation:{type:'string'},recommendation:{type:'string'},limitations:{type:'string'} }
      } } }
    }),
  })
  if (!response.ok) {
    await client.from('ai_runs').update({ status: 'failed', error_code: 'provider_error', completed_at: new Date().toISOString() }).eq('id', run.data?.id)
    return json({ error: { code: 'ai_failed', message: 'A análise não pôde ser concluída.' } }, 502)
  }
  const raw = await response.json()
  let answer: unknown
  try { answer = JSON.parse(raw.output_text) } catch { return json({ error: { code: 'invalid_ai_output', message: 'A resposta recebida não passou na validação.' } }, 502) }
  await client.from('ai_runs').update({ status: 'completed', model: raw.model, completed_at: new Date().toISOString() }).eq('id', run.data?.id)
  await audit(client, organizationId, user.id, 'ai_question', 'ai_run', run.data?.id, { metric_keys: Object.keys(metrics ?? {}) })
  return json({ data: { ...answer as object, analyzed_at: new Date().toISOString() } })
})
