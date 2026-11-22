# 🧩 Web Components Nativos y Declarative Shadow DOM (DSD)

Bustatic aprovecha el estándar de **Web Components nativos del navegador** y el soporte para **Declarative Shadow DOM (DSD)** para ofrecer interactividad del lado del cliente con cero parpadeo (FOUC), máximo rendimiento y sin frameworks pesados de JavaScript.

---

## ⚡ Formas de Declaración en HTML

Puedes declarar e invocar un Web Component de dos formas complementarias:

### Opción A: Etiqueta HTML Estándar (Recomendada)
Usa el tag del componente directamente en cualquier página o componente:
```html
<counter-button id="mi-contador"></counter-button>
```
*Bustatic detecta automáticamente la etiqueta, localiza su archivo TypeScript/JavaScript correspondiente y auto-empaqueta e inyecta el script sin requerir etiquetas `<script>` manuales.*

### Opción B: Alias `<component src="...">` (Navegación Rápida en IDE)
Para habilitar navegación **`Ctrl + Click`** y autocompletado nativo en Visual Studio Code:
```html
<!-- Autocerrado o sin proyección -->
<component src="../components/counter-button.ts" id="contador" />

<!-- Con proyección de slots -->
<component src="../components/interactive-modal.ts">
  <span slot="title">Confirmación</span>
  <p>¿Deseas continuar con la operación?</p>
</component>
```

> [!TIP]
> **Diferenciación por Extensión:**
> - `src="*.html"` &rarr; Componente estático HTML renderizado en tiempo de compilación.
> - `src="*.ts"` o `*.js` &rarr; Web Component interactivo cliente.

---

## 🎯 La Tríada de Web Components con Declarative Shadow DOM

Bustatic implementa **Declarative Shadow DOM (`<template shadowrootmode="open">`)** de forma nativa. Esto te permite separar limpiamente tu lógica, estructura y estilos en tres archivos co-ubicados:

```text
components/
├── counter-button.ts     # Lógica e interactividad del lado del cliente
├── counter-button.html   # Estructura del Shadow DOM (soporta <slot>)
└── counter-button.css    # Estilos 100% encapsulados en el Shadow DOM
```

### 1. Estructura HTML (`components/counter-button.html`):
```html
<div class="counter-box">
  <h4><slot name="title">Contador</slot></h4>
  <button id="btn">Clicks: <span id="num">0</span></button>
</div>
```

### 2. Estilos Encapsulados (`components/counter-button.css`):
```css
:host {
  display: block;
  margin: 1rem 0;
}
.counter-box {
  border: 1px solid #334155;
  padding: 1rem;
  border-radius: 8px;
}
button {
  background: #38bdf8;
  color: #0f172a;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}
```

### 3. Lógica TypeScript (`components/counter-button.ts`):
```ts
class CounterButton extends HTMLElement {
  count = 0;

  connectedCallback() {
    // Al usar Declarative Shadow DOM, el shadowRoot ya existe en el primer frame:
    const btn = this.shadowRoot?.querySelector("#btn");
    const num = this.shadowRoot?.querySelector("#num");

    btn?.addEventListener("click", () => {
      this.count++;
      if (num) num.textContent = String(this.count);
    });
  }
}

customElements.define("counter-button", CounterButton);
```

### HTML Final Emitido por Bustatic (¡Cero FOUC!):
```html
<counter-button id="mi-contador">
  <template shadowrootmode="open">
    <style>
      :host { display: block; ... }
      ...
    </style>
    <div class="counter-box">
      <h4><slot name="title">Contador</slot></h4>
      <button id="btn">Clicks: <span id="num">0</span></button>
    </div>
  </template>
</counter-button>
```

### Anidamiento de Web Components con DSD
Un Web Component puede incluir otros Web Components dentro de su plantilla `.html` (por ejemplo, `<version-viewer>` anidando `<tag-badge>`). Bustatic expande recursivamente los `<template shadowrootmode="open">` de los componentes internos e inyecta automáticamente los `<script type="module">` necesarios en `<head>` sin duplicarlos.

> [!TIP]
> Dentro de un archivo `.css` de Web Component, puedes usar `:host` o `&` indistintamente: Bustatic convierte `&` a `:host` de forma automática para estilizar el elemento anfitrión del Shadow DOM. Además, la hoja de estilos global del proyecto se propaga al Shadow DOM para mantener disponibles tus variables CSS (como `--color-*`).

---

## 📐 Regla Estricta 1:1: Archivo = Tag

Para mantener una arquitectura modular, predecible y con resolución directa $O(1)$:
- **1 Web Component por archivo:** Cada archivo `.ts` o `.js` representa un único Custom Element.
- **Correspondencia unívoca de nombres:** El nombre del archivo debe coincidir de forma idéntica con el tag en `kebab-case` o `PascalCase`:
  - `components/theme-toggle.ts` &rarr; `<theme-toggle>`
  - `components/ThemeToggle.ts` &rarr; `<theme-toggle>`

---

## 🛡️ Validación W3C y Prevención de Colisiones

1. **Cumplimiento W3C:** Todas las etiquetas deben contener un guion (`-`) y comenzar con letra minúscula `[a-z]`.
2. **Detección Preventiva de Colisiones:** Si dos archivos intentan registrar el mismo tag (ej. `pkg-a/card.ts` y `pkg-b/card.ts`):
   - En **`bustatic dev`**: Muestra advertencia en consola y mantiene el registro reactivo.
   - En **`bustatic build`**: Detiene la compilación con un error fatal antes de empaquetar.
3. **Advertencia de Componentes No Registrados:** Si en tu HTML escribes una etiqueta con guion (ej. `<mi-widget>`) que no existe en el proyecto, Bustatic te avisa en consola para detectar errores tipográficos.
4. **Advertencia de Componentes Huérfanos:** Si un Web Component está definido en el proyecto pero ninguna página lo utiliza, Bustatic te alerta para mantener tu base de código limpia.
