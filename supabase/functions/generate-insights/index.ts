import { context, json, audit } from '../_shared/security.ts'

Deno.serve(async (req) => {
  const ctx = await context(req)
  if ('response' in ctx) return ctx.response
  const { client, user, body, organizationId } = ctx
  const start = String(body.period_start ?? ''), end = String(body.period_end ?? '')
  const { data: metrics, error } = await client.rpc('sales_metrics', { org_id: organizationId, start_date: start, end_date: end })
  if (error) return json({ error: { code: 'metrics_error', message: 'Não foi possível calcular as métricas.' } }, 500)
  if (!Deno.env.get('OPENAI_API_KEY')) return json({ error: { code: 'ai_unavailable', message: 'Configure OPENAI_API_KEY nos secrets do Supabase.' } }, 503)
  await audit(client, organizationId, user.id, 'generate_insights_requested', 'ai_insight', undefined, { period_start: start, period_end: end, metric_keys: Object.keys(metrics ?? {}) })
  return json({ data: { status: 'accepted', metrics, message: 'Métricas oficiais calculadas; geração pronta para processamento assíncrono.' } }, 202)
})
