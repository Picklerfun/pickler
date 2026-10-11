/** Native JSON semantics, streamed at container boundaries instead of one giant string. */
export function* jsonChunks(value: unknown): Generator<string> {
  const ancestors = new Set<object>();
  function prepare(input: unknown, key: string): unknown {
    let item = input;
    if (item && typeof item === "object" && "toJSON" in item) {
      const toJSON = (item as { toJSON?: (key: string) => unknown }).toJSON;
      if (typeof toJSON === "function") {
        item = toJSON.call(item, key);
      }
    }
    if (item instanceof Number || item instanceof Boolean || item instanceof String) {
      return item.valueOf();
    }
    return item;
  }
  function* visit(item: unknown): Generator<string> {
    if (!item || typeof item !== "object") {
      yield JSON.stringify(item) ?? "null";
      return;
    }
    if (ancestors.has(item)) {
      throw new TypeError("Circular JSON input");
    }
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        yield "[";
        for (let index = 0; index < item.length; index++) {
          if (index) {
            yield ",";
          }
          yield* visit(prepare(item[index], String(index)));
        }
        yield "]";
      } else {
        yield "{";
        let first = true;
        for (const [name, input] of Object.entries(item)) {
          const field = prepare(input, name);
          if (field === undefined || typeof field === "function" || typeof field === "symbol") {
            continue;
          }
          if (!first) {
            yield ",";
          }
          first = false;
          yield JSON.stringify(name) + ":";
          yield* visit(field);
        }
        yield "}";
      }
    } finally {
      ancestors.delete(item);
    }
  }
  const root = prepare(value, "");
  if (root === undefined || typeof root === "function" || typeof root === "symbol") {
    throw new TypeError("Root JSON value unavailable");
  }
  yield* visit(root);
}

/** Never split scalar text in the middle of a surrogate pair when writing UTF-8. */
export function* bufferedChunks(source: Iterable<string>, target = 64 * 1024): Generator<string> {
  let pending = "";
  for (const piece of source) {
    if (pending.length && pending.length + piece.length > target) {
      yield pending;
      pending = "";
    }
    if (piece.length >= target) {
      yield piece;
    } else {
      pending += piece;
    }
  }
  if (pending) {
    yield pending;
  }
}

export function* jsonDocument(value: unknown): Generator<string> {
  yield* bufferedChunks(jsonChunks(value));
  yield "\n";
}
