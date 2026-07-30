# RUAH Intelligence

CRM e inteligência comercial da RUAH Parfums. A base atual inclui interface responsiva, validação local de planilhas, arquitetura Supabase multiusuário, RLS, auditoria e Edge Functions protegidas para importações e IA.

## Executar localmente

Requisitos: Node.js 20+ e npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Sem variáveis, a interface abre em modo de simulação local e mostra somente os agregados reconciliados. Para conectar:

```env
VITE_SUPABASE_URL=https://pfhvqkzafgoyumxmbwqc.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA
```

Nunca coloque `SUPABASE_SERVICE_ROLE_KEY` ou `OPENAI_API_KEY` no frontend. Configure-as como secrets das Edge Functions.

## Supabase

Projeto confirmado:

- nome atual no painel: `parfumsruah@gmail.com's Project`;
- produto: RUAH Intelligence;
- project-ref: `pfhvqkzafgoyumxmbwqc`;
- URL: `https://pfhvqkzafgoyumxmbwqc.supabase.co`.

Comandos de manutenção:

```bash
supabase projects list
supabase link --project-ref pfhvqkzafgoyumxmbwqc
supabase db push
supabase functions deploy process-import
supabase functions deploy confirm-import
supabase functions deploy revert-import
supabase functions deploy generate-insights
supabase functions deploy ask-intelligence
supabase functions deploy recalculate-metrics
supabase secrets set OPENAI_API_KEY=...
```

As migrations criam:

- `organizations`, `profiles`, `organization_members`;
- `clients`, `sales`;
- `import_batches`, `import_rows`, `import_errors`;
- `ai_insights`, `ai_conversations`, `ai_messages`, `ai_runs`;
- `audit_logs`;
- `client_duplicate_candidates` e `client_merge_history`;
- bucket privado `commercial-imports`;
- funções de normalização, autorização e métricas oficiais;
- RLS por organização e papel (`admin`, `manager`, `operator`, `viewer`);
- auditoria automática de clientes, vendas e importações.

O frontend nunca envia a base bruta à IA. `ask-intelligence` chama `sales_metrics`, envia apenas agregados autorizados ao modelo, exige saída JSON estruturada e registra a execução.

## Planilha real validada

Comando reproduzível:

```bash
npm run validate:workbook -- "/caminho/JULHO - PLANILHA DE VENDAS.xlsx"
```

O script não altera a planilha e grava somente agregados sem nomes de clientes em `src/data/validation-report.json`. Uma linha com cliente e valor é preservada mesmo com data, status ou pagamento não padronizado. Alertas não eliminam registros, e duplicidades dependem de decisão humana.

Veja [docs/RECONCILIACAO.md](docs/RECONCILIACAO.md) para a conciliação financeira completa.

## Qualidade e segurança

```bash
npm run test
npm run lint
npm run build
npm audit --omit=dev
```

Arquivos `.xlsx` e `.csv` são aceitos. `.xls` legado não é aceito porque esta versão prioriza um parser sem os alertas de segurança encontrados na biblioteca inicialmente avaliada.

## Limites antes de produção

- As três migrations foram aplicadas ao project-ref confirmado e as seis Edge Functions estão ativas.
- A proteção anônima de RLS, bucket e JWT foi validada. Falta o teste de papéis com o primeiro usuário administrador.
- A carga da planilha continua bloqueada em simulação.
- Geração assíncrona completa de múltiplos insights deve ser finalizada após configurar o provedor de IA.
- Não houve publicação em produção.

## Vercel

Configure somente:

```env
VITE_SUPABASE_URL=https://pfhvqkzafgoyumxmbwqc.supabase.co
VITE_SUPABASE_ANON_KEY=definida diretamente na Vercel
```

Build command: `npm run build`. Diretório de saída: `dist`.

`SUPABASE_SERVICE_ROLE_KEY` e `OPENAI_API_KEY` pertencem exclusivamente aos secrets das Edge Functions e nunca à Vercel.
