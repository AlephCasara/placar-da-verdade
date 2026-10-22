// Rastreabilidade da evidência: o juiz só pode citar endereços retornados pela pesquisa.
function normalizarUrl(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return null
  try {
    const url = new URL(valor.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    return url.href
  } catch { return null }
}

export function localizarFonte(urlIndicada, provas = [], citacoes = []) {
  const selecionada = normalizarUrl(urlIndicada)
  if (!selecionada) return null

  const prova = provas.find(p => normalizarUrl(p?.url) === selecionada)
  const citacao = citacoes.find(url => normalizarUrl(url) === selecionada)
  if (!prova && !citacao) return null

  const url = prova?.url ?? citacao
  const titulo = prova?.title && !prova.title.startsWith('Pesquisa na web')
    ? prova.title : new URL(url).hostname.replace(/^www\./, '')
  return { titulo, url }
}

export function validarVeredito(veredito, motivo, urlIndicada, provas = [], citacoes = []) {
  const requerFonte = ['verdadeiro', 'impreciso', 'falso'].includes(veredito)
  const fonte = requerFonte ? localizarFonte(urlIndicada, provas, citacoes) : null
  // Ausência de URL comprovadamente recuperada impede a contabilização no placar.
  if (requerFonte && !fonte) return {
    veredito: 'em_revisao',
    motivo: `A fonte indicada não consta nas evidências recuperadas (veredito preliminar: ${veredito}).`,
    fonte: null,
  }
  return { veredito, motivo: String(motivo ?? '').slice(0, 400), fonte }
}
