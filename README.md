<div align="center">

<img src="landing-page/assets/images/logo-horus.png" alt="Logo do Hórus AI: um falcão estilizado" width="200">

# Hórus AI — Seu Mentor de Programação

![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-000000?style=for-the-badge&logo=flask&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)

</div>

Chatbot que ajuda estudantes a aprender programação, tirar dúvidas de código e
encontrar bugs de forma didática. Backend em Flask (IA via Groq) e frontend em
HTML/CSS/JS puro.

## ✨ Recursos

- Conversa com IA sobre programação
- Histórico salvo só no navegador do usuário
- Anexo de trechos de código
- Tema claro/escuro e escolha do modelo de IA

## 🛠️ Como rodar

1. Instale as dependências (Python 3.13):
   ```bash
   pip install -r requirements.txt
   ```
2. Em `servidor/`, copie `.env.example` para `.env` e coloque sua chave da Groq
   em `GROQ_API_KEY` (grátis em https://console.groq.com/keys).
   Sem chave, o bot roda em Modo Demo.
3. Inicie o servidor:
   ```bash
   python servidor/servidor_seguro.py
   ```
4. Abra http://127.0.0.1:5000

## 🚀 Deploy

Funciona na Vercel (`vercel.json` já incluso) ou em qualquer host Python com
`gunicorn`. Em produção, defina as variáveis no painel do host, nunca em arquivo:
`GROQ_API_KEY`, `APP_ENV=production` e `ALLOWED_ORIGINS` com o seu domínio.
Todas as opções estão comentadas em [`servidor/.env.example`](servidor/.env.example).

> 🔑 Nunca faça commit do `.env`. Ele já está no `.gitignore`.

## 🗂 Estrutura

```
├── app.py          → entrypoint da Vercel
├── servidor/       → backend Flask
├── landing-page/   → frontend
└── requirements.txt
```

## 📄 Licença

MIT — veja [LICENSE](LICENSE).
