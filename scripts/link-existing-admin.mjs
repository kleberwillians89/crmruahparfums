import { execFileSync } from 'node:child_process'

const projectRef = 'pfhvqkzafgoyumxmbwqc'
const email = 'parfumsruah@gmail.com'
const keys = JSON.parse(execFileSync('supabase', [
  'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json',
], { encoding: 'utf8' }))
const serviceKey = keys.find((key) =>
  key.name === 'service_role' || key.type === 'service_role'
)?.api_key
if (!serviceKey) throw new Error('Credencial administrativa indisponível.')

const base = `https://${projectRef}.supabase.co`
const headers = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
}
const request = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(body?.message || body?.msg || `HTTP ${response.status}`)
  return body
}

const page = await request('/auth/v1/admin/users?page=1&per_page=1000')
const users = page.users?.filter((user) => user.email?.toLowerCase() === email) ?? []
if (users.length !== 1) throw new Error(`Esperado um usuário existente; encontrados ${users.length}.`)
const user = users[0]

const organizations = await request('/rest/v1/organizations?slug=eq.ruah-intelligence&select=id,name,slug')
if (organizations.length !== 1) throw new Error('Organização RUAH não localizada de forma inequívoca.')
const organization = organizations[0]
await request(`/rest/v1/organizations?id=eq.${organization.id}`, {
  method: 'PATCH',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({ name: 'RUAH PARFUMS' }),
})
await request('/rest/v1/profiles?on_conflict=id', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify({ id: user.id, full_name: 'RUAH PARFUMS' }),
})
await request('/rest/v1/organization_members?on_conflict=organization_id,user_id', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify({
    organization_id: organization.id,
    user_id: user.id,
    role: 'admin',
  }),
})
const audit = await request(
  `/rest/v1/audit_logs?organization_id=eq.${organization.id}&actor_id=eq.${user.id}&action=eq.bootstrap_administrator&select=id`,
)
if (!audit.length) {
  await request('/rest/v1/audit_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      organization_id: organization.id,
      actor_id: user.id,
      action: 'bootstrap_administrator',
      entity_type: 'organization_member',
      entity_id: user.id,
      metadata: { project_ref: projectRef, method: 'existing_auth_user' },
    }),
  })
}

console.log(JSON.stringify({
  project_ref: projectRef,
  user_id: user.id,
  email,
  organization_id: organization.id,
  organization_name: 'RUAH PARFUMS',
  role: 'admin',
  created_user: false,
  changed_password: false,
}, null, 2))
