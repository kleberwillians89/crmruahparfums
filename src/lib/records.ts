import { normalizeClient } from './importer'
import { supabase } from './supabase'
import type { PeriodValue } from './period'

export async function authenticatedOrganization() {
  if (!supabase) throw new Error('Conecte o Supabase para continuar.')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Faça login para continuar.')
  const { data, error } = await supabase.from('organization_members')
    .select('organization_id,role').eq('user_id', user.id).limit(1).single()
  if (error || !data) throw new Error('Usuário sem organização vinculada.')
  return { user, organizationId: data.organization_id as string, role: data.role as string }
}

export async function currentOrganization() {
  const context = await authenticatedOrganization()
  if (context.role === 'viewer') throw new Error('Seu perfil não permite alterações.')
  return context
}

export type DashboardMetrics = {
  clients:number; sales:number; paid:number; pending:number; cancelled:number; review:number
  paid_rows:number; pending_rows:number; cancelled_rows:number; review_rows:number
  raw_gross:number; batch_rows:number; stock_rows:number; stock_pending:number
  preserved_review_rows:number; possible_duplicates:number; first_sale:string|null; last_sale:string|null
}

export async function fetchDashboardMetrics() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('dashboard_commercial_metrics', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return data as DashboardMetrics
}

export type PeriodSummary = {
  period_start:string;period_end:string;sales:number;total:number;paid:number;pending:number
  cancelled:number;review:number;paid_count:number;pending_count:number;cancelled_count:number
  review_count:number;average_ticket:number;buying_clients:number;new_clients:number
  recurring_clients:number;deliveries_pending:number;deliveries_overdue:number
  shipped_today:number;shipped_in_period:number;shipped_on_time:number;shipped_late:number
  without_deadline:number;daily:{period_date:string;sales:number;paid:number;pending:number}[]
  payment_methods:{name:string;items:number;value:number}[]
  top_perfumes:{name:string;items:number;ml:number;value:number}[]
  top_clients:{name:string;items:number;value:number}[]
}

export async function fetchPeriodSummary(period:PeriodValue) {
  const { organizationId }=await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('commercial_period_summary',{
    org_id:organizationId,start_date:period.start,end_date:period.end,
  })
  if(error)throw new Error(error.message)
  return data as PeriodSummary
}

export type ClientCommercialSummary = {
  client_id:string; client:string; total_purchased:number; paid:number; pending:number
  cancelled:number; review:number; item_count:number; average_ticket:number
  total_ml:number; perfumes:string[]; sale_types:string[]
  first_purchase:string|null; last_purchase:string|null
}

export async function fetchClientSummaries() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('client_commercial_summary', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return (data ?? []) as ClientCommercialSummary[]
}

export async function fetchClientPeriodSummaries(period:PeriodValue) {
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.rpc('client_period_summary',{
    org_id:organizationId,start_date:period.start,end_date:period.end,
  })
  if(error)throw new Error(error.message)
  return data ?? []
}

export type CommercialSale = {
  id:string; sale_date:string|null; amount:number; payment_status:string
  payment_method:string|null; paid_at:string|null; original_client:string|null
  perfume_name_raw:string|null; bottle_identifier:string|null; sale_type:string|null
  volume_ml:number|null; shipping_deadline_raw:string|null;shipping_deadline_date:string|null
  shipping_operational_status:string|null; shipped_at:string|null; notes:string|null;source:string
  clients:{name:string}|null
}

export type SaleFilters = {
  period?:PeriodValue; paymentStart?:string;paymentEnd?:string;shippingStart?:string;shippingEnd?:string
  search?:string;client?:string;perfume?:string;type?:string;status?:string;method?:string
  origin?:string;volumeMl?:number;minValue?:number;maxValue?:number;delivery?:string;sort?:string
}

export async function fetchSalesPage(filters:SaleFilters={},page=0,pageSize=50) {
  const { organizationId } = await authenticatedOrganization()
  let query=supabase!.from('sales')
    .select('id,sale_date,amount,payment_status,payment_method,paid_at,original_client,perfume_name_raw,bottle_identifier,sale_type,volume_ml,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,shipped_at,notes,source,clients(name)', { count:'exact' })
    .eq('organization_id', organizationId).is('deleted_at', null)
  if(filters.period)query=query.gte('sale_date',filters.period.start).lte('sale_date',filters.period.end)
  if(filters.paymentStart)query=query.gte('paid_at',filters.paymentStart)
  if(filters.paymentEnd)query=query.lte('paid_at',filters.paymentEnd)
  if(filters.shippingStart)query=query.gte('shipped_at',filters.shippingStart)
  if(filters.shippingEnd)query=query.lte('shipped_at',filters.shippingEnd)
  if(filters.client)query=query.ilike('client_name_raw',`%${filters.client}%`)
  if(filters.perfume)query=query.ilike('perfume_name_raw',`%${filters.perfume}%`)
  if(filters.type)query=query.eq('sale_type',filters.type)
  if(filters.volumeMl!==undefined)query=query.eq('volume_ml',filters.volumeMl)
  if(filters.status)query=query.eq('payment_status',filters.status)
  if(filters.method)query=query.ilike('payment_method',`%${filters.method}%`)
  if(filters.origin)query=query.eq('source',filters.origin)
  if(filters.minValue!==undefined)query=query.gte('amount',filters.minValue)
  if(filters.maxValue!==undefined)query=query.lte('amount',filters.maxValue)
  if(filters.search)query=query.or(`client_name_raw.ilike.%${filters.search}%,perfume_name_raw.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`)
  const sort=filters.sort??'sale_date_desc'
  const [column,direction]=sort.replace(/_(asc|desc)$/,'|$1').split('|')
  query=query.order(column,{ascending:direction==='asc',nullsFirst:false}).range(page*pageSize,page*pageSize+pageSize-1)
  const {data,error,count}=await query
  if (error) throw new Error(error.message)
  return { rows:(data ?? []) as unknown as CommercialSale[], count:count ?? 0 }
}

export async function fetchDeliveryRows(period?:PeriodValue) {
  const {organizationId}=await authenticatedOrganization()
  const result:CommercialSale[]=[]
  for(let from=0;;from+=1000){
    let query=supabase!.from('sales').select('id,sale_date,amount,payment_status,payment_method,paid_at,original_client,perfume_name_raw,bottle_identifier,sale_type,volume_ml,shipping_deadline_raw,shipping_deadline_date,shipping_operational_status,shipped_at,notes,source,clients(name)')
      .eq('organization_id',organizationId).is('deleted_at',null).range(from,from+999)
    if(period)query=query.gte('sale_date',period.start).lte('sale_date',period.end)
    const {data,error}=await query
    if(error)throw new Error(error.message)
    result.push(...((data??[]) as unknown as CommercialSale[]))
    if((data?.length??0)<1000)break
  }
  return result
}

export async function updateShipment(saleId:string,shippedAt:string|null) {
  const {role}=await authenticatedOrganization()
  if(role==='viewer')throw new Error('Perfil somente leitura.')
  const {error}=await supabase!.from('sales').update({shipped_at:shippedAt,updated_at:new Date().toISOString()}).eq('id',saleId)
  if(error)throw new Error(error.message)
}

export async function askIntelligence(question:string,period:PeriodValue) {
  const {organizationId}=await authenticatedOrganization()
  const {data,error}=await supabase!.functions.invoke('ask-intelligence',{body:{
    organization_id:organizationId,question,period_start:period.start,period_end:period.end,
  }})
  if(error){
    const response=(error as {context?:Response}).context
    let code=''
    try{code=String((await response?.clone().json())?.error?.code??'')}catch{/* resposta sem JSON */}
    const messages:Record<string,string>={
      unauthorized:'Sua sessão expirou. Entre novamente para continuar.',
      rate_limit:'O limite de análises foi atingido. Aguarde um minuto.',
      ai_failed:'A OpenAI não conseguiu concluir a análise agora.',
      ai_timeout:'A análise excedeu o tempo esperado. Tente novamente.',
      ai_unavailable:'O serviço de inteligência não está configurado.',
      metrics_error:'Não foi possível preparar os agregados comerciais.',
      origin_forbidden:'Esta origem não está autorizada a acessar a inteligência.',
    }
    throw new Error(messages[code]??(response?'A inteligência retornou um erro interno.':'Falha de conexão com a inteligência.'))
  }
  if(data?.error)throw new Error(data.error.message)
  return data.data
}

export type PerfumeCommercialSummary = {
  perfume_id:string; perfume_name:string; bottle_identifier:string|null
  total_ml:number; paid_ml:number; pending_ml:number; stock_ml:number; stock_items:number
  client_count:number; item_count:number; total_value:number; paid_value:number
  pending_value:number; sale_types:string[]; shipping_deadlines:string[]
  shipping_statuses:string[]; shipped_dates:string[]
}

export async function fetchPerfumeSummaries() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('perfume_commercial_summary', { org_id:organizationId })
  if (error) throw new Error(error.message)
  return (data ?? []) as PerfumeCommercialSummary[]
}

export type ClientInput = {
  name: string; phone?: string; email?: string; instagram?: string; cpf?: string
  birthDate?: string; postalCode?: string; address?: string; addressNumber?: string
  complement?: string; district?: string; city?: string; state?: string; notes?: string; status: string
}

export async function findPossibleClients(name: string) {
  const { organizationId } = await currentOrganization()
  const normalized = normalizeClient(name)
  const { data } = await supabase!.from('clients').select('id,name,normalized_name').eq('organization_id', organizationId).eq('normalized_name', normalized).limit(5)
  return data ?? []
}

export async function createClient(input: ClientInput) {
  const { user, organizationId } = await currentOrganization()
  const possible = await findPossibleClients(input.name)
  if (possible.length) throw new Error(`Possível duplicidade: já existe “${possible[0].name}”. Revise antes de salvar.`)
  const { data, error } = await supabase!.from('clients').insert({
    organization_id: organizationId, name: input.name.trim(), original_name: input.name.trim(),
    normalized_name: normalizeClient(input.name), phone: input.phone || null, email: input.email || null,
    instagram: input.instagram || null, cpf: input.cpf || null, birth_date: input.birthDate || null,
    postal_code: input.postalCode || null, address_line: input.address || null,
    address_number: input.addressNumber || null, complement: input.complement || null,
    district: input.district || null, city: input.city || null, state: input.state || null,
    notes: input.notes || null, status: input.status, source: 'manual', created_by: user.id,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export type SaleInput = {
  clientId:string;date:string;amount:number;status:string;method:string;notes?:string
  shippingDeadlineRaw?:string;shippingDeadlineDate?:string;shippedAt?:string;saleType:'APC'|'SPLIT'
  volumeMl:number;perfume:string;paidAt?:string;creditReferenceAmount?:number|null
}
export async function createSale(input: SaleInput) {
  const { user, organizationId } = await currentOrganization()
  const normalizedPerfume=normalizeClient(input.perfume)
  let {data:perfume}=await supabase!.from('perfumes').select('id').eq('organization_id',organizationId).eq('normalized_name',normalizedPerfume).maybeSingle()
  if(!perfume){
    const bottle=input.perfume.match(/\((FRASCO\s*\d+)\)\s*$/i)?.[1]?.toUpperCase()??null
    const inserted=await supabase!.from('perfumes').insert({organization_id:organizationId,full_name_raw:input.perfume.trim(),normalized_name:normalizedPerfume,base_name:input.perfume.replace(/\s*\(FRASCO\s*\d+\)\s*$/i,'').trim(),bottle_identifier:bottle}).select('id').single()
    if(inserted.error)throw new Error(inserted.error.message)
    perfume=inserted.data
  }
  const { data, error } = await supabase!.from('sales').insert({
    organization_id: organizationId, client_id: input.clientId,perfume_id:perfume.id,sale_date: input.date,
    amount: input.amount, payment_status: input.status, payment_method: input.method,
    notes: input.notes || null, source: 'manual', data_quality_status: 'verified', created_by: user.id,
    perfume_name_raw:input.perfume.trim(),perfume_base_name:input.perfume.replace(/\s*\(FRASCO\s*\d+\)\s*$/i,'').trim(),
    sale_type:input.saleType,volume_ml:input.volumeMl,volume_ml_raw:String(input.volumeMl),
    shipping_deadline_raw:input.shippingDeadlineRaw||null,shipping_deadline_date:input.shippingDeadlineDate||null,
    shipping_operational_status:input.shippingDeadlineDate?null:input.shippingDeadlineRaw||null,
    shipped_at:input.shippedAt||null,paid_at:input.status==='pending'?null:input.paidAt||null,
    credit_reference_amount:input.creditReferenceAmount??null,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function searchClients(term: string) {
  const { organizationId } = await currentOrganization()
  const { data } = await supabase!.from('clients').select('id,name').eq('organization_id', organizationId).ilike('name', `%${term}%`).limit(8)
  return data ?? []
}

export type InventorySummary = {
  items:number;available_ml:number;healthy:number;low:number;critical:number
  out_of_stock:number;consumed_ml:number;movements:number
}
export type InventoryRow = {
  item_id:string;perfume_id:string;perfume:string;available_ml:number;minimum_ml:number
  status:string;sold_ml:number;monthly_average:number;estimated_days:number|null;last_movement:string|null
}

export async function fetchInventory(period:PeriodValue) {
  const {organizationId}=await authenticatedOrganization()
  const [summary,rows]=await Promise.all([
    supabase!.rpc('inventory_summary',{org_id:organizationId,start_date:period.start,end_date:period.end}),
    supabase!.rpc('inventory_rows',{org_id:organizationId,start_date:period.start,end_date:period.end}),
  ])
  if(summary.error)throw new Error(summary.error.message)
  if(rows.error)throw new Error(rows.error.message)
  return {summary:summary.data as InventorySummary,rows:(rows.data??[]) as InventoryRow[]}
}

export async function inventoryPerfumes() {
  const {organizationId}=await currentOrganization()
  const {data,error}=await supabase!.from('perfumes').select('id,full_name_raw,normalized_name').eq('organization_id',organizationId).order('full_name_raw')
  if(error)throw new Error(error.message)
  return data??[]
}

export async function createInventoryItem(input:{perfumeId:string;openingMl:number;minimumMl:number;referenceDate:string;notes:string}) {
  const {organizationId}=await currentOrganization()
  const {data,error}=await supabase!.rpc('inventory_create_item',{
    p_organization_id:organizationId,p_perfume_id:input.perfumeId,p_opening_ml:input.openingMl,
    p_minimum_ml:input.minimumMl,p_reference_date:input.referenceDate,p_notes:input.notes||null,
  })
  if(error)throw new Error(error.message)
  return data
}

export async function adjustInventory(itemId:string,quantity:number,reason:string,notes='') {
  const movementType=quantity>0?'entry':'negative_adjustment'
  const {data,error}=await supabase!.rpc('inventory_apply',{
    p_item_id:itemId,p_quantity_ml:quantity,p_type:movementType,p_reason:reason,p_notes:notes||null,p_sale_id:null,
  })
  if(error)throw new Error(error.message)
  return data
}
