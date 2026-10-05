// React 19 reads JSX types from React.JSX; @shopify/app-bridge-types only augments the global JSX
// namespace. Map the App Bridge element we use across (s-app-nav). Remove once app-bridge-types
// supports React 19's JSX namespace.
export {};

type AppNavProps = globalThis.JSX.IntrinsicElements["s-app-nav"];

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": AppNavProps;
    }
  }
}
