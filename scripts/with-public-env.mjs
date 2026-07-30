import { execFileSync, spawnSync } from 'node:child_process'

const projectRef = 'pfhvqkzafgoyumxmbwqc'
const [command, ...args] = process.argv.slice(2)
if (!command) throw new Error('Informe o comando que deve receber as variáveis públicas.')

const keys = JSON.parse(execFileSync('supabase', [
  'projects', 'api-keys', '--project-ref', projectRef, '--output', 'json',
], { encoding: 'utf8' }))
const publishableKey = keys.find((key) =>
  ['publishable', 'anon'].includes(key.name) || ['publishable', 'anon'].includes(key.type)
)?.api_key
if (!publishableKey) throw new Error('Chave pública do projeto não encontrada.')

const result = spawnSync(command, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_SUPABASE_URL: `https://${projectRef}.supabase.co`,
    VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  },
})
if (result.error) throw result.error
process.exit(result.status ?? 1)

