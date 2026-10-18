// Robô do placar: ouve o debate no YouTube, transcreve, checa cada frase com o Jev
// e publica placar.json no Cloudflare R2. Roda no PC do operador durante o debate.
//
// Uso:  node --env-file=.env robo.mjs <url-youtube> --a "Nome A" --b "Nome B" [--inicio 1500] [--local]
// Teclas: 1 = candidato A falando · 2 = candidato B · 0 = mediador/intervalo (não checa)
import { spawn, execFile, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'

const { values: arg, positionals } = parseArgs({ allowPositionals: true, options: {
  a: { type: 'string', default: 'Candidato A' },
  b: { type: 'string', default: 'Candidato B' },
  inicio: { type: 'string', default: '0' },      // segundos; só vale para vídeo gravado
  quem: { type: 'string', default: '0' },        // quem começa falando
  contexto: { type: 'string', default: 'Debate presidencial do segundo turno no Brasil' },
  local: { type: 'boolean', default: false },    // grava em site/placar.json em vez do R2
} })
const URL_VIDEO = positionals[0]
if (!URL_VIDEO) throw new Error('Passe a URL do YouTube')

const KEY = process.env.OPENROUTER_API_KEY
const BUCKET = 'placar-debate'
const SEGUNDOS = 10
// Calibragem: abaixo disso a frase não é checável / o veredito vira "sem_dados"
const CHECAVEL_MIN = 0.6
const CONFIANCA_MIN = 0.5 // testado: 0.7 jogava quase tudo em sem_dados; o Jev é calibrado e assume quando não sabe
const WHISPER_LIXO = /amara\.org|legendas? (pela|por)|inscreva-se|obrigad[oa] por assistir/i
const STOP = new Set(('a o e é de do da dos das em no na nos nas um uma uns umas que se por para pra com sem ' +
  'ao aos à às eu tu ele ela nós vós eles elas me te lhe nos vos meu minha seu sua nosso nossa isso isto aquilo ' +
  'esse essa este esta aquele aquela mais menos muito muita muitos muitas como quando onde porque mas ou nem ' +
  'já não sim foi era ser ter tem têm está estão estava vai vão fazer fez feito sobre entre até também ' +
  'então aqui ali lá agora hoje gente você vocês senhor senhora candidato presidente brasil').split(' '))

const placar = {
  atualizado: 0,
  video: { id: new URL(URL_VIDEO).searchParams.get('v') ?? URL_VIDEO.split('/').pop(), ao_vivo: false, inicio: +arg.inicio, t0: Date.now() },
  candidatos: { 1: zerado(arg.a), 2: zerado(arg.b) },
  falas: [],
}
function zerado(nome) { return { nome, verdadeiro: 0, impreciso: 0, falso: 0, sem_dados: 0 } }

// ---------- OpenRouter ----------
async function openrouter(caminho, corpo) {
  const r = await fetch(`https://openrouter.ai/api/${caminho}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  })
  if (!r.ok) throw new Error(`${caminho} ${r.status}: ${await r.text()}`)
  return r.json()
}

async function transcrever(arquivo) {
  const { text } = await openrouter('v1/audio/transcriptions', {
    model: 'openai/whisper-large-v3-turbo', language: 'pt', temperature: 0,
    input_audio: { data: readFileSync(arquivo).toString('base64'), format: 'mp3' },
  })
  return WHISPER_LIXO.test(text ?? '') ? '' : (text ?? '').trim()
}

const PERGUNTAS = {
  checavel: { type: 'noul',
    instructions: 'A frase faz uma afirmação factual objetiva que pode ser checada (número, estatística, fato histórico, ato de governo, evento)?',
    criteria: { true: 'Afirma um fato verificável', false: 'Opinião, promessa, pergunta, ataque pessoal, cumprimento ou frase incompleta' } },
  veredito: { type: 'choice',
    instructions: 'Considerando as evidências e o conhecimento geral sobre o Brasil, a afirmação do candidato é:',
    criteria: { verdadeiro: 'Os fatos confirmam a afirmação', impreciso: 'Parcialmente correta, exagerada, desatualizada ou fora de contexto',
      falso: 'Os fatos contradizem a afirmação' } }, // sem "sem_dados" aqui: vira sem_dados quando a confiança é baixa
  fonte: { type: 'noul', instructions: 'Alguma das evidências trata diretamente do fato afirmado na frase?' },
}

// ---------- Wikipedia (provas) ----------
async function wikipedia(frase) {
  const termos = [...new Set(frase.toLowerCase().match(/[\p{L}\d%,.]+/gu) ?? [])]
    .map(t => t.replace(/[,.]+$/, '')).filter(t => !STOP.has(t) && (t.length > 3 || /\d/.test(t))).slice(0, 8)
  if (!termos.length) return []
  const q = new URLSearchParams({ action: 'query', format: 'json', list: 'search', srlimit: '3', srprop: 'snippet', srsearch: termos.join(' OR ') })
  const r = await fetch(`https://pt.wikipedia.org/w/api.php?${q}`, { headers: { 'User-Agent': 'PlacarDoDebate/0.1' } })
  if (!r.ok) return []
  return ((await r.json()).query?.search ?? []).map(p => ({
    titulo: p.title,
    url: `https://pt.wikipedia.org/wiki/${encodeURIComponent(p.title.replaceAll(' ', '_'))}`,
    trecho: p.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
  }))
}

// ---------- Checagem ----------
async function checar(frase, quem) {
  if (quem === '0' || frase.length < 25) return
  try {
    const provas = await wikipedia(frase)
    const nome = placar.candidatos[quem].nome
    const r = await openrouter('alpha/decisions', {
      model: 'typesafe/jev-1.14',
      state: { contexto: arg.contexto, candidato: nome, frase, evidencias: provas.map(p => `${p.titulo}: ${p.trecho}`) },
      questions: PERGUNTAS,
    })
    if (r.answers.checavel.noul < CHECAVEL_MIN) return
    const v = r.answers.veredito
    const veredito = v.confidence < CONFIANCA_MIN ? 'sem_dados' : v.choice
    const fonte = r.answers.fonte.noul > 0.5 && provas[0] ? { titulo: provas[0].titulo, url: provas[0].url } : null
    placar.candidatos[quem][veredito]++
    placar.falas.unshift({ t: Date.now(), quem, frase, veredito, confianca: +v.confidence.toFixed(2), fonte })
    placar.falas.length = Math.min(placar.falas.length, 60)
    console.log(`\n[${veredito.toUpperCase()} ${Math.round(v.confidence * 100)}%] ${nome}: ${frase}${fonte ? `  (${fonte.titulo})` : ''}`)
    publicar()
  } catch (e) { console.error('\nerro checando:', e.message) }
}

// Junta o texto dos pedaços e só solta frases completas (terminadas em . ! ?)
let falando = arg.quem
let buffer = { quem: '0', texto: '' }
function receber(texto, quem) {
  if (quem !== buffer.quem && buffer.texto) { checar(buffer.texto.trim(), buffer.quem); buffer.texto = '' }
  buffer.quem = quem
  const partes = (buffer.texto + ' ' + texto).split(/(?<=[.!?])\s+/)
  buffer.texto = /[.!?]$/.test(partes.at(-1)) ? '' : partes.pop()
  if (buffer.texto.length > 400) partes.push(buffer.texto), buffer.texto = '' // fala sem pontuação
  for (const p of partes) if (p.trim()) checar(p.trim(), quem)
}

// ---------- Publicação (R2 via wrangler, uma de cada vez, sempre a mais nova) ----------
let publicando = false, pendente = false
function publicar() {
  placar.atualizado = Date.now()
  if (arg.local) return writeFileSync('site/placar.json', JSON.stringify(placar))
  if (publicando) return void (pendente = true)
  publicando = true
  writeFileSync('tmp/placar.json', JSON.stringify(placar))
  execFile(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'r2', 'object', 'put', `${BUCKET}/placar.json`,
    '--file', 'tmp/placar.json', '--content-type', 'application/json', '--cache-control', 'public, max-age=3', '--remote'],
  (erro) => {
    if (erro) console.error('\nerro publicando:', erro.message.split('\n')[0])
    publicando = false
    if (pendente) pendente = false, publicar()
  })
}

// ---------- Áudio: YouTube → ffmpeg → pedaços de 10s ----------
mkdirSync('tmp/seg', { recursive: true })
const ytdlp = (...a) => execFileSync('yt-dlp', ['--no-update', ...a, URL_VIDEO], { encoding: 'utf8' }).trim()
placar.video.ao_vivo = ytdlp('--print', 'is_live') === 'True'
const saida = ['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', '-f', 'segment', '-segment_time', `${SEGUNDOS}`,
  '-segment_list', 'pipe:1', '-segment_list_type', 'flat', 'tmp/seg/%05d.mp3']
let ffmpeg
if (placar.video.ao_vivo) {
  const yt = spawn('yt-dlp', ['--no-update', '-q', '-f', 'bestaudio/best', '-o', '-', URL_VIDEO], { stdio: ['ignore', 'pipe', 'inherit'] })
  ffmpeg = spawn('ffmpeg', ['-v', 'error', '-i', 'pipe:0', ...saida], { stdio: ['pipe', 'pipe', 'inherit'] })
  yt.stdout.pipe(ffmpeg.stdin)
} else {
  // Gravado: baixa o áudio uma vez e toca em velocidade real, simulando a live
  console.log('baixando áudio do vídeo gravado...')
  const arquivo = ytdlp('-q', '-f', 'bestaudio', '-o', 'tmp/%(id)s.%(ext)s', '--no-simulate', '--print', 'after_move:filepath')
  ffmpeg = spawn('ffmpeg', ['-v', 'error', '-re', '-ss', arg.inicio, '-i', arquivo, ...saida], { stdio: ['ignore', 'pipe', 'inherit'] })
}
placar.video.t0 = Date.now()

// Pedaços em ordem: um transcreve por vez (Whisper leva ~1,5s para 10s de áudio)
let fila = Promise.resolve()
createInterface({ input: ffmpeg.stdout }).on('line', nome => {
  const quem = falando // ponytail: o pedaço inteiro vai para quem fala ao fim dele; troca no meio erra até 10s
  fila = fila.then(async () => {
    const arquivo = `tmp/seg/${nome.trim()}`
    try { const texto = await transcrever(arquivo); if (texto) receber(texto, quem) }
    catch (e) { console.error('\nerro transcrevendo:', e.message) }
    rmSync(arquivo, { force: true })
  })
})
ffmpeg.on('close', () => fila.then(() => { if (buffer.texto) checar(buffer.texto.trim(), buffer.quem); console.log('\nfim do áudio') }))

// ---------- Teclado do operador ----------
const status = () => process.stdout.write(`\r>>> falando agora: ${falando === '0' ? 'MEDIADOR' : placar.candidatos[falando].nome}        `)
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.on('data', k => {
    const c = k.toString()
    if (c === '\u0003') process.exit()
    if ('012'.includes(c)) falando = c, status()
  })
}
status()
publicar()
setInterval(publicar, 30_000) // batimento: mantém o "ao vivo" aceso no site mesmo sem fala nova
