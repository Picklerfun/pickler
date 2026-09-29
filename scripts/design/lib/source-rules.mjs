/* The rules of the static source check, as pure functions over text. source.mjs walks the tree and
 * prints; everything that decides is here, so each rule is pinned by a fixture that breaks it and
 * one that does not (source.test.mjs). */
import ts from "typescript";

/** Blanks comments and keeps every newline, so a finding's line is the line in the file. */
export function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** Every `--pk-*` custom property the token file defines, on any selector. */
export function definedTokens(tokenCss) {
  const names = new Set();
  for (const match of stripCssComments(tokenCss).matchAll(/(?:^|[;{\s])(--pk-[\w-]+)\s*:/g)) {
    names.add(match[1]);
  }
  return names;
}

const CSS_NAMED = [
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
];
const NAMED = new RegExp(`(?<![\\w-])(?:${CSS_NAMED.join("|")})(?![\\w-(])`, "gi");
const FUNCTIONAL = /(?<![\w-])(?:rgba?|hsla?)\(/gi;
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;

/* Properties whose values are names, not colours: a font called "Tan", an animation called
 * `pink`, a grid area called `gold`. A colour keyword in one of these is not a paint. */
const NAME_VALUED =
  /^(?:font|font-family|animation|animation-name|transition|transition-property|grid-area|grid-template-areas|grid-row|grid-column|content|composes|will-change|view-transition-name|container-name)$/;

/**
 * One CSS file's declarations, comments removed: `{ line, property, value }`, where a value that
 * runs over several lines is joined and reported at the line its property is on.
 */
export function declarations(css) {
  const text = stripCssComments(css);
  const found = [];
  let line = 1;
  let at = 0;
  let start = 0;
  let startLine = 1;
  let depth = 0;
  const push = (chunk, chunkLine) => {
    const match = /^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(chunk);
    if (!match) {
      return;
    }
    const lead = /^\s*/.exec(chunk)[0];
    const offset = (lead.match(/\n/g) ?? []).length;
    found.push({
      line: chunkLine + offset,
      property: match[1],
      value: match[2].replace(/\s+/g, " "),
    });
  };
  for (; at < text.length; at += 1) {
    const char = text[at];
    if (char === "\n") {
      line += 1;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && (char === "{" || char === "}" || char === ";")) {
      if (char !== "{") {
        push(text.slice(start, at), startLine);
      }
      start = at + 1;
      startLine = line;
    }
  }
  return found;
}

/** Colour literals in one declaration value: hex, rgb(), hsl() and named colours. */
export function literalsIn(property, value) {
  const found = [];
  for (const match of value.matchAll(HEX)) {
    found.push(match[0]);
  }
  for (const match of value.matchAll(FUNCTIONAL)) {
    found.push(`${match[0]}…)`);
  }
  if (!NAME_VALUED.test(property)) {
    const bare = value.replace(/var\([^()]*\)/g, " ").replace(/url\([^()]*\)/g, " ");
    for (const match of bare.matchAll(NAMED)) {
      found.push(match[0]);
    }
  }
  return found;
}

/**
 * The rules over one CSS file. `isTokenFile` is true for packages/ui/src/styles.css only: there a
 * literal is allowed inside a `--pk-*` definition and nowhere else, and definitions are the point.
 */
export function checkCss(file, css, { tokens, isTokenFile }) {
  const problems = [];
  const say = (rule, line, text) => problems.push({ rule, file, line, text });
  for (const { line, property, value } of declarations(css)) {
    const custom = property.startsWith("--");
    const isToken = property.startsWith("--pk-");
    if (!(isTokenFile && isToken)) {
      for (const literal of literalsIn(property, value)) {
        say(
          "colour-literal",
          line,
          `${property}: ${literal} is a colour literal; read a --pk-* token instead`,
        );
      }
    }
    if (isToken && !isTokenFile) {
      say("token-definition", line, `${property} is defined outside packages/ui/src/styles.css`);
    }
    if (custom && !isTokenFile && /^var\(\s*--pk-[\w-]+\s*\)$/.test(value)) {
      say("token-alias", line, `${property}: ${value} renames a token; read the token itself`);
    }
    for (const match of value.matchAll(/var\(\s*(--pk-[\w-]+)/g)) {
      if (!tokens.has(match[1])) {
        say("undefined-token", line, `${match[1]} is read and never defined in styles.css`);
      }
    }
  }
  return problems;
}

/* `href="#feed"` is a place on the page, and `feed` happens to be four hex digits. A string handed
 * to one of these names is an address or an id, never a paint. */
const ADDRESSES = new Set(["href", "to", "id", "htmlFor", "aria-controls", "aria-labelledby"]);

function isAnchor(node) {
  const holder = ts.isJsxExpression(node.parent) ? node.parent.parent : node.parent;
  if (!holder) {
    return false;
  }
  if (ts.isJsxAttribute(holder) || ts.isPropertyAssignment(holder)) {
    return ADDRESSES.has(holder.name.getText());
  }
  return false;
}

/** Every string a TypeScript file holds: literals, template parts and JSX text, with its line. */
export function strings(file, source) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const imported =
        node.parent && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent));
      if (!imported) {
        found.push({
          line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
          text: node.text,
          anchor: isAnchor(node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

/**
 * The rules over one TypeScript file.
 *
 * `mirror` is the one module allowed to hold colour values, keyed by the token each one copies
 * (it is pinned to styles.css by mirror.test.mjs); `marks` holds third-party logos, whose colours are theirs and may not be
 * recoloured; `channel` is the one module allowed to hand a token to CSS through an inline custom
 * property, because which agent a screen shows is data.
 */
export function checkTs(file, source, { tokens, mirror, marks, channel }) {
  const problems = [];
  const say = (rule, line, text) => problems.push({ rule, file, line, text });
  for (const { line, text, anchor } of strings(file, source)) {
    if (file !== mirror && !marks.includes(file) && !anchor) {
      for (const match of text.matchAll(HEX)) {
        say("colour-in-ts", line, `${match[0]} is a colour literal; read it from ${mirror}`);
      }
      for (const match of text.matchAll(FUNCTIONAL)) {
        say("colour-in-ts", line, `${match[0]}…) is a colour literal; read it from ${mirror}`);
      }
    }
    if (file !== channel && /var\(\s*--pk-/.test(text)) {
      say("token-alias", line, `var(--pk-…) in a string; only ${channel} hands tokens to CSS`);
    }
    for (const match of text.matchAll(/--pk-[\w-]*[\w]/g)) {
      const name = match[0];
      const open = text[match.index + name.length] === "-";
      if (!open && !tokens.has(name)) {
        say("undefined-token", line, `${name} is named and never defined in styles.css`);
      }
    }
  }
  if (file !== channel && file !== mirror) {
    for (const { line, text } of strings(file, source)) {
      if (/^--pk-[\w-]+$/.test(text) && isPropertyKey(file, source, line, text)) {
        say("token-definition", line, `${text} is assigned outside packages/ui/src/styles.css`);
      }
    }
  }
  return problems.sort((a, b) => a.line - b.line);
}

/** Whether `name` is written as an object key on that line: `"--pk-x": …`. */
function isPropertyKey(file, source, line, name) {
  const text = source.split("\n")[line - 1] ?? "";
  return new RegExp(`["'\`]${name}["'\`]\\s*\\]?\\s*:`).test(text);
}

/** Class names a CSS module defines, with the line of the first selector that names each. */
export function definedClasses(css) {
  const text = stripCssComments(css);
  const found = new Map();
  let line = 1;
  let selector = "";
  let selectorLine = 1;
  let depth = 0;
  for (const char of text) {
    if (char === "\n") {
      line += 1;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    }
    if (depth === 0 && char === "{") {
      const own = selector.replace(/:global\([^)]*\)/g, " ");
      if (!own.trim().startsWith("@")) {
        for (const match of own.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
          if (!found.has(match[1])) {
            found.set(match[1], selectorLine);
          }
        }
      }
      selector = "";
      selectorLine = line;
    } else if (depth === 0 && (char === "}" || char === ";")) {
      selector = "";
      selectorLine = line;
    } else {
      if (!selector.trim() && char.trim()) {
        selectorLine = line;
      }
      selector += char;
    }
  }
  return found;
}

/** Class names `composes:` takes from the same module, which is a use. */
export function composedClasses(css) {
  const used = new Set();
  for (const match of stripCssComments(css).matchAll(/composes:\s*([^;]+?)(\s+from\s+[^;]+)?;/g)) {
    if (!match[2]) {
      for (const name of match[1].trim().split(/\s+/)) {
        used.add(name);
      }
    }
  }
  return used;
}

/** Class names a TypeScript file reads off a module imported as `binding`. */
export function readClasses(source, binding) {
  const used = new Set();
  for (const match of source.matchAll(new RegExp(`\\b${binding}\\.([A-Za-z_][\\w]*)`, "g"))) {
    used.add(match[1]);
  }
  for (const match of source.matchAll(
    new RegExp(`\\b${binding}\\[\\s*["'\`]([^"'\`]+)["'\`]\\s*\\]`, "g"),
  )) {
    used.add(match[1]);
  }
  return used;
}

/**
 * Classes a module defines that nothing names. `keep` lists the ones reached only through a
 * computed `styles[...]`, which no text search can see; each entry there is a promise somebody made
 * by reading the code, so it is a list and not a pattern.
 */
export function unusedClasses(file, css, used, keep) {
  const composed = composedClasses(css);
  const problems = [];
  for (const [name, line] of definedClasses(css)) {
    if (used.has(name) || composed.has(name) || keep.includes(name)) {
      continue;
    }
    problems.push({
      rule: "unused-class",
      file,
      line,
      text: `.${name} is defined and nothing names it`,
    });
  }
  return problems;
}
