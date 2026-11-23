# 📑 Guía de Plantillas y Componentes en Bustatic

Bustatic utiliza HTML estándar complementado con etiquetas especiales de tiempo de compilación (`<layout>`, `<component>`, `<slot>`, `<each>`, `<if>`) procesadas a velocidad de C++ con el runtime de Bun.

---

## ⚡ Formas de Referenciar Rutas y Soporte en VS Code

Bustatic soporta tres formas flexibles de referenciar cualquier `<layout>`, `<component>` o `<each>`:

1. **Relativa a la Raíz del Proyecto (`/`):**
   ```html
   <layout src="/layouts/main.html">
     <component src="/components/card.html" />
     <each src="/data/features.json"> ... </each>
   </layout>
   ```
   *Ideal para rutas predecibles sin tener que contar cuántos `../` subir en páginas profundamente anidadas.*

2. **Relativa al Archivo Actual (`./` o `../`):**
   ```html
   <layout src="../layouts/main.html">
     <component src="../components/card.html" />
   </layout>
   ```
   *Ideal para componentes colocados junto a las páginas (`./autor.html`) y para habilitar la navegación instantánea `Ctrl + Click` y el autocompletado nativo en VS Code.*

3. **Por Convención de Nombre:**
   ```html
   <layout src="main.html">
     <component src="card.html" />
   </layout>
   ```
   *La opción más corta: Bustatic busca automáticamente en las carpetas `layouts/` y `components/`.*

---

## 🚀 Virtual File System (VFS) y Caché en Memoria

Bustatic incorpora un **Virtual File System (VFS)** en memoria:
- **Indexación instantánea:** Al iniciar, indexa la estructura del proyecto en RAM, evitando miles de llamadas repetitivas `statSync` o `existsSync` a disco.
- **Caché de contenido:** Las plantillas HTML y archivos JSON se leen del disco una sola vez y se reutilizan en memoria a través de todas las páginas y bucles `<each>`.
- **Invalidación reactiva:** Durante `bustatic dev`, el observador de archivos refresca en el VFS únicamente los archivos modificados en tiempo real.

---

## 1. Layouts (`<layout>` y `<slot>`)

Un layout es una estructura base HTML (habitualmente en `layouts/`) que envuelve las páginas para compartir `head`, encabezados, navegación y pie de página.

### Definición del Layout (`layouts/main.html`):
```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title><slot name="title">{{ site.title }}</slot></title>
  <link rel="stylesheet" href="/styles/main.css">
  <slot name="head"></slot>
</head>
<body>
  <!-- Referencia relativa: ¡Ctrl + Click en VS Code abre el archivo! -->
  <component src="../components/header.html" />

  <!-- Punto de inserción del contenido principal -->
  <main>
    <slot></slot>
  </main>

  <component src="../components/footer.html" />
</body>
</html>
```

### Uso en una Página (`pages/index.html`):
```html
<!-- Referencia relativa: ¡Ctrl + Click en VS Code abre layouts/main.html! -->
<layout src="../layouts/main.html">
  <!-- Inyección en el slot con nombre "title" -->
  <span slot="title">Inicio - Bienvenido</span>

  <h1>Página de Inicio</h1>
  <p>Este contenido reemplaza al <slot></slot> por defecto del layout.</p>
</layout>
```

---

## 2. Componentes y Gráficos SVG (`<component>`)

Bustatic unifica la inclusión de fragmentos HTML, Web Components y gráficos vectoriales SVG bajo la misma etiqueta `<component src="...">`, diferenciando el comportamiento según la extensión del archivo:

```text
<component src="...">
├── *.html  -> Componente estático HTML renderizado en servidor (+ CSS hermano scoped)
├── *.svg   -> Gráfico SVG inyectado inline con fusión de atributos (+ CSS hermano scoped)
└── *.ts    -> Web Component interactivo cliente con Declarative Shadow DOM
```

### 2.1 Componentes HTML Estáticos (`components/card.html`):
```html
<div class="card">
  <h3>{{ title }}</h3>
  <p>{{ description }}</p>
  <div class="extra">
    <slot></slot>
  </div>
</div>
```
Uso:
```html
<component 
  src="../components/card.html" 
  title="Ultra Rápido" 
  description="Construido con Bun sin librerías externas">
  <a href="/docs">Leer más</a>
</component>
```

### 2.2 Gráficos e Iconos SVG Inline (`icons/*.svg`):
Al referenciar un archivo `.svg`:
1. **Inyección Inline Limpia:** elimina automáticamente prólogos XML (`<?xml ...?>`) y doctypes para mantener HTML5 válido.
2. **Fusión Automática de Atributos:** cualquier atributo pasado a `<component>` (`class`, `width`, `height`, `aria-hidden`, `role`, `style`, etc.) se fusiona directamente en la etiqueta `<svg>` raíz (concatenando clases existentes y reemplazando atributos como dimensiones).
3. **Estilos Scoped y CSS Hermano:** soporta tanto `<style scoped>` dentro del SVG como un archivo `.css` hermano co-ubicado (`check.svg` + `check.css`).
4. **Soporte dentro de Shadow DOM DSD:** si se usa dentro de la plantilla de un Web Component (ej. `tag-badge.html`), sus estilos scoped se encapsulan dentro del `<template shadowrootmode="open">`.

```html
<!-- Inyección inline con dimensiones y accesibilidad -->
<component src="../icons/clipboard.svg" class="badge-icon" aria-hidden="true" />
```

### ¿Cuándo usar `<component src="...svg">` vs `src/public/` + `<img>`?

| Caso de Uso | Mecanismo | Motivo |
| :--- | :--- | :--- |
| **Iconos pequeños (16–32px), `currentColor`, variables CSS (`--color-*`), animaciones de trazos** | `<component src="../icons/icon.svg" />` *(Inline)* | Hereda el color del texto contenedor (`fill="currentColor"`), cero peticiones HTTP extra, manipulable por CSS. |
| **Logos, ilustraciones complejas, favicons, gráficos estáticos reutilizados** | `src/public/logo.svg` + `<img src="/logo.svg" />` *(Externo)* | El navegador lo descarga y cachea una sola vez entre páginas, manteniendo el HTML liviano. |

> [!NOTE]
> La etiqueta `<photo>` está reservada exclusivamente para imágenes rasterizadas (PNG, JPG, WebP) que se optimizan y convierten a WebP con `Bun.Image`. Los SVGs no deben procesarse con `<photo>`.

---

## 3. Iteración con `<each>` y Auto-Spread de Props

La directiva `<each>` te permite iterar arrays desde un archivo JSON externo (`src`) o desde variables ya presentes en memoria (`in`).

### Iterar archivo JSON con Auto-Spread a `<component>`
Si el bloque contiene un `<component>`, las claves del objeto JSON se inyectan automáticamente como props del componente (equivalente a `{...props}` en JSX):

```html
<!-- Cero boilerplate: cada objeto inyecta sus claves automáticamente -->
<each src="../data/features.json">
  <component src="../components/card.html" />
</each>
```

### Iterar con alias explícito (`as="item"`):
```html
<each src="../data/features.json" as="item">
  <component src="../components/card.html" title="{{ item.title }}" description="{{ item.description }}" />
</each>
```

### Iterar colecciones en memoria y elementos HTML estándar:
```html
<nav>
  <each in="site.navLinks" as="link">
    <a href="{{ link.url }}">{{ link.label }}</a>
  </each>
</nav>
```

---

## 4. Renderizado Condicional y Atributos Opcionales

Para evitar dejar elementos vacíos en el DOM cuando un atributo opcional no viene en los datos:

### Opción A: Atributo condicional `if="..."` (en cualquier etiqueta)
Elimina **todo el elemento o subcomponente** si la variable no existe o es falsa/vacía:

```html
<!-- Si badge no viene en los datos, todo el <span> desaparece sin dejar rastro -->
<span class="badge" if="badge">{{ badge }}</span>

<!-- Funciona en subcomponentes enteros -->
<component src="./boton.html" if="url" href="{{ url }}" />
```

### Opción B: Bloque condicional `<if is="...">` con `<else>`
Para bloques multilínea o bifurcaciones de lógica:

```html
<if is="isOnline">
  <span class="status online">En Línea</span>
  <else>
    <span class="status offline">Desconectado</span>
  </else>
</if>
```

### Opción C: Operador de Respaldo (`??`)
Para textos simples con valor por defecto cuando no necesitas borrar la etiqueta contenedora:

```html
<p class="author">Por: {{ author ?? "Anónimo" }}</p>
```

---

## 5. Interpolación de Variables

En cualquier plantilla o componente puedes interpolar valores directamente con la sintaxis de doble llave `{{ variable }}`:

```html
<footer>
  <p>&copy; {{ site.year }} {{ site.title }} por {{ site.author }}</p>
</footer>
```

---

## 📚 Guías Dedicadas para Características Avanzadas

Para profundizar en las funcionalidades avanzadas de Bustatic, consulta nuestras guías especializadas:

- 🎨 **[Estilos Scoped y Grafo CSS](./scoped-css.md):** Encapsulación con `<style scoped>`, selector `&` / `:host` y CSS hermano co-ubicado.
- 🧩 **[Web Components Nativos y DSD](./web-components.md):** Interactividad cliente con Declarative Shadow DOM y tríadas `.ts` + `.html` + `.css`.
- 🗺️ **[Enrutamiento y Páginas Dinámicas](./routing-and-pages.md):** Rutas con parámetros `[slug]`, URLs limpias y detección de colisiones.
- 📊 **[Datos, Loaders y Entorno](./data-and-loaders.md):** Loaders `.data.ts`, almacén global `data/` y `.env.public`.
- 🗄️ **[Motores SQL Nativos](./databases-sql.md):** Conexión out-of-the-box con `bun:sqlite` y `Bun.sql` (PostgreSQL).
- 📑 **[Paginación Automática](./pagination.md):** Asistente `paginate()` declarativo y objeto `props.page`.
- 🖼️ **[Optimización de Imágenes con `<photo>`](./assets-and-images.md):** Compresión WebP, dimensiones anti-CLS y `srcset`.
- 🗄️ **[Storage Loaders Remotos](./storage-loaders.md):** Carga de blobs desde Amazon S3, Cloudflare R2 y MinIO con caché ETag.
- 🔍 **[Suite SEO y Feeds](./seo.md):** Metadatos sociales `<seo>`, `sitemap.xml`, `robots.txt` y feeds RSS/Atom.
