import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'

const projectRef = 'pfhvqkzafgoyumxmbwqc'
const files = globSync('dist/**/*.{js,css,html}')
const bundle = files.map((file) => readFileSync(file, 'utf8')).join('\n')
const forbidden = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'DATABASE_PASSWORD',
  'SENHA_DO_USUARIO',
]
const leakedNames = forbidden.filter((name) => bundle.includes(name))

if (!bundle.includes(`https://${projectRef}.supabase.co`)) {
  throw new Error('A URL pública do projeto não foi incorporada ao build.')
}
if (!/sb_publishable_|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(bundle)) {
  throw new Error('A chave pública não foi incorporada ao build.')
}
if (leakedNames.length) {
  throw new Error(`Referências administrativas encontradas no bundle: ${leakedNames.join(', ')}`)
}

console.log(JSON.stringify({
  url_configured: true,
  publishable_key_configured: true,
  environment: 'production',
  administrative_secrets_in_bundle: false,
}, null, 2))

