export interface DesktopBridgeInfo {
	endpoint: string;
	secret: string;
}
let bridgeInfo: DesktopBridgeInfo | null = null;
export function getDesktopBridgeInfo(): DesktopBridgeInfo | null {
	return bridgeInfo;
}
export function setDesktopBridgeInfo(info: DesktopBridgeInfo | null): void {
	bridgeInfo = info;
}
