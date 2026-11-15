import { useWindowChrome } from "../../context";

export function WindowControlsInset() {
	const { rightInset } = useWindowChrome();
	return (
		<div
			data-native-right-inset
			className="drag h-full shrink-0"
			style={{ width: rightInset }}
		/>
	);
}
