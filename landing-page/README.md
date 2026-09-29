# Hórus AI — Landing Page

Landing (glassmorphism + minimal + futurista) da **Hórus AI**, uma **IA de TI** (programação, revisão de código, debugging e segurança), construída em **HTML/CSS/JS vanilla** — sem build, sem dependências de bundler. Conecta ao backend Flask (Hórus).

## ✨ Recursos

- **Tema preto · branco · dourado**, com alternador **Sistema / Claro / Escuro**
  (a paleta inteira é trocada por tokens CSS; nenhuma regra de layout é reescrita)
- **Painel central de vidro** com gradiente, `backdrop-filter` e sombra suave
- **Sidebar recolhível** no estilo do Claude: fechada por padrão (a home fica
  limpa, só com o quadradinho no canto), abre empurrando o conteúdo no desktop
  e sobrepondo com véu no mobile
  - nova conversa · início · lista de conversas · menu do rodapé
  - cada conversa tem menu **⋮** com **Fixar**, **Mudar o nome** e **Apagar**
    (atalhos `P` / `R` / `D` enquanto o menu está aberto)
- **Logo do falcão** com inclinação 3D seguindo o mouse (`requestAnimationFrame`)
  e halo dourado; no tema claro ele é invertido por CSS para não sumir no fundo
- **Chat funcional** conectado ao backend Python (Hórus IA) com:
  - render de **Markdown** (código, listas, tabelas) via `marked` + `DOMPurify`
  - **histórico** de conversas salvo em `localStorage`
  - indicador "pensando", estados de erro e auto-scroll
- **Botões**:
  - **Send / Enter** → envia pro `/chat`; **chips** → enviam prompts prontos
  - **Attach** → anexa arquivos de texto/código (lidos e enviados no contexto)
- **Configurações**: aparência, fonte do chat, movimento reduzido e escolha do
  modelo da IA (a lista vem do endpoint `/models`, nunca é copiada para cá)
- **Efeitos de fundo**: blurs radiais dourados + textura de ruído (SVG inline)
- **Escala 100% fluida** — `clamp(rem + vw)` e `vmin` em todos os tamanhos:
  - a parte em `rem` cresce/encolhe junto com o **zoom** do navegador (Ctrl +/-);
  - a parte em `vw`/`vmin` adapta entre **mobile / tablet / desktop / 4K**;
  - altura via `min-height` + scroll (sem `height` fixa) → **nada é cortado** ao dar zoom ou em janelas baixas.
- **Responsivo** (mobile · tablet · desktop · telas grandes/ultrawide)
- Respeita `prefers-reduced-motion`

## 🗂 Estrutura

```
landing-page/
├── index.html        → estrutura semântica
├── css/
│   └── style.css     → layout, glassmorphism, animações, responsividade
├── js/
│   └── script.js     → logo 3D, sidebar, conversas, preferências
├── assets/
│   ├── images/       → logo-horus.png (falcão, branco sobre transparente)
│   └── fonts/        → Inter auto-hospedada (woff2 variável)
└── README.md
```

### Blocos principais do `index.html`

| Bloco | Seção HTML |
| --- | --- |
| Sidebar (marca, nova conversa, lista, rodapé) | `<aside class="sidebar">` |
| Logo do falcão com inclinação 3D | `<div class="orb-stage">` |
| Barra de digitação + atalhos | `<section class="prompt">` |
| Efeitos de fundo (blurs + ruído) | `<div class="bg-effects">` |
| Menu ⋮ de cada conversa | `<div class="chat-menu">` (fora da sidebar, que tem `overflow`) |

## 🚀 Como rodar (com a IA Python)

O chat conversa com o backend Flask (Hórus IA). O próprio servidor Python **serve esta landing page**, então é só ligá-lo a partir da raiz do repositório:

```bash
# 1. instale as dependências do backend (a partir da raiz do repo)
pip install -r requirements.txt

# 2. coloque sua chave da Groq em servidor/.env
#    GROQ_API_KEY=gsk_sua_chave_aqui
#    (sem a chave, o bot responde em "Modo Demo")

# 3. ligue o servidor (ele já aponta para ../landing-page)
python servidor/servidor_seguro.py
```

Acesse **http://127.0.0.1:5000** — a landing page abre já conectada à IA.

> ⚠️ Abrir o `index.html` direto por `file://` mostra a UI, mas o chat fica **desativado**
> (o navegador bloqueia a conexão e o CSP exige mesma origem). Use sempre o servidor Python.

Para deploy em produção (self-host), veja o [`README.md`](../README.md) na raiz
do repositório.

### Onde o backend encontra esta pasta
`servidor/main.py` usa `FRONTEND_DIR` (variável de ambiente) e, por padrão, aponta para
`../landing-page` (pasta irmã de `servidor/` na raiz do repo). Se mover esta pasta, defina
`FRONTEND_DIR` no `.env`.

## 🎨 Tokens de design

O tema escuro é a base (`:root`); o claro sobrescreve **apenas os tokens** em
`:root[data-theme="light"]`. Todos os pares passam WCAG AA.

| Token | Escuro | Claro |
| --- | --- | --- |
| `--bg` | `#0a0a0c` | `#f7f5f0` |
| `--text` | `#f2efe8` | `#16150f` |
| `--text-soft` | `#918b80` | `#6b665c` |
| `--gold` (único acento) | `#d4af37` | `#8a6c12` |
| `--danger` | `#ff8a7a` | `#b3261e` |

O ouro escurece no tema claro porque `#d4af37` sobre bege dá 1.9:1 — ilegível.

| | |
| --- | --- |
| Fonte | Inter 400–800 (variável, auto-hospedada) |
| Ícones | Lucide (local) |

## 🔌 Integração com o backend

| Frontend (`js/script.js`)        | Backend (`servidor/`)                          |
| -------------------------------- | ---------------------------------------------- |
| `fetch('/chat', { mensagem, historico, modelo })` | `POST /chat` → `{ resposta }` (`main.py`) |
| seletor de modelo (`/models`)    | `GET /models` → `{ modelos, padrao }` — a allowlist real do servidor |
| status do servidor (`/health`)   | `GET /health` → `{ status }`                   |
| render Markdown da resposta      | prompt mestre pede Markdown (`core/prompt_mestre.py`) |

A função `send()` monta a `mensagem` (texto + anexos) e envia o
`historico` da conversa.

### Recursos de terceiros: nenhum

Tudo é servido pela própria origem, e o `Content-Security-Policy` do servidor não
libera nenhum host externo (`default-src 'self'`):

| Recurso | Onde mora |
| --- | --- |
| Lucide, marked, DOMPurify | `js/vendor/*.min.js` |
| Fonte Inter (variável, 400–800) | `assets/fonts/inter-latin*.woff2` + `@font-face` no `style.css` |

Na prática, abrir a página não faz o navegador do visitante contatar nenhum
domínio além do seu — sem Google Fonts, sem CDN, sem vazamento de IP.
