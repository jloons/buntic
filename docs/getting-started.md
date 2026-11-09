# Primeros Pasos con Bustatic

**Bustatic** es un generador de sitios estáticos (SSG) ultrarrápido y con cero dependencias externas, diseñado exclusivamente para el runtime de [Bun](https://bun.sh).

---

## Requisitos

- Tener instalado [Bun](https://bun.sh) (v1.0 o superior).

---

## Instalación

### Uso global desde Bun:
```bash
bun add -g bustatic
```

### Uso directo sin instalar (con `bunx`):
```bash
bunx bustatic dev
```

### Uso local en un proyecto:
```bash
bun add -d bustatic
```

Agrega los comandos a tus `scripts` en el `package.json`:
```json
{
  "scripts": {
    "dev": "bustatic dev",
    "build": "bustatic build"
  }
}
```

---

## Estructura Recomendada de un Proyecto

Por defecto, Bustatic busca las siguientes carpetas en la raíz de tu proyecto:

```
mi-sitio/
├── pages/             # Cada archivo .html se convierte en una ruta web
│   ├── index.html     # -> /
│   └── about.html     # -> /about
├── layouts/           # Plantillas base
│   └── main.html      # Estructura HTML base con <slot>
├── components/        # Componentes HTML reutilizables y Web Components
│   ├── header.html
│   └── counter.ts
├── data/              # Archivos de datos JSON accesibles en plantillas
│   └── site.json
├── public/            # Archivos estáticos copiados directamente a dist/
│   └── robots.txt
└── styles/            # Hojas de estilo CSS procesadas por Bun
    └── main.css
```

---

## Comandos Principales

### Servidor de Desarrollo con Live-Reload
Inicia el servidor local en `http://localhost:3000`:
```bash
bustatic dev
```
Cualquier cambio en tus páginas, layouts, componentes, CSS o JSON recargará instantáneamente la pestaña del navegador a través de WebSockets nativos.

### Construir para Producción
Empaqueta y minifica todo el sitio en la carpeta `dist/`:
```bash
bustatic build
```
Bun procesará automáticamente los archivos HTML, extraerá y empaquetará los módulos TypeScript/JavaScript y hojas de estilo CSS en chunks minificados y con hash de caché.

---

## Configuración Opcional (`bustatic.config.ts`)

Puedes personalizar el comportamiento de Bustatic creando un archivo `bustatic.config.ts`:

```ts
import { defineConfig } from "bustatic";

export default defineConfig({
  port: 3000,
  minify: true,
  // Estrategia de CSS: "inline" (por defecto para cero FOUC) o "external"
  cssStrategy: "inline",
});
```
