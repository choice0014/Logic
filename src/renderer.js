/* DOM rendering and canvas interactions. Circuit evaluation lives in circuit-core.js. */
const board = document.querySelector('#board');
const world = document.querySelector('#world');
const wires = document.querySelector('#wires');
const status = document.querySelector('#status');
const marquee = document.querySelector('#marquee');

let parts = [];
let links = [];
let nextId = 0;
let drag = null;
let wireDrag = null;
let wirePoint = null;
let zoom = 1;
let panX = 0;
let panY = 0;
let tile = 24;
let panDrag = null;
let selectedIds = new Set();
let selectedId = null;
let selectDrag = null;
let clipboard = null;
let undoStack = [];
let redoStack = [];
let memoEditTimer = null;
let tileHistoryBefore = null;

// SVG and DOM elements are keyed by model identity so signal updates never rebuild wires.
const nodeElements = new Map();
const pinElements = new Map();
const wireElements = new Map();
const linksByPart = new Map();
const objectNumbers = new Map();
let previewPath = null;
let geometryFrame = null;
let previewFrame = null;
const pendingGeometryIds = new Set();
const snap = value => Math.round(value / tile) * tile;

function worldPoint(clientX, clientY) {
  const rect = board.getBoundingClientRect();
  return {
    x: (clientX - rect.left - panX) / zoom,
    y: (clientY - rect.top - panY) / zoom
  };
}

function applyCamera() {
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  board.style.backgroundSize = `${tile * zoom}px ${tile * zoom}px`;
  board.style.backgroundPosition = `${panX % (tile * zoom)}px ${panY % (tile * zoom)}px`;
}

function addPart(type, x, y) {
  recordHistory();
  const part = { id: nextId++, type, x: snap(x), y: snap(y), value: 0 };
  parts.push(part);
  selectedIds = new Set([part.id]);
  selectedId = part.id;
  render();
  return part;
}

function circuitSnapshot() {
  return {
    version: 1,
    parts: parts.map(part => ({ ...part })),
    links: links.map(link => ({ ...link })),
    nextId,
    tile
  };
}

function recordHistory(before = circuitSnapshot()) {
  undoStack.push(before);
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}

function restoreSnapshot(snapshot) {
  clearTimeout(memoEditTimer);
  memoEditTimer = null;
  parts = snapshot.parts.map(part => ({ ...part }));
  links = snapshot.links.map(link => ({ ...link }));
  nextId = snapshot.nextId;
  tile = snapshot.tile;
  selectedIds.clear();
  selectedId = null;
  document.querySelector('#tile-size').value = tile;
  document.querySelector('#tile-label').textContent = tile;
  applyCamera();
  render();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(circuitSnapshot());
  restoreSnapshot(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(circuitSnapshot());
  restoreSnapshot(redoStack.pop());
}

function resetHistory() {
  undoStack = [];
  redoStack = [];
}

function pinFor(partId, side, index = 0) {
  return pinElements.get(`${partId}:${side}:${index}`);
}

function safeValue(evaluator, id) {
  try {
    return evaluator(id);
  } catch {
    return 0;
  }
}

function showStatus(title, detail) {
  const label = document.createElement('b');
  label.textContent = title;
  status.replaceChildren(label, document.createTextNode(` · ${detail}`));
}

function removePart(id) {
  recordHistory();
  parts = parts.filter(part => part.id !== id);
  links = links.filter(link => link.from !== id && link.to !== id);
  selectedIds.delete(id);
  if (selectedId === id) selectedId = [...selectedIds].at(-1) ?? null;
  render();
}

// Full render is reserved for topology changes. Input toggles use refreshSignals().
function render() {
  if (geometryFrame !== null) cancelAnimationFrame(geometryFrame);
  if (previewFrame !== null) cancelAnimationFrame(previewFrame);
  geometryFrame = null;
  previewFrame = null;
  pendingGeometryIds.clear();
  previewPath?.remove();
  previewPath = null;
  nodeElements.clear();
  pinElements.clear();
  objectNumbers.clear();
  world.querySelectorAll('.node').forEach(node => node.remove());
  document.querySelector('#empty').hidden = parts.length > 0;

  const nextObjectNumber = new Map();
  parts.forEach(part => {
    const number = nextObjectNumber.get(part.type) || 0;
    nextObjectNumber.set(part.type, number + 1);
    objectNumbers.set(part.id, number);
    const node = document.createElement('div');
    const className = part.type === 'input' ? 'source'
      : part.type === 'lamp' ? 'lamp'
        : part.type === 'memo' ? 'memo-node' : 'gate';
    node.className = `node ${className}${selectedIds.has(part.id) ? ' selected' : ''}`;
    node.style.left = `${part.x}px`;
    node.style.top = `${part.y}px`;
    node.dataset.id = part.id;

    if (part.type === 'input') {
      node.innerHTML = `<span class="name">입력 ${number}</span>
        <button class="toggle ${part.value ? 'on' : ''}">${part.value}</button>
        <span class="dot ${part.value ? 'hot' : ''}" data-pin="${part.id}:out:0"></span>`;
      node.querySelector('.toggle').onclick = event => {
        event.stopPropagation();
        recordHistory();
        part.value = 1 - part.value;
        refreshSignals();
      };
    } else if (part.type === 'lamp') {
      node.innerHTML = `<span class="dot" data-pin="${part.id}:in:0"></span>
        <span class="bulb"></span><b>램프 ${number}: 0</b>`;
    } else if (part.type === 'memo') {
      node.innerHTML = `<div class="memo-head">메모 ${number} · 잡고 이동</div>`;
      const note = document.createElement('textarea');
      note.placeholder = '메모를 입력하세요…';
      note.value = part.text || '';
      note.oninput = () => {
        if (memoEditTimer === null) recordHistory();
        clearTimeout(memoEditTimer);
        part.text = note.value;
        memoEditTimer = setTimeout(() => { memoEditTimer = null; }, 500);
      };
      node.append(note);
    } else {
      const count = part.type === 'NOT' ? 1 : 2;
      const symbol = { AND: '&', OR: '≥1', XOR: '=1', NOT: '¬' }[part.type];
      node.innerHTML = `<div class="gate-head"><strong>${part.type} ${number}</strong></div>
        <div class="gate-body">
          <div class="pins">${Array.from({ length: count }, (_, index) =>
            `<span class="pin in"><i class="dot" data-pin="${part.id}:in:${index}"></i>${String.fromCharCode(65 + index)}</span>`
          ).join('')}</div>
          <span class="symbol">${symbol}</span>
          <span class="pin out"><i class="dot hot" data-pin="${part.id}:out:0"></i></span>
        </div>`;
    }

    const deleteButton = document.createElement('button');
    deleteButton.className = 'node-delete';
    deleteButton.type = 'button';
    deleteButton.title = '삭제';
    deleteButton.textContent = '×';
    deleteButton.onclick = event => {
      event.stopPropagation();
      removePart(part.id);
    };
    node.append(deleteButton);
    nodeElements.set(part.id, node);
    bindNodePointerEvents(node, part);
    world.append(node);
    node.querySelectorAll('[data-pin]').forEach(pin => pinElements.set(pin.dataset.pin, pin));
  });

  bindPortEvents();
  reconcileWireElements();
  refreshSignals();
  updateWireGeometry();
  if (wireDrag) queuePreviewGeometry();
}

function bindNodePointerEvents(node, part) {
  node.addEventListener('pointerdown', event => {
    if (event.button === 2) return;
    if (event.shiftKey) {
      if (selectedIds.has(part.id)) selectedIds.delete(part.id);
      else selectedIds.add(part.id);
    } else if (!selectedIds.has(part.id)) {
      selectedIds = new Set([part.id]);
    }
    selectedId = part.id;
    updateSelectionStyle();
    if (event.shiftKey || event.button === 1 || event.target.closest('.dot, .toggle, button, textarea')) return;

    const point = worldPoint(event.clientX, event.clientY);
    drag = {
      id: part.id,
      dx: point.x - part.x,
      dy: point.y - part.y,
      originX: part.x,
      originY: part.y,
        members: parts.filter(candidate => selectedIds.has(candidate.id)),
        before: circuitSnapshot(),
        recorded: false
    };
    node.setPointerCapture(event.pointerId);
  });

  node.addEventListener('pointermove', event => {
    if (!drag || drag.id !== part.id) return;
    const point = worldPoint(event.clientX, event.clientY);
    const x = snap(point.x - drag.dx), y = snap(point.y - drag.dy);
    const dx = x - drag.originX, dy = y - drag.originY;
    if ((dx || dy) && !drag.recorded) {
      recordHistory(drag.before);
      drag.recorded = true;
    }
    const movedIds = [];
    drag.members.forEach(member => {
      member.x += dx;
      member.y += dy;
      const element = nodeElements.get(member.id);
      element.style.left = `${member.x}px`;
      element.style.top = `${member.y}px`;
      movedIds.push(member.id);
    });
    drag.originX = x;
    drag.originY = y;
    queueWireGeometry(movedIds);
  });
  node.addEventListener('pointerup', () => { drag = null; });
}

function bindPortEvents() {
  board.querySelectorAll('.dot').forEach(dot => {
    dot.onpointerdown = event => {
      if (event.button === 2) return;
      event.preventDefault();
      event.stopPropagation();
      const [id, side, index] = parsePin(dot);
      if (side === 'out') {
        wireDrag = { id, index };
        wirePoint = { x: event.clientX, y: event.clientY };
        status.innerHTML = '<b>연결 중</b> · 입력이 있는 오브젝트 위에 놓으세요.';
        queuePreviewGeometry();
      }
    };
    dot.ondblclick = event => {
      event.preventDefault();
      event.stopPropagation();
      const [id, side, index] = parsePin(dot);
      const remaining = links.filter(link => side === 'out'
        ? link.from !== id
        : !(link.to === id && link.index === index));
      const before = links.length;
      if (remaining.length !== before) recordHistory();
      links = remaining;
      status.innerHTML = before === links.length
        ? '<b>연결 없음</b> · 끊을 선이 없습니다.'
        : '<b>연결 해제</b> · 포트에 연결된 선을 모두 끊었습니다.';
      wireDrag = null;
      wirePoint = null;
      render();
    };
  });
}

function parsePin(dot) {
  return dot.dataset.pin.split(':').map((value, index) => index === 0 || index === 2 ? +value : value);
}

function updateSelectionStyle() {
  nodeElements.forEach((node, id) => node.classList.toggle('selected', selectedIds.has(id)));
}

function reconcileWireElements() {
  const currentLinks = new Set(links);
  wireElements.forEach((path, link) => {
    if (!currentLinks.has(link)) {
      path.remove();
      wireElements.delete(link);
    }
  });
  links.forEach(link => {
    if (wireElements.has(link)) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('wire');
    wires.append(path);
    wireElements.set(link, path);
  });

  linksByPart.clear();
  links.forEach(link => {
    for (const id of [link.from, link.to]) {
      if (!linksByPart.has(id)) linksByPart.set(id, new Set());
      linksByPart.get(id).add(link);
    }
  });
}

// SVG paths and nodes share one transformed world; camera changes need no wire redraw.
function updateWireGeometry(affectedIds = null) {
  let targets = links;
  if (affectedIds) {
    const incident = new Set();
    affectedIds.forEach(id => linksByPart.get(id)?.forEach(link => incident.add(link)));
    targets = incident;
  }
  targets.forEach(link => {
    const startPin = pinFor(link.from, 'out');
    const endPin = pinFor(link.to, 'in', link.index);
    const path = wireElements.get(link);
    if (!startPin || !endPin || !path) return;
    const start = worldPointAtCenter(startPin), end = worldPointAtCenter(endPin);
    const middle = (start.x + end.x) / 2;
    path.setAttribute('d', `M${start.x} ${start.y} C${middle} ${start.y},${middle} ${end.y},${end.x} ${end.y}`);
  });
}

function worldPointAtCenter(element) {
  const rect = element.getBoundingClientRect();
  return worldPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

function queueWireGeometry(ids) {
  ids.forEach(id => pendingGeometryIds.add(id));
  if (geometryFrame !== null) return;
  geometryFrame = requestAnimationFrame(() => {
    updateWireGeometry(pendingGeometryIds);
    pendingGeometryIds.clear();
    geometryFrame = null;
  });
}

function queuePreviewGeometry() {
  if (previewFrame !== null) return;
  previewFrame = requestAnimationFrame(() => {
    previewFrame = null;
    updatePreviewGeometry();
  });
}

function updatePreviewGeometry() {
  if (!wireDrag || !wirePoint) {
    previewPath?.remove();
    previewPath = null;
    return;
  }
  const startPin = pinFor(wireDrag.id, 'out');
  if (!startPin) return;
  if (!previewPath) {
    previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    previewPath.classList.add('wire', 'preview');
    wires.append(previewPath);
  }
  const start = worldPointAtCenter(startPin), end = worldPoint(wirePoint.x, wirePoint.y);
  const middle = (start.x + end.x) / 2;
  previewPath.setAttribute('d', `M${start.x} ${start.y} C${middle} ${start.y},${middle} ${end.y},${end.x} ${end.y}`);
}

// A fresh memoized evaluator represents one consistent set of input values.
function refreshSignals() {
  const evaluate = LogicCore.createEvaluator({ parts, links });
  parts.forEach(part => {
    const node = nodeElements.get(part.id);
    if (part.type === 'input') {
      const toggle = node.querySelector('.toggle');
      toggle.textContent = part.value;
      toggle.classList.toggle('on', Boolean(part.value));
      node.querySelector('.dot').classList.toggle('hot', Boolean(part.value));
    } else if (part.type === 'lamp') {
      const value = safeValue(evaluate, part.id);
      node.querySelector('.bulb').classList.toggle('on', Boolean(value));
      node.querySelector('b').textContent = `램프 ${objectNumbers.get(part.id)}: ${value}`;
    }
  });
  links.forEach(link => {
    wireElements.get(link)?.classList.toggle('on', Boolean(safeValue(evaluate, link.from)));
  });
}

function placePart(type, clientX, clientY) {
  const point = worldPoint(clientX, clientY);
  addPart(type, point.x, point.y);
  status.innerHTML = '<b>부품 추가됨</b> · 타일에 맞춰 배치됩니다.';
}

function removeSelected() {
  if (!selectedIds.size) return;
  recordHistory();
  const removed = selectedIds;
  parts = parts.filter(part => !removed.has(part.id));
  links = links.filter(link => !removed.has(link.from) && !removed.has(link.to));
  selectedIds = new Set();
  selectedId = null;
  render();
}

function validateCircuit(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.parts) || !Array.isArray(data.links)
      || !Number.isInteger(data.nextId) || data.nextId < 0 || !Number.isInteger(data.tile) || data.tile < 12 || data.tile > 64) {
    throw new Error('회로 파일 형식 또는 버전이 올바르지 않습니다.');
  }
  const byId = new Map();
  data.parts.forEach(part => {
    if (!Number.isInteger(part.id) || part.id < 0 || byId.has(part.id)
        || !Number.isFinite(part.x) || !Number.isFinite(part.y)
        || !['input', 'lamp', 'memo', ...LogicCore.gateTypes].includes(part.type)) {
      throw new Error('중복되거나 잘못된 오브젝트가 있습니다.');
    }
    if (part.type === 'input' && ![0, 1].includes(part.value)) throw new Error('잘못된 입력값입니다.');
    byId.set(part.id, part);
  });
  if (data.parts.some(part => part.id >= data.nextId)) throw new Error('다음 ID가 오브젝트 ID와 충돌합니다.');

  const occupied = new Set();
  data.links.forEach(link => {
    const source = byId.get(link.from), target = byId.get(link.to);
    const inputs = target?.type === 'NOT' || target?.type === 'lamp' ? 1 : 2;
    if (!source || !target || !Number.isInteger(link.index) || link.index < 0 || link.index >= inputs
        || ['lamp', 'memo'].includes(source.type) || ['input', 'memo'].includes(target.type)) {
      throw new Error('잘못된 연결이 있습니다.');
    }
    const key = `${link.to}:${link.index}`;
    if (occupied.has(key)) throw new Error('입력 포트에 중복 연결이 있습니다.');
    occupied.add(key);
  });
  return data;
}

async function saveCircuit() {
  if (!window.logicFiles) {
    showStatus('저장할 수 없음', 'Electron 앱에서 실행하세요.');
    return;
  }
  const result = await window.logicFiles.saveCircuit(circuitSnapshot());
  if (result.error) showStatus('저장 실패', result.error);
  else if (!result.canceled) showStatus('저장 완료', result.filePath);
}

async function loadCircuit() {
  if (!window.logicFiles) {
    showStatus('열 수 없음', 'Electron 앱에서 실행하세요.');
    return;
  }
  const result = await window.logicFiles.loadCircuit();
  if (result.canceled) return;
  if (result.error) {
    showStatus('열기 실패', result.error);
    return;
  }
  try {
    const data = validateCircuit(result.circuit);
    parts = data.parts.map(part => ({ ...part }));
    links = data.links.map(link => ({ ...link }));
    nextId = data.nextId;
    tile = data.tile;
    selectedIds.clear();
    selectedId = null;
    clearTimeout(memoEditTimer);
    memoEditTimer = null;
    tileHistoryBefore = null;
    resetHistory();
    document.querySelector('#tile-size').value = tile;
    document.querySelector('#tile-label').textContent = tile;
    applyCamera();
    render();
    showStatus('열기 완료', result.filePath);
  } catch (error) {
    showStatus('열기 실패', error.message);
  }
}

document.querySelector('#save').onclick = saveCircuit;
document.querySelector('#open').onclick = loadCircuit;

document.querySelectorAll('[data-add]').forEach(button => {
  button.draggable = true;
  button.onclick = () => {
    const rect = board.getBoundingClientRect();
    placePart(button.dataset.add, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };
  button.ondragstart = event => event.dataTransfer.setData('text/plain', button.dataset.add);
});

board.addEventListener('dragover', event => event.preventDefault());
board.addEventListener('drop', event => {
  event.preventDefault();
  const type = event.dataTransfer.getData('text/plain');
  if (type) placePart(type, event.clientX, event.clientY);
});

document.querySelector('#tile-size').oninput = event => {
  if (tileHistoryBefore === null) tileHistoryBefore = circuitSnapshot();
  tile = +event.target.value;
  document.querySelector('#tile-label').textContent = tile;
  parts.forEach(part => { part.x = snap(part.x); part.y = snap(part.y); });
  applyCamera();
  render();
};
document.querySelector('#tile-size').addEventListener('change', () => {
  if (tileHistoryBefore && tileHistoryBefore.tile !== tile) recordHistory(tileHistoryBefore);
  tileHistoryBefore = null;
});

document.querySelector('#reset').onclick = () => {
  if (parts.length || links.length) recordHistory();
  parts = [];
  links = [];
  selectedIds.clear();
  selectedId = null;
  nextId = 0;
  status.innerHTML = '<b>초기화됨</b> · 새 회로를 만들어보세요.';
  render();
};

board.addEventListener('pointerdown', event => {
  // Shift-drag selects a region. Plain drag on empty space pans the camera.
  if (event.shiftKey && event.button === 0) {
    const rect = board.getBoundingClientRect();
    selectDrag = { x: event.clientX, y: event.clientY, base: new Set(selectedIds) };
    marquee.style.display = 'block';
    marquee.style.left = `${event.clientX - rect.left}px`;
    marquee.style.top = `${event.clientY - rect.top}px`;
    marquee.style.width = marquee.style.height = '0px';
    board.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (wireDrag) return;
  if (event.button === 2 || event.button === 1 || (event.button === 0 && !event.target.closest('.node'))) {
    if (event.button === 0) {
      selectedId = null;
      selectedIds.clear();
      updateSelectionStyle();
    }
    panDrag = { x: event.clientX, y: event.clientY, panX, panY };
    board.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
});

board.addEventListener('contextmenu', event => event.preventDefault());
board.addEventListener('pointermove', event => {
  if (panDrag) {
    panX = panDrag.panX + event.clientX - panDrag.x;
    panY = panDrag.panY + event.clientY - panDrag.y;
    applyCamera();
  } else if (wireDrag) {
    wirePoint = { x: event.clientX, y: event.clientY };
    queuePreviewGeometry();
  }
});

board.addEventListener('pointermove', event => {
  if (!selectDrag) return;
  const rect = board.getBoundingClientRect();
  const left = Math.min(event.clientX, selectDrag.x);
  const top = Math.min(event.clientY, selectDrag.y);
  const right = Math.max(event.clientX, selectDrag.x);
  const bottom = Math.max(event.clientY, selectDrag.y);
  marquee.style.left = `${left - rect.left}px`;
  marquee.style.top = `${top - rect.top}px`;
  marquee.style.width = `${right - left}px`;
  marquee.style.height = `${bottom - top}px`;

  if (Math.abs(event.clientX - selectDrag.x) + Math.abs(event.clientY - selectDrag.y) <= 3) return;
  selectedIds = new Set(selectDrag.base);
  nodeElements.forEach((node, id) => {
    const bounds = node.getBoundingClientRect();
    if (bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom) {
      selectedIds.add(id);
    }
  });
  selectedId = [...selectedIds].at(-1) ?? null;
  updateSelectionStyle();
});

board.addEventListener('pointerup', event => {
  if (selectDrag) {
    selectDrag = null;
    marquee.style.display = 'none';
    return;
  }
  if (panDrag) {
    panDrag = null;
    return;
  }
  if (!wireDrag) return;

  // Dropping on a component chooses the input nearest the cursor, not its tiny pin.
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.node');
  if (target && !target.classList.contains('memo-node')) {
    const id = +target.dataset.id;
    const part = parts.find(candidate => candidate.id === id);
    const inputPins = [...target.querySelectorAll('[data-pin*="in"]')];
    const nearest = inputPins.sort((a, b) =>
      Math.abs(a.getBoundingClientRect().y + a.offsetHeight / 2 - event.clientY)
      - Math.abs(b.getBoundingClientRect().y + b.offsetHeight / 2 - event.clientY)
    )[0];
    if (part && part.id !== wireDrag.id && part.type !== 'input' && nearest) {
      const [, , index] = nearest.dataset.pin.split(':');
      recordHistory();
      links = links.filter(link => !(link.to === id && link.index === +index));
      links.push({ from: wireDrag.id, to: id, index: +index });
      status.innerHTML = '<b>연결 완료</b> · 오브젝트에 자동 연결했습니다.';
    } else {
      status.innerHTML = '<b>연결되지 않음</b> · 입력이 있는 오브젝트를 선택하세요.';
    }
  } else {
    status.innerHTML = '<b>연결되지 않음</b> · 입력 오브젝트 위에 놓으세요.';
  }
  wireDrag = null;
  wirePoint = null;
  render();
});

board.addEventListener('wheel', event => {
  event.preventDefault();
  const rect = board.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  const point = worldPoint(event.clientX, event.clientY);
  zoom = Math.max(0.25, Math.min(2.5, zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
  panX = x - point.x * zoom;
  panY = y - point.y * zoom;
  applyCamera();
  if (wireDrag) queuePreviewGeometry();
}, { passive: false });

document.querySelector('#theme').onclick = event => {
  document.body.classList.toggle('light');
  event.currentTarget.textContent = document.body.classList.contains('light') ? '다크 테마' : '라이트 테마';
};

window.addEventListener('keydown', event => {
  const modifier = event.ctrlKey || event.metaKey;
  const editing = event.target.matches('textarea, input, [contenteditable="true"]');
  if (modifier && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveCircuit();
    return;
  }
  if (editing) return;

  if (modifier && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (modifier && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
    return;
  }

  const arrowMoves = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  }[event.key];
  if (arrowMoves) {
    event.preventDefault();
    const [dx, dy] = arrowMoves;
    if (selectedIds.size) {
      recordHistory();
      const moved = parts.filter(part => selectedIds.has(part.id));
      moved.forEach(part => {
        part.x += dx * tile;
        part.y += dy * tile;
        const node = nodeElements.get(part.id);
        node.style.left = `${part.x}px`;
        node.style.top = `${part.y}px`;
      });
      queueWireGeometry(moved.map(part => part.id));
    } else {
      panX -= dx * tile * zoom;
      panY -= dy * tile * zoom;
      applyCamera();
    }
    return;
  }

  // Copy selected components and their internal wires; paste as a new group.
  if (modifier && event.key.toLowerCase() === 'c' && selectedIds.size) {
    const ids = new Set(selectedIds);
    clipboard = {
      parts: parts.filter(part => ids.has(part.id)).map(part => ({ ...part })),
      links: links.filter(link => ids.has(link.from) && ids.has(link.to)).map(link => ({ ...link }))
    };
    event.preventDefault();
  } else if (modifier && event.key.toLowerCase() === 'v' && clipboard?.parts.length) {
    const minX = Math.min(...clipboard.parts.map(part => part.x));
    const minY = Math.min(...clipboard.parts.map(part => part.y));
    const rect = board.getBoundingClientRect();
    const center = worldPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const dx = selectedIds.size ? tile * 2 : center.x - minX;
    const dy = selectedIds.size ? tile * 2 : center.y - minY;
    const ids = new Map();
    recordHistory();
    clipboard.parts.forEach(part => {
      const copy = { ...part, id: nextId++, x: snap(part.x + dx), y: snap(part.y + dy) };
      parts.push(copy);
      ids.set(part.id, copy.id);
    });
    clipboard.links.forEach(link => {
      if (ids.has(link.from) && ids.has(link.to)) {
        links.push({ from: ids.get(link.from), to: ids.get(link.to), index: link.index });
      }
    });
    selectedIds = new Set(ids.values());
    selectedId = [...selectedIds].at(-1) ?? null;
    render();
    event.preventDefault();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    removeSelected();
    event.preventDefault();
  }
});

applyCamera();
const initialBounds = board.getBoundingClientRect();
panX = initialBounds.width / 2 - 50000;
panY = initialBounds.height / 2 - 50000;
applyCamera();
render();
