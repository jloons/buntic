# 📊 Datos, Loaders y Variables de Entorno

Bustatic proporciona una capa de datos reactiva y en memoria para alimentar tanto páginas estáticas como colecciones dinámicas completas.

---

## ⚡ Loaders Dinámicos Co-ubicados (`.data.ts` / `.data.js`)

Los loaders co-ubicados se sitúan junto a sus plantillas HTML para proveer los parámetros de ruta (`params`), las propiedades (`props`), los metadatos de búsqueda (`seo`) y los elementos de suscripción (`feed`):

```text
pages/blog/
├── [slug].html
└── [slug].data.ts
```

### Anatomía de un Loader Dinámico

```ts
// pages/blog/[slug].data.ts
export default async function({ data, env, paginate }) {
  // 1. Obtener datos desde cualquier fuente (SQL, JSON, fetch externo)
  const articulos = await obtenerArticulos();

  // 2. Retornar un array de rutas
  return articulos.map((art) => ({
    // Parámetros de la URL (deben coincidir con los tokens [slug] del HTML)
    params: {
      slug: art.slug,
    },
    // Datos disponibles en la plantilla HTML como {{ props.post.titulo }}
    props: {
      post: art,
    },
    // Metadatos SEO específicos de esta página
    seo: {
      title: art.titulo,
      description: art.resumen,
      image: art.portadaUrl,
    },
    // Opcional: incluir este artículo en dist/rss.xml y dist/atom.xml
    feed: {
      title: art.titulo,
      description: art.resumen,
      date: art.fechaPublicacion,
      author: art.autor,
    }
  }));
}
```

> [!TIP]
> Bustatic también acepta la exportación nominada `getStaticPaths` como alias para facilitar la transición a desarrolladores familiarizados con otros generadores estáticos.

### Parámetros Disponibles en el Contexto del Loader:
* `data`: Objeto con todos los datos cargados desde la carpeta global `data/`.
* `env`: Variables de entorno públicas seguras.
* `paginate`: Función utilitaria para dividir colecciones en páginas automáticamente (ver [Guía de Paginación](./pagination.md)).

### Loaders Co-ubicados para Páginas Estáticas (`pages/index.data.ts`)

Las páginas **sin parámetros dinámicos** (como `pages/index.html` o `pages/about.html`) también pueden tener un loader co-ubicado `.data.ts` / `.data.js` que devuelva un objeto con `props`, `seo` y/o `feed`:

```ts
// pages/index.data.ts
export default async function({ data, env }) {
  const productos = data.products || [];
  return {
    props: {
      featured: productos.filter((p: any) => p.featured),
    },
    seo: {
      title: "Inicio | Mi Catálogo",
      description: "Productos destacados de la temporada.",
    },
  };
}
```

En `pages/index.html`, los datos se consumen mediante el espacio de nombres `props` (ej. `<each in="props.featured">`). Tanto los loaders estáticos como los dinámicos se ejecutan en `bustatic build` **y en `bustatic dev`** con invalidación automática de caché al guardar cambios.

---

## 🌐 Almacén Global en Memoria (`data/`)

Los archivos en la carpeta `data/` están disponibles automáticamente en **todas las plantillas del proyecto** sin necesidad de importarlos manualmente:

```text
data/
├── site.json       # -> accesible como {{ site.titulo }}
├── navegacion.json # -> accesible en un loop <each in="navegacion">
└── equipo.ts       # -> función asíncrona ejecutada una sola vez en el build
```

### 1. Archivos Estáticos (`.json`)
```json
// data/site.json
{
  "title": "Mi Tienda",
  "author": "Equipo Bustatic",
  "year": 2026
}
```
En cualquier plantilla:
```html
<footer>
  <p>&copy; {{ site.year }} {{ site.title }} - Creado por {{ site.author }}</p>
</footer>
```

### 2. Loaders Globales Asíncronos (`.ts` / `.js`)
Si los datos requieren consultas a bases de datos o cálculos dinámicos:
```ts
// data/productos.ts
import { Database } from "bun:sqlite";

export default async function() {
  const db = new Database("tienda.db");
  const productos = db.query("SELECT * FROM productos WHERE activo = 1").all();
  return productos;
}
```
Los datos quedan cargados en memoria y disponibles en plantillas bajo el identificador del archivo: `{{ productos }}`.

---

## 🔒 Espacios de Nombres Reservados

Para evitar sobreescritura accidental o choques de variables en tus plantillas HTML, Bustatic define los siguientes nombres reservados:
- `params`: Parámetros de la URL actual.
- `props`: Propiedades inyectadas por el loader de la página.
- `env`: Variables de entorno públicas.
- `seo`: Metadatos reservados para motores de búsqueda y redes sociales.
- `feed`: Datos reservados para generadores RSS y Atom.

Si creas un archivo en `data/` con uno de estos nombres (ej. `data/props.json`), Bustatic emitirá una advertencia preventiva en consola y omitirá el archivo para proteger el contexto de renderizado.

---

## 🛡️ Variables de Entorno Seguras (`.env.public` y `PUBLIC_*`)

Para prevenir la filtración accidental de claves de API privadas o secretos de base de datos en el HTML final del cliente:

1. **Variables Privadas (`.env`):**
   - Disponibles en el servidor de desarrollo y dentro de tus loaders de datos (`process.env.DB_PASSWORD`, `process.env.S3_SECRET_KEY`).
   - **Nunca se exponen en las plantillas HTML.**
2. **Variables Públicas (`.env.public` o prefijo `PUBLIC_*`):**
   - Diseñadas para ser accesibles en las plantillas mediante el espacio de nombres `env`:
     ```bash
     # .env
     DB_PASSWORD=super_secreto_privado
     PUBLIC_ANALYTICS_ID=G-12345678
     ```
   - En tu plantilla HTML:
     ```html
     <script>
       const analyticsId = "{{ env.PUBLIC_ANALYTICS_ID }}";
     </script>
     ```
