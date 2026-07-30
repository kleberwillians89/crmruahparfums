import { normalizeClient } from './importer'
import { supabase } from './supabase'

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
  possible_duplicates:number; first_sale:string|null; last_sale:string|null
}

export async function fetchDashboardMetrics() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('dashboard_commercial_metrics', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return data as DashboardMetrics
}

export type ClientCommercialSummary = {
  client_id:string; client:string; total_purchased:number; paid:number; pending:number
  cancelled:number; review:number; item_count:number; average_ticket:number
  first_purchase:string|null; last_purchase:string|null
}

export async function fetchClientSummaries() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error } = await supabase!.rpc('client_commercial_summary', { org_id: organizationId })
  if (error) throw new Error(error.message)
  return (data ?? []) as ClientCommercialSummary[]
}

export type CommercialSale = {
  id:string; sale_date:string|null; amount:number; payment_status:string
  payment_method:string|null; original_client:string|null; clients:{name:string}|null
}

export async function fetchSalesPage() {
  const { organizationId } = await authenticatedOrganization()
  const { data, error, count } = await supabase!.from('sales')
    .select('id,sale_date,amount,payment_status,payment_method,original_client,clients(name)', { count:'exact' })
    .eq('organization_id', organizationId).is('deleted_at', null)
    .order('sale_date', { ascending:false, nullsFirst:false }).limit(200)
  if (error) throw new Error(error.message)
  return { rows:(data ?? []) as unknown as CommercialSale[], count:count ?? 0 }
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

export type SaleInput = { clientId: string; date: string; amount: number; status: string; method: string; notes?: string }
export async function createSale(input: SaleInput) {
  const { user, organizationId } = await currentOrganization()
  const { data, error } = await supabase!.from('sales').insert({
    organization_id: organizationId, client_id: input.clientId, sale_date: input.date,
    amount: input.amount, payment_status: input.status, payment_method: input.method,
    notes: input.notes || null, source: 'manual', data_quality_status: 'verified', created_by: user.id,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function searchClients(term: string) {
  const { organizationId } = await currentOrganization()
  const { data } = await supabase!.from('clients').select('id,name').eq('organization_id', organizationId).ilike('name', `%${term}%`).limit(8)
  return data ?? []
}
