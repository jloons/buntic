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

## 3. Componente con Estilos Scoped (`components/card.html`)

```html
<div class="card">
  <style scoped>
    & {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 1.5rem;
    }
    h3 {
      color: #38bdf8;
      margin-top: 0;
    }
    p {
      color: #94a3b8;
    }
  </style>

  <h3>{{ title }}</h3>
  <p>{{ description }}</p>
  <div class="actions" if="url">
    <a href="{{ url }}">Conocer más &rarr;</a>
  </div>
</div>
```

---

## 4. Loader Dinámico con SQLite y Paginación (`pages/articulos/[page].data.ts`)

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
