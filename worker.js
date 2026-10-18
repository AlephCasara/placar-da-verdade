// Contador de quem está com o site aberto agora. Cada aba abre um WebSocket em /ao-vivo;
// um único Durable Object guarda as conexões (hibernando, sem custo parado) e a cada 5s
// manda o total para todo mundo. O resto do site são arquivos estáticos que nem passam por aqui.
import { DurableObject } from 'cloudflare:workers'

// Só abas do próprio site contam (ao trocar de domínio, adicionar aqui e no site/_headers)
const ORIGENS = ['https://placar.zenithonacademy.com.br', 'https://placar-da-verdade.zenithon.workers.dev']
// Contra quem abre milhares de conexões para inflar o número ou derrubar o contador.
// Alto por IP porque operadora de celular põe muita gente atrás do mesmo IP (CGNAT).
const POR_IP = 50, TOTAL = 30000

export class Contador extends DurableObject {
  recentes = new Map() // ip → última visita contada (só em memória: se o objeto dormir, zera, e tudo bem)
  async fetch(req) {
    const ip = req.headers.get('CF-Connecting-IP') ?? '?'
    if (this.ctx.getWebSockets(ip).length >= POR_IP || this.ctx.getWebSockets().length >= TOTAL)
      return new Response('Muitas conexões', { status: 429 })
    // Visita = abrir a página (reconexão não conta). Mesmo IP só conta de novo depois de 10 min,
    // para recarregar a página sem parar não inflar o número
    if (new URL(req.url).searchParams.has('nova') && Date.now() - (this.recentes.get(ip) ?? 0) > 600_000) {
      this.recentes.set(ip, Date.now())
      if (this.recentes.size > 50_000) this.recentes.clear()
      await this.ctx.storage.put('visitas', ((await this.ctx.storage.get('visitas')) ?? 0) + 1)
    }
    const [cliente, servidor] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(servidor, [ip])
    await this.agendar()
    return new Response(null, { status: 101, webSocket: cliente })
  }
  async webSocketMessage(ws) { ws.close(1003, 'Este canal só envia') } // ninguém precisa mandar nada
  async webSocketClose() { await this.agendar() }
  async webSocketError() { await this.agendar() }
  // Junta entradas e saídas numa transmissão só, a cada 5s (senão 10 mil entradas = 10 mil × 10 mil mensagens)
  async agendar() {
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 5000)
  }
  async alarm() {
    const conexoes = this.ctx.getWebSockets()
    const msg = JSON.stringify({ agora: conexoes.length, visitas: (await this.ctx.storage.get('visitas')) ?? 0 })
    // ponytail: um objeto só aguenta dezenas de milhares de conexões; acima disso, dividir em vários e somar
    for (const ws of conexoes) try { ws.send(msg) } catch {}
  }
}

export default {
  fetch(req, env) {
    if (new URL(req.url).pathname !== '/ao-vivo' || req.headers.get('Upgrade') !== 'websocket')
      return new Response('Não encontrado', { status: 404 })
    if (!ORIGENS.includes(req.headers.get('Origin'))) return new Response('Origem não permitida', { status: 403 })
    return env.CONTADOR.get(env.CONTADOR.idFromName('geral')).fetch(req)
  },
}
