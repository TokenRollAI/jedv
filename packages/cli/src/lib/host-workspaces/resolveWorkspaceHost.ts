import { getHostId } from "@jedv/shared/host-info";
import {
	type HostFlags,
	resolveHostFilter,
} from "../host-target/resolveHostFlags";

export async function resolveWorkspaceHost(flags: HostFlags): Promise<string> {
	return resolveHostFilter(flags) ?? getHostId();
}
