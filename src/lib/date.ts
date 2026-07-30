import { format, isValid, parse } from 'date-fns'

export const isoToBrazilian = (iso: string) => {
  if (!iso) return ''
  const parsed = parse(iso, 'yyyy-MM-dd', new Date())
  return isValid(parsed) ? format(parsed, 'dd/MM/yyyy') : ''
}

export const brazilianToIso = (value: string) => {
  const parsed = parse(value, 'dd/MM/yyyy', new Date())
  return isValid(parsed) && format(parsed, 'dd/MM/yyyy') === value ? format(parsed, 'yyyy-MM-dd') : null
}
