import { execFileSync } from 'node:child_process'

const projectRef='pfhvqkzafgoyumxmbwqc'
const batchId='48cb359b-6133-4034-b914-64b0bbd4717e'
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'}))
const serviceKey=keys.find((key)=>key.name==='service_role'||key.type==='service_role')?.api_key
if(!serviceKey)throw new Error('Credencial administrativa indisponível.')
const headers={apikey:serviceKey,authorization:`Bearer ${serviceKey}`}
const response=await fetch(`https://${projectRef}.supabase.co/rest/v1/import_rows?import_batch_id=eq.${batchId}&row_type=eq.stock&select=row_number,raw_data,normalized_data&order=row_number`,{headers})
if(!response.ok)throw new Error(`Consulta falhou: HTTP ${response.status}`)
const rows=await response.json()
const normalize=(value)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase()
const result=rows.map((row)=>{
  const raw=row.raw_data??{},normalized=row.normalized_data??{}
  const perfume=normalized.perfume_name_raw??raw.PERFUME??raw.Perfume??''
  const ml=Number(normalized.volume_ml??raw.ML??0)
  return {
    row_number:row.row_number,perfume,normalized_perfume:normalize(perfume),ml,
    date:normalized.sale_date??raw.DATA??null,
    original_value:raw.VALOR??normalized.amount??null,
  }
})
const totalMl=result.reduce((sum,row)=>sum+row.ml,0)
const uniquePerfumes=new Set(result.map((row)=>row.normalized_perfume)).size
console.log(JSON.stringify({batch_id:batchId,rows:result,row_count:result.length,unique_perfumes:uniquePerfumes,total_ml:totalMl,valid:result.length===15&&totalMl===78},null,2))
if(result.length!==15||totalMl!==78)process.exitCode=2
