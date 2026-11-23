# 🗺️ Roadmap de Buntic

Este documento define la visión técnica y las etapas de desarrollo planificadas para **Buntic**, el generador de sitios estáticos de cero dependencias externas nativo para el runtime de **Bun**.

---

## 📍 Estado Actual: v0.3.0 (Assets, Object Storage y Suite SEO)

Buntic cuenta con un motor de compilación maduro, cobertura de pruebas completa (100+ tests pasando) y cero dependencias de terceros:

- [x] **Motor de Plantillas Estándar:** `<layout>`, `<slot>` y slots con nombre, directiva `<each>` con auto-spread, y renderizado condicional con `<if is="...">` / `<else>`.
- [x] **Virtual File System (VFS) en RAM:** Indexación instantánea en memoria y resolución de rutas relativas (`./`, `../`) con soporte nativo para navegación `Ctrl + Click` en Visual Studio Code.
- [x] **Estilos Scoped Nativos y Grafo de Dependencias CSS:** Bloques `<style scoped>` con selector `&` / `:host`, clases deterministas `bs-...`, deduplicación en bucles y resolución de grafos dirigidos de `@import` locales evitando ciclos. Co-ubicación de archivos CSS hermanos (`.html` + `.css` y `.svg` + `.css`) y ordenamiento determinista por proximidad/profundidad en el árbol DOM.
- [x] **Web Components Nativos + Declarative Shadow DOM (DSD):**
  - Generación de Declarative Shadow DOM con tríadas co-ubicadas (`.ts` + `.html` + `.css`).
  - Anidación recursiva de Web Components dentro de plantillas HTML hermanas y proyección de slots.
  - Aislamiento de estilos scoped dentro de plantillas DSD (`<template shadowrootmode="open">`) sin fugas al `<head>`.
  - Auto-importación de scripts sin etiquetas `<script>` manuales.
  - Alias de alta productividad `<component src="...ts" />` y `<component src="...ts">...</component>` para navegación rápida en IDE.
  - Validación W3C, prevención de colisiones de etiquetas y alertas en tiempo de compilación.
- [x] **Componentes SVG Nativos Inline:**
  - Inclusión declarativa mediante `<component src="...svg" />` con passthrough e interpolación de atributos (`class`, `width`, `height`, `aria-*`, `role`).
  - Limpieza automática de prólogos XML (`<?xml ...?>`) y declaraciones `<!DOCTYPE ...>`.
  - Soporte para `<style scoped>` interno y archivos CSS hermanos (`.svg` + `.css`) con selector `&`.
  - Soporte transparente tanto en HTML estándar como dentro de plantillas Declarative Shadow DOM.
- [x] **Entorno de Desarrollo Integrado:** Servidor `buntic dev` con WebSockets nativos de Bun, live-reload automático y transpilación al vuelo de TypeScript y JSX.
- [x] **Compilador de Producción:** Comando `buntic build` con minificación y empaquetado ultraveloz mediante `Bun.build`.

---

## 🚀 Fase 1: Enrutamiento Dinámico, Datos Avanzados y Motores SQL Nativos (v0.2.0)

- [x] **Enrutamiento Dinámico Basado en Archivos:**
  - Sintaxis de rutas con parámetros en la carpeta `pages/`: ej. `pages/blog/[slug].html` o `pages/productos/[categoria]/[id].html`.
  - Mapeo automático de parámetros URL a nombres de archivo de salida limpios (`/blog/mi-articulo/index.html`).
  - Detección preventiva de colisiones de URLs y validación estricta de parámetros en tiempo de build.
- [x] **Loaders de Datos Asíncronos (`.data.ts` / `.data.js`):**
  - Soporte co-ubicado para archivos de datos que exporten `export default async function` o `getStaticPaths()`.
  - Inyección aislada de espacios de nombres reservados: `params.*`, `props.*`, `env.*`, previniendo colisiones.
  - Almacén global dinámico en memoria RAM (`data/*.ts` y `data/*.json`) con ejecución única compartida para todo el build.
  - Soporte de entorno seguro: `.env.public` y prefijos `PUBLIC_*` para variables accesibles en plantillas, protegiendo credenciales privadas.
- [x] **Integración Nativa con `bun:sqlite`:**
  - Soporte out-of-the-box para consultar bases de datos SQLite locales a velocidad C dentro de los loaders de datos globales y locales.
  - Pruebas unitarias integradas y portables en memoria.
- [x] **Soporte para Drivers Relacionales Nativos (`Bun.sql`) y Clave-Valor (`Bun.redis`):**
  - Conexión directa con bases de datos remotas (PostgreSQL) mediante el driver nativo de Bun sin dependencias NPM de terceros.
  - Conexión nativa de alto rendimiento con servidores Redis (`Bun.redis` / `Bun.RedisClient`) para recuperación de catálogos y datos estructurados.
  - Suite de pruebas de integración y script demostrativo con contenedores Podman.
- [x] **Paginación Automática:**
  - Utilidad declarativa `paginate()` inyectada en los loaders para segmentar colecciones masivas de registros en múltiples páginas (`/articulos`, `/articulos/2`).
  - Omisión canónica de `/1` para la primera página cumpliendo los estándares de SEO.
  - Generación automática del objeto de navegación `props.page` (`data`, `currentPage`, `lastPage`, `url.prev`, `url.next`).
- [x] **Experiencia de Desarrollo en DevServer:**
  - Resolución al vuelo de rutas dinámicas con live-reload.
  - Página 404 interactiva asistida con listado y enlaces a todas las rutas disponibles del proyecto.

---

## 🎨 Fase 2: Optimización de Assets, Object Storage Remoto y SEO (v0.3.0)

Esta fase dota a Buntic de gestión profesional de medios multimedia, integración con almacenamiento en la nube y utilidades esenciales para motores de búsqueda.

- [x] **Pipeline de Imágenes Híbrido (Local y Remoto):**
  - Compresión y generación automática a formato `WebP` a velocidad C++ con la clase nativa `Bun.Image`.
  - Etiqueta declarativa `<photo>` sin colisiones con estándares web (SVG/HTML5), transformada automáticamente al estándar `<img>`.
  - Detección automática de dimensiones físicas originales (`width` y `height`) para prevenir saltos de maquetación (anti-CLS).
  - Generación automática de `srcset` multi-resolución y atributo `sizes` cuando se especifican `widths="..."`, evitando sobreescalados más allá del tamaño original.
  - Carga diferida (`loading="lazy"`) y decodificación asíncrona (`decoding="async"`) por defecto.
- [x] **Integración con Servidores de Objetos Remotos (Amazon S3, Cloudflare R2, MinIO, GCS y OCI Registry):**
  - Carpeta dedicada `storage/` para interactuar con servidores de blobs y archivos binarios mediante `Bun.S3Client` nativo sin librerías externas de npm.
  - **Soporte Nativo para OCI Registry y ORAS:** Cliente integrado de cero dependencias (`OrasClient` y helper `createOrasStorage`) para almacenar, versionar y recuperar archivos binarios directamente desde cualquier Docker Registry v2/v3 u OCI Distribution con soporte de autenticación automática Basic/Bearer.
  - **Versionado por Tags OCI:** Mapeo directo de claves con tag (`product/1/portrait` &rarr; `:latest`, `product/1/portrait:2020` &rarr; `:2020`) con deduplicación y caché inmutable indexado por digest SHA-256 (`artifact.digest`).
  - Detección e inferencia automática del loader por defecto cuando existe un único archivo en `storage/`.
  - **Caché Persistente Inmutable por ETag:** Almacenamiento local en `.buntic/cache/images/` indexado por hash SHA-256 `(namespace + key + etag + ancho + webp)`, evitando re-descargas y re-compresiones innecesarias en builds locales y CI/CD.
  - Opción `--clean-cache` en `buntic build` / `dev` y comando `buntic clean` para purgar `dist/` y el caché persistente.
  - **Demostración Autocontenida con Podman (`examples/catalog`):** Orquestación automatizada de contenedores temporales (`buntic-demo-*`) para PostgreSQL, Redis, OCI Registry y S3 con Web Components anidados y Declarative Shadow DOM.
- [x] **Generadores SEO out-of-the-box:**
  - Generación automática de `sitemap.xml` dinámico incorporando todas las rutas estáticas y dinámicas resueltas por SQL, JSON o loaders.
  - Generación de `robots.txt` configurable, respetando archivos manuales en `public/robots.txt`.
  - Componente declarativo `<seo>` en layouts y páginas con cascada jerárquica (`Config -> Layout -> Page`).
  - Soporte para retorno de `seo` en loaders dinámicos (`.data.ts`) a nivel raíz sin contaminar `props`.
  - Inyección automática de `og:title`, `og:description`, `og:url`, `link[rel="canonical"]` y Twitter Cards (`summary_large_image`).
  - Procesamiento automático de imágenes sociales remotas de `storage/` redimensionadas a formato social card (1200x630 WebP) con URL pública absoluta.
  - Generación de feeds RSS 2.0 (`rss.xml`) y Atom 1.0 (`atom.xml`) ordenados cronológicamente a partir de rutas con propiedad `feed`.

---

## 🧩 Fase 3: Ecosistema, Extensibilidad y Contenido Markdown (v0.4.0 / v1.0.0)

Consolidación de la plataforma para su adopción a gran escala, extensibilidad modular y facilidad de autoría de contenido.

- [ ] **Sistema de Plugins y Lifecycle Hooks:**
  - Ganchos configurables en `buntic.config.ts`: `beforeBuild`, `afterBuild`, `onTransformHtml`, `onPageRender`.
  - API de plugins para transformar código, procesar assets adicionales o integrarse con servicios de analíticas.
- [ ] **Soporte Nativo para Markdown / Frontmatter:**
  - Renderizado automático de archivos `.md` en `pages/`.
  - Extracción de metadatos YAML de frontmatter hacia las variables del layout.
  - Layouts por defecto configurables para artículos o documentación técnica.
- [ ] **Compilación a Binario Único (`bun build --compile`):**
  - Capacidad de compilar tanto el CLI como sitios generados en un solo binario autocontenido y ejecutable sin requerir Bun instalado en la máquina destino.
- [x] **Compilación de Paquete npm y Scaffolding CLI (`buntic init`):**
  - Empaquetado compilado en `dist/` (`index.js`, `cli.js` y declaraciones `.d.ts`) manteniendo cero dependencias de producción.
  - Comando `buntic init [dir]` con plantillas `blank` (por defecto) y `simple`, sin `package.json`, instalación automática de skills en `.agents/skills/buntic/` y soporte TypeScript sin `node_modules` vía `.buntic/types/` + resolver global `Bun.plugin`.
- [ ] **Publicación en JSR y Scaffolding Interactivo:**
  - Publicación adicional en JSR y asistente interactivo `bun create buntic`.
