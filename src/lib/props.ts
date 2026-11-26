// Props of each registry item's main component, read from its TypeScript
// types, so the docs can't drift from the code.

import { join, relative, sep } from "node:path";
import ts from "typescript";
import registry from "../../registry.json";

export interface PropDoc {
  name: string;
  /** The type as written in the declaration, like `ComponentType | false`. */
  type: string;
  required: boolean;
  description?: string;
  /** From a JSDoc `@default`, or else the default in the component's parameter destructuring. */
  default?: string;
  /** File an inherited 0xui prop is declared in, like `token-amount` or `button`. */
  from?: string;
  /** npm package an inherited prop is declared in, like `torph` or `@ui-sdk/react`. */
  package?: string;
  /** A DOM attribute from `extends` that the component handles itself, like a default `title`. */
  attribute?: true;
}

export interface ComponentDoc {
  /** Registry item name, like `balance`. */
  name: string;
  /** Exported component, like `Balance`. */
  component: string;
  /**
   * DOM attributes the component also accepts, like `button attributes`. Only
   * the ones it handles itself are in `props`, marked `attribute`.
   */
  extends?: string;
  props: Array<PropDoc>;
}

interface RegistryItemFiles {
  name: string;
  files?: Array<{ path: string }>;
}

const root = process.cwd();

export function componentName(item: string) {
  return item.replaceAll(/(^|-)([a-z0-9])/g, (_, _dash, char: string) => char.toUpperCase());
}

let cached: ts.Program | undefined;

/** One program over every item's main file, built on first use. */
function program() {
  if (cached) {
    return cached;
  }
  const configPath = join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root, {}, configPath);
  const files = registry.items.flatMap((item: RegistryItemFiles) =>
    item.files?.[0] ? [join(root, item.files[0].path)] : [],
  );
  cached = ts.createProgram(files, { ...options, noEmit: true });
  return cached;
}

type Origin = { kind: "own" | "local" | "package" | "dom"; label?: string };

function origin(file: string, mainFile: string): Origin {
  if (file === mainFile) {
    return { kind: "own" };
  }
  const path = relative(root, file).split(sep).join("/");
  const pkg = path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1];
  if (pkg === "@types/react") {
    return { kind: "dom" };
  }
  if (pkg) {
    return { kind: "package", label: pkg };
  }
  return { kind: "local", label: path.replace(/^.*\//, "").replace(/\.tsx?$/, "") };
}

const rank: Record<Origin["kind"], number> = { own: 0, local: 1, package: 2, dom: 3 };

function jsdoc(node: ts.Node) {
  const description = ts
    .getJSDocCommentsAndTags(node)
    .filter(ts.isJSDoc)
    .map((doc) => ts.getTextOfJSDocComment(doc.comment) ?? "")
    .join("\n")
    .trim();
  const tag = ts.getJSDocTags(node).find((t) => t.tagName.text === "default");
  return {
    description: description || undefined,
    default: tag ? ts.getTextOfJSDocComment(tag.comment)?.trim() : undefined,
  };
}

/** Props the component destructures, with any default written there, like `{ size = 24 }`. */
function destructured(declaration: ts.Declaration) {
  const defaults = new Map<string, string | undefined>();
  const param =
    declaration && ts.isFunctionLike(declaration) ? declaration.parameters[0] : undefined;
  if (param && ts.isObjectBindingPattern(param.name)) {
    for (const element of param.name.elements) {
      const key = element.propertyName ?? element.name;
      if (ts.isIdentifier(key) || ts.isStringLiteral(key)) {
        defaults.set(key.text, element.initializer?.getText());
      }
    }
  }
  return defaults;
}

const elementNames: Record<string, string> = {
  Anchor: "a",
  Button: "button",
  Div: "div",
  Input: "input",
  Span: "span",
  "": "HTML",
};

function domElement(types: Array<string>) {
  for (const text of types) {
    const tag = text.match(/\bHTML(\w*)Element\b/)?.[1];
    if (tag !== undefined) {
      return elementNames[tag] ?? tag.toLowerCase();
    }
  }
  return "HTML";
}

/** The main component's props, or undefined when the item has no exported component of its name. */
export function extractProps(item: RegistryItemFiles): ComponentDoc | undefined {
  const path = item.files?.[0]?.path;
  if (!path?.endsWith(".tsx")) {
    return undefined;
  }
  const component = componentName(item.name);
  const mainFile = join(root, path);
  const prog = program();
  const checker = prog.getTypeChecker();
  const source = prog.getSourceFile(mainFile);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  if (!moduleSymbol) {
    return undefined;
  }

  let symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === component);
  if (!symbol) {
    return undefined;
  }
  if (symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!declaration) {
    return undefined;
  }
  const signature = checker.getTypeOfSymbolAtLocation(symbol, declaration).getCallSignatures()[0];
  const param = signature?.parameters[0];
  if (!param) {
    return { name: item.name, component, props: [] };
  }

  const propsType = checker.getTypeOfSymbolAtLocation(param, declaration);
  const variants = propsType.isUnion() ? propsType.types : [propsType];
  const names = [...new Set(variants.flatMap((t) => t.getProperties().map((p) => p.name)))];
  const bound = destructured(declaration);

  const props: Array<PropDoc> = [];
  const domTypes: Array<string> = [];
  let hasDom = false;

  for (const name of names) {
    // A prop that only some union members declare is optional overall.
    const inAll = variants.every((t) => t.getProperty(name));
    const symbols = variants.flatMap((t) => t.getProperty(name) ?? []);
    const first = symbols[0];
    if (!first) {
      continue;
    }
    const declarations = symbols.flatMap((s) => s.declarations ?? []);
    const best = declarations
      .map((d) => ({ d, o: origin(d.getSourceFile().fileName, mainFile) }))
      .sort((a, b) => rank[a.o.kind] - rank[b.o.kind])[0];
    const type = checker.typeToString(
      checker.getTypeOfSymbolAtLocation(first, declaration),
      undefined,
      ts.TypeFormatFlags.NoTruncation,
    );
    // A DOM attribute the component destructures may have its own behavior,
    // like a default `title`, so it is listed. The rest pass through.
    if (!best || (best.o.kind === "dom" && !bound.has(name))) {
      hasDom = true;
      domTypes.push(type);
      continue;
    }
    const sameOrigin = declarations.filter(
      (d) => origin(d.getSourceFile().fileName, mainFile).kind === best.o.kind,
    );
    const docs = sameOrigin.map(jsdoc);
    // Union members can each declare the prop, like `variant: "mono"` and `variant?: "branded"`.
    const written = [
      ...new Set(
        sameOrigin.flatMap((d) => (ts.isPropertySignature(d) && d.type ? d.type.getText() : [])),
      ),
    ].filter((text) => text !== "never");
    const required = inAll && symbols.every((s) => !(s.flags & ts.SymbolFlags.Optional));
    const prop: PropDoc = {
      name,
      type: written.length ? written.join(" | ") : type.replace(/ \| undefined$/, ""),
      required,
    };
    const description = docs.find((d) => d.description)?.description;
    if (description) {
      prop.description = description;
    }
    const fallback = docs.find((d) => d.default)?.default ?? bound.get(name);
    if (fallback) {
      prop.default = fallback;
    }
    if (best.o.kind === "dom") {
      prop.type = type.replace(/ \| undefined$/, "");
      prop.attribute = true;
    }
    if (best.o.kind === "local") {
      prop.from = best.o.label;
    }
    if (best.o.kind === "package") {
      prop.package = best.o.label;
    }
    props.push(prop);
  }

  return {
    name: item.name,
    component,
    ...(hasDom && { extends: `${domElement(domTypes)} attributes` }),
    props,
  };
}

/** Every registry item with a main component. */
export function allComponentDocs(): Array<ComponentDoc> {
  return registry.items.flatMap((item: RegistryItemFiles) => extractProps(item) ?? []);
}
