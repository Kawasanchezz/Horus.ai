/* =====================================================================
   HÓRUS AI — app logic
   - Chat conectado ao backend Python (Flask /chat)
   - Logo com inclinação 3D seguindo o mouse
   - Sidebar: nova conversa, início, lista de conversas, menu do rodapé
   - Conversas em localStorage (fixar, renomear, apagar)
   - Preferências: tema, fonte do chat, movimento, modelo da IA
   ===================================================================== */

const $ = (sel) => document.querySelector(sel);

/* localStorage sempre por aqui: em modo privado/anonimo o acesso LANCA, e uma
   excecao solta aqui derrubava o resto da funcao (era o caso do "Apagar
   historico", que abortava antes de limpar a tela). */
function lsGet(chave, padrao = null) {
  try { return localStorage.getItem(chave) ?? padrao; } catch { return padrao; }
}
function lsSet(chave, valor) {
  try { valor === null ? localStorage.removeItem(chave) : localStorage.setItem(chave, valor); }
  catch { /* modo privado */ }
}

/* renderiza ícones Lucide (inclusive os criados dinamicamente) */
function icons() { if (window.lucide) lucide.createIcons(); }
icons();

/* ── ELEMENTOS ── */
const els = {
  app: $('.app'),
  hero: $('#hero'),
  chat: $('#chat'),
  messages: $('#messages'),
  anchor: $('#chatAnchor'),
  input: $('#promptInput'),
  send: $('#sendBtn'),
  attach: $('#attachBtn'),
  fileInput: $('#fileInput'),
  attachTags: $('#attachTags'),
  quick: $('#quickActions'),
  sidebar: $('#sidebar'),
  veil: $('#sidebarVeil'),
  historyList: $('#historyList'),
  toast: $('#toast'),
  statusDot: $('#statusDot'),
  serverStatus: $('#serverStatus'),
};

/* ── ESTADO ── */
const STORE_KEY = 'credix_landing_chats';
const MODEL_KEY = 'horus_model';
// '' = deixa o servidor decidir (GROQ_MODEL). O backend valida contra a
// allowlist e cai no padrão se vier algo fora dela, então isso é só preferência.
let modeloEscolhido = lsGet(MODEL_KEY, '');
let history = [];                 // [{role, content}] da conversa atual
let chatId = Date.now().toString();
let chats = loadChats();
let attachments = [];            // [{name, content}]
let sending = false;
// Modo anônimo: NÃO é persistido de propósito. Se ficasse salvo, você poderia
// voltar ao site sem perceber que ainda está nele e perder conversas.
let anonimo = false;
const isServed = location.protocol.startsWith('http');
const MAX_PAYLOAD = 7500;        // alinhado ao MAX_INPUT_LENGTH (8000) do backend
// Espelha o MAX_HISTORY_CHARS do servidor (12000), com folga. O servidor corta
// o histórico que USA, mas o corpo da requisição é barrado ANTES disso pelo
// limite de 32KB — então enviar a conversa inteira quebrava o chat por volta
// do 12º turno com "Requisição muito grande". Aparar aqui resolve na origem
// e ainda economiza banda. O servidor continua validando por conta própria.
const MAX_HISTORY_PAYLOAD = 10000;
// Anexos. O arquivo e lido inteiro na memoria e depois entra no MAX_PAYLOAD
// acima; os dois limites existem pra ele nunca chegar cortado ao servidor.
const MAX_FILE_BYTES = 200 * 1024;
const MAX_FILE_CHARS = 7000;

/* =====================================================================
   ORB — inclinação 3D seguindo o mouse
   ===================================================================== */
const orb = $('#orb');
const MAX_TILT = 8;
let tX = 0, tY = 0, cX = 0, cY = 0;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function animateOrb() {
  cX += (tX - cX) * 0.08;
  cY += (tY - cY) * 0.08;
  if (orb) orb.style.transform = `rotateY(${cX}deg) rotateX(${cY}deg)`;
  requestAnimationFrame(animateOrb);
}
function pointer(x, y) {
  const cx = innerWidth / 2, cy = innerHeight / 2;
  tX = ((x - cx) / cx) * MAX_TILT;
  tY = -((y - cy) / cy) * MAX_TILT;
}
if (orb && !reduceMotion) {
  addEventListener('mousemove', (e) => pointer(e.clientX, e.clientY));
  addEventListener('mouseleave', () => { tX = 0; tY = 0; });
  animateOrb();
}

/* =====================================================================
   UTILIDADES
   ===================================================================== */
function toast(msg, ms = 2600) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  els.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => (els.toast.hidden = true), 250);
  }, ms);
}

/* modal de confirmação (vidro) — substitui o confirm() nativo */
let _confirmCb = null;
function confirmModal(title, msg, onOk) {
  $('#confirmTitle').textContent = title;
  $('#confirmMsg').textContent = msg;
  _confirmCb = onOk;
  $('#confirmModal').hidden = false;
  icons();
}
function closeConfirm() { $('#confirmModal').hidden = true; _confirmCb = null; }

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderMarkdown(text) {
  if (typeof marked === 'undefined') return escapeHtml(text);
  try {
    const html = marked.parse(text);
    // Sem DOMPurify: NUNCA renderiza HTML cru (evita XSS) — cai pra texto escapado
    return (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(html) : escapeHtml(text);
  } catch { return escapeHtml(text); }
}

function scrollBottom() {
  if (els.anchor) els.anchor.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
}

/* =====================================================================
   MODO CHAT / HOME
   ===================================================================== */
function enterChatMode() {
  if (!els.chat.hidden) return;
  els.hero.hidden = true;
  els.chat.hidden = false;
  els.app.classList.add('is-chatting');
}
function goHome() {
  els.chat.hidden = true;
  els.hero.hidden = false;
  els.app.classList.remove('is-chatting');
}

/* logo / Início → volta pra home, salvando a conversa atual (dá pra retomar pela
   lista da sidebar). renderHistoryList() porque a lista agora está sempre
   visível: se a conversa acabou de ser salva, ela precisa aparecer na hora. */
function goHomeView() {
  saveCurrent();
  renderHistoryList();
  goHome();
}

/* Zera a conversa em andamento e volta pra home. NAO salva nada: quem chama
   decide se o que estava na tela deve ser preservado antes. */
function resetConversa() {
  history = [];
  chatId = Date.now().toString();
  els.messages.innerHTML = '';
  clearAttachments();
  renderHistoryList();   // a conversa recém-salva já aparece na sidebar
  goHome();
}

function newChat() {
  saveCurrent();
  resetConversa();
  els.input.focus();
}

/* =====================================================================
   RENDER DE MENSAGENS
   ===================================================================== */
/* Toda mensagem entra por aqui. O icons() e obrigatorio: o Lucide TROCA cada
   <i data-lucide> por um <svg>, entao elemento recem-criado nao vira icone
   sozinho. */
function appendMsg(classe, html, id) {
  const row = document.createElement('div');
  row.className = classe;
  if (id) row.id = id;
  row.innerHTML = html;
  els.messages.appendChild(row);
  icons();
  scrollBottom();
  return row;
}

function addUserMsg(text, files = []) {
  const tags = files.length
    ? `<div class="msg__files">${files.map(f => `<span><i data-lucide="file"></i>${escapeHtml(f.name)}</span>`).join('')}</div>`
    : '';
  appendMsg('msg msg--user',
    `<div class="msg__bubble">${tags}${escapeHtml(text).replace(/\n/g, '<br>')}</div>`);
}

function addBotMsg(text, isError = false) {
  appendMsg('msg msg--bot', `
    <div class="msg__avatar"><i data-lucide="sparkles"></i></div>
    <div class="msg__bubble markdown ${isError ? 'is-error' : ''}">${renderMarkdown(text)}</div>`);
}

function showThinking() {
  appendMsg('msg msg--bot', `
    <div class="msg__avatar pulse"><i data-lucide="sparkles"></i></div>
    <div class="msg__bubble"><span class="dots"><span>.</span><span>.</span><span>.</span></span></div>`, 'thinking');
}
function hideThinking() { const t = $('#thinking'); if (t) t.remove(); }

/* Devolve só o final do histórico que cabe no orçamento do servidor.
   Percorre do mais RECENTE para o mais antigo: o contexto que se perde é o
   mais velho, que é o menos útil para a próxima resposta. */
function historicoParaEnvio() {
  const recorte = [];
  let orcamento = MAX_HISTORY_PAYLOAD;
  for (let i = history.length - 1; i >= 0; i--) {
    const tamanho = (history[i].content || '').length;
    if (tamanho > orcamento) break;
    recorte.push(history[i]);
    orcamento -= tamanho;
  }
  return recorte.reverse();
}

/* Junta texto + anexos numa unica mensagem e corta no limite do backend,
   para o servidor nunca devolver "Texto muito longo" por algo que daria
   para prever aqui. */
function montarPayload(text, arquivos) {
  let payload = text;
  if (arquivos.length) {
    payload += '\n\n' + arquivos
      .map(f => `Conteúdo do arquivo "${f.name}":\n\`\`\`\n${f.content}\n\`\`\``)
      .join('\n\n');
  }

  // respeita o limite do backend (evita "Texto muito longo")
  if (payload.length > MAX_PAYLOAD) payload = payload.slice(0, MAX_PAYLOAD) + '\n…(conteúdo truncado)';

  return payload;
}

/* Aplica a resposta do servidor na tela e no historico. Fica fora do send()
   porque sao duas responsabilidades: uma cuida do FLUXO (estado do botao,
   indicador de digitando, erro de rede) e esta cuida do RESULTADO. */
function tratarResposta(data, textoEnviado) {
  if (data.erro) {
    addBotMsg(`Erro: ${data.erro}`, true);
    return;
  }
  addBotMsg(data.resposta);
  history.push({ role: 'user', content: textoEnviado || '(arquivo anexado)' });
  history.push({ role: 'assistant', content: data.resposta });
  saveCurrent();
  renderHistoryList();   // lista sempre visível: a conversa nova entra na hora
}

/* =====================================================================
   ENVIO → BACKEND PYTHON
   ===================================================================== */
async function send(presetText) {
  if (sending) return;
  const text = (presetText ?? els.input.value).trim();
  if (!text && attachments.length === 0) { els.input.focus(); return; }

  enterChatMode();

  const sentFiles = [...attachments];
  addUserMsg(text || '(arquivo anexado)', sentFiles);

  const payload = montarPayload(text, sentFiles);

  const prevHistory = historicoParaEnvio();
  els.input.value = '';
  autoGrow();
  clearAttachments();

  sending = true;
  els.send.disabled = true;
  showThinking();

  if (!isServed) {
    hideThinking();
    addBotMsg('⚠️ Abra a página pelo servidor Python (`http://127.0.0.1:5000`) para conversar com a IA. Pelo `file://` o navegador bloqueia a conexão.', true);
    sending = false; els.send.disabled = false;
    return;
  }

  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 'modelo' só vai quando o usuário escolheu um; senão o servidor usa o dele
      body: JSON.stringify({
        mensagem: payload,
        historico: prevHistory,
        ...(modeloEscolhido ? { modelo: modeloEscolhido } : {})
      })
    });
    const data = await res.json();
    hideThinking();
    tratarResposta(data, text);
  } catch (e) {
    hideThinking();
    addBotMsg('Não consegui falar com o servidor. Confira se o Python está rodando em `http://127.0.0.1:5000`.', true);
  } finally {
    sending = false;
    els.send.disabled = false;
    scrollBottom();
  }
}

/* =====================================================================
   HISTÓRICO (localStorage)
   ===================================================================== */
function loadChats() {
  try { return JSON.parse(lsGet(STORE_KEY)) || {}; }
  catch { return {}; }   // JSON corrompido no storage
}
function saveCurrent() {
  // Trava única do modo anônimo. saveCurrent() é o ÚNICO caminho que grava uma
  // conversa, então barrar aqui garante que nada escape — em vez de espalhar
  // checagens por cada chamador.
  if (anonimo) return;
  if (history.length === 0) return;
  const title = chats[chatId]?.title || (history[0].content.slice(0, 32) + (history[0].content.length > 32 ? '…' : ''));
  // preserva o "fixado" ao regravar uma conversa existente
  const pinned = chats[chatId]?.pinned || false;
  chats[chatId] = { id: chatId, title, messages: [...history], ts: Date.now(), pinned };
  salvarChats();
}
function salvarChats() {
  lsSet(STORE_KEY, JSON.stringify(chats));
}

function renderHistoryList() {
  // fixadas primeiro; dentro de cada grupo, mais recentes no topo
  const ids = Object.keys(chats).sort((a, b) => {
    const pa = chats[a].pinned ? 1 : 0, pb = chats[b].pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (chats[b].ts || b) - (chats[a].ts || a);
  });

  if (ids.length === 0) {
    els.historyList.innerHTML = `<p class="muted history-empty">Nenhuma conversa ainda.</p>`;
    return;
  }

  els.historyList.innerHTML = '';
  ids.forEach(id => {
    const item = document.createElement('div');
    item.className = 'history-item' + (id === chatId ? ' is-active' : '');
    item.dataset.id = id;
    item.innerHTML = `
      ${chats[id].pinned ? '<i data-lucide="pin" class="history-item__pin"></i>' : ''}
      <span class="history-item__title">${escapeHtml(chats[id].title)}</span>
      <button class="history-item__more" title="Mais ações" aria-label="Mais ações" aria-haspopup="menu">
        <i data-lucide="more-vertical"></i>
      </button>`;
    // ?. porque o markup acima pode mudar: sem isso, um typo numa classe
    // viraria TypeError e a lista inteira pararia de responder
    item.querySelector('.history-item__title')?.addEventListener('click', () => loadChat(id));
    item.querySelector('.history-item__more')?.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirMenuChat(id, e.currentTarget);
    });
    els.historyList.appendChild(item);
  });
  icons();
}

/* =====================================================================
   MENU "⋮" DE CADA CONVERSA
   ===================================================================== */
let menuChatId = null;

function abrirMenuChat(id, botao) {
  menuChatId = id;
  const menu = $('#chatMenu');
  $('#chatMenuPinLabel').textContent = chats[id]?.pinned ? 'Desafixar' : 'Fixar';

  menu.hidden = false;
  icons();

  // position:fixed + medida real do menu para não vazar da janela
  const r = botao.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  let top = r.bottom + 6;
  let left = r.right - m.width;
  if (top + m.height > innerHeight - 8) top = Math.max(8, r.top - m.height - 6);
  if (left < 8) left = 8;
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

function fecharMenuChat() {
  $('#chatMenu').hidden = true;
  menuChatId = null;
}

function fixarChat(id) {
  if (!chats[id]) return;
  chats[id].pinned = !chats[id].pinned;
  salvarChats();
  renderHistoryList();
  toast(chats[id].pinned ? 'Conversa fixada.' : 'Conversa desafixada.', 1400);
}

/* Renomear acontece no próprio item: troca o título por um input.
   Enter confirma, Esc cancela, sair do campo confirma. */
function renomearChat(id) {
  const item = els.historyList.querySelector(`.history-item[data-id="${id}"]`);
  if (!item || !chats[id]) return;
  const span = item.querySelector('.history-item__title');

  const input = document.createElement('input');
  input.className = 'history-item__input';
  input.value = chats[id].title;
  input.maxLength = 80;
  span.replaceWith(input);
  input.focus();
  input.select();

  let encerrado = false;
  const confirmar = (salvar) => {
    if (encerrado) return;
    encerrado = true;
    const novo = input.value.trim();
    if (salvar && novo && novo !== chats[id].title) {
      chats[id].title = novo;
      salvarChats();
      toast('Nome alterado.', 1400);
    }
    renderHistoryList();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmar(true); }
    else if (e.key === 'Escape') { e.preventDefault(); confirmar(false); }
  };
  input.onblur = () => confirmar(true);
  input.onclick = (e) => e.stopPropagation();
}
function loadChat(id) {
  if (!chats[id]) return;
  // Abrir uma conversa salva sai do modo anônimo: seguir digitando nela sem
  // que nada fosse gravado seria um comportamento surpreendente.
  if (anonimo) setAnonimo(false);
  saveCurrent();
  chatId = id;
  history = [...chats[id].messages];
  els.messages.innerHTML = '';
  history.forEach(m => m.role === 'user' ? addUserMsg(m.content) : addBotMsg(m.content));
  enterChatMode();
  closeSidebarIfMobile();
  renderHistoryList();
}
function deleteChat(id) {
  const titulo = chats[id]?.title || 'esta conversa';
  confirmModal('Apagar conversa', `Apagar "${titulo}"? Essa ação não pode ser desfeita.`, () => doDeleteChat(id));
}
function doDeleteChat(id) {
  delete chats[id];
  salvarChats();
  // se for a conversa atual, zera o histórico ANTES do newChat pra não re-salvar (bug corrigido)
  if (id === chatId) { history = []; newChat(); }
  renderHistoryList();
  toast('Conversa apagada.');
}
/* =====================================================================
   SIDEBAR — recolher (desktop) e gaveta (mobile)
   ===================================================================== */
const SIDEBAR_KEY = 'horus_sidebar_open';
// Abaixo deste ponto a sidebar não cabe ao lado do conteúdo: ela sobrepõe.
// O número espelha o @media (max-width: 900px) do style.css.
const DRAWER_BP = 900;
const isDrawer = () => window.matchMedia(`(max-width: ${DRAWER_BP}px)`).matches;
const sidebarIsOpen = () => els.app.classList.contains('is-sidebar-open');

function setSidebar(open) {
  els.app.classList.toggle('is-sidebar-open', open);
  // o véu só faz sentido no mobile, onde a sidebar cobre o conteúdo;
  // no desktop ela apenas empurra e o resto da página segue clicável
  els.veil.hidden = !(open && isDrawer());
  $('#sidebarToggle').setAttribute('aria-expanded', String(open));
  if (!open) toggleAccountMenu(false);
  lsSet(SIDEBAR_KEY, open ? '1' : '0');
}

// no mobile a sidebar some ao escolher algo; no desktop ela fica
function closeSidebarIfMobile() { if (isDrawer()) setSidebar(false); }

/* menu de "conta" no rodapé (Configurações · Servidor · Apagar histórico) */
function toggleAccountMenu(forcar) {
  const menu = $('#accountMenu');
  const abrir = forcar === undefined ? menu.hidden : forcar;
  menu.hidden = !abrir;
  $('#accountBtn').setAttribute('aria-expanded', String(abrir));
  if (abrir) icons();   // os ícones do menu só existem quando ele aparece
}

/* =====================================================================
   PREFERÊNCIAS — tema, fonte e movimento
   Tudo aplicado como atributo em <html>, que é onde o CSS espera
   (:root[data-theme], :root[data-font], :root[data-motion]).
   ===================================================================== */
const PREF = { theme: 'horus_theme', font: 'horus_font', motion: 'horus_motion' };
const raiz = document.documentElement;

const lerPref = (k, padrao) => lsGet(PREF[k], padrao);
const gravarPref = (k, v) => lsSet(PREF[k], v || null);

// 'dark' é o padrão de primeira visita (a identidade do projeto é escura);
// 'system' só entra se a pessoa escolher.
function aplicarTema(v) {
  raiz.setAttribute('data-theme', v);
  gravarPref('theme', v);
  marcarSeg('#themeSeg', 'theme', v);
}
// '' = Inter (padrao). Qualquer outro valor precisa existir aqui, senao um
// valor antigo do localStorage (ex.: o extinto "system") deixaria o atributo
// pendurado sem regra CSS correspondente.
const FONTES = ['', 'georgia', 'verdana', 'mono'];

function aplicarFonte(v) {
  if (!FONTES.includes(v)) v = '';
  if (v) raiz.setAttribute('data-font', v); else raiz.removeAttribute('data-font');
  gravarPref('font', v);
  $('#fontSelect').value = v;
}
function aplicarMovimento(v) {
  if (v === 'reduced') raiz.setAttribute('data-motion', 'reduced');
  else raiz.removeAttribute('data-motion');
  gravarPref('motion', v);
  marcarSeg('#motionSeg', 'motion', v);
}
function marcarSeg(sel, attr, v) {
  $(sel).querySelectorAll('button').forEach(b =>
    b.classList.toggle('is-active', b.dataset[attr] === v));
}

/* Monta o seletor de modelo a partir de /models. A lista vem do servidor de
   propósito: manter uma cópia aqui divergiria da allowlist do backend sem
   ninguém perceber. Por file:// o fetch falha e o seletor fica só com o
   "Padrão do servidor", que é o comportamento correto nesse modo. */
async function carregarModelos() {
  const sel = $('#modelSelect');
  if (!isServed) { sel.disabled = true; return; }
  try {
    const r = await fetch('/models');
    const { modelos = [], padrao } = await r.json();
    // Só entram ALTERNATIVAS ao padrão. Listar o próprio padrão daria duas
    // entradas com o mesmo efeito ("Padrão do servidor" e o nome dele), e a
    // escolha entre elas não mudaria nada. Se um dia a allowlist do servidor
    // ganhar outros modelos, eles aparecem aqui sozinhos.
    const alternativas = modelos.filter(m => m !== padrao);
    alternativas.forEach(m => {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m;
      sel.appendChild(o);
    });
    // se o modelo salvo saiu da allowlist, volta ao padrão em vez de ficar fantasma
    sel.value = alternativas.includes(modeloEscolhido) ? modeloEscolhido : '';
    if (sel.value !== modeloEscolhido) {
      modeloEscolhido = '';
      lsSet(MODEL_KEY, null);
    }
  } catch {
    sel.disabled = true;
  }
}

/* =====================================================================
   CONVERSA ANÔNIMA
   ===================================================================== */
function setAnonimo(on) {
  // Ao ENTRAR, salva o que estava em andamento (ainda é uma conversa normal).
  // Ao SAIR, descarta sem salvar — saveCurrent() está travado enquanto anônimo.
  if (on) saveCurrent();

  anonimo = on;
  els.app.classList.toggle('is-anon', on);
  // a faixa vive FORA do .app (é o chrome da janela), então o estado precisa
  // existir também na raiz para o body e o recuo do painel reagirem
  document.documentElement.classList.toggle('is-anon', on);
  $('#incognitoBtn').setAttribute('aria-pressed', String(on));
  $('#anonBar').hidden = !on;
  $('#anonNote').hidden = !on;
  $('#headlineNormal').hidden = on;
  $('#headlineAnon').hidden = !on;
  if (on) {
    setSidebar(false);   // a "janela" anônima não tem histórico ao lado
    icons();             // desenha o X da barra, criado só agora
  }

  // conversa nova em qualquer direção: o que foi dito num modo não vaza pro outro
  resetConversa();

  // Sem toast aqui: a faixa no topo e a frase abaixo do campo ja dizem o
  // estado o tempo todo. Um aviso extra a cada entrada/saida so atrapalha.
}

function clearAllHistory() {
  confirmModal('Apagar histórico', 'Isso vai apagar TODAS as conversas salvas. Essa ação não pode ser desfeita.', () => {
    chats = {};
    lsSet(STORE_KEY, null);
    $('#settingsModal').hidden = true;
    newChat();
    renderHistoryList();
    toast('Histórico apagado.');
  });
}

/* =====================================================================
   ANEXOS (Attach)
   ===================================================================== */
function renderAttachTags() {
  els.attachTags.innerHTML = attachments.map((f, i) =>
    `<span class="attach-tag"><i data-lucide="file"></i>${escapeHtml(f.name)}
       <button data-i="${i}" title="Remover"><i data-lucide="x"></i></button></span>`
  ).join('');
  els.attachTags.querySelectorAll('button').forEach(b =>
    b.onclick = () => { attachments.splice(+b.dataset.i, 1); renderAttachTags(); });
  icons();
}
function clearAttachments() { attachments = []; els.attachTags.innerHTML = ''; }

els.attach.onclick = () => els.fileInput.click();
els.fileInput.onchange = (e) => {
  const files = Array.from(e.target.files || []);
  files.forEach(file => {
    if (file.size > MAX_FILE_BYTES) { toast(`"${file.name}" é grande demais (máx. ${MAX_FILE_BYTES / 1024}KB).`); return; }
    const reader = new FileReader();
    reader.onload = () => { attachments.push({ name: file.name, content: String(reader.result).slice(0, MAX_FILE_CHARS) }); renderAttachTags(); };
    reader.readAsText(file);
  });
  els.fileInput.value = '';
};

/* =====================================================================
   STATUS DO SERVIDOR (modal de configurações)
   ===================================================================== */
async function checkServer() {
  if (!isServed) {
    els.serverStatus.textContent = 'Aberto via file:// — rode o Python para conversar.';
    els.statusDot.className = 'status-dot is-off';
    return;
  }
  try {
    const r = await fetch('/health');
    const d = await r.json();
    els.serverStatus.textContent = d.status || 'Online';
    els.statusDot.className = 'status-dot is-on';
  } catch {
    els.serverStatus.textContent = 'Offline — inicie o servidor Python.';
    els.statusDot.className = 'status-dot is-off';
  }
}

/* =====================================================================
   LIGAÇÃO DOS BOTÕES
   ===================================================================== */
els.send.onclick = () => send();
els.input.addEventListener('input', autoGrow);
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

// chips rápidos → preenchem e enviam
els.quick.querySelectorAll('.chip[data-prompt]').forEach(chip => {
  chip.onclick = () => send(chip.dataset.prompt);
});
// sidebar
$('#logoBtn').onclick = () => { goHomeView(); closeSidebarIfMobile(); };
$('#newChatBtn').onclick = () => { newChat(); closeSidebarIfMobile(); };

// abrir (quadradinho do canto) e fechar (botão dentro da sidebar)
$('#incognitoBtn').onclick = () => setAnonimo(true);
$('#anonClose').onclick = () => setAnonimo(false);
$('#sidebarOpen').onclick = () => setSidebar(true);
$('#sidebarToggle').onclick = () => setSidebar(false);
els.veil.onclick = () => setSidebar(false);
// ao voltar para o desktop o véu perde o sentido; a sidebar em si continua
addEventListener('resize', () => { els.veil.hidden = !(sidebarIsOpen() && isDrawer()); });

// menu "⋮" das conversas
const ACOES_CHAT = { pin: fixarChat, rename: renomearChat, delete: deleteChat };

/* Fecha o menu ANTES de agir: renomear substitui o item por um <input>, e um
   menu ainda aberto ficaria flutuando sobre um elemento que sumiu. */
function executarAcaoChat(acao) {
  const id = menuChatId;
  fecharMenuChat();
  ACOES_CHAT[acao]?.(id);
}

$('#chatMenu').querySelectorAll('.chat-menu__item').forEach(b => {
  b.onclick = (e) => { e.stopPropagation(); executarAcaoChat(b.dataset.act); };
});
// os atalhos exibidos no menu (P/R/D) funcionam de verdade enquanto ele está aberto
addEventListener('keydown', (e) => {
  if (menuChatId === null || e.ctrlKey || e.altKey || e.metaKey) return;
  const acao = { p: 'pin', r: 'rename', d: 'delete' }[e.key.toLowerCase()];
  if (!acao) return;
  e.preventDefault();
  executarAcaoChat(acao);
});

// menu do rodapé (no lugar da linha de conta do Claude)
$('#accountBtn').onclick = (e) => { e.stopPropagation(); toggleAccountMenu(); };
$('#menuSettings').onclick = () => { toggleAccountMenu(false); checkServer(); $('#settingsModal').hidden = false; };
$('#menuStatus').onclick = () => { checkServer(); toast('Verificando o servidor…', 1200); };
$('#menuClear').onclick = () => { toggleAccountMenu(false); clearAllHistory(); };
// clique fora fecha o menu; dentro do rodapé, não
document.addEventListener('click', (e) => {
  if (!e.target.closest('.sidebar__foot')) toggleAccountMenu(false);
  if (!e.target.closest('#chatMenu')) fecharMenuChat();
});
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (menuChatId !== null) fecharMenuChat();
  else if (!$('#accountMenu').hidden) toggleAccountMenu(false);
  else closeSidebarIfMobile();
});
// a lista rola: se o item sair do lugar, o menu ficaria solto no ar
els.historyList.addEventListener('scroll', fecharMenuChat);
addEventListener('resize', fecharMenuChat);

$('#settingsClose').onclick = $('#settingsDone').onclick = () => { $('#settingsModal').hidden = true; };

// ── preferências ──
$('#themeSeg').querySelectorAll('button').forEach(b =>
  b.onclick = () => aplicarTema(b.dataset.theme));
$('#motionSeg').querySelectorAll('button').forEach(b =>
  b.onclick = () => aplicarMovimento(b.dataset.motion));
$('#fontSelect').onchange = (e) => aplicarFonte(e.target.value);

// ── modelo da IA ──
$('#modelSelect').onchange = (e) => {
  modeloEscolhido = e.target.value;
  lsSet(MODEL_KEY, modeloEscolhido || null);
  toast(modeloEscolhido ? `Modelo: ${modeloEscolhido}` : 'Usando o modelo padrão do servidor.', 1600);
};

// modal de confirmação (vidro)
$('#confirmOk').onclick = () => { const cb = _confirmCb; closeConfirm(); if (cb) cb(); };
$('#confirmCancel').onclick = closeConfirm;
$('#confirmClose').onclick = closeConfirm;
$('#confirmModal').addEventListener('click', (e) => { if (e.target.id === 'confirmModal') closeConfirm(); });
// fecha modal clicando fora
$('#settingsModal').addEventListener('click', (e) => {
  if (e.target.id === 'settingsModal') $('#settingsModal').hidden = true;
});

/* =====================================================================
   INICIALIZAÇÃO
   ===================================================================== */
// a lista de conversas vive na sidebar e está sempre à vista: precisa ser
// desenhada no load, e não só quando um painel era aberto
renderHistoryList();

// A sidebar começa FECHADA (home limpa, só o quadradinho no canto). Se o
// usuário a deixou aberta na visita anterior, ela volta aberta.
setSidebar(lsGet(SIDEBAR_KEY) === '1');

// preferências salvas (tema padrão = escuro, a identidade do projeto)
aplicarTema(lerPref('theme', 'dark'));
aplicarFonte(lerPref('font', ''));
aplicarMovimento(lerPref('motion', 'system'));

// status inicial discreto (agora exibido no menu do rodapé da sidebar)
// As duas ja tratam erro por dentro; o .catch() aqui e a ultima rede: se um
// dia o try/catch interno sair, isso evita unhandled rejection silencioso.
checkServer().catch(() => {});
carregarModelos().catch(() => {});
