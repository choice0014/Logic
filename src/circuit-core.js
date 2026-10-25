/* Shared by the browser renderer and Node CLI; classic-script and CommonJS compatible. */
(function attachCore(root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.LogicCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCore() {
  const gateTypes = Object.freeze(['AND', 'OR', 'NOT', 'XOR']);

  // Build indexes once per signal snapshot, then memoize each node's result.
  // Create a fresh evaluator whenever topology or input values change.
  function createEvaluator(circuit, overrides = {}) {
    const partsById = new Map(circuit.parts.map(part => [part.id, part]));
    const linksByInput = new Map();
    circuit.links.forEach(link => {
      const target = partsById.get(link.to);
      const port = link.input !== undefined
        ? link.input.toUpperCase()
        : target?.type === 'lamp' || target?.type === 'output'
          ? 'IN'
          : link.index === 0 ? 'A' : 'B';
      const key = `${link.to}:${port}`;
      if (!linksByInput.has(key)) linksByInput.set(key, link);
    });

    const values = new Map();
    const active = new Set();
    function value(id) {
      if (values.has(id)) return values.get(id);
      const part = partsById.get(id);
      if (!part) throw new Error(`오브젝트를 찾을 수 없습니다: ${id}`);
      if (part.type === 'input') return overrides[id] ?? part.value ?? 0;
      if (active.has(id)) throw new Error(`순환 연결이 있습니다: ${id}`);

      active.add(id);
      try {
        const readPort = name => {
          const link = linksByInput.get(`${id}:${name}`);
          return link ? value(link.from) : 0;
        };
        let result;
        if (part.type === 'lamp' || part.type === 'output') {
          result = readPort('IN');
        } else {
          const a = readPort('A'), b = readPort('B');
          switch (part.type) {
            case 'AND': result = +Boolean(a && b); break;
            case 'OR': result = +Boolean(a || b); break;
            case 'XOR': result = +(Boolean(a) !== Boolean(b)); break;
            case 'NOT': result = +!a; break;
            default: throw new Error(`알 수 없는 게이트: ${part.type}`);
          }
        }
        values.set(id, result);
        return result;
      } finally {
        active.delete(id);
      }
    }
    return value;
  }

  function evaluate(circuit, id, overrides = {}) {
    return createEvaluator(circuit, overrides)(id);
  }

  return Object.freeze({ gateTypes, createEvaluator, evaluate });
});
