// Dados abertos: transforma o JSON de um debate numa planilha CSV (separador ";" e BOM, para abrir certo no Excel em português)
const BASE = 'https://placar-dados.zenithonacademy.com.br/'
const ROTULO = { verdadeiro: 'Verdadeiro', impreciso: 'Impreciso', falso: 'Falso', sem_dados: 'Sem dados', em_revisao: 'Em revisão' }
const celula = v => `"${String(v ?? '').replace(/"/g, '""')}"`

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-csv]')
  if (!b) return
  const nome = b.dataset.csv, antes = b.textContent
  b.disabled = true; b.textContent = 'Gerando…'
  try {
    const p = await (await fetch(`${BASE}${nome}.json?t=${Date.now()}`)).json()
    const linhas = (p.fatos ?? []).flatMap(f => f.declaracoes.map(d => [
      new Date(d.t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }), p.candidatos[d.quem]?.nome, f.tema, d.afirmacao, d.literal,
      ROTULO[d.veredito] ?? d.veredito, d.motivo, d.fonte?.titulo, d.fonte?.url,
      d.corrigido ? ROTULO[d.corrigido.antes] ?? d.corrigido.antes : '', d.ja_checado?.data ?? '',
    ])).sort((x, y) => String(x[0]).localeCompare(String(y[0])))
    const cab = ['data e hora', 'candidato', 'tema', 'afirmação', 'frase dita', 'veredito', 'motivo', 'fonte', 'link da fonte', 'veredito ao vivo (se corrigido)', 'já checado em']
    const csv = '﻿' + [cab, ...linhas].map(l => l.map(celula).join(';')).join('\r\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `${nome}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    b.textContent = 'Baixado ✓'
  } catch { b.textContent = 'Não deu, tente de novo' }
  setTimeout(() => { b.disabled = false; b.textContent = antes }, 2000)
})
