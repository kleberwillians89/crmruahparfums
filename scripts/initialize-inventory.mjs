import { execFileSync } from 'node:child_process'

const projectRef='pfhvqkzafgoyumxmbwqc'
const organizationId='032fd96e-638f-428b-8cc2-37afc71e10ea'
const batchId='48cb359b-6133-4034-b914-64b0bbd4717e'
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'}))
const serviceKey=keys.find((key)=>key.name==='service_role'||key.type==='service_role')?.api_key
if(!serviceKey)throw new Error('Credencial administrativa indisponível.')
const response=await fetch(`https://${projectRef}.supabase.co/rest/v1/rpc/initialize_inventory_from_stock_rows`,{
  method:'POST',
  headers:{apikey:serviceKey,authorization:`Bearer ${serviceKey}`,'content-type':'application/json'},
  body:JSON.stringify({p_organization_id:organizationId,p_batch_id:batchId}),
})
const body=await response.json()
if(!response.ok)throw new Error(body.message??`HTTP ${response.status}`)
console.log(JSON.stringify(body,null,2))
