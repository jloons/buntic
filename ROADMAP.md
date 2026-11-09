# 🗺️ Roadmap de Bustatic

Este documento define la visión técnica y las etapas de desarrollo planificadas para **Bustatic**, el generador de sitios estáticos de cero dependencias externas nativo para el runtime de **Bun**.

---

## 📍 Estado Actual: v0.1.0 (Fundación Estable)

La versión fundacional cuenta con un motor de compilación robusto, cobertura de pruebas completa y rendimiento sobresaliente:

- [x] **Motor de Plantillas Estándar:** `<layout>`, `<slot>` y slots con nombre, directiva `<each>` con auto-spread, y renderizado condicional con `<if is="...">` / `<else>`.
- [x] **Virtual File System (VFS) en RAM:** Indexación instantánea en memoria y resolución de rutas relativas (`./`, `../`) con soporte nativo para navegación `Ctrl + Click` en Visual Studio Code.
- [x] **Estilos Scoped Nativos y Grafo de Dependencias CSS:** Bloques `<style scoped>` con selector `&` / `:host`, clases deterministas `bs-...`, deduplicación en bucles y resolución de grafos dirigidos de `@import` locales evitando ciclos. Co-ubicación de archivos CSS hermanos (`.html` + `.css`).
- [x] **Web Components Nativos + Declarative Shadow DOM (DSD):**
  - Generación de Declarative Shadow DOM con tríadas co-ubicadas (`.ts` + `.html` + `.css`).
  - Anidación recursiva de Web Components dentro de plantillas HTML hermanas y proyección de slots.
  - Auto-importación de scripts sin etiquetas `<script>` manuales.
  - Alias de alta productividad `<component src="...ts" />` y `<component src="...ts">...</component>` para navegación rápida en IDE.
  - Validación W3C, prevención de colisiones de etiquetas y alertas en tiempo de compilación.
- [x] **Entorno de Desarrollo Integrado:** Servidor `bustatic dev` con WebSockets nativos de Bun, live-reload automático y transpilación al vuelo de TypeScript y JSX.
- [x] **Compilador de Producción:** Comando `bustatic build` con minificación y empaquetado ultraveloz mediante `Bun.build`.

---

## 🚀 Fase 1: Enrutamiento Dinámico, Datos Avanzados y Motores SQL Nativos (v0.2.0)

El objetivo de esta fase es aprovechar las capacidades nativas en C++ del runtime de Bun para generar sitios a partir de fuentes de datos dinámicas y bases de datos relacionales sin requerir librerías o dependencias externas pesadas.

- [ ] **Enrutamiento Dinámico Basado en Archivos:**
  - Sintaxis de rutas con parámetros en la carpeta `pages/`: ej. `pages/blog/[slug].html` o `pages/productos/[categoria]/[id].html`.
  - Mapeo automático de parámetros URL a nombres de archivo de salida limpios (`/blog/mi-articulo/index.html`).
- [ ] **Loaders de Datos Asíncronos (`.data.ts` / `.data.js`):**
  - Soporte para archivos de datos que exporten la función `getStaticPaths()`.
  - Inyección de parámetros (`params`) y propiedades (`props`) directamente en el contexto del motor de plantillas.
- [ ] **Integración Nativa con `bun:sqlite`:**
  - Soporte out-of-the-box para consultar bases de datos SQLite locales a velocidad C dentro de los loaders de datos.
  - Ideal para catálogos, blogs, documentación o sitios de comercio electrónico estáticos generados a partir de bases de datos locales.
- [ ] **Soporte para Drivers Relacionales Nativos (`Bun.sql`):**
  - Conexión directa con bases de datos remotas (PostgreSQL, MySQL) durante el proceso de build sin dependencias NPM de terceros.
- [ ] **Paginación Automática:**
  - Utilidad declarativa para segmentar colecciones masivas de registros en múltiples páginas (`/articulos/page/1`, `/articulos/page/2`).

---

## 🎨 Fase 2: Optimización de Assets, Object Storage Remoto y SEO (v0.3.0)

Esta fase se enfoca en la gestión profesional de medios multimedia, integración con almacenamiento en la nube y utilidades esenciales para motores de búsqueda.

- [ ] **Pipeline de Imágenes Híbrido (Local y Remoto):**
  - Compresión y generación automática de formatos modernos de alta eficiencia (`WebP` y `AVIF`).
  - Generación automática de atributos `srcset`, `sizes` y `loading="lazy"` mediante reescritura con `HTMLRewriter` de Bun.
- [ ] **Integración con Servidores de Objetos Remotos (Amazon S3, Cloudflare R2, MinIO, GCS):**
  - Configuración declarativa en `bustatic.config.ts` de proveedores de almacenamiento de objetos.
  - **Caché Inteligente por ETag:** Verificación preventiva con solicitudes `HEAD` para evitar volver a descargar y recomprimir assets inmutables ya procesados en compilaciones previas.
  - Almacenamiento local persistente en `.bustatic/cache/images` para acelerar entornos de Integración Continua (CI/CD).
- [ ] **Generadores SEO out-of-the-box:**
  - Generación automática de `sitemap.xml` dinámico incorporando todas las rutas estáticas y dinámicas resueltas por SQL o datos.
  - Generación automática de `robots.txt` configurable.
  - Generación de feeds RSS 2.0 y Atom para publicaciones y blogs.
  - Inyección declarativa de metadatos para redes sociales (OpenGraph, Twitter Cards).

---

## 🧩 Fase 3: Ecosistema, Extensibilidad y Contenido Markdown (v0.4.0 / v1.0.0)

Consolidación de la plataforma para su adopción a gran escala, extensibilidad modular y facilidad de autoría de contenido.

- [ ] **Sistema de Plugins y Lifecycle Hooks:**
  - Ganchos configurables en `bustatic.config.ts`: `beforeBuild`, `afterBuild`, `onTransformHtml`, `onPageRender`.
  - API de plugins para transformar código, procesar assets adicionales o integrarse con servicios de analíticas.
- [ ] **Soporte Nativo para Markdown / Frontmatter:**
  - Renderizado automático de archivos `.md` en `pages/`.
  - Extracción de metadatos YAML de frontmatter hacia las variables del layout.
  - Layouts por defecto configurables para artículos o documentación técnica.
- [ ] **Compilación a Binario Único (`bun build --compile`):**
  - Capacidad de compilar tanto el CLI como sitios generados en un solo binario autocontenido y ejecutable sin requerir Bun instalado en la máquina destino.
- [ ] **Publicación Oficial y Herramienta de Scaffolding:**
  - Publicación del paquete en npm y JSR.
  - Comando interactivo `bun create bustatic` para inicializar proyectos listos para producción con plantillas predefinidas.
