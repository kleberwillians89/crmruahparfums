import { describe, expect, it } from 'vitest'
import { presetPeriod } from './period'
import { shortDate } from './format'

describe('períodos comerciais em pt-BR', () => {
  const now=new Date(2026,6,29,12)
  it('calcula atalhos sem deslocamento UTC',()=>{
    expect(presetPeriod('today',now)).toMatchObject({start:'2026-07-29',end:'2026-07-29'})
    expect(presetPeriod('7d',now)).toMatchObject({start:'2026-07-23',end:'2026-07-29'})
    expect(presetPeriod('month',now)).toMatchObject({start:'2026-07-01',end:'2026-07-29'})
  })
  it('calcula mês anterior e trimestre',()=>{
    expect(presetPeriod('previous_month',now)).toMatchObject({start:'2026-06-01',end:'2026-06-30'})
    expect(presetPeriod('quarter',now)).toMatchObject({start:'2026-07-01',end:'2026-07-29'})
  })
  it('formata ISO como DD/MM/AAAA sem mudar o dia',()=>{
    expect(shortDate('2026-07-01')).toBe('01/07/2026')
  })
})
