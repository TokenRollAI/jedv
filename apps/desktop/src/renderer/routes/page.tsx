import { createFileRoute } from "@tanstack/react-router";
import { JedvShell } from "renderer/components/JedvShell";

export const Route = createFileRoute("/")({
	component: JedvShell,
});
