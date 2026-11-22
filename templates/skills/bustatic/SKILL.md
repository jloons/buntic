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

1. **Cero Dependencias Externas:** No instales paquetes de npm (`sharp`, `@aws-sdk`, `pg`, `ioredis`, `better-sqlite3`, etc.). Utiliza exclusivamente las APIs nativas de Bun (`Bun.Image`, `Bun.S3Client`, `bun:sqlite`, `Bun.sql`, `RedisClient`, `Bun.build`) y los módulos integrados de Bustatic (`createOrasStorage`, `OrasClient`).
2. **URLs Limpias por Archivo:** Cada archivo en `pages/` genera una URL limpia sin extensión `.html` (ej. `pages/acerca.html` &rarr; `/acerca` &rarr; `dist/acerca/index.html`).
3. **Usa `&` para estilizar el elemento raíz en Scoped CSS:** Tanto en `<style scoped>` como en archivos `.css` hermanos (`.html` + `.css`), todo selector **sin `&`** (o `:host`) se compila como descendiente (`.bs-xxxx .clase`) y **NO aplica al elemento raíz**. Para estilizar la raíz o sus estados escribe siempre `& { ... }`, `&:hover { ... }`, `&:hover .hijo { ... }` o `&.activo { ... }` — nunca `.clase-raiz { ... }`.
4. **Regla 1:1 de Web Components:** Un Web Component por archivo (`.ts` o `.js`). El nombre del archivo debe coincidir de forma idéntica con el tag Custom Element (`counter-button.ts` &rarr; `<counter-button>`). Pueden anidarse entre sí con expansión recursiva de Declarative Shadow DOM (DSD).
5. **Espacios de Nombres Reservados y Acceso a Loaders:** `params`, `props`, `env`, `seo`, `feed`. No los uses como identificadores en `data/*.json`. En plantillas HTML, los datos devueltos por un loader `.data.ts` (estático o dinámico) se consumen siempre bajo `props.*` (ej. `{{ props.product.name }}`, `<each in="props.featured">`, `{{ props.page.currentPage }}`) y los parámetros de ruta bajo `params.*`.
6. **No uses `<img>` crudo cuando optimices:** Usa `<photo>` para compresión WebP, dimensiones anti-CLS automáticas y `srcset`.
7. **No dupliques metadatos en `<head>`:** Usa la etiqueta `<seo>` en la página o el objeto `seo` en el loader hermano para que Bustatic genere los metatags OpenGraph, Twitter y canonical consolidados.
8. **Tokens de color en variables CSS:** Centraliza colores en un archivo dedicado (ej. `src/styles/colors.css` importado con `@import "./colors.css";` desde `src/styles/main.css`) y evita colores hardcodeados en componentes y páginas.

---

## 📁 Estructura Estándar de un Proyecto

Bustatic detecta automáticamente si el proyecto utiliza la estructura moderna `src/` (recomendada) o una estructura plana en la raíz del proyecto:

```text
mi-proyecto/
├── src/                  # Directorio de fuentes principal (auto-detectado)
│   ├── pages/            # Enrutamiento: cada .html es una ruta pública
│   │   ├── index.html    # -> /
│   │   ├── index.data.ts # Loader co-ubicado para página estática (opcional)
│   │   ├── index.css     # CSS hermano scoped de la página (opcional)
│   │   ├── about.html    # -> /about
│   │   └── blog/
│   │       ├── [slug].html     # Plantilla con parámetro dinámico
│   │       └── [slug].data.ts  # Loader hermano co-ubicado
│   ├── layouts/          # Plantillas base que envuelven páginas con <slot>
│   │   └── main.html
│   ├── components/       # Componentes HTML estáticos y Web Components
│   │   ├── card.html     # Componente HTML reutilizable
│   │   ├── card.css      # CSS hermano scoped (requiere raíz única y uso de "&")
│   │   ├── counter.ts    # Lógica cliente del Web Component <counter>
│   │   ├── counter.html  # Estructura Declarative Shadow DOM
│   │   └── counter.css   # Estilos encapsulados Shadow DOM (:host o &)
│   ├── data/             # Almacén global de datos en RAM (JSON, TS, SQL, Redis)
│   │   └── site.json     # Disponible globalmente como {{ site.title }}
│   ├── storage/          # Loaders de objetos remotos (S3, R2, MinIO, OCI Registry)
│   │   ├── oci.ts        # createOrasStorage({ hostname: "localhost:5000", ... })
│   │   └── s3.ts         # export default async function(key) { ... }
│   ├── styles/           # Hojas de estilo globales (main.css + colors.css)
│   │   ├── colors.css    # Variables CSS (:root { --color-*: ... })
│   │   └── main.css      # @import "./colors.css"; + estilos globales de layout
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

### 7. Estilos Scoped Encapsulados (`<style scoped>` y archivos `.css` hermanos)
```html
<!-- components/card.html -->
<article class="card">
  <style scoped>
    /* ✅ CORRECTO: usa "&" (o ":host") para el elemento raíz y sus estados */
    & {
      background: var(--color-surface);
      padding: 1rem;
    }
    &:hover {
      border-color: var(--color-accent);
    }
    &:hover .card-media img {
      transform: scale(1.03);
    }
    /* ✅ Selectores sin "&" aplican a elementos descendientes dentro de la raíz */
    h3 {
      color: var(--color-accent);
    }
    /* ❌ INCORRECTO: ".card { ... }" se compila como ".bs-xxxx .card" y NO aplica a la raíz */
  </style>
  <h3>{{ title }}</h3>
</article>
```

**CSS Hermano Co-ubicado (`.html` + `.css`):**
- Funciona tanto en **`components/`** (ej. `card.html` + `card.css`) como en **`pages/`** (ej. `index.html` + `index.css` o `[slug].html` + `[slug].css`).
- **Páginas con `<layout>`:** el CSS hermano y `<style scoped>` al nivel de `<layout>` se vinculan al contenedor padre del `<slot>` del layout (normalmente `<main>`).
- **Páginas independientes (`<!doctype html>`):** el prólogo `<!doctype html>` se omite automáticamente y el ámbito se aplica al elemento raíz `<html>`.
- **Orden de cascada:** el `.css` hermano se emite antes que `<style scoped>` inline, por lo que el bloque inline tiene mayor prioridad.

---

## 📊 Catálogo de Loaders de Datos (`.data.ts`)

### Loader Co-ubicado para Página Estática (`pages/index.data.ts`)
Se ejecuta tanto en `bustatic dev` (con recarga en vivo al editar) como en `bustatic build`:
```ts
export default async function({ data, env }) {
  const products = data.products || [];
  return {
    props: {
      featured: products.filter((p: any) => p.featured),
    },
    seo: {
      title: "Inicio | Mi Catálogo",
      description: "Productos destacados",
    },
  };
}
```
En `pages/index.html`, consume `<each in="props.featured">`.

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
> Para PostgreSQL o Redis en `data/*.ts` o `pages/**/*.data.ts`, usa los clientes nativos `import { SQL, RedisClient } from "bun";`.

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
En `[page].html`, consume `props.page`: `<each in="props.page.data">`, `{{ props.page.currentPage }}`, `{{ props.page.lastPage }}`, `{{ props.page.url.prev }}`, `{{ props.page.url.next }}` y `{{ props.seccion }}`.

---

## 🗄️ Storage Loaders Remotos (`storage/`)

### Opción A: OCI Registry / ORAS (`storage/oci.ts`, Recomendado)
Cliente nativo sin dependencias para Docker Registry v2/v3 y OCI Distribution con soporte de tags e inmutabilidad por digest SHA-256:
```ts
import { createOrasStorage } from "bustatic";

export default createOrasStorage({
  hostname: process.env.OCI_REGISTRY_HOST || "localhost:5000",
  insecure: true, // false para HTTPS en producción
  defaultTag: "latest",
});
```
En plantillas HTML puedes referenciar el tag por defecto o una versión específica:
```html
<photo key="product/1/portrait" alt="Versión actual" />
<photo key="product/1/portrait:2020" alt="Versión archivo 2020" />
```

### Opción B: S3 / Cloudflare R2 / MinIO (`storage/s3.ts`)
```ts
import { S3Client } from "bun";

const s3 = new S3Client({
  bucket: process.env.S3_BUCKET,
  endpoint: process.env.S3_ENDPOINT, // Para R2 / MinIO / local-s3
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
Si existen múltiples loaders en `storage/`, define `defaultStorage` en `bustatic.config.ts` o usa el atributo `storage="oci"` / `storage="s3"` en `<photo>`.

---

## ⚙️ Archivo de Configuración (`bustatic.config.ts`)

```ts
import { defineConfig } from "bustatic";

export default defineConfig({
  port: 3000,
  minify: true,
  cssStrategy: "inline", // "inline" (por defecto) o "external"
  defaultStorage: process.env.STORAGE_BACKEND || "oci",
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
- 🗄️ [Motores SQL y Redis Nativos](../../../docs/databases-sql.md)
- 📑 [Paginación Automática](../../../docs/pagination.md)
- 🖼️ [Optimización de Imágenes](../../../docs/assets-and-images.md)
- 🗄️ [Storage Loaders (OCI Registry / ORAS y S3)](../../../docs/storage-loaders.md)
- 🔍 [Suite SEO y Feeds](../../../docs/seo.md)
- ⌨️ [Referencia del CLI](../../../docs/cli.md)
