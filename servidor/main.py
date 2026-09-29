import os
import logging
import mimetypes
import signal
import sys
import threading
from flask import Flask, request, jsonify, redirect
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix

from config import (
    ALLOWED_ORIGINS, FLASK_DEBUG, PORT,
    MAX_REQUEST_SIZE, RATE_LIMIT_DEFAULT, RATE_LIMIT_CHAT,
    MAX_INPUT_LENGTH, RATELIMIT_STORAGE_URI, FORCE_HTTPS, RATE_LIMIT_GLOBAL,
    TRUSTED_PROXY_COUNT, ALLOWED_MODELS, GROQ_MODEL, APP_ENV, GROQ_API_KEY,
    CHAT_ENABLED, GROQ_MAX_RETRIES, MAX_HISTORY_CHARS, MAX_CONCURRENT_REQUESTS,
    IS_PRODUCTION, validar_configuracao
)
from core.prompt_mestre import PromptMestre
from services.ia_service import obter_resposta_ia

# Configura o log pra gente ver o que acontece no terminal
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s]: %(message)s")
logger = logging.getLogger(__name__)

# Verifica se a chave da API ta certinha antes de começar
validar_configuracao()

# Pasta do frontend: usa FRONTEND_DIR do .env se existir; senão, a landing-page do projeto
# (landing-page/ é irmã de servidor/ na raiz do repo)
FRONTEND_DIR = os.environ.get("FRONTEND_DIR") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "landing-page")
)
logger.info("Servindo frontend de: %s", FRONTEND_DIR)

# O Flask deduz o Content-Type dos estaticos pelo modulo mimetypes, que no
# Windows consulta o registro do sistema - e la .woff2 normalmente nao existe.
# Sem isso a fonte sai como "application/octet-stream" em vez de "font/woff2".
# Registramos explicitamente para o tipo ser o mesmo em qualquer SO.
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("font/woff", ".woff")

app = Flask(__name__,
            static_folder=FRONTEND_DIR,
            static_url_path="")

# Confiar no X-Forwarded-* so faz sentido se existir mesmo um proxy na frente.
# Aplicar ProxyFix sem proxy deixa qualquer cliente forjar o proprio IP pelo
# header e, com isso, burlar o rate limit (o flask-limiter usa get_remote_address).
# Por isso o padrao e 0 = nao confiar em nada; atras de nginx/Cloudflare use 1.
if TRUSTED_PROXY_COUNT > 0:
    app.wsgi_app = ProxyFix(
        app.wsgi_app,
        x_for=TRUSTED_PROXY_COUNT,
        x_proto=TRUSTED_PROXY_COUNT,
        x_host=TRUSTED_PROXY_COUNT,
        x_prefix=TRUSTED_PROXY_COUNT,
    )
    logger.info("ProxyFix ativo: confiando em %d proxy(s).", TRUSTED_PROXY_COUNT)
else:
    logger.info("ProxyFix desativado: X-Forwarded-* ignorado (IP real do socket).")
app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_SIZE

# Libera o acesso para o nosso frontend
CORS(app, origins=ALLOWED_ORIGINS)

# Limitador de mensagens (pra ninguem travar o bot mandando 1000 msgs)
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=[RATE_LIMIT_DEFAULT],
    storage_uri=RATELIMIT_STORAGE_URI
)

# Pega as instrucoes do "Mestre" (como o bot deve agir)
system_prompt = PromptMestre().get_prompt()

# Vagas para chamadas SIMULTANEAS a IA. Sem isto, abrir N abas anonimas dispara
# N chamadas ao mesmo tempo: cada uma segura um worker por ate GROQ_TIMEOUT
# segundos. Recusamos na hora (nao enfileiramos) para o excesso nao virar espera.
_vagas_ia = threading.BoundedSemaphore(MAX_CONCURRENT_REQUESTS)


# Redireciona HTTP -> HTTPS quando FORCE_HTTPS estiver ligado (producao com TLS).
# request.is_secure respeita o X-Forwarded-Proto graças ao ProxyFix acima.
@app.before_request
def enforce_https():
    if FORCE_HTTPS and not request.is_secure:
        url = request.url.replace("http://", "https://", 1)
        return redirect(url, code=301)


# Headers de seguranca (protege contra ataques basicos de navegador)
@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    # HTML e API nunca ficam em cache; fonte, CSS, JS e imagens podem (1 dia).
    if request.endpoint == "static" and not request.path.endswith(".html"):
        response.headers["Cache-Control"] = "public, max-age=86400"
    else:
        response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=(self)"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    # So anuncia HSTS quando FORCE_HTTPS estiver ligado (producao atras de proxy TLS);
    # em dev HTTP puro nao faz sentido pedir ao navegador para forcar HTTPS.
    if FORCE_HTTPS:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # CSP sem nenhum host externo: JS, CSS e a fonte Inter sao todos servidos
    # localmente. 'unsafe-inline' nao e preciso em style-src porque o HTML nao
    # tem <style> nem atributo style=""; o script mexe em estilo so via CSSOM
    # (element.style), que a CSP nao governa.
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self'; "
        "font-src 'self'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    )
    return response


# Rota principal: entrega o site (index.html)
@app.route("/")
def index():
    return app.send_static_file("index.html")


# Rota do Chat: onde a magica acontece
def _ip_anonimo(ip):
    """Trunca o IP para log: identifica a origem sem guardar dado pessoal.

    203.0.113.42 -> 203.0.113.x   |   2001:db8:85a3::1 -> 2001:db8:85a3::
    """
    if not ip:
        return "?"
    if ":" in ip:                                  # IPv6
        return ":".join(ip.split(":")[:3]) + "::"
    partes = ip.split(".")
    return ".".join(partes[:3]) + ".x" if len(partes) == 4 else "?"


@app.route("/chat", methods=["POST"])
@limiter.limit(RATE_LIMIT_CHAT)                                # por visitante
@limiter.limit(RATE_LIMIT_GLOBAL, key_func=lambda: "global")   # teto do app todo
def chat():
    # KILL SWITCH: desliga so o /chat, o resto do site continua no ar.
    # Trocar a env var e redeployar leva ~30s — a resposta mais rapida
    # possivel a um pico de consumo, sem mexer em codigo.
    if not CHAT_ENABLED:
        return jsonify({"erro": "O chat esta temporariamente indisponivel."}), 503

    dados = request.get_json(silent=True)

    # Aceita apenas objeto JSON (ex.: corpo "42", "texto" ou uma lista tambem sao
    # JSON valido, mas dados.get() so existe em dict; sem essa checagem, esses
    # casos quebravam com AttributeError -> 500 em vez de um 400 limpo)
    if not dados or not isinstance(dados, dict):
        return jsonify({"erro": "Dados invalidos"}), 400

    mensagem = dados.get("mensagem", "")
    # Seguranca/robustez: so aceita texto (evita 500 se vier numero/objeto)
    if not isinstance(mensagem, str):
        return jsonify({"erro": "Dados invalidos"}), 400
    mensagem = mensagem.strip()
    if not mensagem:
        return jsonify({"erro": "Mensagem vazia"}), 400

    # Seguranca: nao deixa mandar texto gigante
    if len(mensagem) > MAX_INPUT_LENGTH:
        return jsonify({"erro": "Texto muito longo"}), 400

    historico = dados.get("historico", [])
    modelo = dados.get("modelo")
    # So aceita 'modelo' como string; senao usa o padrao do servidor
    if not isinstance(modelo, str):
        modelo = None

    # Log de USO (nao de conteudo): sem isso um ataque de custo so aparece na
    # fatura. Registra origem truncada e TAMANHO — nunca o que foi escrito.
    logger.info("chat ip=%s msg=%dch hist=%dmsg modelo=%s",
                _ip_anonimo(request.remote_addr),
                len(mensagem),
                len(historico) if isinstance(historico, list) else 0,
                modelo or "padrao")

    # Trava de concorrencia: recusa em vez de enfileirar. Fica DEPOIS de toda a
    # validacao, para que request invalida barata nao ocupe uma vaga.
    if not _vagas_ia.acquire(blocking=False):
        logger.warning("concorrencia no teto (%d chamadas simultaneas); recusando",
                       MAX_CONCURRENT_REQUESTS)
        return jsonify({"erro": "Muitas conversas ao mesmo tempo. Tente em instantes."}), 429

    try:
        # Chama o servico que fala com a IA do Groq
        resposta = obter_resposta_ia(system_prompt, mensagem, historico, modelo)
    finally:
        _vagas_ia.release()   # sempre devolve a vaga, inclusive se estourar

    return jsonify({"resposta": resposta})


# Modelos que o /chat aceita. O frontend monta o seletor a partir daqui em vez
# de manter uma copia da lista: assim os dois nunca divergem quando a allowlist
# do servidor mudar. Nao expoe nada sensivel - so nomes de modelo publicos.
@app.route("/models")
def models():
    return jsonify({"modelos": sorted(ALLOWED_MODELS), "padrao": GROQ_MODEL})


# Rota de teste pra saber se o servidor ta vivo
@app.route("/health")
def health():
    # Em producao a rota e publica: devolve so o basico, sem revelar limites e
    # configuracao interna. Fora dela, mostra tudo para conferir o deploy.
    # Nada aqui e segredo: sao numeros e flags, nunca a chave da API.
    if IS_PRODUCTION:
        return jsonify({"status": "Online e Seguro!", "ia_configurada": bool(GROQ_API_KEY)})
    return jsonify({
        "status": "Online e Seguro!",
        "ambiente": APP_ENV,
        "proxies_confiaveis": TRUSTED_PROXY_COUNT,
        "rate_limit_ip": RATE_LIMIT_CHAT,
        "rate_limit_global": RATE_LIMIT_GLOBAL,
        "chat_ativo": CHAT_ENABLED,
        "max_historico_chars": MAX_HISTORY_CHARS,
        "max_request_kb": MAX_REQUEST_SIZE // 1024,
        "groq_max_retries": GROQ_MAX_RETRIES,
        "max_concorrencia": MAX_CONCURRENT_REQUESTS,
        "ia_configurada": bool(GROQ_API_KEY),
    })


# Tratamento de erros amigavel
@app.errorhandler(413)
def payload_too_large(e):
    return jsonify({"erro": "Requisicao muito grande"}), 413


@app.errorhandler(429)
def rate_limit_handler(e):
    return jsonify({"erro": "Calma! Muitas mensagens. Espera um pouco."}), 429


@app.errorhandler(500)
def internal_error(e):
    logger.error("Erro interno: %s", type(e).__name__)
    return jsonify({"erro": "Ops, algo deu errado no servidor."}), 500


# Funcao pra desligar o servidor certinho com Ctrl+C
def graceful_shutdown(sig, frame):
    logger.info("Desligando o servidor...")
    sys.exit(0)


# Os handlers de sinal só fazem sentido pro processo de desenvolvimento (servidor
# standalone). Registrar signal.signal() no nivel do modulo rodaria toda vez que o
# app fosse importado (ex.: por um servidor WSGI como o gunicorn), o que nao tem
# efeito util ali e pode ate falhar (signal so funciona na main thread).
if __name__ == "__main__":
    signal.signal(signal.SIGINT, graceful_shutdown)
    signal.signal(signal.SIGTERM, graceful_shutdown)
    logger.info("Bot rodando na porta %d", PORT)
    app.run(debug=FLASK_DEBUG, host="127.0.0.1", port=PORT)
