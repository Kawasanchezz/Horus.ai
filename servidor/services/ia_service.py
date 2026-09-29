import re
import logging
from groq import Groq

from config import (
    GROQ_API_KEY, GROQ_MODEL, GROQ_TIMEOUT, GROQ_MAX_RETRIES,
    MAX_HISTORY_SIZE, MAX_INPUT_LENGTH, MAX_HISTORY_CHARS, ALLOWED_MODELS
)

logger = logging.getLogger(__name__)

# Tenta conectar no Groq se a chave existir
if GROQ_API_KEY and GROQ_API_KEY != "gsk_COLOQUE_SUA_CHAVE_AQUI":
    # max_retries explicito: o padrao do SDK e 2, e cada retry e uma chamada
    # faturada a mais. Sem isso, um pico de 429 na Groq triplica a conta.
    client = Groq(api_key=GROQ_API_KEY, max_retries=GROQ_MAX_RETRIES)
else:
    client = None

# Lista de palavras que podem indicar uma tentativa de hackear o bot
INJECTION_PATTERNS = [
    re.compile(r"ignore\s+todas\s+as\s+regras", re.IGNORECASE),
    re.compile(r"ignore\s+previous\s+instructions", re.IGNORECASE),
    re.compile(r"system\s*prompt", re.IGNORECASE),
    re.compile(r"revele\s+seu\s+prompt", re.IGNORECASE),
    re.compile(r"ignore\s+above", re.IGNORECASE)
]


def sanitizar_input(texto: str) -> str:
    """Limpa o texto do usuario removendo caracteres 'invisiveis' que podem causar erro"""
    if not isinstance(texto, str):
        return ""
    texto = texto.strip()
    # Remove null bytes e caracteres de controle
    texto = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", texto)
    # Remove caracteres de largura zero (usados em ataques)
    texto = re.sub(r"[\u200B-\u200F\u202A-\u202E\uFEFF]", "", texto)
    return texto


def detectar_injection(texto: str) -> bool:
    """Checa se o usuario ta tentando 'dar um golpe' no prompt do bot"""
    return any(pattern.search(texto) for pattern in INJECTION_PATTERNS)


def validar_historico(historico: list) -> list:
    """Garante que o historico de conversa ta limpo e no tamanho certo"""
    if not historico or not isinstance(historico, list):
        return []

    limpo = []
    orcamento = MAX_HISTORY_CHARS

    # Percorre do mais RECENTE para o mais antigo: quando o orcamento acaba, o
    # que se perde e o contexto mais velho — o menos relevante para a resposta.
    # (O caminho inverso descartaria justamente a pergunta anterior.)
    for msg in reversed(historico[-MAX_HISTORY_SIZE:]):
        if orcamento <= 0:
            break
        if not (isinstance(msg, dict) and msg.get("role") in ("user", "assistant")):
            continue

        conteudo = sanitizar_input(msg.get("content", ""))[:MAX_INPUT_LENGTH]
        if not conteudo:
            continue
        conteudo = conteudo[:orcamento]      # corta no que ainda cabe

        limpo.append({"role": msg["role"], "content": conteudo})
        orcamento -= len(conteudo)

    limpo.reverse()   # devolve na ordem cronologica que o modelo espera
    return limpo


def obter_resposta_ia(system_prompt: str, mensagem: str, historico: list = None, modelo: str = None) -> str:
    """
    Fala com a Groq e traz a resposta.
    """
    mensagem = sanitizar_input(mensagem)

    if not mensagem:
        return "Sua mensagem esta vazia."

    # Se detectar tentativa de hack, bloqueia na hora
    if detectar_injection(mensagem):
        logger.warning("Tentativa de injeção bloqueada.")
        return "Sou o Hórus! Por favor, foque em perguntas sobre programação. 💡"

    if client is None:
        return "O bot ta rodando sem chave da API (Modo Demo)."

    # Monta o pacote de mensagens (Instrucoes + Historico + Mensagem Atual)
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(validar_historico(historico))
    messages.append({"role": "user", "content": mensagem})

    try:
        # So aceita modelos da allowlist; qualquer outra coisa cai no padrao
        modelo_ativo = modelo if (modelo and modelo in ALLOWED_MODELS) else GROQ_MODEL

        # Faz o pedido para a IA
        resp = client.chat.completions.create(
            model=modelo_ativo,
            messages=messages,
            temperature=0.7,
            max_tokens=2048,
            timeout=GROQ_TIMEOUT
        )
        return resp.choices[0].message.content.strip()

    except Exception as e:
        # Loga so o tipo do erro por seguranca
        logger.error("Erro na API: %s", type(e).__name__)
        return "Nao consegui responder agora. Tente em alguns segundos."
