import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const projectRef = 'pfhvqkzafgoyumxmbwqc'
const organizationId = '032fd96e-638f-428b-8cc2-37afc71e10ea'
const userId = '3f34fe2b-87c4-466c-8f4c-71400efa8fed'
const marker = `TESTE-CONTROLADO-${randomUUID()}`
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
    headers: { ...headers, Prefer: 'return=representation', ...options.headers },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(body?.message || body?.hint || `HTTP ${response.status}`)
  return body
}
const metrics = () => request('/rest/v1/rpc/dashboard_commercial_metrics', {
  method: 'POST',
  body: JSON.stringify({ org_id: organizationId }),
})
const cents = (value) => Math.round(Number(value) * 100)

const before = await metrics()
let clientId
let saleId
try {
  const clients = await request('/rest/v1/clients', {
    method: 'POST',
    body: JSON.stringify({
      organization_id: organizationId,
      name: marker,
      original_name: marker,
      normalized_name: marker.toLowerCase(),
      source: 'manual-test',
      created_by: userId,
    }),
  })
  clientId = clients[0].id
  const sales = await request('/rest/v1/sales', {
    method: 'POST',
    body: JSON.stringify({
      organization_id: organizationId,
      client_id: clientId,
      sale_date: '2026-07-29',
      amount: 1.23,
      payment_status: 'paid',
      payment_method: 'TESTE',
      source: 'manual-test',
      created_by: userId,
    }),
  })
  saleId = sales[0].id
  const during = await metrics()
  if (Number(during.clients) !== Number(before.clients) + 1
    || Number(during.sales) !== Number(before.sales) + 1
    || cents(during.paid) !== cents(before.paid) + 123) {
    throw new Error('Dashboard não refletiu o CRUD manual.')
  }
} finally {
  if (saleId) await request(`/rest/v1/sales?id=eq.${saleId}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  })
  if (clientId) await request(`/rest/v1/clients?id=eq.${clientId}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  })
}
const after = await metrics()
const cleanupPassed = Number(after.clients) === Number(before.clients)
  && Number(after.sales) === Number(before.sales)
  && cents(after.paid) === cents(before.paid)
if (!cleanupPassed) throw new Error('Limpeza dos registros de teste não reconciliou.')
console.log(JSON.stringify({
  manual_client_created: true,
  manual_sale_created: true,
  dashboard_updated: true,
  test_records_removed: true,
  final_clients: Number(after.clients),
  final_sales: Number(after.sales),
  final_paid: Number(after.paid),
}, null, 2))
