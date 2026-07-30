import { execFileSync } from 'node:child_process'

const projectRef = 'pfhvqkzafgoyumxmbwqc'
const email = process.argv[2]?.trim().toLowerCase()
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.')

const keys = JSON.parse(execFileSync('supabase', [
  'projects','api-keys','--project-ref',projectRef,'--output','json',
], { encoding:'utf8' }))
const serviceKey = keys.find((key) => key.name === 'service_role' || key.type === 'service_role')?.api_key
if (!serviceKey) throw new Error('Chave administrativa não encontrada pela CLI autenticada.')

const base = `https://${projectRef}.supabase.co`
const headers = { apikey:serviceKey, authorization:`Bearer ${serviceKey}`, 'content-type':'application/json' }
const request = async (path, options={}) => {
  const response = await fetch(`${base}${path}`, { ...options, headers:{...headers,...options.headers} })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(body?.message || body?.msg || body?.error_description || `HTTP ${response.status}`)
  return body
}

let user
try {
  user = await request('/auth/v1/invite', { method:'POST', body:JSON.stringify({ email }) })
  console.log('Convite seguro enviado.')
} catch (error) {
  if (!/already|registered|exists/i.test(error.message)) throw error
  const page = await request('/auth/v1/admin/users?page=1&per_page=1000')
  user = page.users?.find((candidate) => candidate.email?.toLowerCase() === email)
  if (!user) throw new Error('Usuário existente não foi localizado.')
  console.log('Usuário já existia; convite não foi duplicado.')
}

const organizations = await request('/rest/v1/organizations?slug=eq.ruah-intelligence&select=id,name,slug')
let organization = organizations[0]
if (!organization) {
  const created = await request('/rest/v1/organizations', {
    method:'POST', headers:{ Prefer:'return=representation' },
    body:JSON.stringify({ name:'RUAH Intelligence', slug:'ruah-intelligence' }),
  })
  organization = created[0]
}
await request('/rest/v1/organization_members?on_conflict=organization_id,user_id', {
  method:'POST', headers:{ Prefer:'resolution=merge-duplicates,return=representation' },
  body:JSON.stringify({ organization_id:organization.id, user_id:user.id, role:'admin' }),
})
await request('/rest/v1/audit_logs', {
  method:'POST',
  body:JSON.stringify({
    organization_id:organization.id, actor_id:user.id, action:'bootstrap_admin',
    entity_type:'organization_member', entity_id:user.id,
    metadata:{ method:'secure_invite', project_ref:projectRef },
  }),
})
console.log(JSON.stringify({
  project_ref:projectRef, organization_id:organization.id, user_id:user.id,
  email, role:'admin', invitation_sent_at:new Date().toISOString(),
}, null, 2))
