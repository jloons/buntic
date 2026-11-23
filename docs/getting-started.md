# Primeros Pasos con Buntic

**Buntic** es un generador de sitios estáticos (SSG) ultrarrápido y con cero dependencias externas, diseñado exclusivamente para el runtime de [Bun](https://bun.sh).

---

## Requisitos

- Tener instalado [Bun](https://bun.sh) (**v1.4.0 o superior**, requerido para `Bun.Image`, `Bun.S3Client`, `Bun.sql` y `Bun.redis`).

---

## Instalación

### Uso global desde Bun (Recomendado — sin `package.json`)
```bash
bun add -g buntic
```

Una vez instalado de forma global, puedes crear y compilar proyectos en cualquier carpeta sin necesidad de `package.json` ni `node_modules`:

```bash
# Crear un proyecto en blanco (plantilla "blank" por defecto)
buntic init mi-sitio

# O crear un proyecto a partir de la plantilla "simple"
buntic init mi-sitio --template simple

cd mi-sitio
buntic dev
```

#### ¿Cómo funcionan los imports de `"buntic"` sin `package.json`?
Cuando ejecutas `buntic init`, `buntic dev` o `buntic build` desde una instalación global en un proyecto sin `node_modules`:
1. **En tiempo de ejecución:** El CLI registra un resolver nativo (`Bun.plugin`) que resuelve `import { defineConfig, createOrasStorage } from "buntic"` automáticamente al paquete global.
2. **En tu editor (TypeScript):** Buntic genera y mantiene actualizadas las definiciones de tipos en `.buntic/types/` (carpeta ignorada por Git) y las enlaza mediante `paths` en `tsconfig.json`.
3. **Skills para agentes:** `buntic init` copia automáticamente la skill oficial de Buntic en `.agents/skills/buntic/` (puedes omitirlo con `--no-skills`).

### Uso directo sin instalar (con `bunx`)
```bash
bunx buntic init mi-sitio
bunx buntic dev mi-sitio
```

### Uso local opcional en un proyecto con `package.json`
Si prefieres fijar la versión de Buntic dentro de un proyecto existente:
```bash
bun add -d buntic
```

Agrega los comandos a tus `scripts` en `package.json`:
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

## Estructura Recomendada de un Proyecto

Buntic detecta automáticamente tanto la estructura estándar basada en `src/` (recomendada) como la estructura plana en la raíz:

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
│   ├── storage/          # Loaders de almacenamiento remoto (S3, Cloudflare R2, MinIO, OCI)
│   │   └── s3.ts
│   ├── styles/           # Hojas de estilo globales
│   │   └── main.css
│   └── public/           # Archivos estáticos copiados directamente a dist/
│       └── favicon.ico
├── .agents/skills/       # Skill de Buntic para agentes de IA (creada por `buntic init`)
├── dist/                 # Directorio de salida compilado
├── buntic.config.ts    # Configuración del sitio, SEO y feeds
└── tsconfig.json         # Configuración de TypeScript
```

> [!TIP]
> Buntic soporta referencias a rutas absolutas como `/styles/main.css` o `/components/card.html` resolviéndolas automáticamente en la raíz o en `src/`, manteniendo el código limpio y portable.

---

## Comandos Principales

### Inicializar un Proyecto Nuevo
Crea un nuevo proyecto listo para usar sin `package.json`:
```bash
buntic init mi-sitio
buntic init mi-sitio --template simple
```

### Servidor de Desarrollo con Live-Reload
Inicia el servidor local en `http://localhost:3000`:
```bash
buntic dev
```
Cualquier cambio en tus páginas, layouts, componentes, CSS o datos recargará instantáneamente la pestaña del navegador a través de WebSockets nativos.

### Construir para Producción
Empaqueta, minifica y optimiza imágenes y metadatos en la carpeta `dist/`:
```bash
buntic build
```

### Limpiar Caché y Compilación
```bash
buntic clean
```

---

## Configuración (`buntic.config.ts`)

Personaliza el comportamiento de Buntic, las URLs canónicas, el sitemap y los feeds RSS:

```ts
import { defineConfig } from "buntic";

export default defineConfig({
  port: 3000,
  minify: true,
  site: {
    url: "https://misitio.com",
    title: "Mi Proyecto",
    description: "Sitio web generado con Buntic",
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
