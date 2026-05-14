declare module "@xian-tech/compiler" {
  export function compileContractArtifactJson(
    moduleName: string,
    source: string,
    optionsJson?: string
  ): string;
}
