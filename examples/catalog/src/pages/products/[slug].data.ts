export default async function({ data }: { data: any }) {
  const products = data.products || [];
  return products.map((product: any) => ({
    params: { slug: product.slug },
    props: { product },
    seo: {
      title: `${product.name} | Buntic Catalog`,
      description: product.summary,
      image: { key: product.imageKey, alt: product.alt },
    },
  }));
}
