import test from 'node:test'
import assert from 'node:assert/strict'
import { localizarFonte, validarVeredito } from '../fonte.mjs'

const provas = [
  { title: 'Série histórica do IBGE', url: 'https://www.ibge.gov.br/series?ano=2024' },
  { title: 'Pesquisa na web (Perplexity). Fontes: ...', url: 'https://www.bcb.gov.br/nota' },
]
const citacoes = ['https://www.bcb.gov.br/nota', 'https://www.gov.br/dado']

test('aceita fonte recuperada na busca e mantém título e URL originais', () => {
  assert.deepEqual(localizarFonte('https://www.ibge.gov.br/series?ano=2024', provas, citacoes),
    { titulo: 'Série histórica do IBGE', url: provas[0].url })
})

test('aceita URL recuperada nas citações do pesquisador', () => {
  assert.deepEqual(localizarFonte('https://www.gov.br/dado', provas, citacoes),
    { titulo: 'gov.br', url: 'https://www.gov.br/dado' })
})

test('normaliza fragmentos sem perder a identidade da página', () => {
  assert.equal(localizarFonte('https://www.bcb.gov.br/nota#secao', provas, citacoes)?.url, provas[1].url)
})

test('rejeita link inventado, mesmo quando existem outras fontes', () => {
  assert.equal(localizarFonte('https://www.gov.br/dado-inexistente', provas, citacoes), null)
})

test('não aceita uma URL cuja query difere da evidência recuperada', () => {
  assert.equal(localizarFonte('https://www.ibge.gov.br/series?ano=2025', provas, citacoes), null)
})

test('recusa esquemas inválidos, URLs vazias e URLs com credenciais', () => {
  for (const url of ['javascript:alert(1)', '', null, 'https://user:pass@www.gov.br/dado'])
    assert.equal(localizarFonte(url, provas, citacoes), null)
})

test('mantém veredito válido somente quando a fonte é rastreável', () => {
  assert.deepEqual(validarVeredito('verdadeiro', 'A série confirma o dado.', provas[0].url, provas, citacoes), {
    veredito: 'verdadeiro', motivo: 'A série confirma o dado.',
    fonte: { titulo: 'Série histórica do IBGE', url: provas[0].url },
  })
})

test('coloca em revisão veredito sem fonte válida, sem substituir silenciosamente pela primeira', () => {
  for (const rotulo of ['verdadeiro', 'impreciso', 'falso']) {
    const resultado = validarVeredito(rotulo, 'Juízo preliminar.', 'https://exemplo.com/nao-recuperado', provas, citacoes)
    assert.equal(resultado.veredito, 'em_revisao')
    assert.equal(resultado.fonte, null)
    assert.match(resultado.motivo, new RegExp(rotulo))
  }
})

test('sem dados e descartar dispensam fonte, mas não recebem fonte substituta', () => {
  for (const rotulo of ['sem_dados', 'descartar']) {
    const resultado = validarVeredito(rotulo, 'Não é verificável.', provas[0].url, provas, citacoes)
    assert.equal(resultado.veredito, rotulo)
    assert.equal(resultado.fonte, null)
  }
})
