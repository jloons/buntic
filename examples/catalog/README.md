# 🛍️ Bustatic Showcase Catalog

> Ejemplo autocontenido de demostración para **Bustatic** con soporte para pruebas de integración contra servicios externos (**OCI Registry**, **PostgreSQL**, **Redis**, **S3**) ejecutados con **Podman** en Linux ARM64 / x86_64, o en modo local sin requerir contenedores.

---

## ✨ Características Demostradas

1. **Gestión de Assets en OCI Registry y S3 (`storage/`):**
   - Integración nativa con **Docker Registry / OCI Distribution** usando `OrasClient` y `createOrasStorage()`.
   - **Versionado por tags en OCI**: resolución automática de claves con tag (`product/1/portrait` &rarr; `:latest`, `product/1/portrait:2020` &rarr; `:2020`).
   - Caché inmutable persistente indexado por digest SHA-256 (`etag: artifact.digest`).
   - Compatibilidad completa con **S3** (`Bun.S3Client` y `local-s3`).
2. **Motores de Datos Nativos (`data/`):**
   - **PostgreSQL** mediante `Bun.sql` / `new Bun.SQL(...)` sin paquetes npm.
   - **Redis** mediante `Bun.redis` / `new Bun.RedisClient(...)` sin dependencias externas.
   - Modo **Local** mediante `fixtures/catalog.json`.
3. **Web Components Nativos y Declarative Shadow DOM (DSD):**
   - Tríada co-ubicada `.ts` + `.html` + `.css` para `<tag-badge>`.
   - **Anidación recursiva**: `<version-viewer>` contiene internamente múltiples instancias de `<tag-badge>` dentro de su plantilla Declarative Shadow DOM, renderizadas en servidor sin FOUC.
4. **Arquitectura de Estilos Desacoplada:**
   - Paleta de colores centralizada exclusivamente en `src/styles/colors.css` usando variables CSS (`--color-*`).
   - Cero colores hardcodeados en `main.css`, componentes y estilos scoped: todos heredan `var(--color-*)`.
5. **SEO y Generación Estática Completa:**
   - Rutas dinámicas (`/products/[slug]`) y paginación automática (`/catalog`, `/catalog/2`).
   - Inyección de metadatos `<seo>`, tarjetas OpenGraph automáticas, `sitemap.xml` y `robots.txt`.

---

## 🚀 Modos de Ejecución

### 1. Modo Local (Cero Contenedores)
Funciona directamente con las fixtures incluidas sin necesidad de levantar ningún servicio:

```bash
# Compilar el sitio estático
bun run build

# Iniciar servidor de desarrollo con live-reload
bun run dev
```

---

### 2. Demostración con Podman: PostgreSQL + OCI Registry
Levanta contenedores temporales `bustatic-demo-postgres` y `bustatic-demo-registry`, ejecuta el script de seed, compila el sitio y valida los resultados:

```bash
bun run demo:oci
```

---

### 3. Demostración con Podman: Redis + S3 (local-s3)
Levanta contenedores temporales `bustatic-demo-redis` y `bustatic-demo-s3`, ejecuta el seed y compila el sitio:

```bash
bun run demo:s3
```

---

### 4. Mantener Contenedores para Desarrollo
Si deseas dejar los contenedores activos para explorar el catálogo en modo `dev`:

```bash
# Levantar y sembrar sin eliminarlos
bun scripts/demo.ts run --data postgres --storage oci --keep

# Iniciar servidor de desarrollo en http://localhost:3334
DATA_BACKEND=postgres STORAGE_BACKEND=oci bun run dev

# Al terminar, limpiar todos los contenedores
bun run demo:clean
```

---

## 📁 Estructura del Proyecto

```text
examples/catalog/
├── bustatic.config.ts          # Configuración del sitio y proveedor de storage
├── package.json                # Scripts npm/bun
├── fixtures/                   # Datos de prueba autocontenidos
│   ├── catalog.json            # Catálogo de 6 productos
│   └── images/                 # Imágenes PNG reales en resolución 1200x800
│       └── product/{1..6}/portrait/
│           ├── latest.png
│           └── 2020.png        # Edición clásica en productos 1 y 2
├── scripts/
│   ├── seed.ts                 # Puebla BD (Postgres/Redis) y Storage (OCI/S3)
│   └── demo.ts                 # Orquestador Podman (up, seed, build, verify, down)
└── src/
    ├── data/
    │   └── products.ts         # Loader global con selector DATA_BACKEND
    ├── storage/
    │   ├── local.ts            # Loader filesystem local (fixtures/images/)
    │   ├── oci.ts              # Loader OCI Registry con createOrasStorage()
    │   └── s3.ts               # Loader S3 con Bun.S3Client
    ├── components/
    │   ├── tag-badge.ts        # Web Component: Badge de tag/versión
    │   ├── tag-badge.html      # Estructura DSD de tag-badge
    │   ├── tag-badge.css       # Estilos encapsulados de tag-badge (var(--color-*))
    │   ├── version-viewer.ts   # Web Component Padre: Comparador interactivo
    │   ├── version-viewer.html # DSD de version-viewer (anida <tag-badge>)
    │   ├── version-viewer.css  # Estilos encapsulados de version-viewer
    │   ├── header.html (+.css) # Encabezado global con navegación
    │   ├── footer.html (+.css) # Pie de página
    │   └── product-card.html   # Tarjeta con <photo> y <tag-badge>
    ├── layouts/
    │   └── main.html           # Layout base HTML5
    ├── styles/
    │   ├── colors.css          # Único archivo con definición de colores en :root
    │   └── main.css            # Estilos estructurales y responsivos globales
    └── pages/
        ├── index.html          # Portada con destacados (/index.html)
        ├── catalog/[page].html # Listado paginado (/catalog y /catalog/2)
        └── products/[slug].html# Ficha con comparador <version-viewer>
```
