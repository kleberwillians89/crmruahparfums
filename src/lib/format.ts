export const brl = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

export const integer = (value: number) => new Intl.NumberFormat('pt-BR').format(value)

export const shortDate = (value: string | Date) =>
  new Intl.DateTimeFormat('pt-BR').format(new Date(value))

export const monthLabel = (month: string) => {
  const [year, m] = month.split('-').map(Number)
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'short' })
    .format(new Date(year, m - 1, 1)).replace('.', '')
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`
}
