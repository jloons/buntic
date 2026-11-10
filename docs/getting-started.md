# Primeros Pasos con Bustatic

**Bustatic** es un generador de sitios estáticos (SSG) ultrarrápido y con cero dependencias externas, diseñado exclusivamente para el runtime de [Bun](https://bun.sh).

---

## Requisitos

- Tener instalado [Bun](https://bun.sh) (v1.0 o superior).

---

## Instalación

### Uso global desde Bun:
```bash
bun add -g bustatic
```

### Uso directo sin instalar (con `bunx`):
```bash
bunx bustatic dev
```

### Uso local en un proyecto:
```bash
bun add -d bustatic
```

Agrega los comandos a tus `scripts` en el `package.json`:
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

## Estructura Recomendada de un Proyecto

Bustatic detecta automáticamente tanto la estructura estándar basada en `src/` (recomendada) como la estructura plana en la raíz:

```text
mi-sitio/
├── src/                  # Estructura recomendada (auto-detectada)
│   ├── pages/            # Cada archivo .html se convierte en una ruta web
│   │   ├── index.html    # -> /
│   │   ├── about.html    # -> /about
│   │   └── blog/
│   │       ├── [slug].html
│   │       └── [slug].data.ts
│   ├── layouts/          # Plantillas base
│   │   └── main.html     # Estructura HTML base con <slot>
│   ├── components/       # Componentes HTML reutilizables y Web Components
│   │   ├── header.html
│   │   ├── card.html
│   │   └── counter.ts
│   ├── data/             # Almacén de datos (SQLite, Postgres, JSON, TS)
│   │   └── site.ts
│   ├── storage/          # Loaders de almacenamiento remoto (S3, Cloudflare R2, MinIO)
│   │   └── s3.ts
│   ├── styles/           # Hojas de estilo globales
│   │   └── main.css
│   └── public/           # Archivos estáticos copiados directamente a dist/
│       └── favicon.ico
├── docs/                 # Documentación adicional del proyecto (opcional)
├── scripts/              # Scripts auxiliares del proyecto (opcional)
├── dist/                 # Directorio de salida compilado
└── bustatic.config.ts    # Configuración del sitio, SEO y feeds
```

> [!TIP]
> Bustatic soporta referencias a rutas absolutas como `/styles/main.css` o `/components/card.html` resolviéndolas automáticamente en la raíz o en `src/`, manteniendo el código limpio y portable.

---

## Comandos Principales

### Servidor de Desarrollo con Live-Reload
Inicia el servidor local en `http://localhost:3000`:
```bash
bustatic dev
```
Cualquier cambio en tus páginas, layouts, componentes, CSS o datos recargará instantáneamente la pestaña del navegador a través de WebSockets nativos.

### Construir para Producción
Empaqueta, minifica y optimiza imágenes y metadatos en la carpeta `dist/`:
```bash
bustatic build
```

### Limpiar Caché y Compilación
```bash
bustatic clean
```

---

## Configuración (`bustatic.config.ts`)

Personaliza el comportamiento de Bustatic, las URLs canónicas, el sitemap y los feeds RSS:

```ts
import { defineConfig } from "bustatic";

export default defineConfig({
  port: 3000,
  minify: true,
  site: {
    url: "https://misitio.com",
    title: "Mi Proyecto",
    description: "Sitio web generado con Bustatic",
  },
  seo: {
    sitemap: true,
    robots: true,
  },
  feeds: {
    rss: true,
    atom: true,
  }
});
```

---

## 📚 Índice de Guías Especializadas

### 🎨 Fundación y Diseño
- 📑 [Guía de Plantillas y Componentes](./templating.md)
- 🎨 [Estilos Scoped y Grafo de Dependencias CSS](./scoped-css.md)
- 🧩 [Web Components Nativos y Declarative Shadow DOM](./web-components.md)

### 📊 Enrutamiento y Datos
- 🗺️ [Enrutamiento Basado en Archivos y Páginas Dinámicas](./routing-and-pages.md)
- 📊 [Datos, Loaders y Variables de Entorno](./data-and-loaders.md)
- 🗄️ [Motores SQL Nativos (`bun:sqlite` y `Bun.sql`)](./databases-sql.md)
- 📑 [Sistema de Paginación Automática](./pagination.md)

### 🖼️ Assets, Cloud y SEO
- 🖼️ [Optimización de Imágenes con `<photo>`](./assets-and-images.md)
- 🗄️ [Storage Loaders Remotos (S3, R2, MinIO)](./storage-loaders.md)
- 🔍 [Suite SEO, Metadatos Sociales y Feeds](./seo.md)

### ⌨️ Herramientas
- ⌨️ [Referencia del CLI](./cli.md)
