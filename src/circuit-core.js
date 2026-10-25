/* Shared by the browser renderer and Node CLI; classic-script and CommonJS compatible. */
(function attachCore(root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.LogicCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCore() {
  const gateTypes = Object.freeze(['AND', 'OR', 'NOT', 'XOR']);

  // Evaluate recursively and fail on cycles instead of letting a loop hang.
  function evaluate(circuit, id, inputValues = {}, path = []) {
    const part = circuit.parts.find(candidate => candidate.id === id);
    if (!part) throw new Error(`오브젝트를 찾을 수 없습니다: ${id}`);
    if (part.type === 'input') return inputValues[id] ?? part.value ?? 0;
    if (path.includes(id)) throw new Error(`순환 연결이 있습니다: ${[...path, id].join(' → ')}`);

    // The renderer stores numeric pin indexes; the CLI stores named input ports.
    const readPort = (name, index) => {
      const link = circuit.links.find(candidate => candidate.to === id && (
        candidate.input !== undefined
          ? candidate.input.toUpperCase() === name.toUpperCase()
          : candidate.index === index
      ));
      return link ? evaluate(circuit, link.from, inputValues, [...path, id]) : 0;
    };

    if (part.type === 'lamp' || part.type === 'output') return readPort('in', 0);
    const a = readPort('A', 0), b = readPort('B', 1);
    switch (part.type) {
      case 'AND': return +Boolean(a && b);
      case 'OR': return +Boolean(a || b);
      case 'XOR': return +(Boolean(a) !== Boolean(b));
      case 'NOT': return +!a;
      default: throw new Error(`알 수 없는 게이트: ${part.type}`);
    }
  }

  return Object.freeze({ gateTypes, evaluate });
});
