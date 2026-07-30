import { context, json, audit } from '../_shared/security.ts'
Deno.serve(async(req)=>{const ctx=await context(req);if('response'in ctx)return ctx.response;const{client,user,body,organizationId,role}=ctx
if(role==='viewer')return json({error:{code:'forbidden',message:'Perfil sem permissão para importar.'}},403)
const id=String(body.import_batch_id??'');const{data,error}=await client.from('import_batches').update({status:'processing'}).eq('id',id).eq('organization_id',organizationId).eq('status','awaiting_confirmation').select().single()
if(error)return json({error:{code:'invalid_state',message:'O lote não está aguardando confirmação.'}},409)
await audit(client,organizationId,user.id,'import_confirmed','import_batch',id);return json({data})})
