# Reconciliação financeira — aba PERFUMES

Fonte: `JULHO - PLANILHA DE VENDAS.xlsx`. A planilha original permanece fora do repositório e não foi modificada.

## Causa da divergência

A apuração aproximada de R$ 3,345 milhões inclui a linha `TOTAL:` (linha 5946), cujo campo `VALOR` é a fórmula `SUBTOTAL(109,Tabela1[VALOR])` com valor armazenado de R$ 1.673.690,78. Somar essa célula novamente às linhas comerciais duplica integralmente a coluna:

- linhas numéricas, sem a fórmula: R$ 1.673.690,78;
- subtotal armazenado na linha `TOTAL:`: R$ 1.673.690,78;
- soma incorreta com subtotal duplicado: R$ 3.347.381,56.

O relatório anterior de R$ 1.563.985,48 tinha outro problema: exigia data, status reconhecido e forma de pagamento. Isso descartou R$ 108.219,30 de registros com cliente e valor, principalmente vendas `AGUARDANDO` sem forma de pagamento preenchida.

## Partição financeira conciliada

As quatro categorias de status abaixo são mutuamente exclusivas e fecham exatamente o volume bruto com cliente e valor.

| Categoria | Linhas | Valor |
|---|---:|---:|
| Total bruto com cliente e valor | 5.907 | R$ 1.672.204,78 |
| Pago | 5.495 | R$ 1.561.552,38 |
| Aguardando | 362 | R$ 92.598,00 |
| Cancelado | 8 | R$ 5.159,00 |
| Status não padronizado | 42 | R$ 12.895,40 |
| Total incluído no dashboard | 5.857 | R$ 1.654.150,38 |
| Total excluído do faturamento | 50 | R$ 18.054,40 |

Conferência: pago + aguardando + cancelado + revisão = **R$ 1.672.204,78**.

## Qualidade e sobreposições

Estas categorias são marcadores de qualidade e podem se sobrepor às categorias financeiras; não devem ser somadas novamente ao total.

| Marcador | Linhas | Valor associado |
|---|---:|---:|
| Data inválida ou ausente entre vendas com cliente e valor | 0 | R$ 0,00 |
| Possível duplicidade | 283 | R$ 47.178,60 |
| Cliente presente, valor ausente | 18 | R$ 0,00 |
| Valor presente, cliente ausente | 1 | R$ 1.486,00 |

A aba possui 5.925 linhas com cliente, 421 nomes de exibição distintos e 419 nomes após normalização exata de espaços, capitalização e acentos. Nenhum nome é unido por similaridade.

A simulação encontrou dois grupos de colisão de normalização (quatro grafias brutas envolvidas). Eles permanecem na fila de revisão; nenhuma união automática será feita.

## Status em revisão

Os R$ 12.895,40 em revisão incluem status vazios e descrições operacionais como crédito, presente, devolução ou acordo. Eles são preservados, mas não entram no faturamento até decisão humana.

Possíveis duplicidades também permanecem na simulação. Nenhuma foi eliminada ou carregada automaticamente.
