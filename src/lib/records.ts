import { normalizeClient } from './importer'
import { supabase } from './supabase'

export async function currentOrganization() {
  if (!supabase) throw new Error('Conecte o Supabase para salvar.')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Faça login para continuar.')
  const { data, error } = await supabase.from('organization_members').select('organization_id,role').eq('user_id', user.id).limit(1).single()
  if (error || !data) throw new Error('Usuário sem organização vinculada.')
  if (data.role === 'viewer') throw new Error('Seu perfil não permite alterações.')
  return { user, organizationId: data.organization_id as string }
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
