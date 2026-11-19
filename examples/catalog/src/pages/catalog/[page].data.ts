export default async function({ data, paginate }: { data: any; paginate: any }) {
  const products = data.products || [];
  return paginate(products, {
    pageSize: 3,
    seo: {
      title: "Catálogo de Productos | Bustatic",
      description: "Explora la colección completa de productos con imágenes optimizadas WebP.",
    },
  });
}
