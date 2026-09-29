"""
Entrypoint da Vercel (a Vercel procura `app` em app.py, index.py, main.py...).

Sem logica propria: so reexporta o app Flask de servidor/main.py. Como servidor/
nao e um pacote (main.py importa "from config import ...", "from core...."),
a pasta precisa entrar no sys.path ANTES do import, senao o deploy quebra com
ModuleNotFoundError.
"""
import os
import sys

SERVIDOR_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "servidor")

if SERVIDOR_DIR not in sys.path:
    sys.path.insert(0, SERVIDOR_DIR)

from main import app  # noqa: E402  (precisa vir depois do ajuste de sys.path)

__all__ = ["app"]
