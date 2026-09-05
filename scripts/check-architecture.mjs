import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parse } from "@babel/parser";

function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(`${root}/${entry.name}`)
      : /\.[cm]?[jt]sx?$/u.test(entry.name)
        ? [`${root}/${entry.name}`]
        : [],
  );
}
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (node.type) visit(node);
  for (const [key, child] of Object.entries(node)) {
    if (["loc", "start", "end", "comments", "tokens"].includes(key)) continue;
    if (Array.isArray(child))
      child.forEach((value) => {
        walk(value, visit);
      });
    else if (child && typeof child === "object") walk(child, visit);
  }
}
const graph = new Map();
const errors = [];
for (const file of ["src", "shared", "worker", "evaluation", "tests", "scripts"].flatMap(files)) {
  const source = readFileSync(file, "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const edges = new Set();
  walk(ast, (node) => {
    let specifier;
    let typeOnly = false;
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)) {
      specifier = node.source?.value;
      typeOnly =
        node.importKind === "type" ||
        node.exportKind === "type" ||
        (node.specifiers?.length && node.specifiers.every((s) => s.importKind === "type" || s.exportKind === "type"));
    } else if (node.type === "ImportExpression") specifier = node.source.value;
    else if (node.type === "TSImportType") {
      specifier = node.argument.value;
      typeOnly = true;
    } else if (node.type === "CallExpression" && node.callee.type === "Import") specifier = node.arguments[0]?.value;
    if (specifier?.startsWith(".")) {
      const base = resolve(dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}/index.ts`].find((candidate) =>
        existsSync(candidate),
      );
      if (!target) {
        errors.push(`${file}: unresolved import ${specifier}`);
        return;
      }
      const dependency = relative(process.cwd(), target).replaceAll("\\", "/");
      if (/^(src|shared|worker)\//u.test(file) && /^(archive|tests|evaluation|scripts)\//u.test(dependency))
        errors.push(`${file} depends on ${dependency}`);
      if (!typeOnly) {
        edges.add(dependency);
        if (file.startsWith("shared/") && !dependency.startsWith("shared/"))
          errors.push(`${file} depends on ${dependency}`);
        if (file.startsWith("worker/platform/") && /^worker\/(features|runtime|routes)\//u.test(dependency))
          errors.push(`${file} reverses platform dependency: ${dependency}`);
        if (file.startsWith("worker/features/") && /^worker\/(runtime|routes)\//u.test(dependency))
          errors.push(`${file} depends on an execution entry: ${dependency}`);
        if (
          file.includes("/repositories/") &&
          dependency.startsWith("worker/features/") &&
          !dependency.includes("/repositories/")
        )
          errors.push(`${file} repository depends on use case: ${dependency}`);
      }
    }
    if (
      file.startsWith("worker/") &&
      !file.includes("/repositories/") &&
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.property.name === "prepare"
    )
      errors.push(`${file}: SQL outside a D1 repository`);
  });
  graph.set(file, edges);
}
const complete = new Set();
const active = [];
function visit(file) {
  if (active.includes(file)) {
    errors.push(`Runtime cycle: ${[...active.slice(active.indexOf(file)), file].join(" -> ")}`);
    return;
  }
  if (complete.has(file)) return;
  active.push(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency);
  active.pop();
  complete.add(file);
}
for (const file of graph.keys()) visit(file);
if (errors.length) throw new Error([...new Set(errors)].join("\n"));
console.log(
  `Architecture OK: ${graph.size} modules; no runtime cycles, archive dependencies, reversed boundaries, or SQL outside repositories.`,
);
