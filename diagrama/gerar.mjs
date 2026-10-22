// Gera o fluxograma do sistema em dois formatos a partir dos mesmos dados:
//   fluxo.excalidraw → abrir/editar em excalidraw.com (Menu → Abrir)
//   fluxo.html       → mesma cara (rough.js), para tirar o PNG do vídeo
// Rode: node diagrama/gerar.mjs
import { writeFileSync } from 'node:fs'

const COR = { amarelo: '#ffec99', azul: '#a5d8ff', verde: '#b2f2bb', vermelho: '#ffc9c9', roxo: '#d0bfff', laranja: '#ffd8a8', cinza: '#e9ecef', branco: '#ffffff' }
const W = 2400, H = 1350

// Colunas: 1 preparação · 2 durante o debate (notebook) · 3 nuvem
const areas = [
  { x: 30, y: 110, w: 610, h: 1210, titulo: '1. Antes do debate' },
  { x: 680, y: 110, w: 900, h: 1210, titulo: '2. Durante o debate (seu notebook)' },
  { x: 1620, y: 110, w: 750, h: 1210, titulo: '3. Na nuvem (Cloudflare)' },
]

const caixas = {
  claude:   { x: 90,   y: 200,  w: 490, h: 120, cor: 'amarelo', texto: 'Claude Code\n(escreve o código e cuida do deploy)' },
  github:   { x: 90,   y: 430,  w: 490, h: 100, cor: 'cinza',   texto: 'GitHub\n(código aberto)' },
  vozes:    { x: 90,   y: 660,  w: 490, h: 130, cor: 'roxo',    texto: 'Cadastro de voz\nvídeos dos candidatos →\n"impressão digital" da voz' },
  plantao:  { x: 90,   y: 950,  w: 490, h: 140, cor: 'amarelo', texto: 'Claude de plantão\nvigia erros, placar parado e gasto\ne corrige na hora' },
  revisao:  { x: 90,   y: 1150, w: 490, h: 110, cor: 'amarelo', texto: 'Revisão pós-debate (Claude)\nouve tudo de novo e refaz os vereditos\n→ placar revisado, com o antes', tracejado: true },

  live:     { x: 760,  y: 170,  w: 360, h: 90,  cor: 'vermelho', texto: 'Debate ao vivo\n(YouTube ou áudio do PC)' },
  audio:    { x: 760,  y: 320,  w: 360, h: 90,  cor: 'cinza',   texto: 'yt-dlp + ffmpeg\npedaços de 10 segundos' },
  whisper:  { x: 760,  y: 470,  w: 360, h: 90,  cor: 'azul',    texto: 'gpt-audio-mini\ntranscreve' },
  quem:     { x: 1190, y: 470,  w: 360, h: 90,  cor: 'roxo',    texto: 'Reconhece a voz\nquem está falando?' },
  jev:      { x: 760,  y: 640,  w: 360, h: 110, cor: 'azul',    texto: 'Jev\nmede o tom (tempo de fala) e\npeneira: só conversa para aqui' },
  haiku:    { x: 1190, y: 640,  w: 360, h: 110, cor: 'azul',    texto: 'Haiku 5.5\nfatos, propostas e ataques\n(fala repetida reaproveita veredito)' },
  busca:    { x: 1190, y: 830,  w: 360, h: 110, cor: 'verde',   texto: 'Busca na web + Perplexity\nlê as páginas, só o publicado até\naquele momento (sem partidos)' },
  juiz:     { x: 1190, y: 1010, w: 360, h: 130, cor: 'azul',    texto: 'Juiz (Gemini 3.8 Flash)\nveredito + fonte\nfalso/impreciso: outros modelos\nouvem o áudio de novo' },
  placar:   { x: 760,  y: 1010, w: 360, h: 130, cor: 'laranja', texto: 'placar.json\n(tudo junto)' },
  teto:     { x: 760,  y: 830,  w: 360, h: 110, cor: 'vermelho', texto: 'Teto de gasto: US$2\nUS$1,60 → para de checar fatos\nUS$2 → desliga a IA', tracejado: true },

  r2:       { x: 1700, y: 1010, w: 600, h: 110, cor: 'laranja', texto: 'R2 + cache de 3s\nplacar-dados.zenithonacademy.com.br' },
  site:     { x: 1700, y: 760,  w: 600, h: 110, cor: 'verde',   texto: 'Site (grátis e ilimitado)\nplacar.zenithonacademy.com.br' },
  contador: { x: 1700, y: 560,  w: 600, h: 100, cor: 'roxo',    texto: 'Contador "pessoas assistindo"\n(WebSocket + Durable Object)' },
  publico:  { x: 1700, y: 200,  w: 600, h: 260, cor: 'branco',  texto: 'Público no celular / PC\n\nMentirômetro · Propostas x Ataques\nLinha do tempo · Fatos checados\nCard para Stories · Vídeo da live' },
}

// [de, para, rótulo, lado de saída, lado de chegada]
const setas = [
  ['claude', 'github', 'gh CLI', 'b', 't'],
  ['claude', 'site', 'wrangler CLI (deploy)', 'r', 'l', false, [[650, 260], [650, 1300], [1650, 1300], [1650, 815]]],
  ['vozes', 'quem', '', 'r', 'l', true, [[665, 725], [665, 795], [1155, 795], [1155, 515]]],
  ['live', 'audio', '', 'b', 't'],
  ['audio', 'whisper', '', 'b', 't'],
  ['whisper', 'quem', '', 'r', 'l'],
  ['whisper', 'jev', 'texto', 'b', 't'],
  ['quem', 'haiku', 'texto + quem falou', 'b', 't'],
  ['jev', 'haiku', 'passou', 'r', 'l'],
  ['haiku', 'busca', 'só os fatos', 'b', 't'],
  ['busca', 'juiz', '', 'b', 't'],
  ['juiz', 'placar', '', 'l', 'r'],
  ['jev', 'teto', '', 'b', 't', true],
  ['teto', 'placar', '', 'b', 't', true],
  ['placar', 'r2', 'wrangler (a cada fato)', 'b', 'b'],
  ['r2', 'site', 'lê a cada 6s', 't', 'b'],
  ['site', 'contador', '', 't', 'b'],
  ['contador', 'publico', '', 't', 'b'],
  ['plantao', 'placar', 'lê o log do robô', 'r', 'l', true, [[705, 1020], [705, 1075]]],
  ['revisao', 'r2', 'depois do debate', 'r', 'r', true, [[705, 1205], [705, 1265], [2340, 1265], [2340, 1065]]],
]

const ponto = (c, lado) => ({ t: [c.x + c.w / 2, c.y], b: [c.x + c.w / 2, c.y + c.h], l: [c.x, c.y + c.h / 2], r: [c.x + c.w, c.y + c.h / 2] })[lado]
function caminho([de, para, , ld, lp, , via]) {
  const a = ponto(caixas[de], ld), b = ponto(caixas[para], lp)
  if (via) return [a, ...via, b] // rota desenhada à mão para não cruzar caixas
  if (ld === 'b' && lp === 'b') { const y = Math.max(a[1], b[1]) + 70; return [a, [a[0], y], [b[0], y], b] } // contorna por baixo
  if (ld === 'r' && lp === 'l' && a[1] !== b[1]) { const x = (a[0] + b[0]) / 2; return [a, [x, a[1]], [x, b[1]], b] }
  return [a, b]
}

// ---------- Excalidraw ----------
let n = 0
const id = () => `e${++n}`
const base = (extra) => ({ angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
  roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: Math.floor(Math.random() * 2 ** 31), version: 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31), isDeleted: false, boundElements: [], updated: Date.now(), link: null, locked: false, ...extra })
const texto = (t, x, y, w, h, tam, extra = {}) => base({ id: id(), type: 'text', x, y, width: w, height: h, text: t, originalText: t, fontSize: tam, fontFamily: 1,
  textAlign: 'center', verticalAlign: 'middle', containerId: null, lineHeight: 1.25, autoResize: true, ...extra })

const els = []
els.push(texto('Placar da Verdade: como o sistema funciona', 30, 25, W - 60, 60, 44))
for (const a of areas) {
  els.push(base({ id: id(), type: 'rectangle', x: a.x, y: a.y, width: a.w, height: a.h, strokeStyle: 'dashed', strokeColor: '#868e96', roundness: { type: 3 } }))
  els.push(texto(a.titulo, a.x, a.y + 12, a.w, 40, 30, { strokeColor: '#495057' }))
}
const ids = {}
for (const [k, c] of Object.entries(caixas)) {
  const rid = id(), tid = id()
  ids[k] = rid
  els.push(base({ id: rid, type: 'rectangle', x: c.x, y: c.y, width: c.w, height: c.h, backgroundColor: COR[c.cor], roundness: { type: 3 },
    strokeStyle: c.tracejado ? 'dashed' : 'solid', boundElements: [{ type: 'text', id: tid }] }))
  els.push(texto(c.texto, c.x, c.y, c.w, c.h, 22, { id: tid, containerId: rid }))
}
for (const s of setas) {
  const pts = caminho(s), [x0, y0] = pts[0]
  const aid = id()
  els.push(base({ id: aid, type: 'arrow', x: x0, y: y0, width: Math.abs(pts.at(-1)[0] - x0), height: Math.abs(pts.at(-1)[1] - y0),
    points: pts.map(([x, y]) => [x - x0, y - y0]), strokeStyle: s[5] ? 'dashed' : 'solid', roundness: { type: 2 },
    startBinding: { elementId: ids[s[0]], focus: 0, gap: 4 }, endBinding: { elementId: ids[s[1]], focus: 0, gap: 4 }, startArrowhead: null, endArrowhead: 'arrow' }))
  for (const k of [s[0], s[1]]) els.find(e => e.id === ids[k]).boundElements.push({ type: 'arrow', id: aid })
  if (s[2]) {
    const meio = pts[Math.floor((pts.length - 1) / 2)], prox = pts[Math.floor((pts.length - 1) / 2) + 1]
    const mx = (meio[0] + prox[0]) / 2, my = (meio[1] + prox[1]) / 2
    els.push(texto(s[2], mx - 150, my - 32, 300, 26, 18, { strokeColor: '#495057' }))
  }
}
writeFileSync(new URL('fluxo.excalidraw', import.meta.url), JSON.stringify({ type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: els,
  appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} }, null, 2))

// ---------- HTML (rough.js) para o PNG ----------
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&display=block" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js"></script>
<style>body{margin:0;background:#fff}svg{display:block}text{font-family:Kalam,cursive;fill:#1e1e1e}</style></head>
<body><svg id="s" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"></svg>
<script>
const areas=${JSON.stringify(areas)}, caixas=${JSON.stringify(caixas)}, COR=${JSON.stringify(COR)}, setas=${JSON.stringify(setas.map(s => [caminho(s), s[2], !!s[5]]))}
document.fonts.load('22px Kalam').then(() => {
  const s = document.getElementById('s'), rc = rough.svg(s), NS = 'http://www.w3.org/2000/svg'
  const txt = (t, x, y, tam, cor = '#1e1e1e', peso = 400) => { const linhas = t.split('\\n'); linhas.forEach((l, i) => {
    const e = document.createElementNS(NS, 'text'); e.setAttribute('x', x); e.setAttribute('y', y + (i - (linhas.length - 1) / 2) * tam * 1.25)
    e.setAttribute('text-anchor', 'middle'); e.setAttribute('dominant-baseline', 'middle'); e.setAttribute('font-size', tam); e.setAttribute('font-weight', i === 0 ? 700 : peso)
    e.style.fill = cor; e.textContent = l; s.appendChild(e) }) }
  txt('Placar da Verdade: como o sistema funciona', ${W / 2}, 55, 50)
  for (const a of areas) { s.appendChild(rc.rectangle(a.x, a.y, a.w, a.h, { stroke: '#868e96', strokeWidth: 2, strokeLineDash: [12, 10], roughness: 1 })); txt(a.titulo, a.x + a.w / 2, a.y + 35, 32, '#495057') }
  for (const c of Object.values(caixas)) {
    s.appendChild(rc.rectangle(c.x, c.y, c.w, c.h, { fill: COR[c.cor], fillStyle: 'hachure', hachureGap: 7, fillWeight: 1.5, stroke: '#1e1e1e', strokeWidth: 2, roughness: 1.2, ...(c.tracejado ? { strokeLineDash: [10, 8] } : {}) }))
    txt(c.texto, c.x + c.w / 2, c.y + c.h / 2, 23)
  }
  for (const [pts, rotulo, tracejado] of setas) {
    s.appendChild(rc.linearPath(pts, { stroke: '#1e1e1e', strokeWidth: 2.2, roughness: 0.8, ...(tracejado ? { strokeLineDash: [10, 8] } : {}) }))
    const [x1, y1] = pts.at(-2), [x2, y2] = pts.at(-1), ang = Math.atan2(y2 - y1, x2 - x1)
    s.appendChild(rc.linearPath([[x2 - 18 * Math.cos(ang - .45), y2 - 18 * Math.sin(ang - .45)], [x2, y2], [x2 - 18 * Math.cos(ang + .45), y2 - 18 * Math.sin(ang + .45)]], { stroke: '#1e1e1e', strokeWidth: 2.2, roughness: 0.6 }))
    if (rotulo) { const i = Math.floor((pts.length - 1) / 2), mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2
      const bg = document.createElementNS(NS, 'rect'); const w = rotulo.length * 9.5 + 16; bg.setAttribute('x', mx - w / 2); bg.setAttribute('y', my - 32); bg.setAttribute('width', w); bg.setAttribute('height', 26); bg.setAttribute('fill', '#fff'); s.appendChild(bg)
      txt(rotulo, mx, my - 19, 19, '#495057') }
  }
  document.title = 'pronto'
})
</script></body></html>`
writeFileSync(new URL('fluxo.html', import.meta.url), html)
console.log('ok: diagrama/fluxo.excalidraw e diagrama/fluxo.html')
