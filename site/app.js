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
      <div class="contagem">${c.verdadeiro} verdadeiro · ${c.impreciso} impreciso · ${c.falso} falso<br>${c.sem_dados} sem dados</div>
    </div>`).join('')

  $('fatos').innerHTML = d.fatos?.length ? d.fatos.map((f, fi) => {
    const novo = vistos.size && !vistos.has(f.tema + f.declaracoes.length)
    vistos.add(f.tema + f.declaracoes.length)
    return `<li class="fato${novo ? ' novo' : ''}"><h3>${esc(f.tema)}</h3>${f.declaracoes.map((x, di) => `
      <div class="decl ${vered(x.veredito)}">
        <div class="cab"><span class="tecla ${vered(x.veredito)}">${ROTULO[vered(x.veredito)]}</span><b>${esc(d.candidatos[x.quem].nome)}</b>
          <span>${new Date(x.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</span></div>
        <p class="disse">${esc(x.afirmacao)}</p>
        ${x.literal ? `<p class="literal">Frase dita: “${esc(x.literal)}”</p>` : ''}
        ${x.contexto ? `<p class="ctx">${esc(x.contexto)}</p>` : ''}
        ${x.motivo ? `<p class="motivo">${esc(x.motivo)}</p>` : ''}
        ${x.corrigido ? `<p class="corrigido">Revisado após o debate · ao vivo era <b>${ROTULO[vered(x.corrigido.antes)]}</b>${x.corrigido.afirmacao_antes ? ` (o robô tinha entendido: “${esc(x.corrigido.afirmacao_antes)}”)` : ''}</p>` : ''}
        <div class="fonte">${x.fonte ? `Fonte: <a href="${link(x.fonte.url)}" target="_blank" rel="noopener">${esc(x.fonte.titulo)}</a> (${esc(host(x.fonte.url))})` : 'Nenhuma fonte encontrada.'}</div>
        <button class="card-botao" type="button" data-f="${fi}" data-d="${di}">Compartilhar este fato</button>
      </div>`).join('')}</li>`
  }).join('') : '<li class="vazio">Os fatos aparecem aqui quando um candidato citar um dado que dá para checar.</li>'

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

// Card da revisão pós-debate: o que mudou em relação ao placar ao vivo, com link para a versão original
function desenharRevisao(d) {
  const r = d.revisao
  $('revisao').hidden = !r
  if (!r) return
  const [A, B] = Object.keys(d.candidatos), erro = c => { const t = c.verdadeiro + c.impreciso + c.falso; return t ? Math.round((c.falso + c.impreciso / 2) / t * 100) + '%' : '–' }
  const mudou = r.mudancas.filter(m => m.depois && m.depois !== m.antes), saiu = r.mudancas.filter(m => !m.depois)
  $('revisao').innerHTML = `<h2>Dados revisados e corrigidos pelo ${esc(r.por)} após o debate</h2>
    <p>${esc(r.resumo)}</p>
    <p class="rev-numeros">${mudou.length} vereditos corrigidos · ${saiu.length} checagens removidas ·
      índice de erro ao vivo → revisado: <b>${esc(d.candidatos[A].nome)} ${erro(r.antes[A])} → ${erro(r.depois[A])}</b>,
      <b>${esc(d.candidatos[B].nome)} ${erro(r.antes[B])} → ${erro(r.depois[B])}</b></p>
    <details><summary>Ver tudo o que mudou</summary><ul>${r.mudancas.map(m => `<li><b>${esc(m.quem)}</b>: ${esc(m.afirmacao)}
      <span class="rev-de">${ROTULO[vered(m.antes)]} → ${m.depois ? (m.depois === m.antes ? 'mantido, explicação corrigida' : ROTULO[vered(m.depois)]) : 'removida'}</span>
      <small>${esc(m.motivo)}</small></li>`).join('')}</ul></details>
    ${r.ao_vivo ? `<p><a href="?d=${encodeURIComponent(r.ao_vivo)}">Ver o placar como ficou ao vivo, sem a revisão</a></p>` : ''}`
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
    <div class="lt-barras" role="img" aria-label="${esc(c.nome)}: ${blocos.map(b => `${hora(b * 5)}, ${soma(b, 'a' + q)} ataques e ${soma(b, 'p' + q)} propostas`).join('; ')}">${blocos.map(b => {
      const a = soma(b, 'a' + q), p = soma(b, 'p' + q)
      return `<div class="lt-col" title="${hora(b * 5)}–${hora(b * 5 + 5)}: ${a} ataque${a === 1 ? '' : 's'}, ${p} proposta${p === 1 ? '' : 's'}">` +
        (a ? `<span class="lt-a" style="height:${a / max * 100}%"></span>` : '') + (p ? `<span class="lt-p" style="height:${p / max * 100}%"></span>` : '') + '</div>'
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
  g.fillStyle = '#5e625f'; fonte(400, 38); g.fillText('Debate presidencial · checagem ao vivo', M, 275)
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

$('fatos').addEventListener('click', async e => {
  const b = e.target.closest('.card-botao')
  if (!b || !dados) return
  const x = dados.fatos[+b.dataset.f]?.declaracoes[+b.dataset.d]
  if (!x) return
  const nome = dados.candidatos[x.quem].nome
  b.disabled = true; b.textContent = 'Gerando imagem…'
  try {
    const arquivo = new File([await cardDoFato(x, nome)], 'placar-da-verdade.png', { type: 'image/png' })
    const texto = `${nome}: "${x.afirmacao}" → ${ROTULO[vered(x.veredito)]}. Veja ao vivo: ${location.origin}`
    if (navigator.canShare?.({ files: [arquivo] })) await navigator.share({ files: [arquivo], text: texto })
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(arquivo); a.download = arquivo.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000) }
  } catch {} // quem cancela o compartilhar cai aqui; não é erro
  b.disabled = false; b.textContent = 'Compartilhar este fato'
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
    if (novo.candidatos && (!dados || novo.atualizado !== dados.atualizado)) { dados = novo; desenhar() }
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
