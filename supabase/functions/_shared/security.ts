import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
})

export async function context(req: Request) {
  if (req.method === 'OPTIONS') return { response: json({ ok: true }) }
  const authorization = req.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return { response: json({ error: { code: 'unauthorized', message: 'Autenticação necessária.' } }, 401) }
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anon) return { response: json({ error: { code: 'server_config', message: 'Função não configurada.' } }, 500) }
  const client = createClient(url, anon, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return { response: json({ error: { code: 'unauthorized', message: 'Sessão inválida.' } }, 401) }
  let body: Record<string, unknown> = {}
  try { body = req.method === 'GET' ? {} : await req.json() } catch { return { response: json({ error: { code: 'invalid_json', message: 'Payload inválido.' } }, 400) } }
  const organizationId = String(body.organization_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return { response: json({ error: { code: 'invalid_org', message: 'Organização inválida.' } }, 400) }
  const { data: membership } = await client.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle()
  if (!membership) return { response: json({ error: { code: 'forbidden', message: 'Acesso negado.' } }, 403) }
  return { client, user, body, organizationId, role: membership.role }
}

export async function audit(client: ReturnType<typeof createClient>, organizationId: string, actorId: string, action: string, entityType: string, entityId?: string, metadata: Record<string, unknown> = {}) {
  await client.from('audit_logs').insert({ organization_id: organizationId, actor_id: actorId, action, entity_type: entityType, entity_id: entityId, metadata })
}
