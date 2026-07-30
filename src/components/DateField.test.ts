import { describe, expect, it } from 'vitest'
import { brazilianToIso, isoToBrazilian } from '../lib/date'

describe('calendário brasileiro', () => {
  it('converte exibição brasileira e persistência ISO', () => {
    expect(brazilianToIso('29/07/2026')).toBe('2026-07-29')
    expect(isoToBrazilian('2026-07-29')).toBe('29/07/2026')
  })
  it('rejeita datas impossíveis e aceita campo nulo', () => {
    expect(brazilianToIso('31/02/2026')).toBeNull()
    expect(isoToBrazilian('')).toBe('')
  })
})
