import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
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
const normalize = (value) => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase()
const normalizeHeader = (value) => normalize(String(value ?? '').replace(/\r?\n/g, ' ')).toUpperCase()
const officialHeaders = [
  'CLIENTE', 'DATA', 'PRAZO DE ENVIO', 'DATA DE ENVIO', 'TIPO', 'ML', 'PERFUME',
  'VALOR', 'PAGAMENTO', 'FORMA DE PAGAMENTO', 'DATA PAGMT', 'CRÉDITO', 'OBSERVAÇÃO',
]
const rawHeaders = matrix[0].map((value) => String(value ?? ''))
const headerIndexes = new Map(rawHeaders.map((header, index) => [normalizeHeader(header), index]))
const fieldIndexes = new Map(officialHeaders.map((header) => [
  header, headerIndexes.get(normalizeHeader(header)),
]))
const missingHeaders = officialHeaders.filter((header) => fieldIndexes.get(header) === undefined)
if (missingHeaders.length) throw new Error(`Cabeçalhos obrigatórios ausentes: ${missingHeaders.join(', ')}`)
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
  source: Object.fromEntries(officialHeaders.map((header) => [
    header, values[fieldIndexes.get(header)] ?? null,
  ])),
  rawData: Object.fromEntries(rawHeaders.flatMap((header, column) =>
    header ? [[header, values[column] instanceof Date ? values[column].toISOString() : values[column] ?? null]] : []
  )),
})).filter(({ source }) =>
  officialHeaders.some((header) => source[header] !== null && String(source[header]).trim())
).filter(({ source }) => normalize(source.CLIENTE) !== 'total:')

const seen = new Set()
const rows = sourceRows.map(({ sourceRow, source, rawData }) => {
  const displayClient = String(source.CLIENTE ?? '').replace(/\s+/g, ' ').trim()
  const normalizedClient = normalize(displayClient)
  const saleDate = normalizeDate(source.DATA)
  const amount = typeof source.VALOR === 'number' && Number.isFinite(source.VALOR)
    ? Math.round(source.VALOR * 100) / 100 : null
  const paymentStatus = normalizeStatus(source.PAGAMENTO)
  const paymentMethod = String(source['FORMA DE PAGAMENTO'] ?? '').trim()
  const saleType = normalize(source.TIPO).toUpperCase()
  const rawVolume = source.ML
  let volumeMl = typeof rawVolume === 'number' && Number.isFinite(rawVolume) && rawVolume >= 0
    ? rawVolume : null
  let volumeNormalizedFromText = false
  if (volumeMl === null && typeof rawVolume === 'string') {
    const match = rawVolume.match(/\(\s*(\d+(?:[.,]\d+)?)\s*\)/)
      ?? rawVolume.match(/\(\s*X\s*\)\s*(\d+(?:[.,]\d+)?)/i)
    if (match) {
      volumeMl = Number(match[1].replace(',', '.'))
      volumeNormalizedFromText = Number.isFinite(volumeMl) && volumeMl >= 0
    }
  }
  const perfumeNameRaw = String(source.PERFUME ?? '').replace(/\s+/g, ' ').trim()
  const bottleMatch = perfumeNameRaw.match(/\((FRASCO\s*\d+)\)\s*$/i)
  const bottleIdentifier = bottleMatch?.[1].replace(/\s+/g, ' ').toUpperCase() ?? null
  const perfumeBaseName = bottleMatch
    ? perfumeNameRaw.slice(0, bottleMatch.index).trim() : perfumeNameRaw
  const shippingDeadlineRaw = rawString(source['PRAZO DE ENVIO'])
  const shippingDeadlineDate = normalizeDate(source['PRAZO DE ENVIO'])
  const shippingOperationalStatus = shippingDeadlineDate || !shippingDeadlineRaw.trim()
    ? null : shippingDeadlineRaw.trim()
  const shippedAt = normalizeDate(source['DATA DE ENVIO'])
  const paidAt = normalizeDate(source['DATA PAGMT'])
  const creditReferenceAmount = typeof source['CRÉDITO'] === 'number'
    && Number.isFinite(source['CRÉDITO']) ? source['CRÉDITO'] : null
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
    !perfumeNameRaw && 'missing_perfume',
    !['APC', 'SPLIT'].includes(saleType) && 'unknown_sale_type',
    volumeMl === null && 'invalid_volume_ml',
    volumeNormalizedFromText && 'volume_normalized_from_text',
    shippingOperationalStatus && !/^(ENVIADO|DISPON[IÍ]VEL|PRONTA ENTREGA|CANCELADO)$/i.test(shippingOperationalStatus)
      && 'ambiguous_shipping_deadline',
    /frasco/i.test(perfumeNameRaw) && !bottleIdentifier && 'ambiguous_bottle_identifier',
    isDuplicate && 'possible_duplicate',
  ].filter(Boolean)
  const blockers = [
    !normalizedClient && 'missing_client',
    isStock && 'operational_label',
    (amount === null || amount < 0) && 'invalid_amount',
  ].filter(Boolean)
  return {
    source_row: sourceRow,
    display_client: displayClient,
    normalized_client: normalizedClient,
    sale_date: saleDate,
    amount: amount,
    payment_status: paymentStatus,
    payment_method: paymentMethod,
    paid_at: paidAt,
    shipping_deadline_raw: shippingDeadlineRaw,
    shipping_deadline_date: shippingDeadlineDate,
    shipping_operational_status: shippingOperationalStatus,
    shipped_at: shippedAt,
    sale_type: saleType,
    volume_ml: volumeMl,
    volume_ml_raw: rawString(rawVolume),
    perfume_name_raw: perfumeNameRaw,
    perfume_base_name: perfumeBaseName,
    bottle_identifier: bottleIdentifier,
    credit_reference_amount: creditReferenceAmount,
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
  credit_reference_mapped: rows.some((row) => row.credit_reference_amount !== null),
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
  credit_reference_mapped: true,
}
if (JSON.stringify(summary) !== JSON.stringify({ file_hash: fileHash, ...expected })) {
  console.log(JSON.stringify({ summary, expected }, null, 2))
  throw new Error('Reconciliação local divergente. Nenhuma gravação foi realizada.')
}
const perfumeGroups = new Map()
for (const row of rows) {
  if (!row.perfume_name_raw) continue
  const key = [row.perfume_name_raw, row.sale_type, row.bottle_identifier ?? ''].join('|')
  const group = perfumeGroups.get(key) ?? {
    perfume_name_raw: row.perfume_name_raw,
    perfume_base_name: row.perfume_base_name,
    bottle_identifier: row.bottle_identifier,
    sale_type: row.sale_type,
    lines: 0, clients: new Set(), total_ml: 0, total_value: 0,
    paid: 0, pending: 0, cancelled: 0, stock: 0, duplicates: 0,
    purchase_dates: new Set(), shipping_deadlines: new Set(), shipped_dates: new Set(),
  }
  group.lines += 1
  if (row.normalized_client && row.row_type !== 'stock') group.clients.add(row.normalized_client)
  group.total_ml += row.volume_ml ?? 0
  group.total_value += row.amount ?? 0
  if (row.payment_status === 'paid') group.paid += row.amount ?? 0
  if (row.payment_status === 'pending') group.pending += row.amount ?? 0
  if (row.payment_status === 'cancelled') group.cancelled += row.amount ?? 0
  if (row.row_type === 'stock') group.stock += 1
  if (row.is_duplicate) group.duplicates += 1
  if (row.sale_date) group.purchase_dates.add(row.sale_date)
  if (row.shipping_deadline_raw) group.shipping_deadlines.add(row.shipping_deadline_raw)
  if (row.shipped_at) group.shipped_dates.add(row.shipped_at)
  perfumeGroups.set(key, group)
}
const perfumeReport = [...perfumeGroups.values()].map((group) => ({
  ...group,
  clients: group.clients.size,
  total_ml: Math.round(group.total_ml * 100) / 100,
  total_value: Math.round(group.total_value * 100) / 100,
  paid: Math.round(group.paid * 100) / 100,
  pending: Math.round(group.pending * 100) / 100,
  cancelled: Math.round(group.cancelled * 100) / 100,
  purchase_dates: [...group.purchase_dates].sort(),
  shipping_deadlines: [...group.shipping_deadlines].sort(),
  shipped_dates: [...group.shipped_dates].sort(),
}))
const quality = {
  missing_client: rows.filter((row) => !row.normalized_client).length,
  missing_perfume: rows.filter((row) => !row.perfume_name_raw).length,
  unknown_sale_type: rows.filter((row) => !['APC', 'SPLIT'].includes(row.sale_type)).length,
  invalid_volume_ml: rows.filter((row) => row.volume_ml === null).length,
  commercial_items_without_numeric_ml: sales.filter((row) => row.volume_ml === null).length,
  normalized_volume_ml: rows.filter((row) => row.warnings.includes('volume_normalized_from_text')).length,
  ambiguous_shipping_deadline: rows.filter((row) => row.warnings.includes('ambiguous_shipping_deadline')).length,
  ambiguous_bottle_identifier: rows.filter((row) => row.warnings.includes('ambiguous_bottle_identifier')).length,
}
const reportPath = '/tmp/ruah-perfume-validation.json'
writeFileSync(reportPath, `${JSON.stringify({
  source: path.basename(input),
  raw_headers: rawHeaders,
  mapped_headers: Object.fromEntries(officialHeaders.map((header) => [header, rawHeaders[fieldIndexes.get(header)]])),
  summary,
  quality,
  perfume_groups: perfumeReport,
}, null, 2)}\n`)
console.log(JSON.stringify({ mode, ...summary, quality, perfume_groups: perfumeReport.length, report_path: reportPath, reconciled: true }, null, 2))
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
const existingBatch = await jsonRequest(
  `${base}/rest/v1/import_batches?organization_id=eq.${organizationId}&file_hash=eq.${fileHash}&select=id,valid_rows,status`,
)
if (existingClients.length !== 418 || existingBatch.length !== 1
  || existingBatch[0].valid_rows !== 5892 || existingBatch[0].status !== 'completed') {
  throw new Error('Pré-condição para substituição segura do lote não atendida.')
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
let storageAlreadyPreserved = false
if (!upload.ok) {
  const uploadError = await upload.text()
  storageAlreadyPreserved = [400, 409].includes(upload.status)
    && /duplicate|already exists|resource already exists/i.test(uploadError)
  if (!storageAlreadyPreserved) {
    throw new Error(`Falha ao preservar arquivo no bucket privado: ${upload.status}`)
  }
}
let batchId
try {
  batchId = await jsonRequest(`${base}/rest/v1/rpc/replace_commercial_batch_v2`, {
    method: 'POST',
    body: JSON.stringify({
      p_organization_id: organizationId,
      p_user_id: userId,
      p_file_name: path.basename(input),
      p_file_hash: fileHash,
      p_sheet_name: sheetName,
      p_raw_headers: rawHeaders,
      p_old_batch_id: existingBatch[0]?.id ?? null,
      p_rows: rows,
    }),
  })
} catch (error) {
  if (upload.ok && !storageAlreadyPreserved) {
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
