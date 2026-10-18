const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
const PLACAR = LOCAL ? 'placar.json' : 'https://pub-9ba39942d63f4361970d17b4da23b71b.r2.dev/placar.json'
const ROTULO = { verdadeiro: 'Verdadeiro', impreciso: 'Impreciso', falso: 'Falso', sem_dados: 'Sem dados' }
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const host = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } }
// Defesa extra: o placar só é gravado pelo robô, mas o site não confia cegamente nele
const link = url => /^https?:\/\//i.test(url ?? '') ? esc(url) : '#'
const vered = v => v in ROTULO ? v : 'sem_dados'
let dados = null, vistos = new Set(), videoPronto = false

function conta(c) {
  const total = c.verdadeiro + c.impreciso + c.falso
  const p = k => total ? Math.round(c[k] / total * 100) : 0
  // índice de erro: falso vale 1, impreciso vale 0,5
  return { total, v: p('verdadeiro'), i: p('impreciso'), f: p('falso'), erro: total ? (c.falso + c.impreciso / 2) / total : 0 }
}

function desenhar() {
  const d = dados, [A, B] = Object.values(d.candidatos), ca = conta(A), cb = conta(B)
  if (!videoPronto) mostrarVideo(videoVisivel)

  // Mentirômetro: ponteiro para a esquerda = A erra mais, centro = empate, direita = B erra mais
  const angulo = (ca.total && cb.total) ? Math.max(-80, Math.min(80, (cb.erro - ca.erro) * 160)) : 0
  $('ponteiro').style.transform = `rotate(${angulo}deg)`
  $('lado-a').textContent = A.nome; $('lado-b').textContent = B.nome
  const dif = Math.abs(ca.erro - cb.erro)
  $('medidor-texto').innerHTML = !(ca.total && cb.total) ? 'Esperando os primeiros fatos<small>precisa de pelo menos um fato checado de cada lado</small>'
    : dif < 0.1 ? 'Empate técnico<small>os dois erram parecido até agora</small>'
    : `${esc(ca.erro > cb.erro ? A.nome : B.nome)} está errando mais<small>${Math.round(Math.max(ca.erro, cb.erro) * 100)}% contra ${Math.round(Math.min(ca.erro, cb.erro) * 100)}% de índice de erro</small>`
  $('medidor').setAttribute('aria-label', `Mentirômetro: ${A.nome} ${Math.round(ca.erro * 100)}% de erro, ${B.nome} ${Math.round(cb.erro * 100)}%`)

  $('cands').innerHTML = [[A, ca], [B, cb]].map(([c, p]) => `<div class="cand">
      <h3>${esc(c.nome)}</h3>
      <div class="pct">${p.total ? Math.round(p.erro * 100) : '–'}<small>% de erro</small></div>
      <div class="barra" role="img" aria-label="${p.v}% verdadeiro, ${p.i}% impreciso, ${p.f}% falso">
        <span class="v" style="flex-grow:${p.v}"></span><span class="i" style="flex-grow:${p.i}"></span><span class="f" style="flex-grow:${p.f}"></span>
      </div>
      <div class="contagem">${c.verdadeiro} verdadeiro · ${c.impreciso} impreciso · ${c.falso} falso<br>${c.sem_dados} sem dados</div>
    </div>`).join('')

  $('fatos').innerHTML = d.fatos?.length ? d.fatos.map(f => {
    const novo = vistos.size && !vistos.has(f.tema + f.declaracoes.length)
    vistos.add(f.tema + f.declaracoes.length)
    return `<li class="fato${novo ? ' novo' : ''}"><h3>${esc(f.tema)}</h3>${f.declaracoes.map(x => `
      <div class="decl ${vered(x.veredito)}">
        <div class="cab"><span class="tecla ${vered(x.veredito)}">${ROTULO[vered(x.veredito)]}</span><b>${esc(d.candidatos[x.quem].nome)}</b>
          <span>${new Date(x.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</span></div>
        <p class="disse">${esc(x.afirmacao)}</p>
        ${x.contexto ? `<p class="ctx">${esc(x.contexto)}</p>` : ''}
        ${x.motivo ? `<p class="motivo">${esc(x.motivo)}</p>` : ''}
        <div class="fonte">${x.fonte ? `Fonte: <a href="${link(x.fonte.url)}" target="_blank" rel="noopener">${esc(x.fonte.titulo)}</a> (${esc(host(x.fonte.url))})` : 'Nenhuma fonte encontrada.'}</div>
      </div>`).join('')}</li>`
  }).join('') : '<li class="vazio">Os fatos aparecem aqui quando um candidato citar um dado que dá para checar.</li>'

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
  const texto = encodeURIComponent(`Mentirômetro do debate, ao vivo: ${resumo}\n${tons}\n${location.href}`)
  $('share-x').href = `https://x.com/intent/post?text=${texto}`
  $('share-zap').href = `https://wa.me/?text=${texto}`
}

function relogio() {
  if (!dados) return
  const s = Math.round((Date.now() - dados.atualizado) / 1000), vivo = s < 120
  $('status').classList.toggle('vivo', vivo)
  const reprise = dados.video && !dados.video.ao_vivo
    ? ` · reprise do debate de ${new Date(dados.video.data).toLocaleDateString('pt-BR')}` : ''
  $('status-texto').innerHTML = vivo ? `<strong>Ao vivo</strong> · checagem ~30s atrás da TV${reprise}` : `Última atualização há ${Math.round(s / 60)} min`
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
let videoVisivel = true
try { videoVisivel = localStorage.getItem('video') !== 'oculto' } catch {}
function mostrarVideo(visivel) {
  videoVisivel = visivel
  try { localStorage.setItem('video', visivel ? 'visivel' : 'oculto') } catch {}
  $('com-video').hidden = !visivel
  $('sem-video').hidden = visivel
  $('topo').classList.toggle('sem-video', !visivel)
  if (!visivel) { $('video').innerHTML = ''; videoPronto = !!dados; return relogio() }
  if (!dados?.video?.id) return
  const inicio = dados.video.ao_vivo ? 0 : Math.round(segundosDeDebate())
  $('video').innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(dados.video.id)}?autoplay=1&mute=1&start=${inicio}"
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
buscar(); setInterval(() => { if (!document.hidden) buscar() }, 4000)
document.addEventListener('visibilitychange', () => { if (!document.hidden) buscar() })

// Quantas pessoas estão com o site aberto agora
function audiencia(espera = 2000) {
  if (LOCAL) return
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ao-vivo`)
  ws.onmessage = e => {
    const n = +e.data
    $('audiencia').hidden = false
    $('audiencia').innerHTML = `<b>${n.toLocaleString('pt-BR')}</b> ${n === 1 ? 'pessoa assistindo' : 'pessoas assistindo'} agora`
  }
  ws.onclose = () => setTimeout(() => audiencia(Math.min(espera * 2, 60000)), espera + Math.random() * 1000)
}
audiencia()
