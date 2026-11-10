# 🖼️ Optimización de Assets e Imágenes (<photo>)

Bustatic incluye un motor de optimización de imágenes nativo de alto rendimiento impulsado por la API nativa de C++ de Bun (`Bun.Image`). Permite comprimir imágenes a **WebP**, inyectar dimensiones automáticas para evitar saltos de maquetación (Cumulative Layout Shift - CLS) y generar variantes responsivas con `srcset` y `sizes`.

---

## 🏷️ La etiqueta `<photo>`

Para optimizar imágenes dentro de tus plantillas HTML, Bustatic introduce la etiqueta declarativa `<photo>`. Esta etiqueta evita cualquier colisión con estándares HTML5 o SVG y, durante la compilación, se transforma automáticamente en un elemento estándar `<img>`.

### 1. Uso Básico con Imagen Local

```html
<photo src="./foto.png" alt="Mi foto de perfil" class="avatar" />
```

**Resultado HTML compilado:**
```html
<img src="/assets/images/8a2f1c...webp" width="800" height="600" loading="lazy" decoding="async" alt="Mi foto de perfil" class="avatar">
```

### Características Automáticas:
1. **Compresión WebP:** La imagen fuente (`.png`, `.jpg`, `.jpeg`) se convierte a formato WebP optimizado.
2. **Dimensiones Anti-CLS (`width` y `height`):** Bustatic inspecciona los metadatos de la imagen original en memoria y auto-inyecta los atributos `width` y `height` para que el navegador reserve el espacio exacto antes de que la imagen termine de cargar.
3. **Carga Perezosa:** Se añaden automáticamente `loading="lazy"` y `decoding="async"`. Si necesitas que la imagen cargue inmediatamente (por ejemplo, el banner principal o "hero"), especifica `loading="eager"`.
4. **Atributos Preservados:** Cualquier atributo estándar como `class`, `style`, `id` o `data-*` se preserva intacto en el `<img>` resultante.

---

## 📐 Imágenes Responsivas con `widths` y `sizes`

Para servir versiones ligeras a teléfonos móviles y versiones nítidas a pantallas de alta resolución (Retina 2x/4K), utiliza el atributo `widths`:

```html
<photo 
  src="/images/hero-banner.jpg" 
  widths="400,800,1200" 
  sizes="(min-width: 768px) 50vw, 100vw" 
  alt="Banner Principal" 
/>
```

### ¿Qué hace Bustatic?
* Genera 3 archivos WebP escalados proporcionalmente respetando la relación de aspecto original (a 400px, 800px y 1200px de ancho).
* **Prevención de sobreescalado:** Si la imagen original mide 800px de ancho, Bustatic omitirá anchos mayores (como 1200) para no pixelar la imagen.
* Construye automáticamente el atributo `srcset` con descriptores de ancho (`w`):
  ```html
  <img 
    src="/assets/images/variant-1200.webp"
    srcset="/assets/images/variant-400.webp 400w, /assets/images/variant-800.webp 800w, /assets/images/variant-1200.webp 1200w"
    sizes="(min-width: 768px) 50vw, 100vw"
    width="1200"
    height="675"
    loading="lazy"
    decoding="async"
    alt="Banner Principal">
  ```

---

## ☁️ Imágenes Remotas desde Servidores de Objetos (S3 / R2 / MinIO)

Si tu proyecto consume imágenes alojadas en un bucket S3, Cloudflare R2 o MinIO a través de los [Storage Loaders](./storage-loaders.md), utiliza el atributo `key`:

```html
<!-- Si solo tienes un loader en storage/, se usa automáticamente -->
<photo key="productos/zapatilla-pro.jpg" alt="Zapatilla Pro" widths="300,600" />

<!-- Con datos dinámicos dentro de un loop <each> -->
<photo key="{{ producto.coverImageKey }}" alt="{{ producto.nombre }}" />

<!-- Si tienes múltiples loaders, especifica el storage deseado -->
<photo storage="r2" key="media/video-cover.png" alt="Portada de video" />
```

---

## 💾 Caché Persistente e Inmutable (`.bustatic/cache/images`)

La optimización de imágenes no debe ralentizar tus compilaciones ni re-descargar archivos remotos:

* Todas las imágenes optimizadas se guardan en el directorio `.bustatic/cache/images/` dentro de tu proyecto.
* **Hashes Inmutables:**
  - Para imágenes locales: el hash depende del archivo, su fecha de modificación (`mtime`) y dimensiones.
  - Para imágenes remotas: el hash depende de la `key`, el `ETag` reportado por el servidor remoto y las dimensiones.
* Si un archivo no ha cambiado, Bustatic lo reutiliza instantáneamente en **0 ms**.

### Limpieza de Caché
Puedes forzar la regeneración completa de imágenes con:
```bash
# Limpiar el caché antes de compilar
bustatic build --clean-cache

# O limpiar dist/ y .bustatic/cache/ por completo
bustatic clean
```
