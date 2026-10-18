// Contador de quem está com o site aberto agora. Cada aba abre um WebSocket em /ao-vivo;
// um único Durable Object guarda as conexões (hibernando, sem custo parado) e a cada 5s
// manda o total para todo mundo. O resto do site são arquivos estáticos servidos antes daqui.
import { DurableObject } from 'cloudflare:workers'

export class Contador extends DurableObject {
  async fetch() {
    const [cliente, servidor] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(servidor)
    await this.agendar()
    return new Response(null, { status: 101, webSocket: cliente })
  }
  async webSocketClose() { await this.agendar() }
  async webSocketError() { await this.agendar() }
  // Junta entradas e saídas numa transmissão só, a cada 5s (senão 10 mil entradas = 10 mil × 10 mil mensagens)
  async agendar() {
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 5000)
  }
  async alarm() {
    const conexoes = this.ctx.getWebSockets()
    // ponytail: um objeto só aguenta dezenas de milhares de conexões; acima disso, dividir em vários e somar
    for (const ws of conexoes) try { ws.send(String(conexoes.length)) } catch {}
  }
}

export default {
  fetch(req, env) {
    if (new URL(req.url).pathname === '/ao-vivo' && req.headers.get('Upgrade') === 'websocket')
      return env.CONTADOR.get(env.CONTADOR.idFromName('geral')).fetch(req)
    return new Response('Não encontrado', { status: 404 })
  },
}
