// Robô do placar. Roda no PC do operador durante o debate:
//   áudio do YouTube em pedaços de 10s → Whisper transcreve → voz identifica quem fala →
//   Jev mede o tom (proposta, ataque, defesa...) · Haiku extrai fatos, propostas e ataques →
//   busca na web só com o que existia ATÉ aquele momento → juiz dá o veredito → placar.json no R2.
//
// Uso:  node --env-file=.env robo.mjs <url-youtube> --a "Nome A" --b "Nome B" [--inicio 4230] [--local] [--continuar]
// --continuar: se o robô cair no meio do debate, volta de onde parou (lê tmp/placar.json)
// Vídeo gravado vira simulação: o robô "vive" na data e hora em que o debate passou ao vivo.
// Teclas: a = automático (voz) · 1 / 2 / 0 = força candidato A / B / mediador
import { spawn, execFile, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { lerWav, carregarVozes, quemFala, rotular, reforcar } from './voz.mjs'

const { values: arg, positionals } = parseArgs({ allowPositionals: true, options: {
  a: { type: 'string', default: 'Candidato A' },
  b: { type: 'string', default: 'Candidato B' },
  inicio: { type: 'string', default: '0' },      // segundos; só vale para vídeo gravado
  local: { type: 'boolean', default: false },    // grava em site/placar.json em vez do R2
  continuar: { type: 'boolean', default: false },
} })
const URL_VIDEO = positionals[0]
if (!URL_VIDEO) throw new Error('Passe a URL do YouTube')

const KEY = process.env.OPENROUTER_API_KEY
const BUCKET = 'placar-debate'
const SEGUNDOS = 10
const EXTRATOR = 'anthropic/claude-haiku-5.5'
const BUSCADOR = 'google/gemini-2.5-flash-lite' // só carrega a busca; não escreve nada
const JUIZ = 'google/gemini-3.1-flash-lite'     // testado: acertou 6/6 frases do debate de 2022
const VEREDITOS = ['verdadeiro', 'impreciso', 'falso', 'sem_dados']
const WHISPER_LIXO = /amara\.org|legendas? (pela|por)|inscreva-se|obrigad[oa] por assistir/i

// ---------- Vídeo e relógio ----------
// YouTube às vezes nega (403) e na tentativa seguinte libera
function ytdlp(...a) {
  for (let i = 1; ; i++) {
    try { return execFileSync('yt-dlp', ['--no-update', ...a, URL_VIDEO], { encoding: 'utf8' }).trim() }
    catch (e) { if (i === 4) throw e; console.error(`yt-dlp falhou (tentativa ${i}), tentando de novo...`) }
  }
}
const [aoVivo, inicioLive] = ytdlp('--print', '%(is_live)s %(release_timestamp)s').split(' ')
const placar = {
  atualizado: 0,
  video: { id: new URL(URL_VIDEO).searchParams.get('v') ?? URL_VIDEO.split('/').pop(), ao_vivo: aoVivo === 'True', inicio: +arg.inicio, t0: Date.now() },
  candidatos: { 1: zerado(arg.a), 2: zerado(arg.b) },
  fatos: [],     // [{ tema, atualizado, declaracoes: [{ t, quem, afirmacao, contexto, veredito, motivo, fonte }] }]
  propostas: [], // [{ quem, titulo, explicacao, vezes, t }]
  ataques: [],   // [{ quem, resumo, t }] (só os últimos)
}
function zerado(nome) {
  return { nome, verdadeiro: 0, impreciso: 0, falso: 0, sem_dados: 0, propostas: 0, ataques: 0,
    tempo: { proposta: 0, ataque: 0, defesa: 0, balanco: 0, outro: 0 } } // segundos de fala por tom
}
if (arg.continuar && existsSync('tmp/placar.json')) {
  const salvo = JSON.parse(readFileSync('tmp/placar.json', 'utf8'))
  for (const k of ['fatos', 'propostas', 'ataques']) placar[k] = salvo[k] ?? []
  for (const q of ['1', '2']) Object.assign(placar.candidatos[q], salvo.candidatos?.[q], { nome: placar.candidatos[q].nome })
  console.log('continuando de onde parou:', placar.fatos.length, 'fatos,', placar.propostas.length, 'propostas')
}
// "Agora" do debate: ao vivo é o relógio real; gravado é a hora em que aquele trecho passou na TV
const agora = () => placar.video.ao_vivo || inicioLive === 'NA' ? new Date()
  : new Date(+inicioLive * 1000 + +arg.inicio * 1000 + (Date.now() - placar.video.t0))
placar.video.data = agora().toISOString()
const quando = () => agora().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short' })
const situacao = () => `Agora é ${quando()}. Você está acompanhando AO VIVO o debate presidencial do segundo turno no Brasil entre ${arg.a} e ${arg.b}. ` +
  'Só existe o que foi publicado até este momento: checagens e notícias sobre este debate ainda não saíram.'

const nomeDe = quem => quem === '0' ? 'Mediador' : placar.candidatos[quem].nome

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
const json = texto => JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1))
let gasto = 0
const somar = r => (gasto += r.usage?.cost ?? 0, r)

async function transcrever(arquivo) {
  const r = somar(await openrouter('v1/audio/transcriptions', {
    model: 'openai/whisper-large-v3-turbo', language: 'pt', temperature: 0,
    response_format: 'verbose_json', timestamp_granularities: ['segment'],
    input_audio: { data: readFileSync(arquivo).toString('base64'), format: 'wav' },
  }))
  return (r.segments ?? []).filter(s => s.text.trim() && !WHISPER_LIXO.test(s.text))
}

// 1. Jev: mede o tom do trecho em ~0,2s. Devolve a probabilidade de cada tipo, então o tempo de fala
//    é dividido na proporção (trecho 70% ataque / 30% proposta → 70% dos segundos para ataque)
const TOM = { tom: { type: 'choice', instructions: 'O que o candidato está fazendo neste trecho do debate?', criteria: {
  proposta: 'Diz o que vai fazer se for eleito', ataque: 'Ofende, acusa ou desqualifica o adversário',
  defesa: 'Rebate uma acusação feita contra ele', balanco: 'Fala do que já fez no governo ou cita dados do passado',
  outro: 'Cumprimento, regra do debate ou pergunta' } } }
async function medirTom(texto) {
  const { answers } = somar(await openrouter('alpha/decisions', { model: 'typesafe/jev-1.14', state: texto, questions: TOM }))
  return answers.tom.probabilities
}

// 2. Haiku: lê o trecho como um editor. Escolhe o que vale checar (corrigindo a transcrição),
//    anota propostas e ataques com texto (o que o Jev não escreve)
const EXTRAIR = `Você é editor de uma agência de checagem cobrindo o debate. A transcrição automática pode ter erros.
Leia o TRECHO do candidato e responda só JSON:
{"afirmacoes":[{"tema":"","afirmacao":"","contexto":"","busca":""}],"propostas":[{"titulo":"","explicacao":""}],"ataques":[{"resumo":""}]}

afirmacoes (máx. 2): só o que REALMENTE vale uma checagem: números, estatísticas, comparações, atos de governo, leis, eventos.
Ignore retórica e frases de efeito ("não sou candidato de primeira viagem"), opiniões, promessas, ataques, perguntas,
falas óbvias ou triviais. Na dúvida, não extraia. Lista vazia é o mais comum.
- Não repita o que já está em AFIRMAÇÕES JÁ CHECADAS (o trecho pode repetir falas anteriores).
- tema: 1 a 3 palavras. Se o assunto já estiver em TEMAS EXISTENTES, use exatamente o mesmo nome.
- afirmacao: o que o candidato afirmou, em 1 frase na 3ª pessoa, corrigindo erros óbvios de transcrição, sem mudar o sentido.
- contexto: 1 frase curta explicando o argumento (ex.: "respondendo a X sobre Y").
- busca: consulta curta para achar o DADO na web (sem mencionar o debate).

propostas (máx. 2): o que o candidato diz que VAI FAZER se eleito, de forma concreta. Promessa vaga ("vou cuidar do povo") não conta.
- titulo: 2 a 6 palavras. Se a mesma proposta já está em PROPOSTAS JÁ DITAS por ele, repita exatamente o título.
- explicacao: 1 ou 2 frases simples: o que é e como ele diz que vai fazer.

ataques (máx. 3): cada ofensa, acusação ou desqualificação pessoal contra o adversário (crítica a política pública com dados não conta).
- resumo: 1 frase neutra na 3ª pessoa, sem repetir palavrão (ex.: "chamou o adversário de mentiroso").`

async function ler(texto, quem, anterior) {
  const ditas = placar.propostas.filter(p => p.quem === quem).map(p => p.titulo).slice(-30).join('; ') || 'nenhuma'
  const r = somar(await openrouter('v1/chat/completions', {
    model: EXTRATOR, max_tokens: 1000, temperature: 0, reasoning: { enabled: false },
    messages: [{ role: 'system', content: `${situacao()}\n\n${EXTRAIR}` }, { role: 'user', content:
      `TEMAS EXISTENTES: ${placar.fatos.map(f => f.tema).slice(0, 20).join(', ') || 'nenhum'}\n` +
      `PROPOSTAS JÁ DITAS por ${nomeDe(quem)}: ${ditas}\n` +
      `AFIRMAÇÕES JÁ CHECADAS: ${placar.fatos.flatMap(f => f.declaracoes).slice(-15).map(d => d.afirmacao).join(' | ') || 'nenhuma'}\n` +
      `FALAS ANTERIORES:\n${anterior}\n\nTRECHO de ${nomeDe(quem)}:\n${texto}` }],
  }))
  const v = json(r.choices[0].message.content)
  return { afirmacoes: v.afirmacoes ?? [], propostas: v.propostas ?? [], ataques: v.ataques ?? [] }
}

// 3. Busca na web, descartando o que foi publicado depois do "agora" (essencial na simulação:
//    as checagens do próprio debate saíram depois e entregariam a resposta)
const MESES = '|janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro'.split('|')
function depoisDe(limite, url, titulo, texto) {
  // ponytail: datas tiradas de URL, título e texto; página que não cita data nenhuma passa (pode vazar algo do futuro)
  let m = url.match(/\/(20\d\d)[/-](\d\d)(?:[/-](\d\d))?(?=[/-])/)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] ?? 1))) > limite
  const tudo = `${titulo} ${texto}`.slice(0, 4000)
  m = tudo.slice(0, 800).match(/\b(\d{1,2})(?:\/(\d{1,2})\/(20\d\d|\d\d)| de (\p{L}+) de (20\d\d))\b/u)
  if (m) {
    const ano = +(m[3] ?? m[5]), mes = m[2] ? +m[2] - 1 : MESES.indexOf(m[4])
    if (new Date(Date.UTC(ano < 100 ? 2000 + ano : ano, mes, +m[1])) > limite) return true
  }
  // texto que cita um ano posterior ao "agora" foi escrito depois dele
  return Math.max(0, ...(tudo.match(/\b20\d\d\b/g) ?? []).map(Number)) > limite.getUTCFullYear()
}
async function buscar(consulta) {
  const r = somar(await openrouter('v1/chat/completions', {
    model: BUSCADOR, max_tokens: 1,
    plugins: [{ id: 'web', engine: 'parallel', mode: 'turbo', max_results: 10 }],
    messages: [{ role: 'user', content: consulta }],
  }))
  const limite = agora()
  return (r.choices[0].message.annotations ?? []).map(a => a.url_citation)
    .filter(x => !depoisDe(limite, x.url, x.title ?? '', x.content ?? ''))
    .slice(0, 5)
}

// 4. Juiz: lê só as provas filtradas
const REGRAS = 'Você é um checador de fatos imparcial. Julgue se o CONTEÚDO da afirmação é verdadeiro segundo os dados das PROVAS, ' +
  'NÃO se a pessoa disse a frase. Prefira dados oficiais (IBGE, INPE, Banco Central, TSE) e agências de checagem. ' +
  'Não use nada que só tenha acontecido depois de agora. Responda só JSON: ' +
  '{"veredito":"verdadeiro|impreciso|falso|sem_dados","motivo":"uma frase curta com o dado correto","fonte":"url da prova usada"}. ' +
  'verdadeiro = os dados confirmam; impreciso = exagerado, parcialmente certo ou fora de contexto; falso = os dados contradizem; sem_dados = as provas não trazem dado sobre o fato.'

async function julgar(a, quem) {
  const provas = await buscar(a.busca)
  const r = somar(await openrouter('v1/chat/completions', {
    model: JUIZ, max_tokens: 300, temperature: 0, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: `${situacao()}\n\n${REGRAS}` }, { role: 'user', content:
      `Afirmação de ${nomeDe(quem)}: ${a.afirmacao}\nContexto: ${a.contexto}\n\nPROVAS:\n` +
      (provas.map((p, i) => `[${i + 1}] ${p.title} (${p.url})\n${(p.content ?? '').slice(0, 1500)}`).join('\n\n') || '(nenhuma)') }],
  }))
  const v = json(r.choices[0].message.content)
  // Só aceita link que veio mesmo da busca; nunca uma URL inventada pelo modelo
  const fonte = provas.find(x => x.url === v.fonte) ?? (v.veredito !== 'sem_dados' ? provas[0] : null)
  return {
    veredito: VEREDITOS.includes(v.veredito) ? v.veredito : 'sem_dados',
    motivo: String(v.motivo ?? '').slice(0, 400),
    fonte: fonte ? { titulo: fonte.title || new URL(fonte.url).hostname, url: fonte.url } : null,
  }
}

const historico = [] // últimos trechos de todo mundo, para o Haiku entender réplica e tréplica
async function analisar(texto, quem, t, duracao) {
  const anterior = historico.slice(-3).join('\n') || '(início)'
  historico.push(`${nomeDe(quem)}: ${texto}`)
  if (quem === '0' || texto.length < 40) return
  try {
    const [lido, tom] = await Promise.all([ler(texto, quem, anterior), medirTom(texto)]) // Jev e Haiku em paralelo
    const c = placar.candidatos[quem]
    for (const k in c.tempo) c.tempo[k] = Math.round((c.tempo[k] + duracao * (tom[k] ?? 0)) * 10) / 10
    for (const p of lido.propostas) {
      c.propostas++
      const ja = placar.propostas.find(x => x.quem === quem && x.titulo.toLowerCase() === String(p.titulo).toLowerCase())
      if (ja) ja.vezes++
      else placar.propostas.push({ quem, titulo: String(p.titulo), explicacao: String(p.explicacao ?? ''), vezes: 1, t })
      console.log(`\n[PROPOSTA] ${nomeDe(quem)}: ${p.titulo}`)
    }
    for (const a of lido.ataques) {
      c.ataques++
      placar.ataques = [{ quem, resumo: String(a.resumo), t }, ...placar.ataques].slice(0, 30)
      console.log(`\n[ATAQUE] ${nomeDe(quem)}: ${a.resumo}`)
    }
    publicar()
    await Promise.all(lido.afirmacoes.map(async a => {
      const j = await julgar(a, quem)
      placar.candidatos[quem][j.veredito]++
      let fato = placar.fatos.find(f => f.tema.toLowerCase() === String(a.tema).toLowerCase())
      if (!fato) placar.fatos.push(fato = { tema: String(a.tema), declaracoes: [] })
      fato.atualizado = Date.now()
      fato.declaracoes.push({ t, quem, afirmacao: a.afirmacao, contexto: a.contexto, ...j })
      placar.fatos = placar.fatos.sort((x, y) => y.atualizado - x.atualizado).slice(0, 40)
      console.log(`\n[${j.veredito.toUpperCase()}] ${nomeDe(quem)} · ${a.tema}: ${a.afirmacao}\n   → ${j.motivo}${j.fonte ? ` (${j.fonte.url})` : ''}`)
      publicar()
    }))
  } catch (e) { console.error('\nerro analisando:', e.message) }
  status()
}

// Junta frases do mesmo falante em trechos de ~20–40s, cortando na troca de falante ou em fim de frase
let trecho = { quem: '0', texto: '', t: 0, duracao: 0 }
function fechar() {
  if (trecho.texto.trim()) analisar(trecho.texto.trim(), trecho.quem, trecho.t, trecho.duracao)
  trecho = { quem: trecho.quem, texto: '', t: 0, duracao: 0 }
}
function receber(texto, quem, duracao) {
  if (quem !== trecho.quem) fechar()
  trecho.quem = quem
  trecho.duracao += duracao
  trecho.t ||= agora().getTime() // hora do debate (na reprise, a hora em que passou na TV)
  trecho.texto += ' ' + texto.trim()
  if (trecho.texto.length > 350 && /[.!?]$/.test(texto.trim())) fechar()
}

// ---------- Quem está falando ----------
const temVozes = [arg.a, arg.b].every(n => existsSync(`vozes/${n}.json`))
const vozes = temVozes ? carregarVozes([arg.a, arg.b]) : null
let forcado = temVozes ? null : '0' // null = automático pela voz; '1' | '2' | '0' = operador mandou
let ultimo = '0'
function falantes(arquivo, segmentos) {
  if (forcado && vozes && forcado !== '0') { // operador corrigiu: a voz aprende com o áudio do debate
    const i = +forcado - 1
    vozes[i] = reforcar(placar.candidatos[forcado].nome, vozes[i], quemFala(lerWav(arquivo), vozes))
  }
  if (forcado) return segmentos.map(() => forcado)
  const janelas = quemFala(lerWav(arquivo), vozes)
  return segmentos.map(s => String(rotular(janelas, s.start, s.end) + 1)) // -1 → '0' (mediador), 0 → '1', 1 → '2'
}

// ---------- Publicação (R2 via wrangler, uma de cada vez, sempre a mais nova) ----------
let publicando = false, pendente = false
function publicar() {
  placar.atualizado = Date.now()
  writeFileSync('tmp/placar.json', JSON.stringify(placar)) // também serve para o --continuar
  if (arg.local) return writeFileSync('site/placar.json', JSON.stringify(placar))
  if (publicando) return void (pendente = true)
  publicando = true
  writeFileSync('tmp/envio.json', JSON.stringify(placar)) // cópia própria: o placar.json pode mudar durante o envio
  execFile(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'r2', 'object', 'put', `${BUCKET}/placar.json`,
    '--file', 'tmp/envio.json', '--content-type', 'application/json', '--cache-control', 'public, max-age=3', '--remote'],
  (erro) => {
    if (erro) console.error('\nerro publicando:', erro.message.split('\n')[0])
    publicando = false
    if (pendente) pendente = false, publicar()
  })
}

// ---------- Áudio: YouTube → ffmpeg → pedaços WAV de 10s ----------
mkdirSync('tmp/seg', { recursive: true })
let numero = 0 // numeração dos pedaços continua mesmo se a live cair e voltar
let fila = Promise.resolve()
function ouvir() {
  const saida = ['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'segment', '-segment_time', `${SEGUNDOS}`,
    '-segment_start_number', `${numero}`, '-segment_list', 'pipe:1', '-segment_list_type', 'flat', 'tmp/seg/%06d.wav']
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

  // Pedaços em ordem: um por vez (Whisper ~1,5s + voz ~0,3s para 10s de áudio)
  createInterface({ input: ffmpeg.stdout }).on('line', nome => {
    numero++
    fila = fila.then(async () => {
      const arquivo = `tmp/seg/${nome.trim()}`
      try {
        const segmentos = await transcrever(arquivo)
        const quem = falantes(arquivo, segmentos)
        segmentos.forEach((s, i) => receber(s.text, quem[i], s.end - s.start))
        if (quem.length) ultimo = quem.at(-1), status()
      } catch (e) { console.error('\nerro transcrevendo:', e.message) }
      rmSync(arquivo, { force: true })
    })
  })
  ffmpeg.on('close', () => {
    if (placar.video.ao_vivo) { console.error('\nconexão com a live caiu; reconectando em 3s...'); return setTimeout(ouvir, 3000) }
    fila.then(() => { fechar(); console.log('\nfim do áudio') })
  })
}
ouvir()
placar.video.t0 = Date.now()

// ---------- Teclado do operador ----------
function status() {
  const modo = forcado ? `MANUAL (${nomeDe(forcado)})` : 'automático'
  process.stdout.write(`\r>>> ${quando()} · falando: ${nomeDe(forcado ?? ultimo)} · voz: ${modo} · IA: US$${gasto.toFixed(4)}      `)
}
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.on('data', k => {
    const c = k.toString()
    if (c === '\u0003') process.exit()
    if ('012'.includes(c)) forcado = c
    if (c === 'a' && temVozes) forcado = null
    status()
  })
}
if (!temVozes) console.log(`sem vozes cadastradas para ${arg.a} e ${arg.b}: modo manual (teclas 1, 2, 0)`)
status()
publicar()
setInterval(publicar, 30_000) // batimento: mantém o "ao vivo" aceso no site mesmo sem fala nova
