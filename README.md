# ⚡ Bustatic

> **Zero-dependency, blazing-fast static site generator native to Bun.**

Inspirado en la simplicidad de la web y el rendimiento de Bun, **Bustatic** te permite construir sitios web modernos utilizando exclusivamente **HTML estándar, CSS, JavaScript/TypeScript, Web Components y archivos de datos (JSON)**.

Sin extensiones de archivo propietarias, sin `node_modules` de cientos de megabytes y sin dependencias externas.

---

## ✨ Características

- ⚡ **100% Nativo de Bun:** Aprovecha al máximo `Bun.build`, `Bun.serve` y las APIs del runtime.
- 📦 **Cero Dependencias Externas:** Solo necesitas tener instalado Bun.
- 📑 **Plantillas Estándar:** Usa `<layout>`, `<component>` y `<slot>` directamente en archivos HTML estándar.
- 🔄 **Live-Reload Integrado:** Servidor de desarrollo con WebSockets nativos y recarga en caliente automática.
- 🎨 **Estilos Scoped Nativos:** Escribe `<style scoped>` dentro de cualquier elemento con sintaxis `&`, deduplicación automática y cero parpadeo (FOUC).
- 🧩 **Web Components:** Reactividad e interactividad del lado del cliente usando estándares web.
- 📊 **Datos JSON:** Carga automática de datos estructurados desde la carpeta `data/`.
- 🛠 **CLI y API Programática:** Úsalo globalmente, con `bunx`, en tus `package.json` scripts o impórtalo en tu código TypeScript.

---

## 🚀 Inicio Rápido

### 1. Ejecución con Bunx
Puedes probar un proyecto existente sin instalar nada:
```bash
bunx bustatic dev
```

### 2. Instalación Global
```bash
bun add -g bustatic
bustatic --help
```

### 3. En un proyecto local
```bash
bun add -d bustatic
```

Añade los comandos en `package.json`:
```json
{
  "scripts": {
    "dev": "bustatic dev",
    "build": "bustatic build"
  }
}
```

---

## 📁 Estructura del Proyecto

```
mi-sitio/
├── pages/             # Rutas HTML (index.html -> /, about.html -> /about)
├── layouts/           # Layouts reutilizables (main.html) con <slot>
├── components/        # Componentes HTML y Web Components (counter.ts)
├── data/              # Archivos JSON (site.json -> {{site.title}})
├── public/            # Archivos estáticos copiados a dist/ (favicon, robots.txt)
└── styles/            # Estilos CSS procesados por Bun.build
```

---

## 📖 Documentación

- [Primeros Pasos](docs/getting-started.md)
- [Guía de Plantillas y Componentes](docs/templating.md)
- [Referencia del CLI](docs/cli.md)
- [Roadmap del Proyecto](ROADMAP.md)

---

## 🧪 Pruebas

Ejecutar la suite completa de pruebas unitarias:
```bash
bun test
```

---

## 📄 Licencia

[MIT](LICENSE)
