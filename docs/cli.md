# Referencia del CLI de Bustatic

La interfaz de línea de comandos de Bustatic permite levantar servidores de desarrollo y compilar sitios estáticos de forma instantánea.

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
Inicia un servidor de desarrollo local con Live-Reload nativo (WebSockets + File Watcher).

**Opciones:**
- `-p, --port <puerto>`: Especifica el puerto HTTP (por defecto `3000`).

**Ejemplos:**
```bash
bustatic dev
bustatic dev ./mi-sitio --port 8080
```

---

### `bustatic build [directorio]`
Compila el sitio estático para producción y genera todos los archivos en la carpeta de salida.

**Opciones:**
- `-o, --outdir <directorio>`: Especifica la carpeta de destino (por defecto `dist`).

**Ejemplos:**
```bash
bustatic build
bustatic build ./mi-sitio --outdir ./public_html
```

---

### `bustatic help`
Muestra el mensaje de ayuda y las opciones disponibles.

---

### `bustatic --version` / `-v`
Muestra la versión instalada de Bustatic.
