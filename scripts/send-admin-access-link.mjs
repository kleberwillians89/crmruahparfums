import { execFileSync } from 'node:child_process'

const projectRef='pfhvqkzafgoyumxmbwqc'
const email=process.argv[2]?.trim().toLowerCase()
if(!email)throw new Error('Informe o e-mail.')
const keys=JSON.parse(execFileSync('supabase',['projects','api-keys','--project-ref',projectRef,'--output','json'],{encoding:'utf8'}))
const publicKey=keys.find((key)=>['anon','publishable'].includes(key.name)||['anon','publishable'].includes(key.type))?.api_key
if(!publicKey)throw new Error('Chave pública não encontrada.')
const redirect='http://localhost:5173/auth/callback?next=atualizar-senha'
const response=await fetch(`https://${projectRef}.supabase.co/auth/v1/recover?redirect_to=${encodeURIComponent(redirect)}`,{
  method:'POST',headers:{apikey:publicKey,'content-type':'application/json'},body:JSON.stringify({email}),
})
if(!response.ok){const body=await response.json();throw new Error(body.msg||body.message||'Falha ao enviar link.')}
console.log(JSON.stringify({email,flow:'secure_password_setup',callback:redirect,sent:true,sent_at:new Date().toISOString()},null,2))
