# 🗄️ Loaders de Almacenamiento Remoto (`storage/`)

Bustatic proporciona una arquitectura dedicada para interactuar con servidores de almacenamiento de objetos (Amazon S3, Cloudflare R2, MinIO, Google Cloud Storage, CDNs) a través del runtime nativo de Bun, **sin requerir `@aws-sdk/client-s3` ni librerías externas de npm**.

---

## 📁 La carpeta `storage/`

Mientras que `data/` se encarga de información estructurada (bases de datos SQLite, PostgreSQL, JSON), la carpeta `storage/` gestiona **archivos binarios y recursos multimedia**.

Cada archivo en `storage/*.ts` o `storage/*.js` representa un proveedor de almacenamiento.

### Ejemplo: Loader con `Bun.S3Client`

Crea el archivo `storage/s3.ts`:

```ts
// storage/s3.ts
import { S3Client } from "bun";

const s3 = new S3Client({
  bucket: process.env.S3_BUCKET || "mi-bucket",
  endpoint: process.env.S3_ENDPOINT, // Opcional: url de Cloudflare R2 o MinIO
  accessKeyId: process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET_KEY,
});

export default async function getAsset(key: string) {
  const file = s3.file(key);
  const stat = await s3.stat(key); // Obtiene metadatos incluyendo el ETag nativamente

  return {
    bytes: await file.bytes(),
    etag: stat.etag,
    contentType: stat.type,
  };
}
```

---

### Ejemplo: Loader OCI Registry / ORAS (`createOrasStorage`)

Bustatic incluye soporte de primer nivel para servidores **Docker Registry v2/v3** y **OCI Distribution** (como `registry:latest`, `ghcr.io`, o `docker.io`) como alternativa ligera y versionada sin la complejidad ni la sobrecarga de S3:

Crea el archivo `storage/oci.ts`:

```ts
// storage/oci.ts
import { createOrasStorage } from "bustatic";

export default createOrasStorage({
  hostname: process.env.OCI_REGISTRY_HOST || "localhost:5000",
  insecure: true, // true para HTTP local, false para HTTPS en producción
  defaultTag: "latest",
});
```

#### Versionado por Tags OCI en Plantillas
Al referenciar imágenes en `<photo>` o `<seo>`, puedes especificar o no el tag:

- `<photo key="product/1/portrait" />`: se resuelve automáticamente a `product/1/portrait:latest`.
- `<photo key="product/1/portrait:2020" />`: se resuelve a la edición clásica `product/1/portrait:2020`.
- El `digest` SHA-256 inmutable de cada blob se mapea automáticamente como `etag`, garantizando que Bustatic solo descargue y comprima a WebP cuando la imagen en el Registry realmente cambie.

---

## 🔄 Tipos de Retorno Soportados

La función por defecto de tu loader puede devolver cualquiera de las siguientes opciones:

1. **Objeto con metadatos (Recomendado):**
   ```ts
   return {
     bytes: Uint8Array | ArrayBuffer,
     etag?: string,        // Clave para evitar reprocesar si la imagen no cambió
     contentType?: string  // Ej: "image/png"
   };
   ```
2. **Objeto `BunFile`:**
   ```ts
   return s3.file(key);
   ```
3. **Objeto `Response` (para APIs REST o fetch remotos):**
   ```ts
   return fetch(`https://mi-cdn.com/assets/${key}`);
   ```
4. **Buffer crudo:**
   ```ts
   return new Uint8Array(...);
   ```

---

## ⚡ Inferencia Automática de Storage

* **1 Solo Loader:** Si tu proyecto solo tiene un loader (por ejemplo `storage/s3.ts`), Bustatic lo asigna como el proveedor por defecto. En tus etiquetas `<photo>` o metadatos `<seo>`, puedes omitir el atributo `storage`:
  ```html
  <photo key="banners/promo.png" alt="Promo" />
  ```
* **Múltiples Loaders:** Si tienes varios (por ejemplo `storage/s3.ts` y `storage/r2.ts`):
  - Puedes definir el proveedor principal en `bustatic.config.ts`:
    ```ts
    export default defineConfig({
      defaultStorage: "s3"
    });
    ```
  - O especificar el storage directamente en el elemento:
    ```html
    <photo storage="r2" key="video-thumb.jpg" alt="Video" />
    ```

---

## 🛡️ Verificación de Inmutabilidad por ETag

Cuando Bustatic procesa una imagen remota:
1. El loader consulta el recurso y retorna su `etag`.
2. Bustatic compara ese `etag` con la entrada correspondiente en `.bustatic/cache/images/`.
3. Si el ETag coincide, **se salta la compresión y decodificación**, utilizando la versión WebP ya almacenada en disco.
4. Si el asset fue reemplazado en el bucket S3 (su ETag cambió), Bustatic recompila la nueva versión automáticamente.
