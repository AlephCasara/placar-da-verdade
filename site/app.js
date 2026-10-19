const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
// ?d=2026-10-18 abre o arquivo de um debate passado (placar-2026-10-18.json); sem ?d, o placar ao vivo
const ARQUIVO = new URLSearchParams(location.search).get('d')?.match(/^[\w-]{1,40}$/)?.[0] ?? null
const PLACAR = (LOCAL ? '' : 'https://placar-dados.zenithonacademy.com.br/') + (ARQUIVO ? `placar-${ARQUIVO}.json` : 'placar.json')
const ROTULO = { verdadeiro: 'Verdadeiro', impreciso: 'Impreciso', falso: 'Falso', sem_dados: 'Sem dados', em_revisao: 'Em revisão' }
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const host = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }
// Defesa extra: o placar só é gravado pelo robô, mas o site não confia cegamente nele
const link = url => /^https?:\/\//i.test(url ?? '') ? esc(url) : '#'
const vered = v => v in ROTULO ? v : 'sem_dados'
const MINIMO = 3 // fatos checáveis (sem "sem dados") de cada lado antes de o Mentirômetro apontar alguém
let dados = null, vistos = new Set(), videoPronto = false, modoVideo = null

function conta(c) {
  const total = c.verdadeiro + c.impreciso + c.falso
  const p = k => total ? Math.round(c[k] / total * 100) : 0
  // índice de erro: falso vale 1, impreciso vale 0,5
  return { total, v: p('verdadeiro'), i: p('impreciso'), f: p('falso'), erro: total ? (c.falso + c.impreciso / 2) / total : 0 }
}

function desenhar() {
  const d = dados, [A, B] = Object.values(d.candidatos), ca = conta(A), cb = conta(B)
  if (!videoPronto || modoVideo !== (d.encerrado ? 'fim' : d.video?.id)) mostrarVideo(videoVisivel)

  // Mentirômetro: ponteiro para a esquerda = A erra mais, centro = empate, direita = B erra mais.
  // Escala linear: diferença de 100 pontos no índice de erro = ponteiro deitado (90°), 50 pontos = 45°
  // Só mexe com MINIMO fatos checáveis de cada lado: com 1 ou 2, um único veredito já parece placar decidido
  const pronto = ca.total >= MINIMO && cb.total >= MINIMO
  const angulo = pronto ? (cb.erro - ca.erro) * 90 : 0
  $('ponteiro').style.transform = `rotate(${angulo}deg)`
  $('lado-a').textContent = A.nome; $('lado-b').textContent = B.nome
  const dif = Math.abs(ca.erro - cb.erro)
  const base = `<small>com base em ${ca.total} ${ca.total === 1 ? 'fato checável' : 'fatos checáveis'} de ${esc(A.nome)} e ${cb.total} de ${esc(B.nome)} (sem dados fica de fora)</small>`
  $('medidor-texto').innerHTML = (!pronto ? `Esperando mais fatos<small>o ponteiro só se mexe com pelo menos ${MINIMO} fatos checáveis de cada lado</small>`
    : dif < 0.1 ? 'Empate técnico<small>os dois erram parecido até agora</small>'
    : `${esc(ca.erro > cb.erro ? A.nome : B.nome)} está errando mais<small>${Math.round(Math.max(ca.erro, cb.erro) * 100)}% contra ${Math.round(Math.min(ca.erro, cb.erro) * 100)}% de índice de erro</small>`) + base
  $('medidor').setAttribute('aria-label', `Mentirômetro: ${A.nome} ${Math.round(ca.erro * 100)}% de erro, ${B.nome} ${Math.round(cb.erro * 100)}%`)

  $('cands').innerHTML = [[A, ca], [B, cb]].map(([c, p]) => `<div class="cand">
      <h3>${esc(c.nome)}</h3>
      <div class="pct">${p.total ? Math.round(p.erro * 100) : '–'}<small>% de erro</small></div>
      <div class="barra" role="img" aria-label="${p.v}% verdadeiro, ${p.i}% impreciso, ${p.f}% falso">
        <span class="v" style="flex-grow:${p.v}"></span><span class="i" style="flex-grow:${p.i}"></span><span class="f" style="flex-grow:${p.f}"></span>
      </div>
      <div class="contagem"><span>${c.verdadeiro} verdadeiro</span> · <span>${c.impreciso} impreciso</span> · <span>${c.falso} falso</span><br><span>${c.sem_dados} sem dados</span></div>
    </div>`).join('')

  desenharDestaques(d)
  desenharFatos(d)
  desenharLinha(d)
  desenharRevisao(d)

  // Propostas ou ataques?
  const TOM = [['proposta', 'propondo'], ['ataque', 'atacando'], ['defesa', 'se defendendo'], ['balanco', 'falando do passado']]
  $('tom').innerHTML = Object.entries(d.candidatos).map(([q, c]) => {
    const t = c.tempo ?? {}, total = TOM.reduce((s, [k]) => s + (t[k] ?? 0), 0) || 1
    const recentes = (d.ataques ?? []).filter(a => a.quem === q).slice(0, 3)
    return `<div class="tom-cand">
      <h3>${esc(c.nome)}</h3>
      <div class="placar-tom"><div class="p"><b>${c.propostas ?? 0}</b>propostas</div><div class="a"><b>${c.ataques ?? 0}</b>ataques</div></div>
      <div class="barra-tom" role="img" aria-label="Tempo de fala: ${TOM.map(([k, r]) => `${Math.round((t[k] ?? 0) / total * 100)}% ${r}`).join(', ')}">
        ${TOM.map(([k]) => `<span style="flex-grow:${t[k] ?? 0};background:var(--${k})"></span>`).join('')}
      </div>
      <div class="legenda-tom">${TOM.map(([k, r]) => `<span><i style="background:var(--${k})"></i>${Math.round((t[k] ?? 0) / total * 100)}% ${r}</span>`).join('')}</div>
      ${recentes.length ? `<ul class="ataques-recentes">${recentes.map(a => `<li>${esc(a.resumo)}</li>`).join('')}</ul>` : ''}
    </div>`
  }).join('')

  $('lista-propostas').innerHTML = Object.entries(d.candidatos).map(([q, c]) => {
    const minhas = (d.propostas ?? []).filter(p => p.quem === q).sort((x, y) => y.vezes - x.vezes || y.t - x.t)
    return `<div><h3>${esc(c.nome)}</h3>${minhas.length ? `<ol>${minhas.map(p => `<li class="prop">
      <h4>${esc(p.titulo)}</h4><p>${esc(p.explicacao)}</p>${p.vezes > 1 ? `<small>Citada ${p.vezes} vezes</small>` : ''}</li>`).join('')}</ol>`
      : '<p class="vazio">Nenhuma proposta concreta até agora.</p>'}</div>`
  }).join('')

  const resumo = `${A.nome} ${ca.total ? Math.round(ca.erro * 100) + '%' : '–'} x ${B.nome} ${cb.total ? Math.round(cb.erro * 100) + '%' : '–'} de erro`
  const tons = `${A.nome}: ${A.propostas ?? 0} propostas x ${A.ataques ?? 0} ataques. ${B.nome}: ${B.propostas ?? 0} propostas x ${B.ataques ?? 0} ataques`
  const texto = encodeURIComponent(`Mentirômetro do debate${d.encerrado ? ' (placar final)' : ', ao vivo'}: ${resumo}\n${tons}\n${location.href}`)
  $('share-x').href = `https://x.com/intent/post?text=${texto}`
  $('share-zap').href = `https://wa.me/?text=${texto}`
}

// ---------- Fatos checados: lista plana, filtros, ordem, destaques e link direto ----------
// Cada declaração vira um card. id estável (hora + quem + texto) para o link #fato-id continuar valendo entre atualizações
const idDe = x => x.t.toString(36) + x.quem + [...String(x.afirmacao)].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36)
let itens = [] // todas as declarações, já com id e tema
const filtro = { quem: 'todos', vered: null, janela: null } // janela: [início, fim] em ms, vinda da linha do tempo
let ordem = null // 'recentes' | 'debate'; null = automático (ao vivo, recentes primeiro; depois do debate, ordem do debate)
let vistosIds = null, novosPendentes = 0
const ordemAtual = () => ordem ?? (dados?.encerrado || dados?.revisao ? 'debate' : 'recentes')
const horaDe = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })

function filtrar(lista, ignorar) {
  return lista.filter(x => (ignorar === 'quem' || filtro.quem === 'todos' || x.quem === filtro.quem) &&
    (ignorar === 'vered' || !filtro.vered || (filtro.vered === 'corrigidos' ? x.corrigido : x.veredito === filtro.vered)) &&
    (!filtro.janela || (x.t >= filtro.janela[0] && x.t < filtro.janela[1])))
}

function desenharFatos(d) {
  itens = (d.fatos ?? []).flatMap(f => f.declaracoes.map(x => ({ ...x, tema: f.tema, id: idDe(x) })))
  // Ao vivo, fato novo enquanto a pessoa lê lá embaixo: a lista não pula; aparece o aviso "N fatos novos"
  const ids = new Set(itens.map(x => x.id))
  const novos = vistosIds ? itens.filter(x => !vistosIds.has(x.id)).length : 0
  const ancora = [...document.querySelectorAll('#fatos > li[id]')].find(li => li.getBoundingClientRect().top >= 0)
  const topoAntes = ancora?.getBoundingClientRect().top

  const [A, B] = Object.keys(d.candidatos), base = filtrar(itens, 'vered'), porQuem = filtrar(itens, 'quem')
  const conta = k => base.filter(x => k === 'corrigidos' ? x.corrigido : x.veredito === k).length
  const chip = (k, rotulo) => `<button type="button" class="filtro tecla-chip ${k}" data-ver="${k}" aria-pressed="${filtro.vered === k}">${rotulo} <span>${conta(k)}</span></button>`
  const pessoa = (q, rotulo) => `<button type="button" class="filtro" data-quem="${q}" aria-pressed="${filtro.quem === q}">${esc(rotulo)} <span>${q === 'todos' ? porQuem.length : porQuem.filter(x => x.quem === q).length}</span></button>`
  $('filtros').innerHTML = `<div class="grupo" role="group" aria-label="Candidato">${pessoa('todos', 'Todos')}${pessoa(A, d.candidatos[A].nome)}${pessoa(B, d.candidatos[B].nome)}</div>
    <div class="grupo" role="group" aria-label="Veredito">${Object.keys(ROTULO).filter(k => k !== 'em_revisao' || conta(k)).map(k => chip(k, ROTULO[k])).join('')}${itens.some(x => x.corrigido) ? chip('corrigidos', '✎ Corrigidos') : ''}</div>
    <div class="grupo">${filtro.janela ? `<button type="button" class="filtro ativo-x" data-limpar="janela">${horaDe(filtro.janela[0])}–${horaDe(filtro.janela[1])} ✕</button>` : ''}
      <button type="button" class="filtro" data-ordem>${ordemAtual() === 'recentes' ? '↓ Mais recentes primeiro' : '↓ Na ordem do debate'}</button></div>`

  const lista = filtrar(itens).sort((x, y) => ordemAtual() === 'recentes' ? y.t - x.t : x.t - y.t)
  $('fatos-total').textContent = lista.length === itens.length ? `(${itens.length})` : `(${lista.length} de ${itens.length})`
  $('fatos').innerHTML = lista.length ? lista.map(x => {
    const v = vered(x.veredito), nome = d.candidatos[x.quem]?.nome ?? ''
    return `<li class="fato decl ${v}${vistosIds && !vistosIds.has(x.id) ? ' novo' : ''}" id="fato-${x.id}">
      <div class="cab"><span class="tecla ${v}">${ROTULO[v]}</span><b>${esc(nome)}</b><span>${horaDe(x.t)}</span><span class="tema">${esc(x.tema)}</span></div>
      <p class="disse">${esc(x.afirmacao)}</p>
      <details${STORY ? ' open' : ''}><summary>Ver dados e fonte</summary>
        ${x.literal ? `<p class="literal">Frase dita: “${esc(x.literal)}”</p>` : ''}
        ${x.contexto ? `<p class="ctx">${esc(x.contexto)}</p>` : ''}
        ${x.motivo ? `<p class="motivo">${esc(x.motivo)}</p>` : ''}
        ${x.corrigido ? `<p class="corrigido">Revisado após o debate · ao vivo era <b>${ROTULO[vered(x.corrigido.antes)]}</b>${x.corrigido.afirmacao_antes ? ` (o robô tinha entendido: “${esc(x.corrigido.afirmacao_antes)}”)` : ''}</p>` : ''}
        <div class="fonte">${x.fonte ? `Fonte: <a href="${link(x.fonte.url)}" target="_blank" rel="noopener">${esc(x.fonte.titulo)}</a> (${esc(host(x.fonte.url))})` : 'Nenhuma fonte encontrada.'}</div>
      </details>
      <button class="partilhar" type="button" data-id="${x.id}" aria-label="Compartilhar este fato">↗ Compartilhar</button>
    </li>`
  }).join('') : itens.length ? '<li class="vazio">Nenhum fato com esses filtros. <button class="botao-texto" type="button" data-limpar="tudo">Limpar filtros</button></li>'
    : '<li class="vazio">Os fatos aparecem aqui quando um candidato citar um dado que dá para checar.</li>'

  // Mantém o card que a pessoa estava lendo no mesmo lugar da tela
  const mesmo = ancora && document.getElementById(ancora.id)
  if (mesmo && topoAntes != null) window.scrollBy(0, mesmo.getBoundingClientRect().top - topoAntes)
  const lendoEmbaixo = $('fatos').getBoundingClientRect().top < 0
  if (novos && lendoEmbaixo && ordemAtual() === 'recentes' && !d.encerrado) novosPendentes += novos
  if (!lendoEmbaixo) novosPendentes = 0
  $('novos').hidden = !novosPendentes
  $('novos').textContent = `↑ ${novosPendentes} ${novosPendentes === 1 ? 'fato novo' : 'fatos novos'}`
  vistosIds = ids
}

// Faixa de destaques: os falsos e imprecisos mais recentes (ou, depois da revisão, os vereditos que mudaram)
function desenharDestaques(d) {
  const todos = (d.fatos ?? []).flatMap(f => f.declaracoes.map(x => ({ ...x, id: idDe(x) })))
  const mudaram = todos.filter(x => x.corrigido && x.corrigido.antes !== x.veredito)
  const lista = (mudaram.length ? mudaram : todos.filter(x => x.veredito === 'falso' || x.veredito === 'impreciso')).sort((x, y) => y.t - x.t).slice(0, 8)
  $('destaques').hidden = !lista.length
  if (!lista.length) return
  $('destaques-titulo').textContent = mudaram.length ? 'Destaques da revisão: vereditos que mudaram' : 'Destaques: últimos falsos e imprecisos'
  $('faixa').innerHTML = lista.map(x => { const v = vered(x.veredito); return `<a class="dest ${v}" href="#fato-${x.id}" data-id="${x.id}" draggable="false">
    <span class="tecla ${v}">${ROTULO[v]}</span>${x.corrigido ? ` <small>era ${ROTULO[vered(x.corrigido.antes)]}</small>` : ''}
    <b>${esc(d.candidatos[x.quem]?.nome)}</b><span>${esc(x.afirmacao)}</span></a>` }).join('')
}

// Link direto para um fato (#fato-id): limpa filtros se precisar, abre os detalhes e rola até ele
function irPara(id) {
  let el = document.getElementById('fato-' + id)
  if (!el && itens.some(x => x.id === id)) { Object.assign(filtro, { quem: 'todos', vered: null, janela: null }); desenharFatos(dados); desenharLinha(dados); el = document.getElementById('fato-' + id) }
  if (!el) return
  el.querySelector('details').open = true
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  el.classList.remove('alvo'); void el.offsetWidth; el.classList.add('alvo')
}
const hashId = () => location.hash.match(/^#fato-([\w]+)$/)?.[1]
addEventListener('hashchange', () => hashId() && irPara(hashId()))
// Destaques: no computador dá para arrastar com o mouse (no celular o dedo já arrasta)
let arrasto = null, arrastou = false
$('faixa').addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) arrasto = { x: e.clientX, s: $('faixa').scrollLeft }, arrastou = false })
addEventListener('pointermove', e => {
  if (!arrasto) return
  const dx = e.clientX - arrasto.x
  if (!arrastou && Math.abs(dx) > 5) arrastou = true, $('faixa').classList.add('arrastando')
  if (arrastou) $('faixa').scrollLeft = arrasto.s - dx
})
addEventListener('pointerup', () => { arrasto = null; $('faixa').classList.remove('arrastando') })
$('faixa').addEventListener('click', e => {
  const c = e.target.closest('.dest')
  if (arrastou) { arrastou = false; return e.preventDefault() } // soltou depois de arrastar: não abre o fato
  if (!c) return
  e.preventDefault(); history.replaceState(null, '', '#fato-' + c.dataset.id); irPara(c.dataset.id)
})
// ---------- Compartilhar um fato: janela com a prévia do card e os atalhos ----------
const urlDoFato = id => `${location.origin}${location.pathname}${location.search}#fato-${id}`
const imagens = new Map() // id → Blob do card já gerado (abrir de novo é instantâneo)
let fatoAberto = null
async function abrirPartilha(x) {
  fatoAberto = x
  const nome = dados.candidatos[x.quem].nome, v = vered(x.veredito), url = urlDoFato(x.id)
  const texto = `${nome} disse: "${x.afirmacao}" → ${ROTULO[v]}.${x.motivo ? ` ${x.motivo}` : ''}`
  $('p-veredito').className = `tecla ${v}`; $('p-veredito').textContent = ROTULO[v]
  $('p-frase').textContent = `${nome}: “${x.afirmacao}”`
  $('p-zap').href = `https://wa.me/?text=${encodeURIComponent(`${texto}\n\nVeja a fonte: ${url}`)}`
  $('p-x').href = `https://x.com/intent/post?text=${encodeURIComponent(`${nome} disse: "${x.afirmacao.slice(0, 150)}" → ${ROTULO[v]}`)}&url=${encodeURIComponent(url)}`
  $('p-copiar').textContent = 'Copiar link'
  $('p-mais').hidden = !navigator.share
  $('p-previa').innerHTML = '<div class="p-carregando">Gerando o card…</div>'
  $('partilha').showModal()
  if (!imagens.has(x.id)) imagens.set(x.id, await cardDoFato(x, nome))
  if (fatoAberto !== x) return // a pessoa já abriu outro fato
  const img = new Image(); img.alt = `Card do fato: ${nome}, ${ROTULO[v]}`; img.src = URL.createObjectURL(imagens.get(x.id))
  $('p-previa').replaceChildren(img)
}
const arquivoDoCard = () => new File([imagens.get(fatoAberto.id)], 'placar-da-verdade.png', { type: 'image/png' })
$('p-copiar').onclick = async () => {
  try { await navigator.clipboard.writeText(urlDoFato(fatoAberto.id)); $('p-copiar').textContent = 'Link copiado ✓'; $('p-copiar').classList.add('ok') }
  catch { prompt('Copie o link do fato:', urlDoFato(fatoAberto.id)) }
  setTimeout(() => { $('p-copiar').textContent = 'Copiar link'; $('p-copiar').classList.remove('ok') }, 2000)
}
$('p-baixar').onclick = async () => {
  if (!imagens.has(fatoAberto.id)) imagens.set(fatoAberto.id, await cardDoFato(fatoAberto, dados.candidatos[fatoAberto.quem].nome))
  const l = document.createElement('a'); l.href = URL.createObjectURL(arquivoDoCard()); l.download = 'placar-da-verdade.png'; l.click()
  setTimeout(() => URL.revokeObjectURL(l.href), 5000)
}
$('p-mais').onclick = async () => { // menu nativo do celular (Instagram, Telegram...), com a imagem quando o aparelho aceita
  const x = fatoAberto, dadosShare = { title: 'Placar da Verdade', text: `${dados.candidatos[x.quem].nome}: "${x.afirmacao}" → ${ROTULO[vered(x.veredito)]}`, url: urlDoFato(x.id) }
  try {
    if (imagens.has(x.id) && navigator.canShare?.({ files: [arquivoDoCard()] })) await navigator.share({ ...dadosShare, files: [arquivoDoCard()] })
    else await navigator.share(dadosShare)
  } catch {} // cancelar o menu não é erro
}
$('p-fechar').onclick = () => $('partilha').close()
$('partilha').addEventListener('click', e => { if (e.target === $('partilha')) $('partilha').close() }) // clique fora fecha

// Cliques nos filtros, na linha do tempo e no aviso de fatos novos
function refazer() { desenharFatos(dados); desenharLinha(dados); desenharRevisao(dados) }
document.addEventListener('click', e => {
  if (!dados) return
  const b = e.target.closest('[data-quem], [data-ver], [data-ordem], [data-limpar], .lt-col')
  if (!b) return
  if (b.dataset.quem) filtro.quem = b.dataset.quem
  else if (b.dataset.ver) { filtro.vered = filtro.vered === b.dataset.ver ? null : b.dataset.ver; if (b.closest('#revisao')) $('fatos-secao').scrollIntoView() }
  else if ('ordem' in b.dataset) ordem = ordemAtual() === 'recentes' ? 'debate' : 'recentes'
  else if (b.dataset.limpar === 'janela') filtro.janela = null
  else if (b.dataset.limpar === 'tudo') Object.assign(filtro, { quem: 'todos', vered: null, janela: null })
  else if (b.classList.contains('lt-col')) {
    const comeco = dados.video?.comeco ?? dados.video?.t0 ?? 0, i = comeco + +b.dataset.b * 300000
    filtro.janela = filtro.janela?.[0] === i ? null : [i, i + 300000]
    if (filtro.janela) $('fatos-secao').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  refazer()
})
$('novos').onclick = () => { novosPendentes = 0; $('novos').hidden = true; $('fatos-secao').scrollIntoView() }

// Card da revisão pós-debate: o que mudou em relação ao placar ao vivo, com link para a versão original
function desenharRevisao(d) {
  const r = d.revisao
  $('revisao').hidden = !r
  if (!r) return
  const [A, B] = Object.keys(d.candidatos), erro = c => { const t = c.verdadeiro + c.impreciso + c.falso; return t ? Math.round((c.falso + c.impreciso / 2) / t * 100) + '%' : '–' }
  const mudou = r.mudancas.filter(m => m.depois && m.depois !== m.antes), saiu = r.mudancas.filter(m => !m.depois)
  $('revisao').innerHTML = `<p class="rev-linha"><b>✎ Dados revisados e corrigidos pelo ${esc(r.por)} após o debate.</b>
      ${mudou.length} vereditos corrigidos · ${saiu.length} checagens removidas · erro ao vivo → revisado:
      <b>${esc(d.candidatos[A].nome)} ${erro(r.antes[A])} → ${erro(r.depois[A])}</b> ·
      <b>${esc(d.candidatos[B].nome)} ${erro(r.antes[B])} → ${erro(r.depois[B])}</b></p>
    <details><summary>Ver detalhes da revisão</summary><p>${esc(r.resumo)}</p>
      ${filtro.vered !== 'corrigidos' ? '<p><button class="botao-texto" type="button" data-ver="corrigidos">Mostrar só os fatos corrigidos</button></p>' : ''}<ul>${r.mudancas.map(m => `<li><b>${esc(m.quem)}</b>: ${esc(m.afirmacao)}
      <span class="rev-de">${ROTULO[vered(m.antes)]} → ${m.depois ? (m.depois === m.antes ? 'mantido, explicação corrigida' : ROTULO[vered(m.depois)]) : 'removida'}</span>
      <small>${esc(m.motivo)}</small></li>`).join('')}</ul>
    ${r.ao_vivo ? `<p><a href="?d=${encodeURIComponent(r.ao_vivo)}">Ver o placar como ficou ao vivo, sem a revisão</a></p>` : ''}</details>`
}

// Linha do tempo: colunas de 5 min, do primeiro minuto com algo até o último, mesma escala para os dois
function desenharLinha(d) {
  const linha = d.linha ?? {}, mins = Object.keys(linha).map(Number)
  if (!mins.length) { $('linha-tempo').innerHTML = '<p class="vazio">A linha do tempo começa no primeiro ataque ou proposta.</p>'; return }
  const ini = Math.floor(Math.min(...mins) / 5), fim = Math.floor(Math.max(...mins) / 5)
  const blocos = Array.from({ length: fim - ini + 1 }, (_, i) => ini + i)
  const soma = (b, k) => [0, 1, 2, 3, 4].reduce((s, i) => s + (linha[b * 5 + i]?.[k] ?? 0), 0)
  const max = Math.max(1, ...blocos.flatMap(b => ['1', '2'].map(q => soma(b, 'a' + q) + soma(b, 'p' + q))))
  const comeco = d.video?.comeco ?? d.video?.t0 ?? Date.now()
  const hora = m => new Date(comeco + m * 60000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  const linhas = Object.entries(d.candidatos).map(([q, c]) => `<div class="lt-linha"><span class="lt-nome">${esc(c.nome)}</span>
    <div class="lt-barras" role="group" aria-label="${esc(c.nome)}: ${blocos.map(b => `${hora(b * 5)}, ${soma(b, 'a' + q)} ataques e ${soma(b, 'p' + q)} propostas`).join('; ')}">${blocos.map(b => {
      const a = soma(b, 'a' + q), p = soma(b, 'p' + q)
      const ativo = filtro.janela?.[0] === comeco + b * 300000
      return `<button type="button" class="lt-col${ativo ? ' ativo' : ''}" data-b="${b}" aria-pressed="${ativo}" title="${hora(b * 5)}–${hora(b * 5 + 5)}: ${a} ataque${a === 1 ? '' : 's'}, ${p} proposta${p === 1 ? '' : 's'}. Toque para ver os fatos desses minutos">` +
        (a ? `<span class="lt-a" style="height:${a / max * 100}%"></span>` : '') + (p ? `<span class="lt-p" style="height:${p / max * 100}%"></span>` : '') + '</button>'
    }).join('')}</div></div>`).join('')
  const passo = Math.max(1, Math.ceil(blocos.length / 6)) // no máximo ~6 rótulos no eixo
  const eixo = `<div class="lt-eixo"><span></span><div>${blocos.map((b, i) => `<span>${i % passo ? '' : hora(b * 5)}</span>`).join('')}</div></div>`
  $('linha-tempo').innerHTML = linhas + eixo
}

// Card vertical (1080x1920) de um fato, para Stories e WhatsApp
async function cardDoFato(x, nome) {
  await document.fonts.load('900 10px Archivo').catch(() => {})
  const W = 1080, H = 1920, M = 90, cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const g = cv.getContext('2d'), cor = { verdadeiro: '#1d8a4a', impreciso: '#e07b14', falso: '#c62828', sem_dados: '#ffffff' }
  const fonte = (peso, px, estreita) => { g.font = `${peso} ${px}px Archivo, system-ui, sans-serif`; g.fontStretch = estreita ? 'extra-condensed' : 'normal' }
  const quebrar = (texto, larg) => String(texto).split(/\s+/).reduce((ls, p) => {
    const tenta = ls.length ? `${ls.at(-1)} ${p}` : p
    if (ls.length && g.measureText(tenta).width <= larg) ls[ls.length - 1] = tenta; else ls.push(p)
    return ls
  }, [])
  const escrever = (texto, y, px, alt, max) => { const ls = quebrar(texto, W - 2 * M).slice(0, max); ls.forEach((l, i) => g.fillText(l, M, y + i * px * alt)); return y + ls.length * px * alt }
  g.fillStyle = '#e4e6e3'; g.fillRect(0, 0, W, H)
  g.fillStyle = '#fbfbf8'; g.beginPath(); g.roundRect(40, 40, W - 80, H - 80, 36); g.fill()
  g.fillStyle = '#1b1d1c'; fonte(900, 110, true); g.fillText('Placar da Verdade', M, 210)
  g.fillStyle = '#5e625f'; fonte(400, 38); g.fillText(x.corrigido ? 'Debate presidencial · revisado após o debate' : 'Debate presidencial · checagem ao vivo', M, 275)
  g.fillStyle = '#1b1d1c'; fonte(800, 72, true); let y = escrever(`${nome} disse:`, 430, 72, 1.1, 2)
  fonte(400, 58); y = escrever(x.afirmacao, y + 30, 58, 1.3, 7)
  const v = vered(x.veredito); y += 60
  g.fillStyle = cor[v]; g.beginPath(); g.roundRect(M, y, W - 2 * M, 190, 24); g.fill()
  if (v === 'sem_dados') { g.strokeStyle = '#b9bdb8'; g.lineWidth = 4; g.stroke() }
  g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(M + 24, y + 182, W - 2 * M - 48, 8)
  g.fillStyle = v === 'sem_dados' ? '#1b1d1c' : '#fff'; fonte(900, 130, true); g.textAlign = 'center'; g.fillText(ROTULO[v].toUpperCase(), W / 2, y + 140); g.textAlign = 'left'
  y += 290
  if (x.motivo) { g.fillStyle = '#1b1d1c'; fonte(800, 48); g.fillText('Os dados:', M, y); fonte(400, 46); y = escrever(x.motivo, y + 64, 46, 1.35, 7) }
  if (x.fonte) { g.fillStyle = '#5e625f'; fonte(400, 36); escrever(`Fonte: ${host(x.fonte.url)}`, y + 30, 36, 1.3, 1) }
  g.fillStyle = '#1b1d1c'; fonte(900, 64, true); g.textAlign = 'center'; g.fillText(location.host, W / 2, H - 170)
  g.fillStyle = '#5e625f'; fonte(400, 34); g.fillText('Checagem automática por IA. Confira a fonte.', W / 2, H - 110)
  return new Promise(ok => cv.toBlob(ok, 'image/png'))
}

$('fatos').addEventListener('click', e => {
  const b = e.target.closest('.partilhar')
  const x = b && dados && itens.find(i => i.id === b.dataset.id)
  if (x) abrirPartilha(x)
})

function relogio() {
  if (!dados) return
  if (dados.encerrado) {
    $('status').classList.remove('vivo'); $('faixa-status').classList.remove('vivo')
    $('status-texto').textContent = 'Debate encerrado · placar final'
    $('faixa-texto').textContent = 'Debate encerrado'
    $('duracao').innerHTML = `próximo debate em <span class="regressiva">${falta(dados.encerrado.proximo)}</span>`
    return
  }
  const s = Math.round((Date.now() - dados.atualizado) / 1000), vivo = s < 120
  $('status').classList.toggle('vivo', vivo)
  const reprise = dados.video && !dados.video.ao_vivo
    ? ` · reprise do debate de ${new Date(dados.video.data).toLocaleDateString('pt-BR')}` : ''
  const pausa = dados.pausado ? ' · checagem automática pausada' : ''
  $('status-texto').innerHTML = (vivo ? `<strong>Ao vivo</strong> · checagem ~30s atrás da TV${reprise}` : `Última atualização há ${Math.round(s / 60)} min`) + pausa
  $('faixa-status').classList.toggle('vivo', vivo)
  $('faixa-texto').innerHTML = vivo ? '<strong>Ao vivo</strong>' : 'Debate encerrado ou pausado'
  const min = Math.floor(segundosDeDebate() / 60)
  $('duracao').textContent = `rolando há ${min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : `${min} min`}`
}

// Tempo de debate: ao vivo, desde o início da transmissão; na reprise, a posição do vídeo
function segundosDeDebate() {
  const v = dados?.video
  if (!v) return 0
  return v.ao_vivo ? (Date.now() - (v.comeco ?? v.t0)) / 1000 : v.inicio + (Date.now() - v.t0) / 1000
}

// Ocultar / mostrar o vídeo. Oculto, o player sai da página (não gasta internet) e fica a faixa de ao vivo
const STORY = new URLSearchParams(location.search).get('modo') === 'story' // modo gravação vertical
if (STORY) document.body.classList.add('story')
let videoVisivel = !STORY
try { if (!STORY) videoVisivel = localStorage.getItem('video') !== 'oculto' } catch {}
function mostrarVideo(visivel) {
  videoVisivel = visivel
  try { if (!STORY) localStorage.setItem('video', visivel ? 'visivel' : 'oculto') } catch {}
  $('com-video').hidden = !visivel
  $('sem-video').hidden = visivel
  $('topo').classList.toggle('sem-video', !visivel)
  $('ocultar').hidden = $('ver-live').hidden = !!dados?.encerrado // entre debates não há live para ocultar ou abrir
  modoVideo = dados?.encerrado ? 'fim' : dados?.video?.id
  if (dados?.encerrado) { $('video').innerHTML = telaFim(dados); videoPronto = true; return relogio() }
  if (!visivel) { $('video').innerHTML = ''; videoPronto = !!dados; return relogio() }
  if (!dados?.video?.id) { $('video').innerHTML = dados?.aviso ? `<div class="aviso">${esc(dados.aviso)}</div>` : ''; return }
  const inicio = dados.video.ao_vivo ? 0 : Math.round(segundosDeDebate())
  $('video').innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(dados.video.id)}?autoplay=1&mute=1&enablejsapi=1&start=${inicio}"
    title="Transmissão do debate" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
  videoPronto = true
}
$('ocultar').onclick = () => { mostrarVideo(false); $('ver-live').focus() }
$('ver-live').onclick = () => { mostrarVideo(true); $('ocultar').focus() }

async function buscar() {
  try {
    const r = await fetch(`${PLACAR}?t=${Math.floor(Date.now() / 3000)}`)
    if (!r.ok) throw new Error(r.status)
    const novo = await r.json()
    if (novo.candidatos && (!dados || novo.atualizado !== dados.atualizado)) {
      const primeira = !dados
      dados = novo; desenhar()
      if (primeira && hashId()) irPara(hashId())
    }
  } catch { if (!dados) $('status-texto').textContent = 'Sem conexão com o placar. Tentando de novo…' }
  relogio()
}
// Aba em segundo plano não busca: economiza a internet de quem assiste e requisições no servidor
buscar(); setInterval(() => { if (!document.hidden) buscar() }, 6000)
document.addEventListener('visibilitychange', () => { if (!document.hidden) { buscar(); voltarAoVivo() } })
// O navegador pausa vídeo mudo em aba escondida; na volta, a live ficaria atrasada. Pula para o ao vivo
// (comandos do player do YouTube por postMessage, sem carregar o script da API; mantém o som como a pessoa deixou)
function voltarAoVivo() {
  const f = dados?.video?.ao_vivo && $('video').querySelector('iframe')
  if (!f) return
  for (const [func, args] of [['seekTo', [1e9, true]], ['playVideo', []]])
    f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube.com')
}

// Entre debates o placar final traz "encerrado" com a data do próximo: no lugar da live entra esta tela com contagem regressiva.
// Quando o robô liga no próximo debate, o placar novo não tem "encerrado" e a live volta sozinha
function falta(quando) {
  const s = Math.floor((Date.parse(quando) - Date.now()) / 1000)
  if (s <= 0) return 'começando agora'
  const d = Math.floor(s / 86400), dois = n => String(n).padStart(2, '0')
  return `${d ? d + (d === 1 ? ' dia ' : ' dias ') : ''}${dois(Math.floor(s % 86400 / 3600))}h ${dois(Math.floor(s % 3600 / 60))}min ${dois(s % 60)}s`
}
const telaFim = d => `<div class="aviso tela-fim"><div>
  <small>Debate de ${new Date(d.video?.data ?? d.atualizado).toLocaleDateString('pt-BR', { day: 'numeric', month: 'numeric', timeZone: 'America/Sao_Paulo' })} encerrado · o placar final está logo abaixo</small>
  <span class="rotulo-fim">Próximo debate</span>
  <b>${esc(d.encerrado.texto)}</b>
  <div class="regressiva" role="timer">${falta(d.encerrado.proximo)}</div>
  <small>Estamos aprimorando os métodos de checagem para o próximo debate.</small>
</div></div>`
setInterval(() => { if (dados?.encerrado) for (const el of document.querySelectorAll('.regressiva')) el.textContent = falta(dados.encerrado.proximo) }, 1000)

// Quantas pessoas estão com o site aberto agora e quantas visitas já teve
function audiencia(espera = 2000, primeira = true) {
  if (LOCAL) return
  // ?nova só na primeira conexão da página: reconexão não conta como visita
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ao-vivo${primeira ? '?nova' : ''}`)
  ws.onmessage = e => {
    let d; try { d = JSON.parse(e.data) } catch { return }
    const n = +d.agora || 0, v = +d.visitas || 0
    $('audiencia').hidden = false
    $('audiencia').innerHTML = `<b>${n.toLocaleString('pt-BR')}</b> ${n === 1 ? 'pessoa assistindo' : 'pessoas assistindo'} agora` +
      (v ? ` · <b>${v.toLocaleString('pt-BR')}</b> ${v === 1 ? 'visita' : 'visitas'}` : '')
  }
  ws.onclose = () => setTimeout(() => audiencia(Math.min(espera * 2, 60000), false), espera + Math.random() * 1000)
}
audiencia()
