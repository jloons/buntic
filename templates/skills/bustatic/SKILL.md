---
name: bustatic
description: >-
  Guía experta para crear, desarrollar, compilar y mantener sitios web estáticos utilizando
  Bustatic, el generador de sitios estáticos de cero dependencias externas nativo para Bun.
  Activar cuando el usuario pida crear o modificar páginas, layouts, componentes, loaders de datos
  dinámicos (.data.ts), optimización de imágenes (<photo>), metadatos SEO (<seo>), Web Components,
  estilos scoped o loaders de almacenamiento (storage/*.ts) en un proyecto Bustatic.
---

# ⚡ Skill: Desarrollo de Sitios con Bustatic

Esta skill proporciona las directrices maestras, sintaxis declarativa y reglas de arquitectura para desarrollar sitios web estáticos de máximo rendimiento con **Bustatic**.

---

## 🛑 Reglas de Oro de Bustatic

1. **Cero Dependencias Externas:** No instales paquetes de npm (`sharp`, `@aws-sdk`, `pg`, `better-sqlite3`, etc.). Utiliza exclusivamente las APIs nativas del runtime de Bun (`Bun.Image`, `Bun.S3Client`, `bun:sqlite`, `Bun.sql`, `Bun.build`).
2. **URLs Limpias por Archivo:** Cada archivo en `pages/` genera una URL limpia sin extensión `.html` (ej. `pages/acerca.html` &rarr; `/acerca` &rarr; `dist/acerca/index.html`).
3. **Regla 1:1 de Web Components:** Un Web Component por archivo (`.ts` o `.js`). El nombre del archivo debe coincidir de forma idéntica con el tag Custom Element (`counter-button.ts` &rarr; `<counter-button>`).
4. **Espacios de Nombres Reservados:** `params`, `props`, `env`, `seo`, `feed`. No los uses como identificadores en `data/*.json`.
5. **No uses `<img>` crudo cuando optimices:** Usa `<photo>` para compresión WebP, dimensiones anti-CLS automáticas y `srcset`.
6. **No dupliques metadatos en `<head>`:** Usa la etiqueta `<seo>` en la página o el objeto `seo` en el loader hermano para que Bustatic genere los metatags OpenGraph, Twitter y canonical consolidados.

---

## 📁 Estructura Estándar de un Proyecto

Bustatic detecta automáticamente si el proyecto utiliza la estructura moderna `src/` (recomendada) o una estructura plana en la raíz del proyecto:

```text
mi-proyecto/
├── src/                  # Directorio de fuentes principal (auto-detectado)
│   ├── pages/            # Enrutamiento: cada .html es una ruta pública
│   │   ├── index.html    # -> /
│   │   ├── about.html    # -> /about
│   │   └── blog/
│   │       ├── [slug].html     # Plantilla con parámetro dinámico
│   │       └── [slug].data.ts   # Loader hermano co-ubicado
│   ├── layouts/          # Plantillas base que envuelven páginas con <slot>
│   │   └── main.html
│   ├── components/       # Componentes HTML estáticos y Web Components
│   │   ├── card.html     # Componente HTML reutilizable
│   │   ├── counter.ts    # Lógica cliente del Web Component <counter>
│   │   ├── counter.html  # Estructura Declarative Shadow DOM
│   │   └── counter.css   # Estilos encapsulados Shadow DOM
│   ├── data/             # Almacén global de datos en RAM (JSON, TS)
│   │   └── site.json     # Disponible globalmente como {{ site.title }}
│   ├── storage/          # Loaders de servidores de objetos remotos (S3, R2, MinIO)
│   │   └── s3.ts         # export default async function(key) { ... }
│   ├── styles/           # Hojas de estilo globales (main.css)
│   │   └── main.css
│   └── public/           # Assets estáticos copiados directamente a dist/
│       └── favicon.ico
├── docs/                 # Documentación técnica del proyecto (opcional)
├── scripts/              # Scripts de mantenimiento o utilidades (opcional)
├── dist/                 # Directorio de salida generado por la compilación
└── bustatic.config.ts    # Configuración del sitio (site, seo, feeds)
```

> [!TIP]
> Tanto en desarrollo como en producción, las rutas absolutas como `/styles/main.css` o `/components/card.html` son resueltas de forma transparente verificando tanto la raíz como `src/`.

---

## 🏷️ Catálogo de Etiquetas Declarativas

### 1. Layouts y Slots (`<layout>` y `<slot>`)
```html
<!-- En pages/index.html -->
<layout src="../layouts/main.html">
  <span slot="title">Inicio | Mi Sitio</span>
  <main>
    <h1>Bienvenido</h1>
  </main>
</layout>
```

### 2. Componentes (`<component>`)
```html
<!-- Componente estático HTML -->
<component src="../components/card.html" title="Rápido" description="Sin dependencias">
  <a href="/info">Ver más</a>
</component>

<!-- Web Component cliente interactivo (navegable con Ctrl + Click) -->
<component src="../components/counter-button.ts" id="contador" />
```

### 3. Imágenes Optimizadas (`<photo>`)
Transformada automáticamente a `<img>` con WebP, `loading="lazy"`, `decoding="async"` y dimensiones físicas anti-CLS:
```html
<!-- Imagen local básica -->
<photo src="/images/hero.png" alt="Hero" class="banner" />

<!-- Imagen responsiva con multi-ancho -->
<photo src="./foto.jpg" widths="400,800,1200" sizes="(min-width: 768px) 50vw, 100vw" alt="Foto" />

<!-- Imagen remota desde storage loader (S3 / R2) -->
<photo key="productos/zapato.png" alt="Zapato" widths="300,600" />
```

### 4. Metadatos SEO y Tarjetas Sociales (`<seo>`)
Inyecta en `<head>` el `<title>`, `<link rel="canonical">`, OpenGraph y Twitter Cards:
```html
<seo 
  title="Contacto | Mi Empresa" 
  description="Ponte en contacto con nuestro equipo."
  image="/images/contacto-hero.png" 
/>

<!-- O con tarjeta social generada a 1200x630 WebP desde S3: -->
<seo title="Catálogo" image-key="banners/catalogo.jpg" />
```

### 5. Bucles e Iteración (`<each>`)
```html
<!-- Con Auto-spread automático de claves a las props del componente -->
<each src="../data/features.json">
  <component src="../components/card.html" />
</each>

<!-- Con alias explícito -->
<each in="site.navLinks" as="link">
  <a href="{{ link.url }}">{{ link.label }}</a>
</each>
```

### 6. Renderizado Condicional (`<if>` y atributo `if`)
```html
<!-- Atributo condicional: elimina la etiqueta si badge no existe -->
<span class="badge" if="badge">{{ badge }}</span>

<!-- Bloque condicional con alternativa -->
<if is="isLogged">
  <span>Hola, {{ user.name }}</span>
<else>
  <a href="/login">Iniciar sesión</a>
</if>

<!-- Operador de respaldo en texto -->
<p>Autor: {{ author ?? "Anónimo" }}</p>
```

### 7. Estilos Scoped Encapsulados (`<style scoped>`)
```html
<div class="card">
  <style scoped>
    & {
      background: #1e293b;
      padding: 1rem;
    }
    h3 {
      color: #38bdf8;
    }
  </style>
  <h3>{{ title }}</h3>
</div>
```

---

## 📊 Catálogo de Loaders de Datos (`.data.ts`)

### Loader Dinámico Estándar (`pages/blog/[slug].data.ts`)
```ts
import { Database } from "bun:sqlite";

export default async function({ data, env, paginate }) {
  const db = new Database("blog.db");
  const posts = db.query("SELECT * FROM articulos").all();
  db.close();

  return posts.map((post) => ({
    params: { slug: post.slug },
    props: { post },
    seo: {
      title: post.title,
      description: post.summary,
      image: { key: post.coverKey } // Social Card 1200x630 desde storage
    },
    feed: {
      title: post.title,
      description: post.summary,
      date: post.created_at,
      author: post.author
    }
  }));
}
```

### Paginación Automática con `paginate()` (`pages/articulos/[page].data.ts`)
```ts
export default async function({ paginate }) {
  const items = await obtenerColeccion();

  // Genera automáticamente URLs /articulos (página 1) y /articulos/2, /articulos/3...
  return paginate(items, {
    pageSize: 10,
    props: { seccion: "Artículos" }
  });
}
```
En `[page].html`, consume `{{ page.data }}`, `{{ page.currentPage }}`, `{{ page.url.prev }}` y `{{ page.url.next }}`.

---

## 🗄️ Storage Loaders Remotos (`storage/s3.ts`)

```ts
import { S3Client } from "bun";

const s3 = new S3Client({
  bucket: process.env.S3_BUCKET,
  endpoint: process.env.S3_ENDPOINT, // Para R2 / MinIO
  accessKeyId: process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET_KEY,
});

export default async function getAsset(key: string) {
  const file = s3.file(key);
  const stat = await s3.stat(key);
  return {
    bytes: await file.bytes(),
    etag: stat.etag,
    contentType: stat.type,
  };
}
```

---

## ⚙️ Archivo de Configuración (`bustatic.config.ts`)

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
    sitemap: true, // dist/sitemap.xml
    robots: true,  // dist/robots.txt
  },
  feeds: {
    rss: true,     // dist/rss.xml
    atom: true,    // dist/atom.xml
  }
});
```

---

## 🛠️ Comandos de Terminal

| Comando | Descripción |
| :--- | :--- |
| `bustatic dev [dir]` | Servidor de desarrollo en `http://localhost:3000` con live-reload |
| `bustatic dev --clean-cache` | Servidor de desarrollo purgando caché previo de imágenes |
| `bustatic build [dir]` | Compila todo el sitio para producción en `dist/` |
| `bustatic build --clean-cache` | Compila purgando caché inmutable previo |
| `bustatic clean [dir]` | Elimina `dist/` y `.bustatic/cache/` |
| `bun test` | Ejecuta la suite de pruebas del proyecto |

---

## 📖 Referencias Detalladas

Para consultas profundas sobre subsistemas específicos, revisa los documentos en `docs/`:
- 📑 [Plantillas y Sintaxis](../../../docs/templating.md)
- 🎨 [Estilos Scoped y Grafo CSS](../../../docs/scoped-css.md)
- 🧩 [Web Components y Shadow DOM](../../../docs/web-components.md)
- 🗺️ [Enrutamiento y Rutas Dinámicas](../../../docs/routing-and-pages.md)
- 📊 [Datos, Loaders y Entorno](../../../docs/data-and-loaders.md)
- 🗄️ [Motores SQL Nativos](../../../docs/databases-sql.md)
- 📑 [Paginación Automática](../../../docs/pagination.md)
- 🖼️ [Optimización de Imágenes](../../../docs/assets-and-images.md)
- 🗄️ [Storage Loaders para S3 / R2](../../../docs/storage-loaders.md)
- 🔍 [Suite SEO y Feeds](../../../docs/seo.md)
- ⌨️ [Referencia del CLI](../../../docs/cli.md)
