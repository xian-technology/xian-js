import { TransactionError } from "./errors.js";
import type {
  ContractDeploymentArtifacts,
  XianContractCompiler
} from "./types.js";

interface CompileContractArtifactsOptions {
  moduleName: string;
  source: string;
  compiler?: XianContractCompiler;
  lint?: boolean;
  vmProfile?: string;
}

interface XianCompilerModule extends XianContractCompiler {}

const DEFAULT_VM_PROFILE = "xian_vm_v1";
const DEFAULT_COMPILER_MODULE = "@xian-tech/compiler";

function compilerOptionsJson(vmProfile: string, lint: boolean): string {
  return JSON.stringify({ lint, vm_profile: vmProfile });
}

async function loadDefaultCompiler(): Promise<XianCompilerModule> {
  try {
    return (await import(
      /* @vite-ignore */ DEFAULT_COMPILER_MODULE
    )) as XianCompilerModule;
  } catch (error) {
    throw new TransactionError(
      "deployContract requires @xian-tech/compiler or an injected compiler",
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
  const lint = options.lint ?? true;

  if (typeof compiler.compileContractArtifact === "function") {
    return compiler.compileContractArtifact(options.moduleName, options.source, {
      lint,
      vmProfile
    });
  }

  if (typeof compiler.compileContractArtifactJson === "function") {
    const artifactJson = await compiler.compileContractArtifactJson(
      options.moduleName,
      options.source,
      compilerOptionsJson(vmProfile, lint)
    );
    return parseArtifactJson(artifactJson);
  }

  throw new TransactionError(
    "compiler must expose compileContractArtifact or compileContractArtifactJson"
  );
}
