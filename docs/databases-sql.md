# 🗄️ Motores SQL Nativos (`bun:sqlite` y `Bun.sql`)

Buntic permite alimentar páginas estáticas y colecciones dinámicas directamente desde bases de datos locales o remotas a velocidad C++ nativa, **sin instalar clientes NPM pesados de terceros** (como `pg`, `better-sqlite3`, `knex` o `prisma`).

---

## ⚡ 1. SQLite Nativo con `bun:sqlite`

Bun incluye SQLite de forma embebida en su núcleo de C++. Puedes consultar bases de datos SQLite locales de forma instantánea dentro de tus loaders globales (`data/*.ts`) o locales (`pages/**/*.data.ts`).

### Ejemplo: Catálogo de Productos desde SQLite

```ts
// pages/productos/[slug].data.ts
import { Database } from "bun:sqlite";

export default async function() {
  // Conexión directa al archivo SQLite local
  const db = new Database("tienda.db");

  // Preparación y ejecución de la consulta a velocidad de compilación
  const query = db.query("SELECT id, slug, nombre, precio, stock FROM productos WHERE activo = 1");
  const productos = query.all();

  // Cerrar la base de datos al finalizar
  db.close();

  return productos.map((prod) => ({
    params: {
      slug: prod.slug,
    },
    props: {
      producto: prod,
    },
    seo: {
      title: `${prod.nombre} - Catálogo`,
      description: `Comprar ${prod.nombre} al mejor precio.`,
    }
  }));
}
```

### Bases de Datos en Memoria para Pruebas
Puedes inicializar bases de datos portables para testing usando `:memory:`:
```ts
const db = new Database(":memory:");
db.run("CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT)");
db.run("INSERT INTO usuarios (nombre) VALUES (?)", ["Alicia"]);
```

---

## 🐘 2. PostgreSQL Remoto con `Bun.sql`

Para proyectos empresariales que consumen datos de servidores PostgreSQL centrales (AWS RDS, Supabase, Neon, servidores locales), Buntic aprovecha el driver nativo de Bun implementado en C++ (`Bun.sql`):

### Ejemplo: Blog Corporativo desde PostgreSQL

```ts
// pages/blog/[slug].data.ts
import { SQL } from "bun";

// Inicializar conexión nativa sin paquetes de npm
const sql = new SQL(process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/miblog");

export default async function() {
  // Consultas seguras contra inyecciones SQL mediante Tagged Template Literals
  const articulos = await sql`
    SELECT 
      slug, 
      titulo, 
      cuerpo, 
      fecha_publicacion,
      portada_key
    FROM articulos 
    WHERE publicado = true 
    ORDER BY fecha_publicacion DESC
  `;

  return articulos.map((art) => ({
    params: {
      slug: art.slug,
    },
    props: {
      articulo: art,
    },
    seo: {
      title: art.titulo,
      image: { key: art.portada_key }
    },
    feed: {
      title: art.titulo,
      date: art.fecha_publicacion,
    }
  }));
}
```

---

## 🔴 3. Servidores Redis Nativos con `Bun.redis`

Para recuperar datos estructurados o catálogos en memoria desde servidores Redis, Buntic aprovecha el cliente nativo de Bun:

### Ejemplo: Carga de Catálogo desde Redis

```ts
// data/products.ts
import { RedisClient } from "bun";

export default async function() {
  const redis = new RedisClient(process.env.REDIS_URL || "redis://localhost:6379");
  try {
    const raw = await redis.get("catalog:products");
    return raw ? JSON.parse(raw) : [];
  } finally {
    redis.close();
  }
}
```

---

## 🎯 Ventajas de Rendimiento

1. **Cero Latencia en Producción:** Toda la interacción SQL ocurre **durante el comando `buntic build`**. El sitio estático final generado en `dist/` se compone únicamente de archivos HTML, CSS y WebP pre-renderizados servidos instantáneamente desde un CDN o servidor HTTP.
2. **Cero Fugas de Credenciales:** La cadena de conexión a la base de datos y las credenciales solo existen durante la compilación en tu máquina o pipeline de CI/CD. Jamás se exponen al cliente.
3. **Mantenimiento Cero:** No tienes dependencias nativas de node-gyp ni problemas de compatibilidad entre arquitecturas (x86_64 vs arm64).
