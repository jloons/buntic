export interface BustaticConfig {
  root?: string;
  pagesDir?: string;
  layoutsDir?: string;
  componentsDir?: string;
  dataDir?: string;
  publicDir?: string;
  outDir?: string;
  port?: number;
  minify?: boolean;
  cssStrategy?: "inline" | "external";
}

export interface ResolvedConfig {
  root: string;
  pagesDir: string;
  layoutsDir: string;
  componentsDir: string;
  dataDir: string;
  publicDir: string;
  outDir: string;
  port: number;
  minify: boolean;
  cssStrategy: "inline" | "external";
}

export interface PageInfo {
  relativeFilePath: string; // e.g. "index.html" or "blog/post.html"
  absoluteFilePath: string;
  urlPath: string;          // e.g. "/" or "/blog/post"
  outputFilePath: string;   // e.g. "dist/index.html" or "dist/blog/post.html"
}
