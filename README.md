# ⚡ Buntic

> **Zero-dependency, blazing-fast static site generator native to Bun.**

Inspirado en la simplicidad de la web y el rendimiento de Bun, **Buntic** te permite construir sitios web modernos utilizando exclusivamente **HTML estándar, CSS, JavaScript/TypeScript, Web Components, SQL y almacenamiento en la nube**.

Sin extensiones de archivo propietarias, sin `node_modules` de cientos de megabytes, sin `package.json` obligatorio en tus sitios y con **cero dependencias externas**.

---

## ✨ Características Principales

- ⚡ **100% Nativo de Bun (`>=1.4.0`):** Aprovecha al máximo `Bun.build`, `Bun.serve`, `Bun.Image`, `Bun.S3Client`, `bun:sqlite`, `Bun.sql`, y `Bun.redis`.
- 📦 **Cero Dependencias Externas y Sin `package.json`:** Instala Buntic una sola vez de forma global y crea proyectos limpios con solo HTML, CSS, TypeScript y `tsconfig.json`.
- 🖼️ **Pipeline de Imágenes Nativo (`<photo>`):** Compresión automática a WebP a velocidad C++, cálculo de dimensiones anti-CLS y generación responsiva de `srcset` y `sizes`.
- 🗄️ **Storage Loaders Remotos (`storage/`):** Integración nativa con **Amazon S3 / R2 / MinIO** y servidores **OCI Registry / Docker Registry** vía `OrasClient` y `createOrasStorage` con versionado por tags y caché inmutable persistente por ETag/Digest en `.buntic/cache/images`.
- 🔍 **Suite SEO Out-of-the-Box:** Componente `<seo>`, generación dinámica de `sitemap.xml`, `robots.txt` configurable y feeds RSS 2.0 y Atom 1.0.
- 📱 **Tarjetas Sociales Automáticas:** Generación de tarjetas OpenGraph y Twitter Cards a tamaño estándar 1200x630 WebP a partir de imágenes locales o remotas en S3/OCI.
- 🚀 **Enrutamiento Dinámico, SQL y Redis:** Parámetros en rutas (`pages/[slug].html`), loaders `.data.ts`, integración directa con SQLite, PostgreSQL y Redis, y paginación declarativa.
- 📑 **Plantillas Estándar:** Usa `<layout>`, `<slot>`, `<each>` y `<if>` directamente en HTML estándar.
- 🧩 **Componentes SVG Nativos:** Inclusión inline con `<component src="...svg" />`, passthrough de atributos (`class`, `width`, `aria-*`), `<style scoped>`, CSS hermano co-ubicado (`.svg` + `.css`) y compatibilidad con DSD.
- 🎨 **Estilos Scoped Nativos:** Escribe `<style scoped>` dentro de cualquier elemento con sintaxis `&` o `:host`, deduplicación automática y cero FOUC.
- 🔄 **Live-Reload Integrado:** Servidor de desarrollo con WebSockets nativos y recarga en caliente automática.

---

## 🚀 Inicio Rápido

Requiere [Bun](https://bun.sh) `>=1.4.0`.

### 1. Instalación Global (Recomendada — sin `package.json`)
```bash
bun add -g buntic
```

Crea un proyecto nuevo desde cualquier directorio:
```bash
# Plantilla en blanco por defecto (blank)
buntic init mi-sitio

# O usando la plantilla multipágina (simple)
buntic init mi-sitio --template simple

cd mi-sitio
buntic dev
```

`buntic init` genera un proyecto limpio **sin `package.json` ni `node_modules`**, incluyendo:
- `tsconfig.json` y definiciones de tipos locales en `.buntic/types/` (autocompletado completo para `import { defineConfig } from "buntic"` sin instalar dependencias en el proyecto).
- La skill de Buntic para agentes de IA en `.agents/skills/buntic/` (omitible con `--no-skills`).

### 2. Ejecución directa con `bunx`
```bash
bunx buntic init mi-sitio
bunx buntic dev mi-sitio
```

### 3. Uso local opcional en un proyecto con `package.json`
Si prefieres fijar la versión de Buntic por proyecto:
```bash
bun add -d buntic
```

```json
{
  "scripts": {
    "dev": "buntic dev",
    "build": "buntic build",
    "clean": "buntic clean"
  }
}
```

---

## 📁 Estructura del Proyecto

Buntic auto-detecta tanto la estructura estándar recomendada con `src/` como la estructura plana en la raíz:

```text
mi-sitio/
├── src/                  # Estructura recomendada (auto-detectada)
│   ├── pages/            # Rutas HTML (index.html -> /, [slug].html -> /:slug)
│   ├── layouts/          # Layouts reutilizables (main.html) con <slot>
│   ├── components/       # Componentes HTML y Web Components (counter.ts)
│   ├── data/             # Almacén de datos (SQLite, Postgres, JSON, TS)
│   ├── storage/          # Loaders de objetos remotos (S3, Cloudflare R2, MinIO, OCI)
│   ├── styles/           # Hojas de estilo globales (main.css)
│   └── public/           # Archivos estáticos copiados directamente a dist/
├── .agents/skills/       # Skill de Buntic instalada por `buntic init`
├── dist/                 # Carpeta de salida compilada
├── buntic.config.ts    # Configuración de URLs, SEO, feeds y almacenamiento
└── tsconfig.json         # Configuración TypeScript (tipos en .buntic/types/)
```

---

## 📚 Documentación Técnica

### 🚀 Primeros Pasos
- [Guía de Inicio Rápido](https://github.com/jloons/buntic/blob/main/docs/getting-started.md)
- [Referencia del CLI](https://github.com/jloons/buntic/blob/main/docs/cli.md)
- [Roadmap del Proyecto](https://github.com/jloons/buntic/blob/main/ROADMAP.md)
- [Ejemplo Simple (Plantillas y Web Components)](https://github.com/jloons/buntic/blob/main/examples/simple/README.md)
- [Ejemplo Catalog (OCI Registry, S3, Postgres, Redis y Podman)](https://github.com/jloons/buntic/blob/main/examples/catalog/README.md)

### 🎨 Fundación y Plantillas (Fase 0)
- [Guía de Plantillas y Componentes](https://github.com/jloons/buntic/blob/main/docs/templating.md)
- [Estilos Scoped y Grafo de Dependencias CSS](https://github.com/jloons/buntic/blob/main/docs/scoped-css.md)
- [Web Components Nativos y Declarative Shadow DOM](https://github.com/jloons/buntic/blob/main/docs/web-components.md)

### 📊 Enrutamiento y Datos (Fase 1)
- [Enrutamiento Basado en Archivos y Páginas Dinámicas](https://github.com/jloons/buntic/blob/main/docs/routing-and-pages.md)
- [Datos, Loaders y Variables de Entorno](https://github.com/jloons/buntic/blob/main/docs/data-and-loaders.md)
- [Motores SQL Nativos (`bun:sqlite` y `Bun.sql`)](https://github.com/jloons/buntic/blob/main/docs/databases-sql.md)
- [Sistema de Paginación Automática](https://github.com/jloons/buntic/blob/main/docs/pagination.md)

### 🖼️ Assets, Cloud y SEO (Fase 2)
- [Optimización de Imágenes con `<photo>`](https://github.com/jloons/buntic/blob/main/docs/assets-and-images.md)
- [Storage Loaders Remotos (S3, R2, MinIO y OCI)](https://github.com/jloons/buntic/blob/main/docs/storage-loaders.md)
- [Suite SEO, Metadatos Sociales y Feeds](https://github.com/jloons/buntic/blob/main/docs/seo.md)

---

## 🧪 Pruebas

Ejecutar la suite completa de pruebas unitarias e integración:
```bash
bun test
```

---

## 📄 Licencia

[MIT](https://github.com/jloons/buntic/blob/main/LICENSE)
