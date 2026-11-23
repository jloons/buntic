# ⚡ Bustatic Simple

Sitio multipágina estático creado con **Bustatic** (sin `package.json` ni `node_modules`).

---

## 📁 Estructura con `src/`

```text
mi-sitio/
├── src/
│   ├── pages/         # index.html, about.html, contact.html
│   ├── layouts/       # main.html
│   ├── components/    # header, footer, card (HTML + CSS scoped)
│   ├── data/          # site.json, features.json
│   ├── styles/        # main.css
│   └── public/        # robots.txt
├── bustatic.config.ts
└── tsconfig.json
```

---

## 🚀 Comandos

```bash
# Servidor de desarrollo con live-reload
bustatic dev

# Compilar para producción en dist/
bustatic build

# Limpiar dist/ y caché
bustatic clean
```
