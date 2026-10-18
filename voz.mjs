// Reconhecimento de voz dos candidatos: compara a "impressão digital" da voz (embedding) de cada
// janela de 2s com as vozes cadastradas antes do debate. Roda local, grátis, ~35ms por janela.
// Modelo: 3D-Speaker CAM++ zh_en (sherpa-onnx), em modelos/voz.onnx. No debate de 2022 acertou 124/124 janelas.
//
// Cadastrar (antes do debate, 1–3 min de fala limpa de cada um, de qualquer vídeo do YouTube):
//   node voz.mjs cadastrar <nome> <url-youtube> <inicio-seg> <fim-seg>   (pode repetir para somar trechos)
import sherpa from 'sherpa-onnx-node'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const TAXA = 16000
const JANELA = 2 * TAXA, PASSO = 1 * TAXA
// Calibragem: similaridade mínima para cravar um candidato; abaixo disso é mediador/outra pessoa
export const LIMIAR = 0.5 // testado (CAM++): mediador ~0.2, candidatos ~0.8

const extrator = new sherpa.SpeakerEmbeddingExtractor({ model: 'modelos/voz.onnx', numThreads: 2, debug: 0 })

export function impressao(amostras) {
  const s = extrator.createStream()
  s.acceptWaveform({ sampleRate: TAXA, samples: amostras })
  s.inputFinished()
  return normalizar(extrator.compute(s))
}
const normalizar = v => { const n = Math.hypot(...v); return Float32Array.from(v, x => x / n) }
const cosseno = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)

export function lerWav(arquivo) { return sherpa.readWave(arquivo).samples }

export function carregarVozes(nomes) {
  return nomes.map(nome => {
    const f = `vozes/${nome}.json`
    if (!existsSync(f)) throw new Error(`Voz de ${nome} não cadastrada. Rode: node voz.mjs cadastrar "${nome}" <url> <inicio> <fim>`)
    return Float32Array.from(JSON.parse(readFileSync(f, 'utf8')))
  })
}

// Para cada janela de 2s (passo 1s): índice da voz mais parecida (0, 1, ...) ou -1 se ninguém passa do limiar
export function quemFala(amostras, vozes) {
  const out = []
  for (let i = 0; i + JANELA <= amostras.length || (i === 0 && amostras.length > TAXA / 2); i += PASSO) {
    const e = impressao(amostras.subarray(i, i + JANELA))
    const sims = vozes.map(v => cosseno(e, v))
    const melhor = sims.indexOf(Math.max(...sims))
    out.push({ ini: i / TAXA, fim: Math.min(i + JANELA, amostras.length) / TAXA, voz: sims[melhor] >= LIMIAR ? melhor : -1, sims })
  }
  return out
}

// Rótulo de um intervalo [ini, fim] em segundos: voto da maioria das janelas que se sobrepõem a ele
export function rotular(janelas, ini, fim) {
  const votos = new Map()
  for (const j of janelas) {
    const sobra = Math.min(fim, j.fim) - Math.max(ini, j.ini)
    if (sobra > 0) votos.set(j.voz, (votos.get(j.voz) ?? 0) + sobra)
  }
  return [...votos].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1
}

if (process.argv[2] === 'cadastrar') {
  const [, , , nome, url, ini, fim] = process.argv
  mkdirSync('tmp', { recursive: true }); mkdirSync('vozes', { recursive: true })
  const wav = 'tmp/cadastro.wav'
  // Baixa o áudio inteiro uma vez (fica em tmp/, reaproveitado) e recorta o trecho
  const audio = execSync(`yt-dlp --no-update -q -f bestaudio -o "tmp/%(id)s.%(ext)s" --no-simulate --print after_move:filepath "${url}"`, { encoding: 'utf8' }).trim()
  execSync(`ffmpeg -v error -y -ss ${ini} -to ${fim} -i "${audio}" -ac 1 -ar ${TAXA} -c:a pcm_s16le ${wav}`)
  const amostras = lerWav(wav)
  // média das impressões de janelas de 2s
  const soma = new Float32Array(extrator.dim)
  let n = 0
  for (let i = 0; i + JANELA <= amostras.length; i += PASSO, n++) impressao(amostras.subarray(i, i + JANELA)).forEach((x, k) => soma[k] += x)
  const f = `vozes/${nome}.json`
  const anterior = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
  const nova = normalizar(soma.map(x => x / n))
  const final = anterior ? normalizar(nova.map((x, k) => x + anterior[k])) : nova
  writeFileSync(f, JSON.stringify(Array.from(final)))
  console.log(`voz de ${nome} cadastrada (${n} janelas de 2s) em ${f}`)
}
