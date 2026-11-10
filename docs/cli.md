# Referencia del CLI de Bustatic

La interfaz de línea de comandos de Bustatic permite levantar servidores de desarrollo, compilar sitios estáticos de forma instantánea y gestionar la caché de assets.

---

## Detección Automática de la Raíz del Proyecto

Bustatic incluye un mecanismo inteligente de **búsqueda ascendente (*upward discovery*)**:
- Si ejecutas `bustatic dev` o `bustatic build` dentro de cualquier subcarpeta de tu proyecto (por ejemplo en `pages/blog/` o `components/`), el CLI busca hacia arriba hasta encontrar la carpeta raíz que contiene `pages/` o un archivo de configuración (`bustatic.config.*`).
- Si pasas un directorio explícito (ej. `bustatic dev ./mi-sitio`), Bustatic usará directamente ese directorio.
- Si ejecutas el comando en un directorio que no pertenece a un proyecto Bustatic, recibirás un mensaje de error claro y accionable con los pasos para solucionarlo.

---

## Sintaxis General

```bash
bustatic <comando> [directorio] [opciones]
```

---

## Comandos

### `bustatic dev [directorio]`
Inicia un servidor de desarrollo local con Live-Reload nativo (WebSockets + File Watcher) y procesamiento de imágenes y metadatos SEO al vuelo.

**Opciones:**
- `-p, --port <puerto>`: Especifica el puerto HTTP (por defecto `3000`).
- `--clean-cache`: Limpia el directorio de caché persistente `.bustatic/cache/` antes de iniciar el servidor.

**Ejemplos:**
```bash
bustatic dev
bustatic dev ./mi-sitio --port 8080
bustatic dev --clean-cache
```

---

### `bustatic build [directorio]`
Compila el sitio estático para producción, optimiza imágenes a WebP, genera metadatos sociales, sitemap.xml, robots.txt y feeds RSS/Atom en la carpeta de salida.

**Opciones:**
- `-o, --outdir <directorio>`: Especifica la carpeta de destino (por defecto `dist`).
- `--clean-cache`: Purgar el caché de imágenes persistente antes de construir.

**Ejemplos:**
```bash
bustatic build
bustatic build ./mi-sitio --outdir ./public_html
bustatic build --clean-cache
```

---

### `bustatic clean [directorio]`
Elimina la carpeta de distribución (`dist/`) y el directorio de caché persistente de imágenes (`.bustatic/cache/images/`).

**Ejemplos:**
```bash
bustatic clean
bustatic clean ./mi-sitio
```

---

### `bustatic help`
Muestra el mensaje de ayuda y las opciones disponibles.

---

### `bustatic --version` / `-v`
Muestra la versión instalada de Bustatic.
