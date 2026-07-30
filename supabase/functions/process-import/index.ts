import { context, json, audit } from '../_shared/security.ts'
Deno.serve(async (req) => {
  const ctx = await context(req); if ('response' in ctx) return ctx.response
  const { client,user,body,organizationId }=ctx
  const batchId=String(body.import_batch_id??'')
  const {data,error}=await client.from('import_batches').update({status:'validating'}).eq('id',batchId).eq('organization_id',organizationId).select().single()
  if(error)return json({error:{code:'batch_error',message:'Lote não encontrado ou inválido.'}},400)
  await audit(client,organizationId,user.id,'import_validation_started','import_batch',batchId)
  return json({data})
})
