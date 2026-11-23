# 🔍 Suite SEO, Metadatos Sociales y Feeds

Buntic proporciona una suite completa para optimización en motores de búsqueda (SEO) y previsualización en redes sociales (OpenGraph & Twitter Cards), además de generadores para `sitemap.xml`, `robots.txt` y feeds RSS 2.0 y Atom 1.0.

---

## ⚙️ Configuración en `buntic.config.ts`

Configura la información global de tu sitio:

```ts
// buntic.config.ts
import { defineConfig } from "buntic";

export default defineConfig({
  site: {
    url: "https://midominio.com",
    title: "Mi Sitio Web",
    description: "Sitio estático creado con Buntic",
    defaultOgImage: "/images/og-default.png", // Imagen por defecto para redes
  },
  seo: {
    sitemap: true,  // Genera dist/sitemap.xml con todas las rutas
    robots: true,   // Genera dist/robots.txt apuntando al sitemap
  },
  feeds: {
    rss: true,      // Genera dist/rss.xml
    atom: true,     // Genera dist/atom.xml
    title: "Blog de Mi Empresa",
  }
});
```

---

## 🏷️ Etiqueta Declarativa `<seo>`

Para definir metadatos en tus páginas o layouts HTML, utiliza la etiqueta `<seo>`:

```html
<!-- pages/contacto.html -->
<layout src="../layouts/main.html">
  <seo 
    title="Contacto | Mi Empresa" 
    description="Escríbenos para conocer más sobre nuestros productos."
    image="/images/contacto-hero.png"
  />

  <h1>Ponte en contacto</h1>
</layout>
```

### ¿Qué se inyecta en el `<head>`?
Durante el build, la etiqueta `<seo>` se elimina del cuerpo y se inyecta en el `<head>`:

```html
<title>Contacto | Mi Empresa</title>
<meta name="description" content="Escríbenos para conocer más sobre nuestros productos.">
<link rel="canonical" href="https://midominio.com/contacto">

<!-- OpenGraph -->
<meta property="og:title" content="Contacto | Mi Empresa">
<meta property="og:description" content="Escríbenos para conocer más sobre nuestros productos.">
<meta property="og:url" content="https://midominio.com/contacto">
<meta property="og:type" content="website">
<meta property="og:image" content="https://midominio.com/assets/seo/9a1f2b.webp">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<!-- Twitter Cards -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Contacto | Mi Empresa">
<meta name="twitter:description" content="Escríbenos para conocer más sobre nuestros productos.">
<meta name="twitter:image" content="https://midominio.com/assets/seo/9a1f2b.webp">
```

### Cascada de Herencia Jerárquica:
1. **Configuración Base (`site` en `buntic.config.ts`)**: Provee los valores por defecto globales.
2. **Layout Base**: Puede incluir un `<seo>` con valores por defecto para una sección completa.
3. **Página Específica**: Sobreescribe únicamente los campos que declare (ej. si la página solo define `title`, hereda automáticamente la `description` y la `image` del layout o config).

---

## 🚀 SEO en Páginas Dinámicas (`.data.ts`)

En páginas dinámicas (como artículos de blog o catálogo de productos), exporta la propiedad `seo` en el retorno del loader:

```ts
// pages/blog/[slug].data.ts
export default async function({ params }) {
  const post = await db.getPost(params.slug);

  return [
    {
      params: { slug: post.slug },
      props: { post },
      seo: {
        title: post.title,
        description: post.summary,
        // Imagen remota desde S3 / storage
        image: { key: post.coverImageKey }
      }
    }
  ];
}
```

### Tarjetas Sociales Automáticas desde Storage (1200x630 WebP):
Cuando especificas una imagen con `key` (remota) o ruta local para redes sociales:
1. Buntic la redimensiona automáticamente al tamaño estándar de previsualización social (**1200x630 píxeles**).
2. La comprime a formato WebP en `dist/assets/seo/[hash].webp`.
3. Inyecta la **URL absoluta canónica** combinando `site.url` de tu configuración.

---

## 🗺️ Sitemap y Robots.txt Automáticos

* **`dist/sitemap.xml`**: Incorpora dinámicamente **todas** las rutas resueltas (tanto páginas estáticas como colecciones masivas generadas por SQLite, Postgres o JSON) con URLs limpias y etiquetas estándar W3C.
* **`dist/robots.txt`**: Genera un archivo estándar permitiendo la indexación y referenciando el `sitemap.xml`.
  > [!TIP]
  > Si colocas tu propio archivo en `public/robots.txt`, Buntic lo respetará y no lo sobreescribirá.

---

## 📰 Feeds RSS 2.0 y Atom 1.0

Buntic puede generar automáticamente `dist/rss.xml` y `dist/atom.xml` a partir de tus rutas dinámicas o estáticas. Solo añade la propiedad `feed` en el retorno de tus loaders:

```ts
return [
  {
    params: { slug: post.slug },
    props: { post },
    feed: {
      title: post.title,
      description: post.summary,
      date: post.publishedAt, // Date o string ISO
      author: post.authorName,
    }
  }
];
```

Buntic recolectará todas las entradas, las ordenará cronológicamente (más recientes primero) y generará los feeds listos para ser consumidos por agregadores de noticias y lectores RSS.
