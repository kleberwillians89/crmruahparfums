import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import readXlsxFile from 'read-excel-file/node'

const projectRef = 'pfhvqkzafgoyumxmbwqc'
const organizationId = '032fd96e-638f-428b-8cc2-37afc71e10ea'
const email = 'parfumsruah@gmail.com'
const input = process.argv[2]
const mode = process.argv[3] ?? 'dry-run'
if (!input || !['dry-run', 'load'].includes(mode)) {
  throw new Error('Uso: node scripts/import-commercial-batch.mjs <arquivo.xlsx> [dry-run|load]')
}

const file = readFileSync(input)
const fileHash = createHash('sha256').update(file).digest('hex')
const workbook = await readXlsxFile(input, { getSheets: true })
const sheetName = workbook.some((sheet) => sheet.sheet === 'PERFUMES') ? 'PERFUMES' : workbook[0].sheet
const matrix = workbook.find((sheet) => sheet.sheet === sheetName)?.data ?? []
const headers = matrix[0].map((value) => String(value ?? '').trim())
const normalize = (value) => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase()
const normalizeDate = (value) =>
  value instanceof Date && !Number.isNaN(value.valueOf()) ? value.toISOString().slice(0, 10) : null
const rawString = (value) => value instanceof Date ? value.toISOString() : String(value ?? '')
const normalizeStatus = (value) => {
  const normalized = normalize(value)
  if (['pago', 'paga', 'quitado'].includes(normalized)) return 'paid'
  if (normalized.includes('cancel') || normalized.includes('estorn')) return 'cancelled'
  if (normalized.includes('aguard') || normalized.includes('pendente') || normalized.includes('nao pago')) return 'pending'
  return 'unknown'
}
const sourceRows = matrix.slice(1).map((values, index) => ({
  sourceRow: index + 2,
  source: Object.fromEntries(headers.map((header, column) => [header, values[column] ?? null])),
})).filter(({ source }) =>
  headers.some((header) => source[header] !== null && String(source[header]).trim())
).filter(({ source }) => normalize(source.CLIENTE) !== 'total:')

const seen = new Set()
const rows = sourceRows.map(({ sourceRow, source }) => {
  const displayClient = String(source.CLIENTE ?? '').replace(/\s+/g, ' ').trim()
  const normalizedClient = normalize(displayClient)
  const saleDate = normalizeDate(source.DATA)
  const amount = typeof source.VALOR === 'number' && Number.isFinite(source.VALOR)
    ? Math.round(source.VALOR * 100) / 100 : null
  const paymentStatus = normalizeStatus(source.PAGAMENTO)
  const paymentMethod = String(source['FORMA DE PAGAMENTO'] ?? '').trim()
  const isStock = normalizedClient === 'disponivel para venda'
  const rowType = isStock ? 'stock' : normalizedClient && amount !== null && amount >= 0 ? 'sale' : 'rejected'
  const signatureSource = [
    normalizedClient, saleDate, normalize(source.PERFUME), normalize(source.TIPO),
    normalize(source.ML), amount, normalize(source.PAGAMENTO),
    normalize(source['FORMA DE PAGAMENTO']), path.basename(input),
  ].join('|')
  const signature = createHash('sha256').update(signatureSource).digest('hex')
  const isDuplicate = seen.has(signature)
  seen.add(signature)
  const warnings = [
    !saleDate && 'invalid_date',
    paymentStatus === 'unknown' && 'unknown_status',
    !paymentMethod && 'unknown_payment_method',
    isDuplicate && 'possible_duplicate',
  ].filter(Boolean)
  const blockers = [
    !normalizedClient && 'missing_client',
    isStock && 'operational_label',
    (amount === null || amount < 0) && 'invalid_amount',
  ].filter(Boolean)
  const rawData = Object.fromEntries(headers.map((header) => [
    header,
    source[header] instanceof Date ? source[header].toISOString() : source[header],
  ]))
  return {
    source_row: sourceRow,
    display_client: displayClient,
    normalized_client: normalizedClient,
    sale_date: saleDate,
    amount: amount,
    payment_status: paymentStatus,
    payment_method: paymentMethod,
    note: String(source['OBSERVAÇÃO'] ?? '').trim(),
    signature,
    is_duplicate: isDuplicate,
    warnings,
    blockers,
    row_type: rowType,
    original_date: rawString(source.DATA),
    original_amount: rawString(source.VALOR),
    original_payment_status: rawString(source.PAGAMENTO),
    original_payment_method: rawString(source['FORMA DE PAGAMENTO']),
    raw_data: rawData,
  }
})

const cents = (items) => items.reduce((sum, row) =>
  sum + (row.amount === null ? 0 : Math.round(row.amount * 100)), 0)
const sales = rows.filter((row) => row.row_type === 'sale')
const stock = rows.filter((row) => row.row_type === 'stock')
const review = rows.filter((row) => row.row_type !== 'sale')
const summary = {
  file_hash: fileHash,
  rows: rows.length,
  sales: sales.length,
  review: review.length,
  stock: stock.length,
  clients: new Set(rows.filter((row) =>
    row.normalized_client && row.row_type !== 'stock'
  ).map((row) => row.normalized_client)).size,
  possible_duplicates: sales.filter((row) => row.is_duplicate).length,
  gross_cents: cents(rows),
  paid_cents: cents(sales.filter((row) => row.payment_status === 'paid')),
  pending_cents: cents(sales.filter((row) => row.payment_status === 'pending')),
  stock_pending_cents: cents(stock.filter((row) => row.payment_status === 'pending')),
  credit_outside_raw_json: rows.some((row) =>
    Object.keys(row).some((key) => key.toLowerCase().includes('credit'))
  ),
}
const expected = {
  rows: 5926,
  sales: 5892,
  review: 34,
  stock: 15,
  clients: 418,
  possible_duplicates: 20,
  gross_cents: 167369078,
  paid_cents: 156155238,
  pending_cents: 9125780,
  stock_pending_cents: 134020,
  credit_outside_raw_json: false,
}
if (JSON.stringify(summary) !== JSON.stringify({ file_hash: fileHash, ...expected })) {
  console.log(JSON.stringify({ summary, expected }, null, 2))
  throw new Error('Reconciliação local divergente. Nenhuma gravação foi realizada.')
}
console.log(JSON.stringify({ mode, ...summary, reconciled: true }, null, 2))
if (mode === 'dry-run') process.exit(0)

const keys = JSON.parse(execFileSync('supabase', [
  'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json',
], { encoding: 'utf8' }))
const serviceKey = keys.find((key) =>
  key.name === 'service_role' || key.type === 'service_role'
)?.api_key
if (!serviceKey) throw new Error('Credencial administrativa indisponível.')
const base = `https://${projectRef}.supabase.co`
const headersWithAuth = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
}
const jsonRequest = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { ...headersWithAuth, 'content-type': 'application/json', ...options.headers },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(body?.message || body?.hint || body?.code || `HTTP ${response.status}`)
  return body
}
const authPage = await jsonRequest(`${base}/auth/v1/admin/users?page=1&per_page=1000`)
const users = authPage.users?.filter((user) => user.email?.toLowerCase() === email) ?? []
if (users.length !== 1) throw new Error('Usuário administrador não localizado de forma inequívoca.')
const userId = users[0].id
const membership = await jsonRequest(
  `${base}/rest/v1/organization_members?organization_id=eq.${organizationId}&user_id=eq.${userId}&role=eq.admin&select=user_id`,
)
if (membership.length !== 1) throw new Error('Vínculo administrativo não confirmado.')
const existingClients = await jsonRequest(`${base}/rest/v1/clients?organization_id=eq.${organizationId}&select=id`)
const existingSales = await jsonRequest(`${base}/rest/v1/sales?organization_id=eq.${organizationId}&select=id`)
const existingBatch = await jsonRequest(
  `${base}/rest/v1/import_batches?organization_id=eq.${organizationId}&file_hash=eq.${fileHash}&select=id`,
)
if (existingClients.length || existingSales.length || existingBatch.length) {
  throw new Error('Pré-condição de banco vazio/idempotência não atendida.')
}

const storagePath = `${organizationId}/${fileHash}/${path.basename(input)}`
const encodedStoragePath = storagePath.split('/').map(encodeURIComponent).join('/')
const upload = await fetch(`${base}/storage/v1/object/commercial-imports/${encodedStoragePath}`, {
  method: 'POST',
  headers: {
    ...headersWithAuth,
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'x-upsert': 'false',
  },
  body: file,
})
if (!upload.ok && upload.status !== 409) {
  throw new Error(`Falha ao preservar arquivo no bucket privado: ${upload.status}`)
}
let batchId
try {
  batchId = await jsonRequest(`${base}/rest/v1/rpc/import_commercial_batch`, {
    method: 'POST',
    body: JSON.stringify({
      p_organization_id: organizationId,
      p_user_id: userId,
      p_file_name: path.basename(input),
      p_file_hash: fileHash,
      p_sheet_name: sheetName,
      p_rows: rows,
    }),
  })
} catch (error) {
  if (upload.ok) {
    await fetch(`${base}/storage/v1/object/commercial-imports/${encodedStoragePath}`, {
      method: 'DELETE',
      headers: headersWithAuth,
    })
  }
  throw error
}
console.log(JSON.stringify({
  imported: true,
  import_batch_id: batchId,
  storage_path: storagePath,
  transaction_completed: true,
}, null, 2))
