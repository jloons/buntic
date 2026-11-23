# Referencia del CLI de Buntic

La interfaz de línea de comandos de Buntic permite inicializar proyectos sin `package.json`, levantar servidores de desarrollo, compilar sitios estáticos de forma instantánea y gestionar la caché de assets.

---

## Detección Automática de la Raíz del Proyecto

Buntic incluye un mecanismo inteligente de **búsqueda ascendente (*upward discovery*)** que **no requiere `package.json`**:
- Si ejecutas `buntic dev`, `buntic build` o `buntic clean` dentro de cualquier subcarpeta de tu proyecto (por ejemplo en `src/pages/blog/` o `src/components/`), el CLI busca hacia arriba hasta encontrar la carpeta raíz que contiene `src/pages/`, `pages/` o un archivo de configuración (`buntic.config.*`).
- Si pasas un directorio explícito (ej. `buntic dev ./mi-sitio`), Buntic usará directamente ese directorio.
- Si el proyecto no tiene `node_modules/buntic`, el CLI resuelve automáticamente los imports `from "buntic"` hacia la instalación global y sincroniza las definiciones de tipos en `.buntic/types/`.
- Si ejecutas el comando en un directorio que no pertenece a un proyecto Buntic, recibirás un mensaje de error claro y accionable con los pasos para solucionarlo.

---

## Sintaxis General

```bash
buntic <comando> [directorio] [opciones]
```

---

## Comandos

### `buntic init [directorio]`
Inicializa un nuevo proyecto Buntic sin `package.json` ni `node_modules`, generando `buntic.config.ts`, `tsconfig.json`, `.gitignore`, `.buntic/types/` y copiando la skill oficial en `.agents/skills/buntic/`.

**Opciones:**
- `-t, --template <nombre>`: Plantilla a utilizar: `blank` (por defecto) o `simple`.
- `--no-skills`: Omite la copia de las skills de Buntic en `.agents/skills/buntic/`.
- `-f, --force`: Permite inicializar aunque el directorio de destino no esté vacío.

**Ejemplos:**
```bash
buntic init mi-sitio
buntic init mi-sitio --template simple
buntic init . --force
buntic init mi-sitio --no-skills
```

---

### `buntic dev [directorio]`
Inicia un servidor de desarrollo local con Live-Reload nativo (WebSockets + File Watcher) y procesamiento de imágenes y metadatos SEO al vuelo.

**Opciones:**
- `-p, --port <puerto>`: Especifica el puerto HTTP (por defecto `3000`).
- `--clean-cache`: Limpia el directorio de caché persistente `.buntic/cache/` antes de iniciar el servidor.

**Ejemplos:**
```bash
buntic dev
buntic dev ./mi-sitio --port 8080
buntic dev --clean-cache
```

---

### `buntic build [directorio]`
Compila el sitio estático para producción, optimiza imágenes a WebP, genera metadatos sociales, `sitemap.xml`, `robots.txt` y feeds RSS/Atom en la carpeta de salida.

**Opciones:**
- `-o, --outdir <directorio>`: Especifica la carpeta de destino (por defecto `dist`).
- `--clean-cache`: Purgar el caché de imágenes persistente antes de construir.

**Ejemplos:**
```bash
buntic build
buntic build ./mi-sitio --outdir ./public_html
buntic build --clean-cache
```

---

### `buntic clean [directorio]`
Elimina la carpeta de distribución (`dist/`) y el directorio de caché persistente de imágenes (`.buntic/cache/images/`).

**Ejemplos:**
```bash
buntic clean
buntic clean ./mi-sitio
```

---

### `buntic help`
Muestra el mensaje de ayuda y las opciones disponibles.

---

### `buntic --version` / `-v`
Muestra la versión instalada de Buntic.
