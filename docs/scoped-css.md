# 🎨 Estilos Scoped y Grafo de Dependencias CSS

Bustatic cuenta con un procesador de CSS nativo que proporciona **estilos encapsulados (*Scoped CSS*)**, deduplicación automática y resolución de grafos de dependencias `@import`, sin requerir preprocesadores externos como PostCSS o Sass.

---

## 🔒 1. Bloques `<style scoped>`

Puedes colocar un bloque `<style scoped>` dentro de cualquier elemento contenedor o componente HTML:

```html
<!-- components/card.html -->
<div class="card">
  <style scoped>
    /* "&" y ":host" hacen referencia al contenedor padre (.card) */
    & {
      background: #1e293b;
      padding: 1.5rem;
      border-radius: 8px;
    }

    h3 {
      color: #38bdf8;
      margin-top: 0;
    }

    /* Reglas @media anidadas manteniendo el alcance */
    @media (max-width: 640px) {
      & {
        padding: 1rem;
      }
    }
  </style>

  <h3>{{ title }}</h3>
  <p>{{ description }}</p>
</div>
```

### ¿Cómo lo transforma Bustatic?
1. Genera una clase hash determinista con prefijo `bs-` (ej. `bs-a8f3b1`).
2. Agrega automáticamente esta clase al elemento contenedor padre: `<div class="card bs-a8f3b1">`.
3. Transforma los selectores para encapsular el estilo:
   ```css
   .bs-a8f3b1 { background: #1e293b; ... }
   .bs-a8f3b1 h3 { color: #38bdf8; ... }
   ```
4. **Deduplicación en Bucles `<each>`:** Si el componente se repite 500 veces dentro de un bucle `<each>`, el bloque de estilos compilado solo se emite **una sola vez**, evitando inflar el HTML.
5. **Prioridad por Proximidad / Profundidad en el DOM:** Las reglas scoped se emiten ordenadas de contenedores más externos a más internos (manteniendo el orden del documento en empates). Así, un `<style scoped>` más cercano al elemento (por ejemplo dentro de `<nav>`) siempre sobrescribe a uno de un ancestro más externo (como `<main>`), incluso si el bloque general de la página se escribió al final del archivo.
6. **Compatibilidad con etiquetas autocerradas y DSD:** El analizador de etiquetas ignora correctamente etiquetas autocerradas (como `<photo ... />`, `<path ... />`) y bloques `<script>` / `<style>` previos (incluyendo los de Declarative Shadow DOM) al determinar el contenedor padre de `<style scoped>`.

### Regla clave de selectores: `&` vs descendientes

En un bloque `<style scoped>` o archivo `.css` hermano, la clase generada (`bs-...`) se añade **directamente sobre el elemento raíz** (o el contenedor padre del `<style scoped>`). Por ello:

| Lo que escribes | CSS compilado | ¿A quién aplica? |
| :--- | :--- | :--- |
| `& { ... }` o `:host { ... }` | `.bs-a8f3b1 { ... }` | **Al elemento raíz mismo** |
| `&:hover { ... }` / `&.active { ... }` | `.bs-a8f3b1:hover` / `.bs-a8f3b1.active` | **Estados o clases sobre el elemento raíz** |
| `&:hover .card-media img { ... }` | `.bs-a8f3b1:hover .card-media img` | **Hijo cuando el elemento raíz está en `:hover`** |
| `> p { ... }` | `.bs-a8f3b1 > p` | **Hijos directos del elemento raíz** |
| `.titulo { ... }` / `h3 { ... }` | `.bs-a8f3b1 .titulo` / `.bs-a8f3b1 h3` | **Solo elementos descendientes dentro de la raíz** |

> [!IMPORTANT]
> **No uses la clase o etiqueta del propio elemento raíz sin `&`.**
> Si el elemento raíz es `<article class="card">` y escribes `.card { ... }` o `.card:hover .card-media img { ... }`, Bustatic lo compilará como `.bs-a8f3b1 .card ...` (buscando `.card` **dentro** de sí mismo, fuera de su alcance) y la regla **no aplicará**. Usa siempre `& { ... }`, `&:hover { ... }` o `&:hover .card-media img { ... }`.

---

## 📂 2. Archivos CSS Hermanos Co-ubicados (`.html` + `.css`)

Si prefieres separar tu HTML de tu CSS sin escribir `<style scoped>` manualmente, puedes colocar un archivo `.css` hermano con el mismo nombre base junto a **cualquier componente o página** (estática o dinámica):

```text
src/
├── components/
│   ├── product-card.html
│   └── product-card.css     # Se aplica automáticamente como scoped a la raíz del componente
└── pages/
    ├── index.html
    ├── index.css            # Se aplica automáticamente a la página (contenedor del <slot> del layout)
    └── products/
        ├── [slug].html
        └── [slug].css       # También funciona con rutas dinámicas
```

### Regla del Elemento Raíz Único:
* **Componentes (`components/*.html`):** Si el componente tiene un único elemento contenedor raíz (ej. `<article class="card">...</article>`), Bustatic adjunta el CSS hermano como scoped a ese contenedor.
* **Páginas con `<layout>` (`pages/*.html`):** `<layout src="...">...</layout>` actúa como raíz única; el CSS hermano (así como un `<style scoped>` en el primer nivel de `<layout>`) se inyecta en el `<slot>` por defecto y se vincula automáticamente al contenedor padre del layout (por ejemplo `<main class="bs-...">`).
* **Páginas independientes con `<!doctype html>`:** Bustatic omite el prólogo `<!doctype html>` y los comentarios HTML, detectando `<html>` como elemento raíz único y aplicando la clase `bs-...` a `<html>`.
* **Múltiples Raíces (Fragmentos):** Si la plantilla contiene múltiples elementos en el nivel superior (ej. `<p>Uno</p><p>Dos</p>`), Bustatic no puede inferir un único contenedor padre y emitirá una advertencia preventiva `⚠ [Bustatic Warning]`.
* **Orden de cascada:** Si un mismo archivo tiene un `.css` hermano **y** un bloque `<style scoped>` inline, el CSS hermano se inserta primero y el bloque inline después, permitiendo que `<style scoped>` sobrescriba reglas del archivo hermano.

---

## 🌲 3. Grafo de Dependencias CSS y Resolución de `@import`

Bustatic analiza todas las hojas de estilo del proyecto para construir un **Grafo Dirigido Acíclico (DAG)** de dependencias:

* **Aplanamiento Recursivo:** Los `@import` locales (ej. `@import "./variables.css";`) se combinan recursivamente en el orden de cascada correcto.
* **Detección de Ciclos:** Si el archivo A importa B y B importa A, Bustatic detecta el ciclo y detiene la recursión con seguridad sin bloquear el build.
* **Imports Externos:** Declaraciones como `@import url("https://fonts.googleapis.com/...");` se preservan intactas en la cabecera.

---

## ⚙️ 4. Estrategias de Emisión (`cssStrategy`)

Configura la estrategia de entrega de CSS en `bustatic.config.ts`:

```ts
import { defineConfig } from "bustatic";

export default defineConfig({
  // "inline" (por defecto) o "external"
  cssStrategy: "inline",
});
```

### Comparativa de Estrategias:
* **`inline` (Recomendada para sitios estáticos de alto rendimiento):**
  - Los estilos de la página y sus componentes scoped se inyectan directamente dentro de etiquetas `<style>` en el `<head>`.
  - **Ventaja:** Cero peticiones HTTP adicionales y **cero parpadeo de contenido no estilizado (FOUC)**.
* **`external`:**
  - Extrae y empaqueta las hojas de estilo en archivos `.css` en la carpeta `dist/` enlazados mediante etiquetas `<link rel="stylesheet">`.
