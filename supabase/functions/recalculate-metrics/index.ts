import { context, json, audit } from '../_shared/security.ts'
Deno.serve(async(req)=>{const ctx=await context(req);if('response'in ctx)return ctx.response;const{client,user,body,organizationId}=ctx
const{data,error}=await client.rpc('sales_metrics',{org_id:organizationId,start_date:String(body.period_start??''),end_date:String(body.period_end??'')})
if(error)return json({error:{code:'metrics_error',message:'Falha ao recalcular métricas.'}},500)
await audit(client,organizationId,user.id,'metrics_recalculated','organization',organizationId);return json({data})})
