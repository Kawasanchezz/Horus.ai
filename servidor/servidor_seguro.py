import os
import subprocess
import time
import sys


# Funcao que mata processos travados na porta do bot.
# Script APENAS de desenvolvimento (Windows). Evitamos shell=True e passamos
# argumentos como lista (sem interpolar string no shell) por boa pratica -
# assim nao ha superficie para command injection, mesmo com 'porta' fixo.
def limpar_porta(porta):
    porta = int(porta)  # garante que e numero (nunca vira comando)
    try:
        saida = subprocess.check_output(["netstat", "-ano"], text=True)
    except (OSError, subprocess.SubprocessError):
        return

    for linha in saida.splitlines():
        if f":{porta} " in linha and "LISTENING" in linha:
            pid = linha.split()[-1]
            if not pid.isdigit():
                continue
            print(f"[!] Limpando porta {porta} (ID do processo: {pid})...")
            try:
                subprocess.run(["taskkill", "/F", "/PID", pid],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except (OSError, subprocess.SubprocessError):
                pass
            time.sleep(0.5)


if __name__ == "__main__":
    print("==========================================")
    print("      INICIALIZADOR DO CHATBOT")
    print("==========================================")

    # Agora o script ja esta dentro da pasta backend
    pasta_backend = os.path.dirname(os.path.abspath(__file__))
    arquivo_main = os.path.join(pasta_backend, "main.py")

    if not os.path.exists(arquivo_main):
        print("[X] Erro: Nao achei o arquivo main.py!")
        sys.exit(1)

    PORTA = 5000
    limpar_porta(PORTA)
    print("[+] Iniciando o sistema...")

    try:
        # Roda o main.py diretamente ja que estao na mesma pasta
        subprocess.run([sys.executable, "main.py"], cwd=pasta_backend)
    except KeyboardInterrupt:
        print("\n[+] Sistema desligado.")
    except Exception as e:
        print(f"\n[X] Erro: {e}")
    finally:
        # Garante que a porta fica livre ao fechar (Ctrl+C, erro ou saida
        # normal), mesmo se o main.py nao tiver conseguido se desligar sozinho.
        print("[+] Liberando a porta...")
        limpar_porta(PORTA)

    input("\nAperte Enter para sair...")
