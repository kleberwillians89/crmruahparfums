import { context, json, audit } from '../_shared/security.ts'
Deno.serve(async(req)=>{const ctx=await context(req);if('response'in ctx)return ctx.response;const{client,user,body,organizationId,role}=ctx
if(!['admin','manager'].includes(role))return json({error:{code:'forbidden',message:'Apenas administradores e gestores podem reverter.'}},403)
const id=String(body.import_batch_id??'');const{error}=await client.from('sales').update({deleted_at:new Date().toISOString()}).eq('organization_id',organizationId).eq('import_batch_id',id).is('deleted_at',null)
if(error)return json({error:{code:'revert_failed',message:'Não foi possível reverter o lote.'}},500)
await client.from('import_batches').update({status:'reverted',reverted_at:new Date().toISOString()}).eq('id',id).eq('organization_id',organizationId)
await audit(client,organizationId,user.id,'import_reverted','import_batch',id);return json({data:{id,status:'reverted'}})})
