# 📋 Ejemplos de Referencia para Bustatic

Este directorio contiene plantillas y snippets canónicos listos para copiar y usar en proyectos Bustatic.

---

## 1. Layout Base Canónico (`layouts/main.html`)

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="/styles/main.css">
  <slot name="head"></slot>
</head>
<body>
  <header>
    <nav>
      <a href="/">Inicio</a>
      <a href="/articulos">Artículos</a>
      <a href="/contacto">Contacto</a>
    </nav>
  </header>

  <main>
    <slot></slot>
  </main>

  <footer>
    <p>&copy; {{ site.year ?? "2026" }} {{ site.title }}</p>
  </footer>
</body>
</html>
```

---

## 2. Página con SEO e Imágenes (`pages/index.html`)

```html
<layout src="../layouts/main.html">
  <seo 
    title="Inicio | Mi Empresa" 
    description="Bienvenido al sitio web oficial generado con Bustatic."
    image="/images/hero.png"
  />

  <section class="hero">
    <h1>Soluciones Web Ultrarrápidas</h1>
    <photo 
      src="/images/hero.png" 
      widths="400,800,1200" 
      sizes="(min-width: 768px) 50vw, 100vw" 
      alt="Ilustración principal" 
      loading="eager"
    />
  </section>

  <section class="features">
    <each src="../data/features.json">
      <component src="../components/card.html" />
    </each>
  </section>
</layout>
```

---

## 3. Componente con Estilos Scoped (`components/card.html` + `card.css`)

```html
<article class="card">
  <style scoped>
    /* Usa "&" para estilizar la raíz y sus estados; nunca ".card { ... }" sin "&" */
    & {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 1.5rem;
    }
    &:hover {
      border-color: var(--color-accent);
    }
    h3 {
      color: var(--color-accent);
      margin-top: 0;
    }
    p {
      color: var(--color-text-muted);
    }
  </style>

  <h3>{{ title }}</h3>
  <p>{{ description }}</p>
  <div class="actions" if="url">
    <a href="{{ url }}">Conocer más &rarr;</a>
  </div>
</article>
```

---

## 4. Loader Co-ubicado para Página Estática (`pages/index.data.ts`)

```ts
export default async function({ data }) {
  const productos = data.products || [];
  return {
    props: {
      featured: productos.filter((p: any) => p.featured),
    },
    seo: {
      title: "Inicio | Mi Catálogo",
      description: "Productos destacados",
    },
  };
}
```
> En `pages/index.html`, se consume con `<each in="props.featured">`.

---

## 5. Loader Dinámico con SQLite y Paginación (`pages/articulos/[page].data.ts`)

```ts
import { Database } from "bun:sqlite";

export default async function({ paginate }) {
  const db = new Database("contenido.db");
  const posts = db.query("SELECT * FROM articulos ORDER BY fecha DESC").all();
  db.close();

  return paginate(posts, {
    pageSize: 10,
    props: {
      tituloSeccion: "Últimas Publicaciones"
    }
  });
}
```
> En `pages/articulos/[page].html`, consume `props.page.data`, `props.page.currentPage`, `props.page.lastPage`, `props.page.url.prev`, `props.page.url.next` y `props.tituloSeccion`.

---

## 6. Storage Loader OCI Registry / ORAS (`storage/oci.ts`)

```ts
import { createOrasStorage } from "bustatic";

export default createOrasStorage({
  hostname: process.env.OCI_REGISTRY_HOST || "localhost:5000",
  insecure: true,
  defaultTag: "latest",
});
```
> En plantillas: `<photo key="product/1/portrait" alt="Actual" />` o con tag explícito `<photo key="product/1/portrait:2020" alt="Edición 2020" />`.

---

## 7. Componente SVG Inline con Estilos Scoped (`icons/clipboard.svg` + `clipboard.css`)

```html
<!-- En src/components/tag-badge.html o en cualquier plantilla -->
<component src="../icons/clipboard.svg" class="badge-icon" aria-hidden="true" />
```

Con CSS hermano co-ubicado (`src/icons/clipboard.css`):
```css
& {
  display: inline-block;
  color: var(--color-text);
  vertical-align: middle;
}
```
O con `<style scoped>` directamente dentro del archivo SVG. Los atributos como `class`, `width`, `height`, `aria-*` y `role` pasados en `<component>` se fusionan directamente sobre la etiqueta `<svg>` raíz sin duplicar clases.
