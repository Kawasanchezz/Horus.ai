import os
import logging
from dotenv import load_dotenv

# Carrega o .env que fica ao lado deste arquivo (funciona de qualquer pasta)
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

logger = logging.getLogger(__name__)


def _env_int(nome: str, padrao: int) -> int:
    """Le um inteiro do ambiente sem quebrar se o valor vier invalido."""
    try:
        return int(os.environ.get(nome, str(padrao)))
    except (TypeError, ValueError):
        logger.warning("Valor invalido para %s no .env; usando padrao %s", nome, padrao)
        return padrao


# --- Configuracoes da Groq ---
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
GROQ_TIMEOUT = _env_int("GROQ_TIMEOUT", 30)

# Allowlist de modelos: o cliente pode mandar "modelo" no /chat, entao so
# aceitamos modelos conhecidos (evita abuso/custo com modelos arbitrarios).
# Da pra estender via ALLOWED_MODELS no .env (separado por virgula).
#
# NAO recoloque estes sem antes conferir em console.groq.com/docs/deprecations:
#   llama-3.1-70b-versatile  -> desligado em 24/01/2025
#   llama-3.1-8b-instant     -> desligado em 16/08/2026
#   llama-3.3-70b-versatile  -> desligado (confirmado em 18/08/2026: a API
#                               respondeu 404 model_not_found e o chat inteiro
#                               parou, devolvendo so "Nao consegui responder")
#
# Um modelo desligado NAO falha aqui: passa na allowlist e so estoura la na
# Groq, virando a mensagem generica. Por isso, ao trocar de modelo, confirme
# com uma chamada real — a allowlist nao sabe o que existe do outro lado.
_MODELOS_PADRAO = "openai/gpt-oss-120b,openai/gpt-oss-20b"
_modelos = {m.strip() for m in os.environ.get("ALLOWED_MODELS", _MODELOS_PADRAO).split(",") if m.strip()}
_modelos.add(GROQ_MODEL)  # o modelo padrao sempre e permitido
ALLOWED_MODELS = frozenset(_modelos)

# --- Configuracoes do Servidor ---
# Ambiente: "development" (padrao) ou "production". Controla travas de seguranca.
APP_ENV = os.environ.get("APP_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV == "production"

PORT = _env_int("PORT", 5000)

# Quantos proxies confiaveis existem na frente do app. Isso decide se o
# X-Forwarded-For sera respeitado para identificar o IP do cliente.
#
# 0 (padrao seguro) = nenhum proxy: o header e IGNORADO e vale o IP real do
#   socket. Sem isso, qualquer cliente forjaria o X-Forwarded-For e zeraria o
#   rate limit por request (bypass total do flask-limiter).
# 1 = atras de exatamente um proxy TLS (nginx, Cloudflare, load balancer...).
# Use o numero REAL de proxies: um valor alto demais volta a permitir spoofing.
TRUSTED_PROXY_COUNT = _env_int("TRUSTED_PROXY_COUNT", 0)

# Debug NUNCA pode ficar ligado em producao: o debugger do Werkzeug expoe um
# console interativo (= execucao remota de codigo). Em producao forcamos False.
FLASK_DEBUG = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
if IS_PRODUCTION and FLASK_DEBUG:
    logger.warning("FLASK_DEBUG=true ignorado em producao (seguranca): debugger desativado.")
    FLASK_DEBUG = False

ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5000").split(",") if o.strip()
]

# Rate limit: memory:// serve pra 1 processo (dev). Em producao com varios
# workers, aponte para um backend compartilhado (ex.: redis://...) via env.
RATELIMIT_STORAGE_URI = os.environ.get("RATELIMIT_STORAGE_URI", "memory://")

# Redireciona HTTP->HTTPS quando ligado (produção atrás de proxy TLS).
# Fica desligado por padrao pra nao quebrar o dev local em HTTP.
FORCE_HTTPS = os.environ.get("FORCE_HTTPS", "false").lower() == "true"

# --- Limites de Seguranca ---
MAX_INPUT_LENGTH = 8000       # Maximo de letras por mensagem (cobre texto + anexos)
MAX_HISTORY_SIZE = 16         # Quantas msgs o bot lembra

# Teto do historico INTEIRO, somando todas as mensagens.
#
# Sem ele, limitar so o tamanho de CADA mensagem nao adianta: 16 x 8000 = 128 mil
# caracteres (~32 mil tokens) numa unica chamada, contra ~150 de uma conversa
# real. Como o historico vem do cliente a cada request, qualquer um podia inflar
# e multiplicar o custo por ~218x sem burlar nenhum rate limit.
MAX_HISTORY_CHARS = 12000

# 32KB cobre com folga mensagem + historico + anexos ja truncados. O valor
# anterior (128KB) era exatamente a janela que permitia o historico inflado.
MAX_REQUEST_SIZE = 32 * 1024

# Retries do SDK da Groq. O padrao do SDK e 2, o que transforma UMA requisicao
# em ate TRES chamadas faturadas quando a Groq devolve 429/5xx — justo quando
# ela ja esta sobrecarregada (retry storm). 1 mantem resiliencia sem triplicar.
GROQ_MAX_RETRIES = _env_int("GROQ_MAX_RETRIES", 1)

# Kill switch. CHAT_ENABLED=false derruba so o /chat (503), mantendo o site no ar.
# E a unica forma de estancar consumo em segundos, sem redeploy de codigo.
CHAT_ENABLED = os.environ.get("CHAT_ENABLED", "true").strip().lower() != "false"
RATE_LIMIT_DEFAULT = "60 per minute"
RATE_LIMIT_CHAT = "20 per minute"

# Teto de chamadas SIMULTANEAS a IA neste processo.
#
# O rate limit conta requisicoes por JANELA DE TEMPO; ele nao impede que as 20
# permitidas por minuto disparem todas no mesmo instante e segurem 20 workers
# por ate GROQ_TIMEOUT segundos cada. Uma sessao nova (aba anonima, outro
# navegador) nao custa nada para o atacante, entao a rajada simultanea e o
# caminho barato para esgotar o servidor.
#
# ATENCAO ao alcance: o semaforo e POR PROCESSO. No self-host com gunicorn
# (worker com threads) ele protege de verdade. Em serverless, onde cada
# instancia e isolada, ele limita CADA instancia — o teto agregado continua
# sendo o RATE_LIMIT_GLOBAL, que precisa de storage compartilhado.
MAX_CONCURRENT_REQUESTS = _env_int("MAX_CONCURRENT_REQUESTS", 4)

# Teto do APP INTEIRO, somando todos os visitantes. O limite por IP acima nao
# protege a cota da Groq: quem tem varios IPs (VPN, botnet, proxy rotativo)
# simplesmente contorna. Este teto e a unica barreira que independe do IP.
# Ao ser atingido, o /chat responde 429 ate a janela virar.
RATE_LIMIT_GLOBAL = os.environ.get("RATE_LIMIT_GLOBAL", "300 per hour")


def validar_configuracao():
    """Valida a configuracao e avisa sobre riscos de seguranca no boot."""
    if not GROQ_API_KEY or GROQ_API_KEY == "gsk_COLOQUE_SUA_CHAVE_AQUI":
        logger.warning("⚠️ AVISO: Chave da Groq nao encontrada. O bot vai rodar em modo de teste.")

    # FORCE_HTTPS depende de request.is_secure, que so enxerga o
    # X-Forwarded-Proto se o ProxyFix estiver ligado. Com 0 proxies confiaveis
    # atras de um proxy TLS, todo request parece HTTP e o redirect vira loop.
    if FORCE_HTTPS and TRUSTED_PROXY_COUNT == 0:
        logger.warning("FORCE_HTTPS=true com TRUSTED_PROXY_COUNT=0: se houver um proxy TLS "
                       "na frente, o redirect HTTP->HTTPS entra em loop infinito. "
                       "Defina TRUSTED_PROXY_COUNT=1 (ou o numero real de proxies).")

    # Avisos especificos de producao (nao derrubam o app, so alertam)
    if IS_PRODUCTION:
        if any(("localhost" in o or "127.0.0.1" in o) for o in ALLOWED_ORIGINS):
            logger.warning("ALLOWED_ORIGINS ainda aponta para localhost em producao. "
                           "Configure o dominio real (ex.: https://seu-dominio.com).")
        if not FORCE_HTTPS:
            logger.warning("FORCE_HTTPS=false em producao. Habilite HTTPS/HSTS atras do proxy TLS.")
        if RATELIMIT_STORAGE_URI.startswith("memory://"):
            logger.warning("RATELIMIT_STORAGE_URI=memory:// em producao: o limite nao e "
                           "compartilhado entre workers. Use redis:// para rate limit real.")
        if TRUSTED_PROXY_COUNT == 0:
            logger.warning("TRUSTED_PROXY_COUNT=0 em producao: se o app estiver atras de um "
                           "proxy (nginx/Cloudflare), o rate limit vai contar TODOS os clientes "
                           "como o mesmo IP (o do proxy). Defina o numero real de proxies.")
