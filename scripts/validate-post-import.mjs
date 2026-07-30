import { execFileSync } from 'node:child_process'

const projectRef = 'pfhvqkzafgoyumxmbwqc'
const organizationId = '032fd96e-638f-428b-8cc2-37afc71e10ea'
const batchId = process.argv[2]
if (!batchId) throw new Error('Informe o identificador do lote.')
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
  if (!response.ok) throw new Error(body?.message || body?.hint || `HTTP ${response.status}`)
  return { body, response }
}
const count = async (table, query = '') => {
  const { response } = await request(`/rest/v1/${table}?select=*&${query}`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact' },
  })
  return Number(response.headers.get('content-range')?.split('/')[1] ?? 0)
}
const { body: metrics } = await request('/rest/v1/rpc/dashboard_commercial_metrics', {
  method: 'POST',
  body: JSON.stringify({ org_id: organizationId }),
})
const { body: clients } = await request('/rest/v1/rpc/client_commercial_summary', {
  method: 'POST',
  body: JSON.stringify({ org_id: organizationId }),
})
const { body: batch } = await request(
  `/rest/v1/import_batches?id=eq.${batchId}&select=id,status,file_hash,total_rows,valid_rows,rejected_rows,duplicate_rows,processed_rows,raw_total,metadata`,
)
const { body: rawSample } = await request(
  `/rest/v1/import_rows?import_batch_id=eq.${batchId}&select=raw_data,normalized_data,row_type&limit=1`,
)
const { body: externalSales } = await request(
  `/rest/v1/sales?organization_id=eq.${organizationId}&import_batch_id=is.null&select=id,amount,payment_status,source,clients(name)`,
)
const errors = await count('import_errors', `organization_id=eq.${organizationId}`)
const batchSales = await count('sales', `import_batch_id=eq.${batchId}`)
const missingPerfume = await count('sales', `import_batch_id=eq.${batchId}&perfume_id=is.null`)
const missingType = await count('sales', `import_batch_id=eq.${batchId}&sale_type=is.null`)
const missingVolume = await count('sales', `import_batch_id=eq.${batchId}&volume_ml=is.null`)
const oldBatch = await count('import_batches', 'id=eq.3bb120e0-b173-43c4-a336-6c91594f6f08')
const expectedLeaders = [
  ['thais', 70232.71],
  ['erica freitas', 66678.30],
  ['ariana', 63236.90],
  ['luiza de rossi', 62677.66],
  ['veridiana', 54954.96],
]
const normalize = (value) => String(value).normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
for (const [name, paid] of expectedLeaders) {
  const client = clients.find((item) => normalize(item.client) === name)
  if (!client || Number(client.paid) !== paid) {
    throw new Error(`Ranking divergente para ${name}: ${client?.paid ?? 'ausente'}`)
  }
}
const checks = {
  clients: Number(metrics.clients) === 418,
  sales: Number(metrics.sales) === 5892,
  paid_rows: Number(metrics.paid_rows) === 5495,
  pending_rows: Number(metrics.pending_rows) === 354,
  paid: Number(metrics.paid) === 1561552.38,
  pending: Number(metrics.pending) === 91257.80,
  raw_gross: Number(metrics.raw_gross) === 1673690.78,
  stock_rows: Number(metrics.stock_rows) === 15,
  stock_pending: Number(metrics.stock_pending) === 1340.20,
  review_rows: Number(metrics.review_rows) === 35,
  preserved_review_rows: Number(metrics.preserved_review_rows) === 34,
  possible_duplicates: Number(metrics.possible_duplicates) === 20,
  batch_rows: Number(metrics.batch_rows) === 5926,
  batch_completed: batch[0]?.status === 'completed',
  raw_credit_preserved: Object.hasOwn(rawSample[0]?.raw_data ?? {}, 'CRÉDITO'),
  credit_reference_mapped: Object.hasOwn(rawSample[0]?.normalized_data ?? {}, 'credit_reference_amount'),
  ranking_descending: clients.every((client, index) =>
    index === 0 || Number(clients[index - 1].paid) >= Number(client.paid)
  ),
  import_errors: errors === 0,
  batch_sales: batchSales === 5892,
  every_item_has_perfume: missingPerfume === 0,
  every_item_has_sale_type: missingType === 0,
  one_unrecoverable_ml_preserved_for_review: missingVolume === 1,
  no_external_manual_sales: externalSales.length === 0,
  old_batch_removed: oldBatch === 0,
}
if (Object.values(checks).some((value) => !value)) {
  console.log(JSON.stringify({ metrics, batch: batch[0], checks }, null, 2))
  throw new Error('Validação pós-carga divergente.')
}
console.log(JSON.stringify({
  project_ref: projectRef,
  import_batch_id: batchId,
  metrics,
  import_errors: errors,
  external_sales: externalSales,
  checks,
  top_20_clients: clients.slice(0, 20).map((client) => ({
    client: client.client,
    paid: Number(client.paid),
    total: Number(client.total_purchased),
    items: Number(client.item_count),
  })),
}, null, 2))
