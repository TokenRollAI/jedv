import { z } from "zod";

export type OpenApiPaths = Record<string, Record<string, unknown>>;
type Definition = readonly [
	method: "get" | "post",
	path: string,
	schema: z.ZodType,
	...rest: unknown[],
];

function queryParameters(schema: z.ZodType) {
	const input = z.toJSONSchema(schema, { io: "input" });
	const direct = Object.entries(input.properties ?? {}).flatMap(
		([name, property]) => {
			if (
				typeof property !== "object" ||
				property === null ||
				!["string", "integer", "number", "boolean"].includes(
					String(property.type),
				)
			)
				return [];
			return [
				{
					in: "query",
					name,
					// The JSON input parameter is an alternative to all direct fields.
					required: false,
					schema: property,
				},
			];
		},
	);
	return [
		...direct,
		{
			in: "query",
			name: "input",
			required: false,
			description:
				"JSON-encoded request, used instead of individual query parameters. Nested fields must use input.",
			content: { "application/json": { schema: input } },
		},
	];
}

export function createOpenApiPaths(
	definitions: readonly Definition[],
	resultDescription: string,
): OpenApiPaths {
	const paths: OpenApiPaths = {};
	for (const [method, path, schema] of definitions) {
		const key = path.replace(/:([a-zA-Z0-9_]+)/g, "{$1}");
		paths[key] ??= {};
		paths[key][method] = {
			security: [{ bearerAuth: [] }],
			...(method === "get"
				? { parameters: queryParameters(schema) }
				: {
						requestBody: {
							content: {
								"application/json": {
									schema: z.toJSONSchema(schema, { io: "input" }),
								},
							},
						},
					}),
			responses: { "200": { description: resultDescription } },
		};
	}
	return paths;
}

export function mergeOpenApiPaths(...groups: readonly OpenApiPaths[]) {
	const paths: OpenApiPaths = {};
	for (const group of groups)
		for (const [path, methods] of Object.entries(group))
			paths[path] = { ...paths[path], ...methods };
	return paths;
}
