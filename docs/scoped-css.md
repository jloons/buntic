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
2. Agrega automáticamente esta clase al elemento padre: `<div class="card bs-a8f3b1">`.
3. Transforma los selectores para encapsular el estilo:
   ```css
   .card.bs-a8f3b1 { background: #1e293b; ... }
   .bs-a8f3b1 h3 { color: #38bdf8; ... }
   ```
4. **Deduplicación en Bucles `<each>`:** Si el componente se repite 500 veces dentro de un bucle `<each>`, el bloque de estilos compilado solo se emite **una sola vez**, evitando inflar el HTML.

---

## 📂 2. Archivos CSS Hermanos Co-ubicados (`.html` + `.css`)

Si prefieres separar tu HTML de tu CSS sin tener que escribir `<style scoped>` manualmente, puedes colocar un archivo `.css` hermano con el mismo nombre:

```text
components/
├── user-profile.html
└── user-profile.css   # Se aplica automáticamente con alcance scoped
```

### Regla del Elemento Raíz Único:
* **1 Solo Elemento Raíz:** Si `user-profile.html` tiene un único contenedor raíz (ej. `<div class="profile">...</div>`), Bustatic asocia automáticamente el CSS hermano como scoped a ese contenedor.
* **Múltiples Raíces (Fragmentos):** Si el componente contiene múltiples elementos en el nivel superior (ej. `<p>Uno</p><p>Dos</p>`), Bustatic no puede inferir un único contenedor padre y emitirá una advertencia preventiva `⚠ [Bustatic Warning]`.

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
