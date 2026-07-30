import fs from 'node:fs'
import path from 'node:path'
import readXlsxFile from 'read-excel-file/node'

const input = process.argv[2] || '/Users/klebs/Downloads/JULHO - PLANILHA DE VENDAS.xlsx'
const output = process.argv[3] || path.resolve('src/data/validation-report.json')
const sheetsMeta = await readXlsxFile(input, { getSheets: true })
const sheets = sheetsMeta.map((sheet) => sheet.sheet)
const sheetName = sheets.includes('PERFUMES') ? 'PERFUMES' : sheets[0]
const matrix = sheetsMeta.find((sheet) => sheet.sheet === sheetName).data
const headers = matrix[0].map((value) => String(value ?? '').trim())
const source = matrix.slice(1).map((values,rowIndex) => ({
  ...Object.fromEntries(headers.map((header,index)=>[header,values[index]??null])),
  __sourceRow:rowIndex+2,
}))
const normalize = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const date = (v) => v instanceof Date && !Number.isNaN(v.valueOf()) ? v.toISOString().slice(0,10) : null
const money = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null
const status = (v) => {
  const x = normalize(v)
  if (['pago','paga','quitado'].includes(x)) return 'paid'
  if (x.includes('cancel') || x.includes('estorn')) return 'cancelled'
  if (x.includes('aguard') || x.includes('pendente') || x.includes('nao pago')) return 'pending'
  return 'unknown'
}
const isOperationalClientLabel = (v) => ['disponivel para venda'].includes(normalize(v))
const rows = source.filter((r) => headers.some((header) => r[header] !== null && String(r[header]).trim())).filter((r)=>normalize(r.CLIENTE)!=='total:')
const seen = new Set()
let duplicates = 0
const parsed = rows.map((r) => {
  const rawClient=String(r.CLIENTE??'').replace(/\s+/g,' ').trim(), client = normalize(r.CLIENTE), saleDate = date(r.DATA), amount = money(r.VALOR), paymentStatus = status(r.PAGAMENTO)
  const sig = [
    client,saleDate,normalize(r.PERFUME),normalize(r.TIPO),normalize(r.ML),
    amount,normalize(r.PAGAMENTO),normalize(r['FORMA DE PAGAMENTO']),path.basename(input)
  ].join('|')
  const duplicate = seen.has(sig); if (duplicate) duplicates++
  seen.add(sig)
  const operationalLabel=isOperationalClientLabel(client)
  const importable = Boolean(client && !operationalLabel && amount !== null && amount >= 0)
  const accountable = Boolean(importable && saleDate && paymentStatus !== 'unknown' && paymentStatus !== 'cancelled')
  const warnings = [!saleDate&&'invalid_date',paymentStatus==='unknown'&&'unknown_status',!String(r['FORMA DE PAGAMENTO']??'').trim()&&'unknown_payment_method',duplicate&&'possible_duplicate'].filter(Boolean)
  const blockers = [!client&&'missing_client',operationalLabel&&'operational_label',(amount===null||amount<0)&&'invalid_amount'].filter(Boolean)
  return { sourceRow:r.__sourceRow, rawClient, client, saleDate, amount: amount ?? 0, hasNumericAmount:amount!==null, operationalLabel, paymentStatus, rawStatus:String(r.PAGAMENTO??'').trim()||'(vazio)', paymentMethod: String(r['FORMA DE PAGAMENTO'] ?? '').trim() || 'Não informado', importable, accountable, warnings, blockers, duplicate }
})
const validRows = parsed.filter((r) => r.importable)
const accountableRows = parsed.filter((r)=>r.accountable)
const clientRows = parsed.filter((r)=>r.client&&!r.operationalLabel)
const sum = (items) => Math.round(items.reduce((a,b)=>a+b.amount,0)*100)/100
const group = (key, value = () => 1, items=validRows) => Object.entries(items.reduce((acc,r)=>{const k=key(r);acc[k]=(acc[k]||0)+value(r);return acc},{})).map(([name,v])=>({name,value:Math.round(v*100)/100})).sort((a,b)=>b.value-a.value)
const monthlyRaw = group((r)=>r.saleDate.slice(0,7),(r)=>r.amount,accountableRows).sort((a,b)=>a.name.localeCompare(b.name))
const partition = {
  paid: validRows.filter((r)=>r.paymentStatus==='paid'),
  pending: validRows.filter((r)=>r.paymentStatus==='pending'),
  cancelled: validRows.filter((r)=>r.paymentStatus==='cancelled'),
  review: validRows.filter((r)=>r.paymentStatus==='unknown'),
}
const oldStrict = validRows.filter((r)=>r.saleDate && r.paymentStatus!=='unknown' && r.paymentMethod!=='Não informado')
const clientVariantMap = new Map()
for (const row of clientRows) {
  if (!clientVariantMap.has(row.client)) clientVariantMap.set(row.client,new Set())
  clientVariantMap.get(row.client).add(row.rawClient)
}
const report = {
  source:path.basename(input), sheet:sheetName, sheets:sheets.length, rows:rows.length,
  valid:validRows.length, rejected:rows.length-validRows.length, duplicates,
  warningRows:parsed.filter((r)=>r.warnings.length).length,
  impossibleRows:parsed.filter((r)=>r.blockers.length).length,
  operationalRows:parsed.filter((r)=>r.operationalLabel).length,
  operationalValue:sum(parsed.filter((r)=>r.operationalLabel)),
  columnGrossValue:sum(parsed.filter((r)=>r.hasNumericAmount)),
  possibleClientDuplicateGroups:[...clientVariantMap.values()].filter((variants)=>variants.size>1).length,
  uniqueClients:new Set(clientRows.map((r)=>r.client)).size,
  rowsWithClient:parsed.filter((r)=>r.client).length, rowsWithNumericValue:parsed.filter((r)=>r.hasNumericAmount).length,
  rawClientNames:clientRows.length, exactClientNames:new Set(clientRows.map((r)=>r.rawClient)).size,
  normalizedClientNames:new Set(clientRows.map((r)=>r.client)).size,
  importedValue:sum(validRows), revenue:sum(accountableRows),
  grossToDashboardDifference:Math.round((sum(parsed.filter((r)=>r.hasNumericAmount))-sum(accountableRows))*100)/100,
  paid:sum(validRows.filter((r)=>r.paymentStatus==='paid')),
  pending:sum(validRows.filter((r)=>r.paymentStatus==='pending')),
  cancelled:sum(validRows.filter((r)=>r.paymentStatus==='cancelled')),
  reviewValue:sum(validRows.filter((r)=>r.paymentStatus==='unknown')),
  rejectionReasonCounts:{
    missing_client:parsed.filter((r)=>r.blockers.includes('missing_client')).length,
    invalid_amount:parsed.filter((r)=>r.blockers.includes('invalid_amount')).length,
    operational_label:parsed.filter((r)=>r.blockers.includes('operational_label')).length,
  },
  rejectedRows:parsed.filter((r)=>r.blockers.length).map((r)=>({
    row:r.sourceRow,
    reasons:r.blockers,
    value:r.hasNumericAmount?Math.round(r.amount*100)/100:null,
  })),
  reconciliation: {
    gross_with_client_and_value:{lines:validRows.length,value:sum(validRows)},
    paid:{lines:partition.paid.length,value:sum(partition.paid)},
    pending:{lines:partition.pending.length,value:sum(partition.pending)},
    cancelled:{lines:partition.cancelled.length,value:sum(partition.cancelled)},
    unstandardized_status:{lines:partition.review.length,value:sum(partition.review)},
    invalid_or_missing_date:{lines:validRows.filter((r)=>!r.saleDate).length,value:sum(validRows.filter((r)=>!r.saleDate))},
    possible_duplicate:{lines:validRows.filter((r)=>r.duplicate).length,value:sum(validRows.filter((r)=>r.duplicate))},
    missing_value:{lines:parsed.filter((r)=>r.client&&!r.operationalLabel&&!r.hasNumericAmount).length,value:0},
    dashboard_accounted:{lines:accountableRows.length,value:sum(accountableRows)},
    excluded_from_revenue:{lines:partition.cancelled.length+partition.review.length,value:sum([...partition.cancelled,...partition.review])},
    impossible_without_client:{lines:parsed.filter((r)=>!r.client&&r.hasNumericAmount).length,value:sum(parsed.filter((r)=>!r.client&&r.hasNumericAmount))},
  },
  previous_report:{valid_value:1563985.48,dashboard_revenue:1560267.48,strict_recalculated:sum(oldStrict),difference_gross_vs_previous:Math.round((sum(validRows)-1563985.48)*100)/100},
  paymentMethods:group((r)=>r.paymentMethod),
  statusCounts:group((r)=>r.paymentStatus),
  monthly:monthlyRaw.map(({name,value})=>({month:name,revenue:value}))
}
fs.writeFileSync(output, `${JSON.stringify(report,null,2)}\n`)
console.log(JSON.stringify(report,null,2))
