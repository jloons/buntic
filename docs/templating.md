# Guía de Plantillas y Componentes en Bustatic

Bustatic utiliza HTML estándar complementado con etiquetas especiales de tiempo de compilación (`<layout>`, `<component>`, `<slot>`) y soporte nativo para **Web Components**.

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
  <title><slot name="title">{{site.title}}</slot></title>
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

## 2. Componentes (`<component>`)

Los componentes son fragmentos HTML reutilizables. Puedes ubicarlos en `components/` o incluso colocarlos en la misma carpeta de una página.

### Definición del Componente (`components/card.html`):
```html
<div class="card">
  <h3>{{title}}</h3>
  <p>{{description}}</p>
  <div class="extra">
    <slot></slot>
  </div>
</div>
```

### Uso con Rutas Relativas y Props:
```html
<component 
  src="../components/card.html" 
  title="Ultra Rápido" 
  description="Construido con Bun sin librerías externas">
  <a href="/docs">Leer más</a>
</component>
```

> [!TIP]
> Bustatic soporta tanto rutas relativas explícitas (`../components/card.html`, `./boton.html`) como nombres convencionales (`card.html` o `card`), para que uses el estilo que más te guste.

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
  <component src="../components/card.html" title="{{item.title}}" description="{{item.description}}" />
</each>
```

### Iterar colecciones en memoria y elementos HTML estándar:
```html
<nav>
  <each in="site.navLinks" as="link">
    <a href="{{link.url}}">{{link.label}}</a>
  </each>
</nav>
```

---

## 4. Renderizado Condicional y Atributos Opcionales

Para evitar dejar elementos vacíos en el DOM cuando un atributo opcional no viene en los datos:

### Opción A: Atributo condicional `if="..."` (en cualquier etiqueta)
Elimina **todo el elemento o subcomponente** si la variable no existe o es falsa/vacía:

```html
<!-- Si badge no viene en el JSON, todo el <span> desaparece sin dejar rastro -->
<span class="badge" if="badge">{{badge}}</span>

<!-- Funciona en subcomponentes enteros -->
<component src="./boton.html" if="url" href="{{url}}" />
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
<p class="author">Por: {{author ?? "Anónimo"}}</p>
```

---

## 5. Inyección de Datos JSON

Los archivos situados en la carpeta `data/` se cargan automáticamente:
- `data/site.json` crea la variable global `{{site.*}}`.

Ejemplo de `data/site.json`:
```json
{
  "title": "Mi Proyecto",
  "author": "María",
  "year": 2026
}
```

En cualquier plantilla o componente puedes interpolar valores directamente:
```html
<footer>
  <p>&copy; {{site.year}} {{site.title}} por {{site.author}}</p>
</footer>
```

---

## 6. Reactividad con Web Components Nativos y Auto-Importación

Para añadir interactividad del lado del cliente, Bustatic aprovecha la potencia de los **Web Components nativos** junto con el compilador integrado de Bun.

### Declaración en HTML (¡Sin etiquetas `<script>` manuales!)

Simplemente usa la etiqueta del componente en cualquier página o componente HTML:

```html
<!-- Bustatic detecta automáticamente la etiqueta e inyecta el script en <head> -->
<counter-button></counter-button>
```

> [!NOTE]
> Ya no necesitas escribir `<script type="module" src="/components/counter.ts"></script>`. Bustatic inspecciona el árbol del proyecto, asocia la etiqueta con su archivo `.ts` o `.js` e inyecta la referencia automáticamente. Si ya habías escrito la etiqueta `<script>` manualmente, Bustatic la respeta sin duplicarla.

---

### Cómo declara y detecta Bustatic tus Web Components

Bustatic utiliza una doble estrategia de resolución indexada en su Virtual File System (VFS):

1. **Definición Explícita en Código (`customElements.define` o decoradores):**
   ```ts
   // components/counter.ts
   class CounterButton extends HTMLElement {
     count = 0;
     connectedCallback() {
       this.innerHTML = `<button>Clicks: ${this.count}</button>`;
       this.querySelector("button")?.addEventListener("click", () => {
         this.count++;
         this.querySelector("button")!.textContent = `Clicks: ${this.count}`;
       });
     }
   }

   customElements.define("counter-button", CounterButton);
   ```

2. **Convención por Nombre de Archivo:**
   Si el archivo no define la etiqueta de forma estática inmediata, Bustatic asocia la etiqueta basándose en el nombre del archivo:
   - `components/counter-button.ts` &rarr; `<counter-button>`
   - `components/UserProfile.ts` (PascalCase) &rarr; `<user-profile>`

---

### Validación W3C y Prevención de Colisiones

Para garantizar código robusto tanto en desarrollo como en producción:

- **Especificación W3C:** Todas las etiquetas deben cumplir la especificación W3C (contener un guión `-`, iniciar con letra minúscula `[a-z]` y no coincidir con etiquetas reservadas del estándar como `font-face` o `annotation-xml`).
- **Detección de Colisiones:** Si dos archivos intentan definir la misma etiqueta (por ejemplo, `components/card.ts` y `widgets/card.ts` ambos definiendo `<item-card>`):
  - En **`bustatic dev`**: Emite una advertencia de colisión en consola y mantiene el registro sincronizado en caliente sin fugas de memoria si renombras o eliminas uno de los archivos.
  - En **`bustatic build`**: Lanza una excepción fatal antes del empaquetado indicando con exactitud los archivos en conflicto para evitar comportamientos impredecibles en producción.
- **Aviso de Componentes No Utilizados:** Durante `bustatic build`, si un Web Component está definido en el proyecto pero ninguna página HTML lo utiliza, Bustatic emite una advertencia en consola para ayudarte a mantener limpio tu código.
