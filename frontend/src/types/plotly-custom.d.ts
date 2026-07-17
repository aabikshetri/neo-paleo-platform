declare module "plotly.js/lib/core" {
  const Plotly: {
    register(modules: unknown[]): void;
  };
  export default Plotly;
}

declare module "plotly.js/lib/scatter" {
  const scatter: unknown;
  export default scatter;
}

declare module "plotly.js/lib/scatter3d" {
  const scatter3d: unknown;
  export default scatter3d;
}
