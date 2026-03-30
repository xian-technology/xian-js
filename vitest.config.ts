import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@xian-tech/client": new URL("./packages/client/src/index.ts", import.meta.url).pathname,
      "@xian-tech/provider": new URL("./packages/provider/src/index.ts", import.meta.url).pathname
    }
  },
  test: {
    include: [
      "packages/*/tests/**/*.test.ts",
      "examples/*/src/**/*.test.ts"
    ]
  }
});
