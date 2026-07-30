import { execFileSync } from 'node:child_process'

const projectRef = 'pfhvqkzafgoyumxmbwqc'
const keys = JSON.parse(execFileSync('supabase', [
  'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json',
], { encoding: 'utf8' }))
const serviceKey = keys.find((key) => key.name === 'service_role' || key.type === 'service_role')?.api_key
if (!serviceKey) throw new Error('Credencial administrativa indisponível.')
const response = await fetch(`https://${projectRef}.supabase.co/rest/v1/ai_runs?select=id,status,error_code,model,duration_ms,input_tokens,output_tokens,created_at,completed_at,organization_id,user_id&order=created_at.desc&limit=10`, {
  headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
})
if (!response.ok) throw new Error(`Consulta falhou: HTTP ${response.status}`)
console.log(JSON.stringify(await response.json(), null, 2))
