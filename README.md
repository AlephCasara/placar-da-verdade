# Placar da Verdade

Robô que checa, **ao vivo**, os fatos ditos pelos candidatos em um debate político e mostra o placar
num site, fato por fato, sempre com a fonte ao lado.

**No ar:** https://placar.zenithonacademy.com.br · **Como ele decide:** [metodologia](https://placar.zenithonacademy.com.br/metodologia.html)

![Placar do debate de 18/10/2026](docs/placar.png)

## Como o robô funciona

![Fluxo do robô](diagrama/fluxo.png)

1. O áudio do debate é cortado em pedaços de 10 segundos.
2. Uma IA transcreve e o reconhecimento de voz (local, grátis) identifica quem está falando.
3. Outra IA separa o que é fato checável de opinião, promessa e ataque.
4. Cada fato é pesquisado na web, **só com o que já existia até aquele momento do debate**.
5. Um juiz dá o veredito: `verdadeiro`, `impreciso`, `falso` ou `sem_dados`.
6. Antes de publicar um falso ou impreciso, outros modelos ouvem o trecho de novo para confirmar a frase.

Todas as IAs passam pela [OpenRouter](https://openrouter.ai). Os modelos usados estão no topo do `robo.mjs`.

## Rodar no seu PC

Você precisa de:

- [Node.js](https://nodejs.org) 22 ou mais novo
- [ffmpeg](https://ffmpeg.org) e [yt-dlp](https://github.com/yt-dlp/yt-dlp) instalados e no PATH
- Uma chave da [OpenRouter](https://openrouter.ai/keys) com crédito

Depois:

```bash
npm install
npm run modelo                      # baixa o modelo de reconhecimento de voz (~30 MB)
cp .env.example .env                # e cole sua chave da OpenRouter no .env
```

**Cadastre a voz de cada candidato** com 1 a 3 minutos de fala limpa, de qualquer vídeo do YouTube
(início e fim em segundos; pode repetir o comando para somar trechos):

```bash
npm run voz -- "Lula" https://youtu.be/XXXX 60 180
npm run voz -- "Bolsonaro" https://youtu.be/YYYY 300 420
```

**Rode o robô** com `--local`, que grava o placar em `site/placar.json` em vez de publicar na nuvem:

```bash
npm run robo -- https://youtu.be/ZZZZ --a "Lula" --b "Bolsonaro" --local
```

**Veja o placar** em outro terminal e abra http://localhost:8787:

```bash
npm run site
```

Sem voz cadastrada o robô também funciona: você aperta `1`, `2` ou `0` para dizer quem está falando
(candidato A, B ou mediador). Com voz cadastrada, `a` volta para o automático.

### Outras opções do robô

| Opção | O que faz |
|---|---|
| `--inicio 4230` | Começa um vídeo gravado neste segundo |
| `--limite 2` | Teto de gasto com IA, em dólares. Em 80% para de checar; em 100% para tudo |
| `--continuar` | Volta de onde parou, se o robô cair no meio do debate |
| `--rejulgar` | Com `--continuar`: refaz os vereditos com as regras atuais do juiz |
| `--entrada "CABLE Output (VB-Audio Virtual Cable)"` | Ouve um dispositivo de áudio do PC em vez do YouTube (só Windows) |

Vídeo gravado vira simulação: o robô "vive" na data e hora em que o debate passou, e a busca
ignora notícias publicadas depois.

## Quanto custa

Alguns dólares por debate, em créditos da OpenRouter (depende da duração e de quantos fatos aparecem).
O `--limite` (padrão **US$ 2**) garante que não passa disso. O gasto fica em `tmp/gasto.json`.

## Publicar o seu próprio site

O site é estático, hospedado na Cloudflare (Workers + R2). Para publicar o seu:

1. Crie uma conta na Cloudflare e um bucket R2 público.
2. Troque o bucket em `robo.mjs` (`BUCKET`), o endereço dos dados em `site/app.js` (`PLACAR`) e o
   domínio em `wrangler.jsonc` (`routes`).
3. `npx wrangler login` e `npm run deploy`.
4. Rode o robô **sem** `--local`: ele envia o `placar.json` para o bucket a cada atualização.

## Testes

```bash
node teste.mjs
```

## Licença

[AGPL-3.0](LICENSE). Pode usar, estudar e modificar. Se colocar uma versão modificada no ar, precisa
publicar o código dela também.
