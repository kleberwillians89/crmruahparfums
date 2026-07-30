import { FormEvent, useEffect, useState } from 'react'
import { Check, LoaderCircle, Plus, Search, X } from 'lucide-react'
import { DateField } from './DateField'
import { ClientInput, createClient, createSale, searchClients } from '../lib/records'
import { parseBrazilianMoney } from '../lib/importer'

const maskPhone = (v:string)=>v.replace(/\D/g,'').slice(0,11).replace(/^(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d)/,'$1-$2')
const maskCpf = (v:string)=>v.replace(/\D/g,'').slice(0,11).replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2')
const maskCep = (v:string)=>v.replace(/\D/g,'').slice(0,8).replace(/(\d{5})(\d)/,'$1-$2')

function Modal({ title, close, children }: { title:string; close:()=>void; children:React.ReactNode }) {
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}><button className="modal-scrim" onClick={close} aria-label="Fechar"/><div className="modal-panel"><div className="modal-title"><div><span>RUAH PARFUMS</span><h2>{title}</h2></div><button onClick={close}><X/></button></div>{children}</div></div>
}

export function ClientModal({ close, onSaved }: { close:()=>void; onSaved?: (client:{id:string;name:string})=>void }) {
  const [form,setForm]=useState<ClientInput>({name:'',status:'active'})
  const [birth,setBirth]=useState(''),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('')
  const set=(key:keyof ClientInput,value:string)=>setForm((x)=>({...x,[key]:value}))
  const submit=async(e:FormEvent)=>{e.preventDefault();setError('');if(!form.name.trim())return setError('Informe o nome completo.')
    setSaving(true);try{const data=await createClient({...form,birthDate:birth});setMessage('Cliente salvo com sucesso.');onSaved?.(data as {id:string;name:string});setTimeout(close,650)}catch(err){setError(err instanceof Error?err.message:'Falha ao salvar.')}finally{setSaving(false)}}
  return <Modal title="Adicionar cliente" close={close}><form onSubmit={submit} className="record-form">
    <div className="form-grid"><Field label="Nome completo *" value={form.name} onChange={(v)=>set('name',v)} wide/>
      <Field label="Telefone" value={form.phone} onChange={(v)=>set('phone',maskPhone(v))}/><Field label="E-mail" type="email" value={form.email} onChange={(v)=>set('email',v)}/>
      <Field label="Instagram" value={form.instagram} onChange={(v)=>set('instagram',v)}/><Field label="CPF" value={form.cpf} onChange={(v)=>set('cpf',maskCpf(v))}/>
      <DateField id="birth-date" label="Data de nascimento" value={birth} onChange={setBirth}/>
      <Field label="CEP" value={form.postalCode} onChange={(v)=>set('postalCode',maskCep(v))}/>
      <Field label="Endereço" value={form.address} onChange={(v)=>set('address',v)} wide/><Field label="Número" value={form.addressNumber} onChange={(v)=>set('addressNumber',v)}/>
      <Field label="Complemento" value={form.complement} onChange={(v)=>set('complement',v)}/><Field label="Bairro" value={form.district} onChange={(v)=>set('district',v)}/>
      <Field label="Cidade" value={form.city} onChange={(v)=>set('city',v)}/><Field label="Estado" value={form.state} onChange={(v)=>set('state',v.toUpperCase().slice(0,2))}/>
      <label className="field"><span>Status</span><select value={form.status} onChange={(e)=>set('status',e.target.value)}><option value="active">Ativo</option><option value="inactive">Inativo</option><option value="review">Em revisão</option></select></label>
      <label className="field wide"><span>Observações</span><textarea value={form.notes??''} onChange={(e)=>set('notes',e.target.value)}/></label>
    </div><FormFeedback error={error} message={message}/><FormActions close={close} saving={saving} label="Salvar cliente"/></form></Modal>
}

export function SaleModal({ close }: { close:()=>void }) {
  const [query,setQuery]=useState(''),[clients,setClients]=useState<{id:string;name:string}[]>([]),[client,setClient]=useState<{id:string;name:string}|null>(null)
  const [date,setDate]=useState(''),[amount,setAmount]=useState(''),[status,setStatus]=useState('paid'),[method,setMethod]=useState('PIX'),[notes,setNotes]=useState('')
  const [saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[newClient,setNewClient]=useState(false)
  useEffect(()=>{if(query.trim().length<2||client)return;const timer=setTimeout(()=>searchClients(query).then(setClients).catch(()=>setClients([])),250);return()=>clearTimeout(timer)},[query,client])
  const submit=async(e:FormEvent)=>{e.preventDefault();const value=parseBrazilianMoney(amount);if(!client)return setError('Selecione um cliente.');if(!date)return setError('Informe a data da venda.');if(value===null||value<0)return setError('Informe um valor válido.')
    setSaving(true);setError('');try{await createSale({clientId:client.id,date,amount:value,status,method,notes});setMessage('Venda salva e dashboard atualizado.');setTimeout(close,650)}catch(err){setError(err instanceof Error?err.message:'Falha ao salvar.')}finally{setSaving(false)}}
  return <>{newClient&&<ClientModal close={()=>setNewClient(false)} onSaved={(c)=>{setClient(c);setQuery(c.name);setNewClient(false)}}/>}<Modal title="Adicionar venda" close={close}><form onSubmit={submit} className="record-form">
    <div className="form-grid"><div className="field wide client-search"><label>Cliente *</label><div className="search-control"><Search/><input value={query} placeholder="Busque pelo nome" onChange={(e)=>{setQuery(e.target.value);setClient(null)}}/><button type="button" onClick={()=>setNewClient(true)}><Plus/> Criar cliente</button></div>
      {!client&&clients.length>0&&<div className="client-results">{clients.map((c)=><button type="button" key={c.id} onClick={()=>{setClient(c);setQuery(c.name);setClients([])}}>{c.name}</button>)}</div>}</div>
      <DateField id="sale-date" label="Data da venda" value={date} onChange={setDate} required error={!date&&error?'Data obrigatória.':''}/>
      <Field label="Valor *" value={amount} onChange={setAmount} placeholder="R$ 0,00"/>
      <label className="field"><span>Status do pagamento</span><select value={status} onChange={(e)=>setStatus(e.target.value)}><option value="paid">Pago</option><option value="pending">Aguardando</option><option value="cancelled">Cancelado</option><option value="unknown">Em revisão</option></select></label>
      <label className="field"><span>Forma de pagamento</span><select value={method} onChange={(e)=>setMethod(e.target.value)}><option>PIX</option><option>CARTÃO DE CRÉDITO</option><option>DEPÓSITO</option><option>CRÉDITO E PIX</option><option>OUTRO</option></select></label>
      <label className="field wide"><span>Observação</span><textarea value={notes} onChange={(e)=>setNotes(e.target.value)}/></label></div>
      <FormFeedback error={error} message={message}/><FormActions close={close} saving={saving} label="Salvar venda"/></form></Modal></>
}

function Field({label,value='',onChange,wide,type='text',placeholder}: {label:string;value?:string;onChange:(v:string)=>void;wide?:boolean;type?:string;placeholder?:string}) {
  return <label className={`field ${wide?'wide':''}`}><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(e)=>onChange(e.target.value)}/></label>
}
function FormFeedback({error,message}:{error:string;message:string}) { return <>{error&&<div className="form-error">{error}</div>}{message&&<div className="form-success"><Check/> {message}</div>}</> }
function FormActions({close,saving,label}:{close:()=>void;saving:boolean;label:string}) { return <div className="form-actions"><button type="button" onClick={close}>Cancelar</button><button className="primary" disabled={saving}>{saving?<LoaderCircle className="spin"/>:<Check/>}{saving?'Salvando…':label}</button></div> }
