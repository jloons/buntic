export default async function({ data }: { data: any }) {
  const products = data.products || [];
  const featured = products.filter((p: any) => p.featured);
  return {
    props: {
      featured,
    },
    seo: {
      title: "Inicio | Bustatic Catalog",
      description: "Catálogo de demostración integrado con OCI Registry, S3, PostgreSQL y Redis",
    },
  };
}
