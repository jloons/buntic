# ⚡ Bustatic Simple Example

Ejemplo sencillo y 100% estático creado con **Bustatic**.

---

## 📁 Estructura con `src/`

```text
examples/simple/
├── src/
│   ├── pages/         # index.html, about.html, contact.html
│   ├── layouts/       # main.html
│   ├── components/    # header, footer, card (HTML + CSS scoped)
│   ├── data/          # site.json, features.json
│   ├── styles/        # main.css
│   └── public/        # robots.txt, bustatic-icon.svg
├── bustatic.config.ts
└── package.json
```

---

## 🚀 Comandos

```bash
# Servidor de desarrollo con live-reload
bun run dev

# Compilar para producción en dist/
bun run build
```
