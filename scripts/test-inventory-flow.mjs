import { execFileSync } from 'node:child_process'

const projectRef='pfhvqkzafgoyumxmbwqc'
const organizationId='032fd96e-638f-428b-8cc2-37afc71e10ea'
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'}))
const key=keys.find((item)=>item.name==='service_role'||item.type==='service_role')?.api_key
if(!key)throw new Error('Credencial administrativa indisponível.')
const base=`https://${projectRef}.supabase.co/rest/v1`
const headers={apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'}
const request=async(path,options={})=>{
  const response=await fetch(`${base}${path}`,{...options,headers:{...headers,...options.headers}})
  const text=await response.text(),body=text?JSON.parse(text):null
  if(!response.ok)throw new Error(body?.message??`HTTP ${response.status}`)
  return body
}
const [item]=await request(`/inventory_items?organization_id=eq.${organizationId}&select=id,perfume_id,available_ml,perfumes(full_name_raw)&order=available_ml.desc&limit=1`)
const [client]=await request(`/clients?organization_id=eq.${organizationId}&select=id&limit=1`)
if(!item||!client)throw new Error('Dados controlados indisponíveis.')
const before=Number(item.available_ml)
let saleId
try{
  const [sale]=await request('/sales?select=id',{
    method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
      organization_id:organizationId,client_id:client.id,perfume_id:item.perfume_id,
      sale_date:new Date().toISOString().slice(0,10),amount:1,payment_status:'pending',
      source:'manual',sale_type:'SPLIT',volume_ml:1,volume_ml_raw:'1',
      perfume_name_raw:item.perfumes.full_name_raw,notes:'TESTE CONTROLADO DE ESTOQUE',
    }),
  })
  saleId=sale.id
  const [afterSale]=await request(`/inventory_items?id=eq.${item.id}&select=available_ml`)
  const saleMovements=await request(`/inventory_movements?sale_id=eq.${saleId}&select=id,movement_type,quantity_ml,balance_before,balance_after`)
  if(Number(afterSale.available_ml)!==before-1||saleMovements.filter((m)=>m.movement_type==='sale_out').length!==1)throw new Error('Abatimento ou idempotência divergente.')
  await request(`/sales?id=eq.${saleId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({notes:'TESTE CONTROLADO ATUALIZADO'})})
  const unchangedMovements=await request(`/inventory_movements?sale_id=eq.${saleId}&select=id`)
  if(unchangedMovements.length!==1)throw new Error('Atualização irrelevante duplicou o abatimento.')
  await request(`/sales?id=eq.${saleId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({payment_status:'cancelled'})})
  const [afterCancellation]=await request(`/inventory_items?id=eq.${item.id}&select=available_ml`)
  const finalMovements=await request(`/inventory_movements?sale_id=eq.${saleId}&select=id,movement_type,quantity_ml,balance_before,balance_after&order=created_at`)
  if(Number(afterCancellation.available_ml)!==before||finalMovements.length!==2)throw new Error('Estorno divergente.')
  await request(`/inventory_movements?sale_id=eq.${saleId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({sale_id:null,source:'controlled_test',notes:`Teste controlado concluído; venda temporária removida (${saleId})`})})
  await request(`/sales?id=eq.${saleId}`,{method:'DELETE'})
  saleId=null
  console.log(JSON.stringify({perfume:item.perfumes.full_name_raw,balance_before:before,balance_after_sale:before-1,balance_after_reversal:before,sale_out_movements:1,reversal_movements:1,idempotency:true,temporary_sale_removed:true,audit_preserved:true},null,2))
}finally{
  if(saleId){
    await request(`/inventory_movements?sale_id=eq.${saleId}`,{method:'PATCH',body:JSON.stringify({sale_id:null,source:'controlled_test',notes:`Limpeza de teste interrompido (${saleId})`})}).catch(()=>{})
    await request(`/sales?id=eq.${saleId}`,{method:'DELETE'}).catch(()=>{})
  }
}
