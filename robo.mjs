// Robô do placar: ouve o debate no YouTube, transcreve, o Jev separa as afirmações checáveis,
// um modelo barato com busca na web dá o veredito, e publica placar.json no Cloudflare R2. Roda no PC do operador durante o debate.
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
  contexto: { type: 'string' },                  // padrão: debate do 2º turno no mês atual
  local: { type: 'boolean', default: false },    // grava em site/placar.json em vez do R2
} })
arg.contexto ??= `Debate presidencial do segundo turno no Brasil, ${new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`
const URL_VIDEO = positionals[0]
if (!URL_VIDEO) throw new Error('Passe a URL do YouTube')

const KEY = process.env.OPENROUTER_API_KEY
const BUCKET = 'placar-debate'
const SEGUNDOS = 10
// Calibragem: abaixo disso o Jev considera que a frase não é uma afirmação checável
const CHECAVEL_MIN = 0.6
const JUIZ = 'google/gemini-3.1-flash-lite' // testado: acertou 6/6 frases do debate de 2022 com busca Parallel
const VEREDITOS = ['verdadeiro', 'impreciso', 'falso', 'sem_dados']
const WHISPER_LIXO = /amara\.org|legendas? (pela|por)|inscreva-se|obrigad[oa] por assistir/i

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

// Jev: filtro barato e rápido antes de gastar com busca na web
const CHECAVEL = { checavel: { type: 'noul',
  instructions: 'A frase faz uma afirmação factual objetiva que pode ser checada (número, estatística, fato histórico, ato de governo, evento)?',
  criteria: { true: 'Afirma um fato verificável', false: 'Opinião, promessa, pergunta, ataque pessoal, cumprimento ou frase incompleta' } } }

const REGRAS = 'Você é um checador de fatos imparcial. Julgue se o CONTEÚDO da afirmação é verdadeiro segundo os dados, NÃO se a pessoa disse a frase. ' +
  'Prefira dados oficiais (IBGE, INPE, Banco Central, TSE) e agências de checagem. Responda só JSON: ' +
  '{"veredito":"verdadeiro|impreciso|falso|sem_dados","motivo":"uma frase curta com o dado correto","fonte":"url usada"}. ' +
  'verdadeiro = os dados confirmam; impreciso = exagerado, parcialmente certo ou fora de contexto; falso = os dados contradizem; sem_dados = as fontes não trazem dado sobre o fato.'

// Juiz: modelo barato + busca na web (agências de checagem, imprensa, dados oficiais)
async function julgar(frase, nome) {
  const r = await openrouter('v1/chat/completions', {
    model: JUIZ, max_tokens: 300, temperature: 0, response_format: { type: 'json_object' },
    plugins: [{ id: 'web', engine: 'parallel', mode: 'turbo', max_results: 5 }],
    messages: [{ role: 'system', content: REGRAS },
      { role: 'user', content: `${frase}\n\n(Afirmação de ${nome}. ${arg.contexto}. É verdade?)` }],
  })
  const msg = r.choices[0].message
  const resultados = (msg.annotations ?? []).map(a => a.url_citation)
  const v = JSON.parse(msg.content.replace(/^```(json)?|```$/g, ''))
  // Só aceita link que veio mesmo da busca; nunca uma URL inventada pelo modelo
  const fonte = resultados.find(x => x.url === v.fonte) ?? resultados[0]
  return {
    veredito: VEREDITOS.includes(v.veredito) ? v.veredito : 'sem_dados',
    motivo: String(v.motivo ?? '').slice(0, 280),
    fonte: fonte ? { titulo: fonte.title || new URL(fonte.url).hostname, url: fonte.url } : null,
  }
}

async function checar(frase, quem) {
  if (quem === '0' || frase.length < 25) return
  const t = Date.now(), nome = placar.candidatos[quem].nome
  try {
    const { answers } = await openrouter('alpha/decisions', { model: 'typesafe/jev-1.14', state: { contexto: arg.contexto, frase }, questions: CHECAVEL })
    if (answers.checavel.noul < CHECAVEL_MIN) return
    const j = await julgar(frase, nome)
    placar.candidatos[quem][j.veredito]++
    placar.falas.push({ t, quem, frase, ...j })
    placar.falas = placar.falas.sort((x, y) => y.t - x.t).slice(0, 60)
    console.log(`\n[${j.veredito.toUpperCase()}] ${nome}: ${frase}\n   →${j.motivo}${j.fonte ? ` (${j.fonte.url})` : ''}`)
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
