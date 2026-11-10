# 📑 Sistema de Paginación Automática

Cuando manejas colecciones grandes de registros (blogs, listas de productos, directorios), renderizar cientos de elementos en una sola página afecta la velocidad de carga y la experiencia del usuario.

Bustatic proporciona un asistente declarativo `paginate()` inyectado directamente en los loaders de datos que segmenta tus colecciones en múltiples páginas estáticas optimizadas para SEO.

---

## 🚀 Convención de Archivos

Crea la plantilla con el parámetro `[page]`:

```text
pages/articulos/
├── [page].html     # Plantilla con botones de navegación
└── [page].data.ts   # Loader con paginate()
```

---

## ⚡ Uso del Asistente `paginate()`

En tu loader hermano, utiliza la función `paginate` inyectada en los argumentos:

```ts
// pages/articulos/[page].data.ts
import { Database } from "bun:sqlite";

export default async function({ paginate }) {
  const db = new Database("blog.db");
  const todosLosPosts = db.query("SELECT * FROM articulos ORDER BY fecha DESC").all();

  // Divide la colección en páginas de 10 elementos cada una
  return paginate(todosLosPosts, {
    pageSize: 10,
    props: {
      tituloSeccion: "Todos los Artículos",
    }
  });
}
```

---

## 🎯 Estándar SEO Canónico: Omisión de `/1`

Para cumplir con las mejores prácticas de posicionamiento web (Google Search Console y W3C):
* **Página 1:** Se mapea a la URL limpia base: `/articulos` (o `/` si está en la raíz). **Nunca a `/articulos/1`**.
* **Páginas siguientes:** Se mapean ordenadamente: `/articulos/2`, `/articulos/3`, etc.

---

## 📦 El Objeto `props.page`

Bustatic inyecta automáticamente en tu plantilla el objeto `page` dentro de `props`:

| Propiedad | Tipo | Descripción |
| :--- | :--- | :--- |
| `page.data` | `Array` | Arreglo con los elementos correspondientes a la página actual. |
| `page.currentPage` | `number` | Número de la página actual (1, 2, 3...). |
| `page.lastPage` | `number` | Número total de páginas generadas. |
| `page.total` | `number` | Total de registros en la colección original. |
| `page.size` | `number` | Cantidad de elementos por página (`pageSize`). |
| `page.start` | `number` | Índice inicial de los datos en esta página. |
| `page.end` | `number` | Índice final de los datos en esta página. |
| `page.url.current` | `string` | URL canónica de la página actual. |
| `page.url.prev` | `string \| null` | URL de la página anterior (`null` si estás en la página 1). |
| `page.url.next` | `string \| null` | URL de la página siguiente (`null` si estás en la última página). |

---

## 🎨 Ejemplo Completo de Plantilla (`pages/articulos/[page].html`)

```html
<layout src="../../layouts/main.html">
  <seo title="Artículos - Página {{ page.currentPage }} de {{ page.lastPage }}" />

  <h1>{{ tituloSeccion }}</h1>
  <p>Mostrando {{ page.data.length }} de {{ page.total }} artículos.</p>

  <!-- Lista de artículos de la página actual -->
  <div class="grid">
    <each in="page.data" as="articulo">
      <article class="card">
        <h3>{{ articulo.titulo }}</h3>
        <p>{{ articulo.resumen }}</p>
        <a href="/articulos/{{ articulo.slug }}">Leer más</a>
      </article>
    </each>
  </div>

  <!-- Controles de navegación y paginación -->
  <nav class="pagination" aria-label="Navegación de páginas">
    <if is="page.url.prev">
      <a href="{{ page.url.prev }}" class="btn">&larr; Anterior</a>
    <else>
      <span class="btn disabled">&larr; Anterior</span>
    </if>

    <span class="page-indicator">
      Página {{ page.currentPage }} de {{ page.lastPage }}
    </span>

    <if is="page.url.next">
      <a href="{{ page.url.next }}" class="btn">Siguiente &rarr;</a>
    <else>
      <span class="btn disabled">Siguiente &rarr;</span>
    </if>
  </nav>
</layout>
```
