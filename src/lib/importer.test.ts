import { describe, expect, it } from 'vitest'
import { normalizeClient, normalizeStatus, parseBrazilianMoney, parseDate, parseRows } from './importer'

describe('importação', () => {
  it('normaliza clientes sem unir nomes parecidos', () => {
    expect(normalizeClient('  ÁNA   Paula ')).toBe('ana paula')
    expect(normalizeClient('Ana Paula')).not.toBe(normalizeClient('Ana Paula Silva'))
  })
  it('interpreta moeda brasileira sem converter inválido em zero', () => {
    expect(parseBrazilianMoney('R$ 1.250,50')).toBe(1250.5)
    expect(parseBrazilianMoney('inválido')).toBeNull()
  })
  it('interpreta datas e status conhecidos', () => {
    expect(parseDate('07/07/2026')).toBe('2026-07-07')
    expect(normalizeStatus('PEDIDO CANCELADO')).toBe('cancelled')
    expect(normalizeStatus('PAGO')).toBe('paid')
  })
  it('preserva valores numéricos nativos do Excel', () => {
    expect(parseBrazilianMoney(1250.5)).toBe(1250.5)
  })
  it('mantém venda sem data na revisão em vez de descartá-la', () => {
    const preview = parseRows('teste.xlsx',['PERFUMES'],'PERFUMES',[
      ['CLIENTE','DATA','VALOR','PAGAMENTO','FORMA DE PAGAMENTO'],
      ['CLIENTE TESTE',null,100,'PAGO','PIX'],
    ])
    expect(preview.valid).toBe(1)
    expect(preview.rows[0].isImportable).toBe(true)
    expect(preview.rows[0].isAccountable).toBe(false)
    expect(preview.rows[0].warnings).toContain('Data inválida ou ausente')
  })
  it('mantém status e formas não padronizadas em revisão', () => {
    for (const method of ['PX','P','PP']) {
      const preview = parseRows('teste.xlsx',['PERFUMES'],'PERFUMES',[
        ['CLIENTE','DATA','VALOR','PAGAMENTO','FORMA DE PAGAMENTO'],
        ['CLIENTE TESTE',new Date('2026-07-01'),100,'STATUS LIVRE',method],
      ])
      expect(preview.valid).toBe(1)
      expect(preview.rows[0].paymentMethod).toBe(method)
      expect(preview.rows[0].paymentStatus).toBe('unknown')
    }
  })
  it('sinaliza duplicidade sem excluir nenhuma venda', () => {
    const header = ['CLIENTE','DATA','VALOR','PAGAMENTO','FORMA DE PAGAMENTO']
    const row = ['CLIENTE TESTE',new Date('2026-07-01'),100,'PAGO','PIX']
    const preview = parseRows('teste.xlsx',['PERFUMES'],'PERFUMES',[header,row,row])
    expect(preview.valid).toBe(2)
    expect(preview.duplicates).toBe(1)
    expect(preview.rows[1].isDuplicate).toBe(true)
  })
  it('cria o cliente comercial mesmo sem telefone', () => {
    const preview = parseRows('teste.xlsx',['PERFUMES'],'PERFUMES',[
      ['CLIENTE','DATA','VALOR','PAGAMENTO','FORMA DE PAGAMENTO'],
      ['CLIENTE SEM CONTATO',new Date('2026-07-01'),50,'PAGO','PIX'],
    ])
    expect(preview.uniqueClients).toBe(1)
    expect(preview.rows[0].client).toBe('CLIENTE SEM CONTATO')
  })
})
