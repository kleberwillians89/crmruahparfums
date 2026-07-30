import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import {
  Bell, Bot, CalendarDays, ChartNoAxesCombined, Check, ChevronDown, CircleHelp,
  Clock3, FileSpreadsheet, Home, Import, Lightbulb, Menu,
  MoreHorizontal, Plus, Search, Settings, ShoppingBag, Sparkles, TrendingUp,
  UploadCloud, UserRound, UsersRound, X, AlertTriangle, ArrowUpRight,
} from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { brl, integer, monthLabel, shortDate } from './lib/format'
import { ImportPreview, ParsedSale, readWorkbook } from './lib/importer'
import report from './data/validation-report.json'
import { ClientModal, SaleModal } from './components/RecordModals'
import {
  ClientCommercialSummary, CommercialSale, DashboardMetrics,
  PerfumeCommercialSummary, fetchClientSummaries, fetchDashboardMetrics,
  fetchPerfumeSummaries, fetchSalesPage,
} from './lib/records'

type Page = 'Visão Geral' | 'Clientes' | 'Vendas' | 'Perfumes' | 'Importar Dados' | 'RUAH Intelligence' | 'Insights' | 'Configurações'
const navigation: { label: Page; icon: typeof Home }[] = [
  { label: 'Visão Geral', icon: Home }, { label: 'Clientes', icon: UsersRound },
  { label: 'Vendas', icon: ShoppingBag }, { label: 'Perfumes', icon: Sparkles },
  { label: 'Importar Dados', icon: Import },
  { label: 'RUAH Intelligence', icon: Sparkles }, { label: 'Insights', icon: Lightbulb },
  { label: 'Configurações', icon: Settings },
]

const statusLabel: Record<string, string> = { paid: 'Pago', pending: 'Aguardando', cancelled: 'Cancelado', unknown: 'Desconhecido' }

function Sidebar({ page, setPage, open, close }: { page: Page; setPage: (p: Page) => void; open: boolean; close: () => void }) {
  return <>
    {open && <button className="scrim" aria-label="Fechar menu" onClick={close} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand"><img src="/ruah-logo.jpg" alt="RUAH Parfums" /><div><strong>RUAH</strong><span>INTELLIGENCE</span></div></div>
      <nav>{navigation.map(({ label, icon: Icon }) =>
        <button key={label} className={page === label ? 'active' : ''} onClick={() => { setPage(label); close() }}>
          <Icon size={19} /><span>{label}</span>{label === 'RUAH Intelligence' && <i>IA</i>}
        </button>)}
      </nav>
      <div className="sidebar-foot">
        <div className="workspace-mark">RP</div>
        <div><strong>RUAH Parfums</strong><span>Administrador</span></div>
        <MoreHorizontal size={18} />
      </div>
    </aside>
  </>
}

function Header({ page, menu }: { page: Page; menu: () => void }) {
  return <header>
    <button className="icon-button mobile-menu" onClick={menu}><Menu size={21} /></button>
    <div><p>CRM E INTELIGÊNCIA COMERCIAL</p><h1>{page}</h1></div>
    <div className="header-actions">
      <button className="icon-button"><CircleHelp size={20} /></button>
      <button className="icon-button notification"><Bell size={20} /><i /></button>
      <span className="avatar">KP</span>
    </div>
  </header>
}

function EmptyConnect({ title, text }: { title: string; text: string }) {
  return <div className="empty card">
    <div className="empty-icon"><ChartNoAxesCombined /></div><h3>{title}</h3><p>{text}</p>
    <button className="primary"><Settings size={17} /> Configurar Supabase</button>
  </div>
}

function Metric({ label, value, detail, icon: Icon, tone = 'gold' }: { label: string; value: string; detail: string; icon: typeof Home; tone?: string }) {
  return <article className="metric card">
    <div className={`metric-icon ${tone}`}><Icon size={19} /></div>
    <div className="metric-top"><span>{label}</span><button><MoreHorizontal size={17} /></button></div>
    <strong>{value}</strong><small>{detail}</small>
  </article>
}

function Dashboard() {
  const [live,setLive]=useState<DashboardMetrics|null>(null)
  const [loadError,setLoadError]=useState('')
  useEffect(()=>{fetchDashboardMetrics().then(setLive).catch(()=>setLoadError('Não foi possível consultar o Supabase.'))},[])
  const hasData = Boolean(live?.sales)
  const paid = Number(live?.paid ?? 0)
  const pending = Number(live?.pending ?? 0)
  const cancelled = Number(live?.cancelled ?? 0)
  const total = paid + pending + cancelled
  const paymentData = report.paymentMethods.map((x: { name: string; value: number }) => x)
  const colors = ['#bf9636', '#332f29', '#817768', '#ded6c8', '#9f7c2b']
  return <div className="page">
    <div className="page-lead">
      <div><h2>O pulso comercial da RUAH</h2><p>Indicadores consolidados para decisões mais precisas.</p></div>
      <button className="date-filter"><CalendarDays size={17} /> Todo o período <ChevronDown size={16} /></button>
    </div>
    {loadError && <div className="notice"><AlertTriangle size={18} /><span>{loadError}</span></div>}
    <section className="metrics">
      <Metric label="Volume bruto da base" value={hasData ? brl(Number(live!.raw_gross)) : '—'} detail={hasData ? `${integer(Number(live!.batch_rows))} linhas preservadas` : 'Sem dados sincronizados'} icon={ChartNoAxesCombined} />
      <Metric label="Faturamento contabilizado" value={hasData ? brl(paid+pending) : '—'} detail={hasData ? 'Pagos + aguardando' : 'Sem dados sincronizados'} icon={TrendingUp} />
      <Metric label="Valor pago" value={hasData ? brl(paid) : '—'} detail={hasData ? `${integer(Number(live!.paid_rows))} vendas` : 'Aguardando importação'} icon={Check} tone="dark" />
      <Metric label="Aguardando pagamento" value={hasData ? brl(pending) : '—'} detail={hasData ? `${integer(Number(live!.pending_rows))} vendas` : 'Aguardando importação'} icon={Clock3} tone="sand" />
      <Metric label="Cancelado" value={hasData ? brl(cancelled) : '—'} detail={hasData ? 'Fora do faturamento' : 'Aguardando importação'} icon={X} tone="cream" />
      <Metric label="Status em revisão" value={hasData ? brl(Number(live!.review)) : '—'} detail={hasData ? `${integer(Number(live!.review_rows))} registros` : 'Aguardando importação'} icon={AlertTriangle} tone="cream" />
    </section>
    {hasData && <section className="coverage card">
      <div><span>Cobertura financeira</span><strong>{(((Number(live!.paid_rows)+Number(live!.pending_rows))/Number(live!.sales))*100).toFixed(1).replace('.',',')}%</strong></div>
      <div><span>Total de registros</span><strong>{integer(Number(live!.batch_rows))}</strong></div>
      <div><span>Vendas</span><strong>{integer(Number(live!.sales))}</strong></div>
      <div><span>Estoque</span><strong>{integer(Number(live!.stock_rows))}</strong></div>
      <div><span>Possíveis duplicidades</span><strong>{integer(Number(live!.possible_duplicates))}</strong></div>
      <div><span>Última venda</span><strong>{live!.last_sale?shortDate(`${live!.last_sale}T12:00:00`):'—'}</strong></div>
    </section>}
    <section className="dashboard-grid">
      <div className="card chart-card">
        <div className="card-title"><div><h3>Evolução de faturamento</h3><p>Receita mensal da base validada</p></div><span className="live-dot">DADOS REAIS</span></div>
        {hasData ? <ResponsiveContainer width="100%" height={260}><AreaChart data={report.monthly}>
          <defs><linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#bf9636" stopOpacity={0.28}/><stop offset="100%" stopColor="#bf9636" stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid stroke="#eee9e1" vertical={false}/><XAxis dataKey="month" tickFormatter={monthLabel} axisLine={false} tickLine={false}/><YAxis tickFormatter={(v) => `${Math.round(v/1000)}k`} axisLine={false} tickLine={false}/>
          <Tooltip formatter={(v) => brl(Number(v))} labelFormatter={monthLabel}/><Area type="monotone" dataKey="revenue" stroke="#b68a25" strokeWidth={2.5} fill="url(#goldFill)"/>
        </AreaChart></ResponsiveContainer> : <ChartPlaceholder />}
      </div>
      <div className="card chart-card">
        <div className="card-title"><div><h3>Status dos pagamentos</h3><p>Distribuição do valor comercial</p></div></div>
        {hasData && total ? <div className="payment-chart">
          <ResponsiveContainer width="52%" height={220}><PieChart><Pie data={[{name:'Pago',value:paid},{name:'Aguardando',value:pending},{name:'Cancelado',value:cancelled}]} innerRadius={67} outerRadius={88} dataKey="value" stroke="none">
            {[0,1,2].map((_, i)=><Cell key={i} fill={colors[i]}/>)}</Pie><Tooltip formatter={(v)=>brl(Number(v))}/></PieChart></ResponsiveContainer>
          <div className="legend">{[['Pago',paid],['Aguardando',pending],['Cancelado',cancelled]].map((x,i)=><div key={String(x[0])}><i style={{background:colors[i]}}/><span>{x[0]}</span><strong>{brl(Number(x[1]))}</strong></div>)}</div>
        </div> : <ChartPlaceholder />}
      </div>
      <div className="card chart-card payments">
        <div className="card-title"><div><h3>Formas de pagamento</h3><p>Preferências na base comercial</p></div></div>
        {hasData ? <ResponsiveContainer width="100%" height={235}><BarChart layout="vertical" data={paymentData.slice(0,5)} margin={{left: 15}}>
          <CartesianGrid horizontal={false} stroke="#eee9e1"/><XAxis type="number" hide/><YAxis type="category" dataKey="name" width={125} axisLine={false} tickLine={false} tick={{fontSize:12}}/><Tooltip formatter={(v)=>integer(Number(v))}/>
          <Bar dataKey="value" fill="#b68a25" radius={[0,5,5,0]} barSize={15}/></BarChart></ResponsiveContainer> : <ChartPlaceholder compact />}
      </div>
      <div className="card intelligence-card">
        <div className="ai-orb"><Sparkles size={22}/></div><span>RUAH INTELLIGENCE</span>
        <h3>Uma leitura inteligente da sua operação.</h3>
        <p>{hasData ? `A base possui ${integer(report.valid)} vendas válidas. Gere análises após confirmar a importação no Supabase.` : 'Quando os dados estiverem conectados, a IA encontrará tendências, riscos e oportunidades sem expor informações desnecessárias.'}</p>
        <button>Conversar com a inteligência <ArrowUpRight size={16}/></button>
      </div>
    </section>
  </div>
}

function ChartPlaceholder({ compact = false }: { compact?: boolean }) {
  return <div className={`chart-placeholder ${compact ? 'compact' : ''}`}><ChartNoAxesCombined size={25}/><span>Aguardando dados reais</span></div>
}

function ImportPage() {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setLoading(true); setError('')
    try {
      const result = await readWorkbook(file)
      setPreview(result.preview)
    } catch { setError('Não foi possível ler o arquivo. Verifique o formato e tente novamente.') }
    finally { setLoading(false) }
  }
  return <div className="page">
    <div className="page-lead"><div><h2>Importar dados comerciais</h2><p>Valide cada linha antes de levar as vendas ao Supabase.</p></div></div>
    {!preview ? <label className="dropzone">
      <input type="file" accept=".xlsx,.csv" onChange={handleFile}/>
      <div className="upload-icon"><UploadCloud/></div>
      <h3>{loading ? 'Lendo planilha…' : 'Arraste sua planilha ou clique para selecionar'}</h3>
      <p>Arquivos XLSX ou CSV · o arquivo original nunca será alterado</p>
      <span className="primary"><FileSpreadsheet size={17}/> Selecionar arquivo</span>
      {error && <em>{error}</em>}
    </label> : <ImportReview preview={preview} reset={() => setPreview(null)} />}
    <div className="security-note"><div><Check size={17}/></div><p><strong>Importação protegida</strong><span>Nenhuma venda será inserida antes da sua confirmação. Em produção, o arquivo fica em bucket privado.</span></p></div>
  </div>
}

function ImportReview({ preview, reset }: { preview: ImportPreview; reset: () => void }) {
  const [filter, setFilter] = useState<'all'|'valid'|'error'>('all')
  const rows = preview.rows.filter((r) => filter === 'all' || (filter === 'valid' ? r.isAccountable : !r.isAccountable))
  return <div className="import-review">
    <div className="file-line card"><div className="file-icon"><FileSpreadsheet/></div><div><strong>{preview.fileName}</strong><span>{preview.sheets.length} abas · aba selecionada: {preview.selectedSheet}</span></div><button onClick={reset}><X size={18}/></button></div>
    <div className="import-steps"><span className="done"><Check/> Arquivo</span><i/><span className="current">2</span><b>Validar</b><i/><span>3</span><b>Confirmar</b></div>
    <section className="import-stats">
      <div><span>Linhas lidas</span><strong>{integer(preview.totalRows)}</strong></div>
      <div className="success"><span>Importáveis</span><strong>{integer(preview.valid)}</strong></div>
      <div className="danger"><span>Impossíveis</span><strong>{integer(preview.rejected)}</strong></div>
      <div className="warning"><span>Duplicidades</span><strong>{integer(preview.duplicates)}</strong></div>
      <div><span>Clientes</span><strong>{integer(preview.uniqueClients)}</strong></div>
      <div><span>Volume bruto</span><strong>{brl(preview.importedValue)}</strong></div>
    </section>
    <div className="card preview-card">
      <div className="preview-head"><div><h3>Prévia da validação</h3><p>Confira alertas antes de confirmar.</p></div>
        <div className="tabs">{(['all','valid','error'] as const).map((x)=><button className={filter===x?'selected':''} onClick={()=>setFilter(x)} key={x}>{x==='all'?'Todas':x==='valid'?'Válidas':'Revisar'}</button>)}</div>
      </div>
      <div className="table-wrap"><table><thead><tr><th>Linha</th><th>Cliente</th><th>Data</th><th>Valor</th><th>Status</th><th>Pagamento</th><th>Validação</th></tr></thead>
        <tbody>{rows.slice(0,25).map((r)=><PreviewRow key={r.row} row={r}/>)}</tbody></table></div>
      <div className="table-foot"><span>Exibindo {Math.min(rows.length,25)} de {integer(rows.length)} linhas</span><button className="primary" disabled={preview.valid === 0}>Confirmar linhas válidas <ArrowUpRight size={16}/></button></div>
    </div>
  </div>
}

function PreviewRow({ row }: { row: ParsedSale }) {
  const issues = [...row.blockers, ...row.warnings]
  return <tr><td>{row.row}</td><td><strong>{row.client || '—'}</strong></td><td>{row.date || '—'}</td><td>{row.amount === null ? '—' : brl(row.amount)}</td><td><span className={`badge ${row.paymentStatus}`}>{statusLabel[row.paymentStatus]}</span></td><td>{row.paymentMethod || '—'}</td><td>{issues.length ? <span className="row-error"><AlertTriangle/> {issues.join(', ')}</span> : <span className="row-ok"><Check/> Contabilizável</span>}</td></tr>
}

function Intelligence() {
  const suggestions = ['Quanto faturamos neste mês?', 'Quais oportunidades comerciais existem?', 'Como está a qualidade dos dados?', 'Que ação devemos priorizar agora?']
  return <div className="page intelligence-page">
    <div className="intelligence-hero"><div className="hero-spark"><Sparkles/></div><span>RUAH INTELLIGENCE</span><h2>Decisões mais claras começam<br/>com as perguntas certas.</h2><p>Respostas baseadas exclusivamente nos dados autorizados da sua operação.</p></div>
    <div className="chat-box card">
      <div className="chat-empty"><Bot/><h3>Como posso ajudar hoje?</h3><p>Escolha uma sugestão ou escreva uma pergunta sobre os dados da RUAH.</p></div>
      <div className="suggestions">{suggestions.map(x=><button key={x}>{x}<ArrowUpRight size={14}/></button>)}</div>
      <div className="chat-input"><input placeholder="Pergunte sobre faturamento, clientes, pagamentos…"/><button><ArrowUpRight/></button></div>
      <small><span className="dot"/> A IA só acessa métricas agregadas e autorizadas</small>
    </div>
  </div>
}

function Insights() {
  return <div className="page"><div className="page-lead"><div><h2>Insights comerciais</h2><p>Recomendações práticas geradas a partir de métricas oficiais.</p></div><button className="primary"><Sparkles size={17}/> Gerar novos insights</button></div>
    <div className="insight-grid">
      {['Receita','Recorrência','Oportunidade'].map((x,i)=><article className="card insight-skeleton" key={x}><div><span>{x}</span><i>{i===0?'ALTO':i===1?'MÉDIO':'NOVO'}</i></div><h3>{report.valid ? 'Pronto para interpretar a base validada' : 'Aguardando dados para uma análise confiável'}</h3><p>A inteligência não inventará números. Conecte o Supabase e gere a análise quando houver métricas autorizadas.</p><footer><Clock3 size={14}/> Ainda não gerado</footer></article>)}
    </div>
    {!report.valid && <EmptyConnect title="Seus insights aparecerão aqui" text="Após a primeira importação, a RUAH Intelligence poderá identificar tendências e oportunidades."/>}
  </div>
}

function GenericPage({ page }: { page: Page }) {
  const [modal,setModal]=useState(false)
  const config = {
    Clientes: ['Clientes','Relacionamento, recorrência e histórico em um só lugar.',UserRound],
    Vendas: ['Vendas','Acompanhe cada venda, pagamento e alteração com segurança.',ShoppingBag],
    Configurações: ['Configurações','Organização, membros, integrações e preferências.',Settings],
  }[page as 'Clientes'] as [string,string,typeof Home]
  const Icon = config[2]
  return <div className="page">{modal&&page==='Clientes'&&<ClientModal close={()=>setModal(false)}/>}
    {modal&&page==='Vendas'&&<SaleModal close={()=>setModal(false)}/>}
    <div className="page-lead"><div><h2>{config[0]}</h2><p>{config[1]}</p></div>{page!=='Configurações'&&<button className="primary" onClick={()=>setModal(true)}><Plus size={17}/> {page==='Clientes'?'Adicionar cliente':'Adicionar venda'}</button>}</div>
    <div className="toolbar card"><div className="search"><Search size={18}/><input placeholder={`Buscar em ${page.toLowerCase()}…`}/></div><button><CalendarDays size={17}/> Período</button><button><ChevronDown size={16}/> Filtros</button></div>
    <div className="empty card"><div className="empty-icon"><Icon/></div><h3>Nenhum dado sincronizado</h3><p>Conecte o projeto Supabase da RUAH e faça a primeira importação segura.</p><button className="primary" onClick={()=>setModal(true)}><Plus size={17}/> {page==='Clientes'?'Adicionar cliente':page==='Vendas'?'Adicionar venda':'Configurar'}</button></div>
  </div>
}

function ClientsPage() {
  const [modal,setModal]=useState(false)
  const [clients,setClients]=useState<ClientCommercialSummary[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  useEffect(()=>{fetchClientSummaries().then(setClients).catch(()=>setError('Não foi possível consultar os clientes.')).finally(()=>setLoading(false))},[])
  return <div className="page">{modal&&<ClientModal close={()=>setModal(false)}/>}
    <div className="page-lead"><div><h2>Clientes</h2><p>Relacionamento, recorrência e histórico em um só lugar.</p></div><button className="primary" onClick={()=>setModal(true)}><Plus size={17}/> Adicionar cliente</button></div>
    {loading?<div className="empty card"><h3>Carregando clientes do Supabase…</h3></div>:error?<div className="notice"><AlertTriangle size={18}/><span>{error}</span></div>:
    <div className="card clients-table"><div className="clients-caption"><div><strong>{integer(clients.length)} clientes</strong><span>Ordenados por valor pago, do maior para o menor</span></div><span className="live-dot">SUPABASE</span></div>
      <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Total comprado</th><th>Pago</th><th>Aguardando</th><th>Itens</th><th>ML</th><th>Perfumes</th><th>Tipos</th><th>Ticket médio</th><th>Primeira compra</th><th>Última compra</th></tr></thead>
      <tbody>{clients.map((c)=><tr key={c.client_id}><td><strong>{c.client}</strong></td><td>{brl(Number(c.total_purchased))}</td><td>{brl(Number(c.paid))}</td><td>{brl(Number(c.pending))}</td><td>{integer(Number(c.item_count))}</td><td>{Number(c.total_ml).toLocaleString('pt-BR')} ml</td><td title={(c.perfumes??[]).join(', ')}>{(c.perfumes??[]).slice(0,2).join(', ')||'—'}</td><td>{(c.sale_types??[]).join(' / ')||'—'}</td><td>{brl(Number(c.average_ticket))}</td><td>{c.first_purchase?shortDate(`${c.first_purchase}T12:00:00`):'—'}</td><td>{c.last_purchase?shortDate(`${c.last_purchase}T12:00:00`):'—'}</td></tr>)}</tbody></table></div>
    </div>}
  </div>
}

function SalesPage() {
  const [modal,setModal]=useState(false)
  const [sales,setSales]=useState<CommercialSale[]>([])
  const [count,setCount]=useState(0)
  const [error,setError]=useState('')
  useEffect(()=>{fetchSalesPage().then((result)=>{setSales(result.rows);setCount(result.count)}).catch(()=>setError('Não foi possível consultar as vendas.'))},[])
  return <div className="page">{modal&&<SaleModal close={()=>setModal(false)}/>}
    <div className="page-lead"><div><h2>Vendas</h2><p>Dados consultados diretamente no Supabase.</p></div><button className="primary" onClick={()=>setModal(true)}><Plus size={17}/> Adicionar venda</button></div>
    {error?<div className="notice"><AlertTriangle size={18}/><span>{error}</span></div>:
    <div className="card clients-table"><div className="clients-caption"><div><strong>{integer(count)} vendas</strong><span>Exibindo as 200 mais recentes</span></div><span className="live-dot">SUPABASE</span></div>
      <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Data</th><th>Perfume</th><th>Frasco</th><th>Tipo</th><th>ML</th><th>Valor</th><th>Pagamento</th><th>Forma</th><th>Data pagmt.</th><th>Prazo/status envio</th><th>Enviado em</th><th>Observação</th></tr></thead>
      <tbody>{sales.map((sale)=><tr key={sale.id}><td><strong>{sale.clients?.name??sale.original_client??'—'}</strong></td><td>{sale.sale_date?shortDate(`${sale.sale_date}T12:00:00`):'—'}</td><td>{sale.perfume_name_raw??'—'}</td><td>{sale.bottle_identifier??'—'}</td><td>{sale.sale_type??'—'}</td><td>{sale.volume_ml===null?'Revisar':`${Number(sale.volume_ml).toLocaleString('pt-BR')} ml`}</td><td>{brl(Number(sale.amount))}</td><td><span className={`badge ${sale.payment_status}`}>{statusLabel[sale.payment_status]}</span></td><td>{sale.payment_method??'—'}</td><td>{sale.paid_at?shortDate(`${sale.paid_at}T12:00:00`):'—'}</td><td>{sale.shipping_deadline_raw||sale.shipping_operational_status||'—'}</td><td>{sale.shipped_at?shortDate(`${sale.shipped_at}T12:00:00`):'—'}</td><td>{sale.notes??'—'}</td></tr>)}</tbody></table></div>
    </div>}
  </div>
}

function PerfumesPage() {
  const [perfumes,setPerfumes]=useState<PerfumeCommercialSummary[]>([])
  const [search,setSearch]=useState('')
  const [type,setType]=useState('')
  const [error,setError]=useState('')
  useEffect(()=>{fetchPerfumeSummaries().then(setPerfumes).catch(()=>setError('Não foi possível consultar os perfumes.'))},[])
  const visible=perfumes.filter((item)=>item.perfume_name.toLowerCase().includes(search.toLowerCase())
    && (!type||(item.sale_types??[]).includes(type)))
  return <div className="page"><div className="page-lead"><div><h2>Perfumes</h2><p>Itens, frascos, volumes, clientes e operação de envio.</p></div></div>
    <div className="toolbar card"><div className="search"><Search size={18}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Filtrar por perfume ou frasco…"/></div>
      <button className={!type?'active':''} onClick={()=>setType('')}>Todos</button><button onClick={()=>setType('APC')}>APC</button><button onClick={()=>setType('SPLIT')}>SPLIT</button></div>
    {error?<div className="notice"><AlertTriangle size={18}/><span>{error}</span></div>:
    <div className="card clients-table"><div className="clients-caption"><div><strong>{integer(visible.length)} referências</strong><span>Frascos diferentes permanecem separados</span></div><span className="live-dot">SUPABASE</span></div>
      <div className="table-wrap"><table><thead><tr><th>Perfume</th><th>Frasco</th><th>Tipos</th><th>ML total</th><th>ML pago</th><th>ML aguardando</th><th>Estoque</th><th>Clientes</th><th>Itens</th><th>Valor total</th><th>Pago</th><th>Aguardando</th><th>Status de envio</th></tr></thead>
      <tbody>{visible.map((item)=><tr key={item.perfume_id}><td><strong>{item.perfume_name}</strong></td><td>{item.bottle_identifier??'—'}</td><td>{(item.sale_types??[]).join(' / ')||'—'}</td><td>{Number(item.total_ml).toLocaleString('pt-BR')} ml</td><td>{Number(item.paid_ml).toLocaleString('pt-BR')} ml</td><td>{Number(item.pending_ml).toLocaleString('pt-BR')} ml</td><td>{Number(item.stock_ml).toLocaleString('pt-BR')} ml · {integer(Number(item.stock_items))} itens</td><td>{integer(Number(item.client_count))}</td><td>{integer(Number(item.item_count))}</td><td>{brl(Number(item.total_value))}</td><td>{brl(Number(item.paid_value))}</td><td>{brl(Number(item.pending_value))}</td><td>{(item.shipping_statuses??[]).join(', ')||'—'}</td></tr>)}</tbody></table></div>
    </div>}
  </div>
}

export function App() {
  const [page, setPage] = useState<Page>('Visão Geral')
  const [menuOpen, setMenuOpen] = useState(false)
  const content = useMemo<ReactNode>(() => {
    if (page === 'Visão Geral') return <Dashboard/>
    if (page === 'Clientes') return <ClientsPage/>
    if (page === 'Vendas') return <SalesPage/>
    if (page === 'Perfumes') return <PerfumesPage/>
    if (page === 'Importar Dados') return <ImportPage/>
    if (page === 'RUAH Intelligence') return <Intelligence/>
    if (page === 'Insights') return <Insights/>
    return <GenericPage page={page}/>
  }, [page])
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} open={menuOpen} close={()=>setMenuOpen(false)}/><main><Header page={page} menu={()=>setMenuOpen(true)}/>{content}</main></div>
}
