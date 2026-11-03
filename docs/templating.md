# Guía de Plantillas y Componentes en Bustatic

Bustatic utiliza HTML estándar complementado con etiquetas especiales de tiempo de compilación (`<layout>`, `<component>`, `<slot>`) y soporte nativo para **Web Components**.

---

## ⚡ Superpoder de VS Code: Rutas Relativas y `Ctrl + Click`

Uno de los mayores beneficios de usar el atributo nativo `src="..."` con rutas relativas (`./` o `../`) es la integración directa con editores modernos como **VS Code**:

- **Navegación instantánea (Ctrl + Click / Cmd + Click):** Al colocar el cursor sobre `src="../components/card.html"` o `src="../layouts/main.html"`, el editor subraya la ruta como un hipervínculo y al hacer clic abre directamente el archivo correspondiente.
- **Autocompletado de rutas:** Al escribir `src="./` o `src="../`, VS Code despliega una lista desplegable con todos los archivos disponibles en ese directorio.
- **Sin plugins propietarios:** No necesitas instalar extensiones pesadas ni configurar herramientas de terceros. ¡Funciona de fábrica en cualquier editor HTML!

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

## 6. Reactividad con Web Components Nativos

Para añadir interactividad compleja del lado del cliente, no necesitas React o Vue. Puedes usar Web Components nativos:

### `components/counter.ts`:
```ts
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

### En tu página HTML:
```html
<counter-button></counter-button>

<script type="module" src="/components/counter.ts"></script>
```

`Bun.build` empaqueta, compila TypeScript y minifica el componente automáticamente para producción.
