import { execFileSync } from 'node:child_process'

const projectRef = 'pfhvqkzafgoyumxmbwqc'
const base = `https://${projectRef}.supabase.co`
const raw = execFileSync('supabase', ['projects','api-keys','--project-ref',projectRef,'--output','json'], { encoding:'utf8' })
const keys = JSON.parse(raw)
const publicKey = keys.find((key) => ['anon','publishable'].includes(key.name) || ['anon','publishable'].includes(key.type))?.api_key
if (!publicKey) throw new Error('Chave pública do projeto não encontrada.')
const headers = { apikey:publicKey, authorization:`Bearer ${publicKey}`, 'content-type':'application/json' }
const results = []
const check = async (name, url, options, expected) => {
  const response = await fetch(url, options)
  results.push({ name, status:response.status, passed:expected.includes(response.status) })
}
for (const table of ['clients','perfumes','sales']) {
  const response = await fetch(`${base}/rest/v1/${table}?select=id&limit=1`, { headers })
  const body = response.ok ? await response.json() : null
  results.push({
    name:`RLS: ${table} anônimo sem vazamento`,
    status:response.status,
    passed:response.status===200 && Array.isArray(body) && body.length===0,
  })
}
await check('RLS: escrita anônima bloqueada',`${base}/rest/v1/clients`,{method:'POST',headers,body:'{}'},[401,403])
await check('Bucket comercial não público',`${base}/storage/v1/object/public/commercial-imports/security-check.txt`,{},[400,404])
for (const fn of ['process-import','confirm-import','revert-import','generate-insights','ask-intelligence','recalculate-metrics']) {
  await check(`JWT obrigatório: ${fn}`,`${base}/functions/v1/${fn}`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'},[401])
}
console.table(results)
if (results.some((result)=>!result.passed)) process.exit(1)
