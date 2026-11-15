export interface PrivateHostConnection {
	baseUrl: string;
	machineId: string;
}

export interface TailscaleStatus {
	installed: boolean;
	state: string;
	dnsName: string | null;
	addresses: string[];
	health: string[];
}
