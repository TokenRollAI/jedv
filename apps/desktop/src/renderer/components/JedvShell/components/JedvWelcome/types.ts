import type {
	ProjectActionContext,
	ProjectActionKind,
} from "../JedvProjectActions";
export interface WelcomeImportResult {
	context: ProjectActionContext;
	projectId: string | null;
	workspaceIds: string[];
}
export interface JedvWelcomeProps {
	context: ProjectActionContext | null;
	onComplete(): Promise<void>;
	onOpenProject(kind: ProjectActionKind, path?: string): void;
	onImported?(result: WelcomeImportResult): Promise<void>;
}
