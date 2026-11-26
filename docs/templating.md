# 📑 Guía de Plantillas y Componentes en Buntic

Buntic utiliza HTML estándar complementado con etiquetas especiales de tiempo de compilación de una sola palabra (`<layout>`, `<component>`, `<slot>`, `<each>`, `<if>`, `<unless>`, `<match>`, `<case>`, `<else>`, `<none>`, `<default>`) procesadas a velocidad nativa con el runtime de Bun sin entrar en conflicto con Web Components (que requieren guion) ni con HTML5/SVG.

---

## ⚡ Formas de Referenciar Rutas y Soporte en VS Code

Buntic soporta tres formas flexibles de referenciar cualquier `<layout>`, `<component>` o `<each>`:

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
   *La opción más corta: Buntic busca automáticamente en las carpetas `layouts/` y `components/`.*

---

## 🚀 Virtual File System (VFS) y Caché en Memoria

Buntic incorpora un **Virtual File System (VFS)** en memoria:
- **Indexación instantánea:** Al iniciar, indexa la estructura del proyecto en RAM, evitando miles de llamadas repetitivas `statSync` o `existsSync` a disco.
- **Caché de contenido:** Las plantillas HTML y archivos JSON se leen del disco una sola vez y se reutilizan en memoria a través de todas las páginas y bucles `<each>`.
- **Invalidación reactiva:** Durante `buntic dev`, el observador de archivos refresca en el VFS únicamente los archivos modificados en tiempo real.

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

Buntic unifica la inclusión de fragmentos HTML, Web Components y gráficos vectoriales SVG bajo la misma etiqueta `<component src="...">`, diferenciando el comportamiento según la extensión del archivo:

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

### Fallbacks de 3 niveles en `<each>` (`<none>`, `<else>`, `<default>`):
Cuando una colección puede estar vacía o no definida, `<each>` soporta bloques fallback directos:
- `<none>`: la lista existe y es un array, pero tiene **0 elementos** (`[]`).
- `<else>`: la fuente en `in="..."` **no está definida** (`undefined` o `null`). *(Si no declaras `<else>` ni `<default>`, Buntic lanza un error detallado para ayudarte a detectar typos).*
- `<default>`: **fallback universal** que cubre `<none>` y `<else>` cuando no se declaran por separado.

```html
<!-- Distinguiendo lista vacía vs dato no definido -->
<each in="props.workers">
  <li>{{ name }}</li>
  <none>
    <p>No hay trabajadores registrados todavía.</p>
  </none>
  <else>
    <p>Lista de trabajadores no disponible.</p>
  </else>
</each>

<!-- O usando un único fallback universal -->
<each in="props.workers">
  <li>{{ name }}</li>
  <default>
    <p>Sin elementos para mostrar.</p>
  </default>
</each>
```

---

## 4. Renderizado Condicional, Expresiones Seguras y `<match>`

Buntic ofrece un sistema híbrido de decisiones sin `eval`: **expresiones seguras en `is="..."`** (sin `{{ }}`) y **atributos literales tipados/rango** con verificación estricta de tipo (`string`, `number`, `boolean`, `min`, `max`).

### Opción A: Atributo condicional `if="..."` (en cualquier etiqueta)
Elimina **todo el elemento o subcomponente** si la expresión es falsa o vacía:

```html
<!-- Si badge no viene en los datos, todo el <span> desaparece sin dejar rastro -->
<span class="badge" if="badge">{{ badge }}</span>

<!-- Soporta negación y expresiones seguras -->
<span class="badge" if="items.length > 0 && !isArchived">{{ items.length }}</span>

<!-- Funciona en subcomponentes enteros -->
<component src="./boton.html" if="url" href="{{ url }}" />
```

### Opción B: Bloque condicional `<if is="...">` con `<else>` y `<unless>`
Soporta anidamiento balanceado, expresiones seguras (`!`, `===`, `!==`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, paréntesis, rutas anidadas y `.length`) y atributos tipados estrictos:

```html
<!-- Expresiones seguras en is="..." (sin {{ }}) -->
<if is="age >= 18 && age <= 30">
  <span>Adulto joven</span>
  <else>
    <span>Fuera de rango</span>
  </else>
</if>

<!-- Comparación entre variables -->
<if is="age >= config.allowed_age">
  <span>Acceso permitido</span>
</if>

<!-- Atributos literales tipados y de rango (verificación estricta de tipo) -->
<if is="age" number="0"><span>Recién nacido</span></if>
<if is="age" min="18" max="30"><span>Adulto joven</span></if>
<if is="role" string="admin"><span>Administrador</span></if>
<if is="active" boolean="true"><span>Activo</span></if>

<!-- <unless>: inverso declarativo de <if> -->
<unless is="props.product.inStock">
  <span class="out-of-stock">Agotado</span>
</unless>
```

> [!NOTE]
> Los atributos `string`, `number`, `boolean`, `min` y `max` aceptan únicamente **valores literales** y realizan una comprobación estricta de tipo (`typeof`): por ejemplo, si `age` es el texto `"20"` en lugar del número `20`, `<if is="age" min="18">` evalúa a `false`. Los rangos `min`/`max` son inclusivos (`>=` / `<=`). Para comparar dos variables entre sí, utiliza expresiones en `is="..."`.

### Opción C: Selección múltiple con `<match>`, `<case>`, `<none>`, `<else>` y `<default>`
Evalúa cada `<case>` en orden y detiene la evaluación en la **primera coincidencia** (sin *fallthrough*). Utiliza `<match>` (en lugar de `<switch>`) para evitar cualquier colisión con el elemento `<switch>` de SVG:

```html
<match is="age">
  <case number="0">Recién nacido</case>
  <case min="1" max="17">Menor de edad</case>
  <case min="18" max="64">Adulto</case>
  <case min="65">Adulto mayor</case>
  <none>Valor fuera de los rangos definidos</none>
  <else>Edad no especificada</else>
</match>

<match is="role">
  <case string="admin">Panel Admin</case>
  <case string="editor">Panel Editor</case>
  <default>Invitado</default>
</match>
```

**Prioridad de fallbacks en `<match>`:**
- Si el valor de `is="..."` es `undefined` o `null`: renderiza `<else>` → si no existe, `<default>` → si no existe, nada (`""`).
- Si el valor está definido pero ningún `<case>` coincide: renderiza `<none>` → si no existe, `<default>` → si no existe, nada (`""`).

### Opción D: Operador de Respaldo (`??`)
Para textos simples con valor por defecto cuando no necesitas borrar la etiqueta contenedora:

```html
<p class="author">Por: {{ author ?? "Anónimo" }}</p>
```

---

## 5. Diagnóstico Detallado de Errores en Plantillas

Cuando ocurre un error de plantilla (archivo faltante en `<layout>`, `<component>` o `<each>`, error de parseo JSON, expresión inválida en `is="..."`, o literal inválido como `min="abc"`), Buntic genera un diagnóstico estructurado tanto en `buntic build` como en el navegador en `buntic dev` (con recarga automática al guardar la corrección):

- **Plantilla exacta, línea y columna** (`src/pages/workers.html:3:5`).
- **Fragmento de código marcado (*code frame*)** con indicador `>` y subrayado `^^^^` sobre la etiqueta exacta.
- **Archivo resuelto y causa original** cuando aplica carga de archivos (`src="..."`).
- **Sugerencia accionable (`Hint`)** para corregir el problema rápidamente.

---

## 6. Interpolación de Variables

En cualquier plantilla o componente puedes interpolar valores directamente con la sintaxis de doble llave `{{ variable }}`:

```html
<footer>
  <p>&copy; {{ site.year }} {{ site.title }} por {{ site.author }}</p>
</footer>
```

---

## 📚 Guías Dedicadas para Características Avanzadas

Para profundizar en las funcionalidades avanzadas de Buntic, consulta nuestras guías especializadas:

- 🎨 **[Estilos Scoped y Grafo CSS](./scoped-css.md):** Encapsulación con `<style scoped>`, selector `&` / `:host` y CSS hermano co-ubicado.
- 🧩 **[Web Components Nativos y DSD](./web-components.md):** Interactividad cliente con Declarative Shadow DOM y tríadas `.ts` + `.html` + `.css`.
- 🗺️ **[Enrutamiento y Páginas Dinámicas](./routing-and-pages.md):** Rutas con parámetros `[slug]`, URLs limpias y detección de colisiones.
- 📊 **[Datos, Loaders y Entorno](./data-and-loaders.md):** Loaders `.data.ts`, almacén global `data/` y `.env.public`.
- 🗄️ **[Motores SQL Nativos](./databases-sql.md):** Conexión out-of-the-box con `bun:sqlite` y `Bun.sql` (PostgreSQL).
- 📑 **[Paginación Automática](./pagination.md):** Asistente `paginate()` declarativo y objeto `props.page`.
- 🖼️ **[Optimización de Imágenes con `<photo>`](./assets-and-images.md):** Compresión WebP, dimensiones anti-CLS y `srcset`.
- 🗄️ **[Storage Loaders Remotos](./storage-loaders.md):** Carga de blobs desde Amazon S3, Cloudflare R2 y MinIO con caché ETag.
- 🔍 **[Suite SEO y Feeds](./seo.md):** Metadatos sociales `<seo>`, `sitemap.xml`, `robots.txt` y feeds RSS/Atom.
