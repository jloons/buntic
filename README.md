# ⚡ Bustatic

> **Zero-dependency, blazing-fast static site generator native to Bun.**

Inspirado en la simplicidad de la web y el rendimiento de Bun, **Bustatic** te permite construir sitios web modernos utilizando exclusivamente **HTML estándar, CSS, JavaScript/TypeScript, Web Components, SQL y almacenamiento en la nube**.

Sin extensiones de archivo propietarias, sin `node_modules` de cientos de megabytes y con **cero dependencias externas**.

---

## ✨ Características Principales

- ⚡ **100% Nativo de Bun:** Aprovecha al máximo `Bun.build`, `Bun.serve`, `Bun.Image`, `Bun.S3Client`, `bun:sqlite`, `Bun.sql`, y `Bun.redis`.
- 📦 **Cero Dependencias Externas:** Cero paquetes de npm requeridos.
- 🖼️ **Pipeline de Imágenes Nativo (`<photo>`):** Compresión automática a WebP a velocidad C++, cálculo de dimensiones anti-CLS y generación responsiva de `srcset` y `sizes`.
- 🗄️ **Storage Loaders Remotos (`storage/`):** Integración nativa con **Amazon S3 / R2 / MinIO** y servidores **OCI Registry / Docker Registry** vía `OrasClient` y `createOrasStorage` con versionado por tags y caché inmutable persistente por ETag/Digest en `.bustatic/cache/images`.
- 🔍 **Suite SEO Out-of-the-Box:** Componente `<seo>`, generación dinámica de `sitemap.xml`, `robots.txt` configurable y feeds RSS 2.0 y Atom 1.0.
- 📱 **Tarjetas Sociales Automáticas:** Generación de tarjetas OpenGraph y Twitter Cards a tamaño estándar 1200x630 WebP a partir de imágenes locales o remotas en S3/OCI.
- 🚀 **Enrutamiento Dinámico, SQL y Redis:** Parámetros en rutas (`pages/[slug].html`), loaders `.data.ts`, integración directa con SQLite, PostgreSQL y Redis, y paginación declarativa.
- 📑 **Plantillas Estándar:** Usa `<layout>`, `<slot>`, `<each>` y `<if>` directamente en HTML estándar.
- 🎨 **Estilos Scoped Nativos:** Escribe `<style scoped>` dentro de cualquier elemento con sintaxis `&` o `:host`, deduplicación automática y cero FOUC.
- 🔄 **Live-Reload Integrado:** Servidor de desarrollo con WebSockets nativos y recarga en caliente automática.

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
    "build": "bustatic build",
    "clean": "bustatic clean"
  }
}
```

---

## 📁 Estructura del Proyecto

Bustatic auto-detecta tanto la estructura estándar recomendada con `src/` como la estructura plana en la raíz:

```text
mi-sitio/
├── src/                  # Estructura recomendada (auto-detectada)
│   ├── pages/            # Rutas HTML (index.html -> /, [slug].html -> /:slug)
│   ├── layouts/          # Layouts reutilizables (main.html) con <slot>
│   ├── components/       # Componentes HTML y Web Components (counter.ts)
│   ├── data/             # Almacén de datos (SQLite, Postgres, JSON, TS)
│   ├── storage/          # Loaders de objetos remotos (S3, Cloudflare R2, MinIO)
│   ├── styles/           # Hojas de estilo globales (main.css)
│   └── public/           # Archivos estáticos copiados directamente a dist/
├── docs/                 # Documentación técnica adicional (opcional)
├── scripts/              # Scripts auxiliares del proyecto (opcional)
├── dist/                 # Carpeta de salida compilada
└── bustatic.config.ts    # Configuración de URLs, SEO, feeds y almacenamiento
```

---

## 📚 Documentación Técnica

### 🚀 Primeros Pasos
- [Guía de Inicio Rápido](docs/getting-started.md)
- [Referencia del CLI](docs/cli.md)
- [Roadmap del Proyecto](ROADMAP.md)
- [Ejemplo Simple (Plantillas y Web Components)](examples/simple/README.md)
- [Ejemplo Catalog (OCI Registry, S3, Postgres, Redis y Podman)](examples/catalog/README.md)

### 🎨 Fundación y Plantillas (Fase 0)
- [Guía de Plantillas y Componentes](docs/templating.md)
- [Estilos Scoped y Grafo de Dependencias CSS](docs/scoped-css.md)
- [Web Components Nativos y Declarative Shadow DOM](docs/web-components.md)

### 📊 Enrutamiento y Datos (Fase 1)
- [Enrutamiento Basado en Archivos y Páginas Dinámicas](docs/routing-and-pages.md)
- [Datos, Loaders y Variables de Entorno](docs/data-and-loaders.md)
- [Motores SQL Nativos (`bun:sqlite` y `Bun.sql`)](docs/databases-sql.md)
- [Sistema de Paginación Automática](docs/pagination.md)

### 🖼️ Assets, Cloud y SEO (Fase 2)
- [Optimización de Imágenes con `<photo>`](docs/assets-and-images.md)
- [Storage Loaders Remotos (S3, R2, MinIO)](docs/storage-loaders.md)
- [Suite SEO, Metadatos Sociales y Feeds](docs/seo.md)

---

## 🧪 Pruebas

Ejecutar la suite completa de pruebas unitarias e integración:
```bash
bun test
```

---

## 📄 Licencia

[MIT](LICENSE)
