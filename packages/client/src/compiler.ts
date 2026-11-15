import { DEFAULT_VM_PROFILE } from "./numeric.js";
import { TransactionError } from "./errors.js";
import type {
  ContractDeploymentArtifacts,
  XianContractCompiler
} from "./types.js";

interface CompileContractArtifactsOptions {
  moduleName: string;
  source: string;
  compiler?: XianContractCompiler;
  vmProfile?: string;
}

interface XianCompilerModule extends XianContractCompiler {}

const DEFAULT_COMPILER_MODULE = "@xian-tech/compiler";

function compilerOptionsJson(vmProfile: string): string {
  return JSON.stringify({ vm_profile: vmProfile });
}

async function loadDefaultCompiler(): Promise<XianCompilerModule> {
  try {
    return (await import(
      /* @vite-ignore */ DEFAULT_COMPILER_MODULE
    )) as XianCompilerModule;
  } catch (error) {
    throw new TransactionError(
      "compileContractArtifacts requires @xian-tech/compiler or an injected compiler",
      { cause: error }
    );
  }
}

function parseArtifactJson(value: string): ContractDeploymentArtifacts {
  try {
    return JSON.parse(value) as ContractDeploymentArtifacts;
  } catch (error) {
    throw new TransactionError("compiler returned invalid artifact JSON", {
      cause: error
    });
  }
}

export async function compileContractArtifacts(
  options: CompileContractArtifactsOptions
): Promise<ContractDeploymentArtifacts> {
  const compiler = options.compiler ?? (await loadDefaultCompiler());
  const vmProfile = options.vmProfile ?? DEFAULT_VM_PROFILE;

  if (typeof compiler.compileContractArtifact === "function") {
    return compiler.compileContractArtifact(options.moduleName, options.source, {
      vmProfile
    });
  }

  if (typeof compiler.compileContractArtifactJson === "function") {
    const artifactJson = await compiler.compileContractArtifactJson(
      options.moduleName,
      options.source,
      compilerOptionsJson(vmProfile)
    );
    return parseArtifactJson(artifactJson);
  }

  throw new TransactionError(
    "compiler must expose compileContractArtifact or compileContractArtifactJson"
  );
}
