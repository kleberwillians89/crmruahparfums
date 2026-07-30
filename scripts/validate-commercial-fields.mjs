import { execFileSync } from 'node:child_process'

const ref = 'pfhvqkzafgoyumxmbwqc'
const organizationId = '032fd96e-638f-428b-8cc2-37afc71e10ea'
const batchId = '48cb359b-6133-4034-b914-64b0bbd4717e'
const keys = JSON.parse(execFileSync('supabase', [
  'projects', 'api-keys', '--project-ref', ref, '--output', 'json',
], { encoding: 'utf8' }))
const service = keys.find((key) =>
  key.name === 'service_role' || key.type === 'service_role'
)?.api_key
const base = `https://${ref}.supabase.co`
const headers = { apikey:service, authorization:`Bearer ${service}` }
const request = async (path, extraHeaders = {}) => {
  const response = await fetch(`${base}${path}`, { headers:{ ...headers, ...extraHeaders } })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(body?.message || `HTTP ${response.status}`)
  return { body, response }
}
const count = async (filter) => {
  const { response } = await request(`/rest/v1/sales?select=id&import_batch_id=eq.${batchId}&${filter}`, {
    Prefer:'count=exact', Range:'0-0',
  })
  return Number(response.headers.get('content-range')?.split('/')[1] ?? 0)
}
const sample = async (filter) => (await request(
  `/rest/v1/sales?select=source_row,client_name_raw,perfume_name_raw,bottle_identifier,sale_type,volume_ml,volume_ml_raw,amount,payment_status,payment_method,paid_at,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,shipped_at,notes&import_batch_id=eq.${batchId}&${filter}&limit=1`,
)).body[0]

const counts = {
  apc: await count('sale_type=eq.APC'),
  split: await count('sale_type=eq.SPLIT'),
  paid: await count('payment_status=eq.paid'),
  pending: await count('payment_status=eq.pending'),
  pix: await count('payment_method=ilike.*PIX*'),
  card: await count('payment_method=ilike.*CART*'),
  shipped: await count('shipped_at=not.is.null'),
  ready_delivery: await count('shipping_operational_status=ilike.*PRONTA%20ENTREGA*'),
  paid_at_preserved: await count('paid_at=not.is.null'),
  volume_review: await count('volume_ml=is.null'),
}
const samples = {
  many_purchases_client: await sample('client_name_raw=eq.THAIS'),
  apc: await sample('sale_type=eq.APC'),
  split: await sample('sale_type=eq.SPLIT'),
  pix: await sample('payment_method=ilike.*PIX*'),
  card: await sample('payment_method=ilike.*CART*'),
  paid: await sample('payment_status=eq.paid'),
  pending: await sample('payment_status=eq.pending'),
  shipped: await sample('shipped_at=not.is.null'),
  ready_delivery: await sample('shipping_operational_status=ilike.*PRONTA%20ENTREGA*'),
  unrecoverable_ml: await sample('volume_ml=is.null'),
}
const { body: perfumes } = await request(
  `/rest/v1/perfumes?organization_id=eq.${organizationId}&select=full_name_raw,base_name,bottle_identifier&limit=2000`,
)
const bottleGroups = new Map()
for (const perfume of perfumes) {
  if (!perfume.bottle_identifier) continue
  const bottles = bottleGroups.get(perfume.base_name) ?? new Set()
  bottles.add(perfume.bottle_identifier)
  bottleGroups.set(perfume.base_name, bottles)
}
const multipleBottles = [...bottleGroups].find(([, bottles]) => bottles.size > 1)
const { body: clientSummaries } = await fetch(`${base}/rest/v1/rpc/client_commercial_summary`, {
  method:'POST',
  headers:{ ...headers, 'content-type':'application/json' },
  body:JSON.stringify({ org_id:organizationId }),
}).then(async (response) => ({ body:await response.json() }))
const multiplePerfumes = clientSummaries.find((client) => (client.perfumes?.length ?? 0) > 5)
const { body: perfumeSummaries } = await fetch(`${base}/rest/v1/rpc/perfume_commercial_summary`, {
  method:'POST',
  headers:{ ...headers, 'content-type':'application/json' },
  body:JSON.stringify({ org_id:organizationId }),
}).then(async (response) => ({ body:await response.json() }))
const multipleClients = perfumeSummaries.find((perfume) => Number(perfume.client_count) > 5)

const passed = counts.apc + counts.split === 5892
  && counts.paid === 5495 && counts.pending === 354
  && counts.pix > 0 && counts.card > 0 && counts.shipped > 0
  && counts.ready_delivery > 0 && counts.volume_review === 1
  && Boolean(multipleBottles && multiplePerfumes && multipleClients)
if (!passed) throw new Error('Amostragem comercial não atendeu aos critérios.')
console.log(JSON.stringify({
  counts,
  samples,
  client_with_multiple_perfumes:{
    client:multiplePerfumes.client,
    perfumes:multiplePerfumes.perfumes.length,
    items:Number(multiplePerfumes.item_count),
  },
  perfume_with_multiple_clients:{
    perfume:multipleClients.perfume_name,
    clients:Number(multipleClients.client_count),
    items:Number(multipleClients.item_count),
  },
  same_perfume_multiple_bottles:{
    perfume:multipleBottles[0],
    bottles:[...multipleBottles[1]].sort(),
  },
  passed:true,
}, null, 2))
