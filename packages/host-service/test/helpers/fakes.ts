import {
	localCredentialRemedy,
	type TokenSource,
} from "../../src/providers/git/LocalGitCredentialProvider/credential-remedy";
import type {
	CredentialProblem,
	GitCredentialProvider,
} from "../../src/runtime/git/types";

export class MemoryGitCredentialProvider implements GitCredentialProvider {
	constructor(
		private readonly token: string | null = null,
		private readonly tokenSource: TokenSource | null = null,
	) {}
	async getCredentials(): Promise<{ env: Record<string, string> }> {
		return { env: {} };
	}
	async getToken(): Promise<string | null> {
		return this.token;
	}
	credentialRemedy(_host: string, problem: CredentialProblem): string {
		return localCredentialRemedy(problem, this.tokenSource);
	}
}
