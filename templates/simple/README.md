# ⚡ Buntic Simple

Sitio multipágina estático creado con **Buntic** (sin `package.json` ni `node_modules`).

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
├── buntic.config.ts
└── tsconfig.json
```

---

## 🚀 Comandos

```bash
# Servidor de desarrollo con live-reload
buntic dev

# Compilar para producción en dist/
buntic build

# Limpiar dist/ y caché
buntic clean
```
