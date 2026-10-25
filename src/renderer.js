/* DOM rendering and canvas interactions. Circuit evaluation lives in circuit-core.js. */
const board = document.querySelector('#board');
const world = document.querySelector('#world');
const wires = document.querySelector('#wires');
const status = document.querySelector('#status');
const marquee = document.querySelector('#marquee');

// Canvas model and transient pointer/selection state.
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

const snap = value => Math.round(value / tile) * tile;

// Convert screen coordinates to the unscaled, pannable canvas coordinate space.
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
  const part = { id: nextId++, type, x: snap(x), y: snap(y), value: 0 };
  parts.push(part);
  selectedIds = new Set([part.id]);
  selectedId = part.id;
  render();
  return part;
}

// Keep DOM pin naming in one place; the model stores the pin's input index.
function pinFor(part, side, index = 0) {
  return board.querySelector(`[data-pin="${part.id}:${side}:${index}"]`);
}

function valueOf(part) {
  try {
    return LogicCore.evaluate({ parts, links }, part.id);
  } catch {
    return 0;
  }
}

function removePart(id) {
  parts = parts.filter(part => part.id !== id);
  links = links.filter(link => link.from !== id && link.to !== id);
  selectedIds.delete(id);
  if (selectedId === id) selectedId = [...selectedIds].at(-1) ?? null;
  render();
}

function render() {
  world.querySelectorAll('.node').forEach(node => node.remove());
  document.querySelector('#empty').hidden = parts.length > 0;
  wires.innerHTML = '';

  // Rebuild the small set of canvas nodes so their controls always match the model.
  parts.forEach(part => {
    const node = document.createElement('div');
    const className = part.type === 'input' ? 'source'
      : part.type === 'lamp' ? 'lamp'
        : part.type === 'memo' ? 'memo-node' : 'gate';
    node.className = `node ${className}${selectedIds.has(part.id) ? ' selected' : ''}`;
    node.style.left = `${part.x}px`;
    node.style.top = `${part.y}px`;
    node.dataset.id = part.id;

    if (part.type === 'input') {
      node.innerHTML = `<span class="name">입력 ${String.fromCharCode(65 + part.id)}</span>
        <button class="toggle ${part.value ? 'on' : ''}">${part.value}</button>
        <span class="dot ${part.value ? 'hot' : ''}" data-pin="${part.id}:out:0"></span>`;
      node.querySelector('.toggle').onclick = event => {
        event.stopPropagation();
        part.value = 1 - part.value;
        render();
      };
    } else if (part.type === 'lamp') {
      node.innerHTML = `<span class="dot" data-pin="${part.id}:in:0"></span>
        <span class="bulb ${valueOf(part) ? 'on' : ''}"></span>
        <b>출력 ${valueOf(part)}</b>`;
    } else if (part.type === 'memo') {
      node.innerHTML = '<div class="memo-head">메모 · 잡고 이동</div>';
      const note = document.createElement('textarea');
      note.placeholder = '메모를 입력하세요…';
      note.value = part.text || '';
      note.oninput = () => { part.text = note.value; };
      node.append(note);
    } else {
      const count = part.type === 'NOT' ? 1 : 2;
      const symbol = { AND: '&', OR: '≥1', XOR: '=1', NOT: '¬' }[part.type];
      node.innerHTML = `<div class="gate-head"><strong>${part.type}</strong></div>
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
        members: parts.filter(candidate => selectedIds.has(candidate.id))
      };
      node.setPointerCapture(event.pointerId);
    });

    node.addEventListener('pointermove', event => {
      if (!drag || drag.id !== part.id) return;
      const point = worldPoint(event.clientX, event.clientY);
      const x = snap(point.x - drag.dx);
      const y = snap(point.y - drag.dy);
      const dx = x - drag.originX;
      const dy = y - drag.originY;
      drag.members.forEach(member => {
        member.x += dx;
        member.y += dy;
        const element = world.querySelector(`[data-id="${member.id}"]`);
        element.style.left = `${member.x}px`;
        element.style.top = `${member.y}px`;
      });
      drag.originX = x;
      drag.originY = y;
      renderWires();
    });
    node.addEventListener('pointerup', () => { drag = null; });
    world.append(node);
  });

  renderWires();
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
      }
    };
    dot.ondblclick = event => {
      event.preventDefault();
      event.stopPropagation();
      const [id, side, index] = parsePin(dot);
      const before = links.length;
      links = links.filter(link => side === 'out'
        ? link.from !== id
        : !(link.to === id && link.index === index));
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
  world.querySelectorAll('.node').forEach(node => {
    node.classList.toggle('selected', selectedIds.has(+node.dataset.id));
  });
}

function renderWires() {
  const path = (x1, y1, x2, y2, active, extra = '') =>
    `<path class="wire ${active ? 'on' : ''} ${extra}" d="M${x1} ${y1} C${(x1 + x2) / 2} ${y1},${(x1 + x2) / 2} ${y2},${x2} ${y2}"/>`;
  // Wire paths live in world coordinates, even though their endpoints are DOM nodes.
  const center = element => {
    const rect = element.getBoundingClientRect();
    return worldPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  };

  wires.innerHTML = links.map(link => {
    const startPin = pinFor(parts.find(part => part.id === link.from), 'out');
    const endPin = pinFor(parts.find(part => part.id === link.to), 'in', link.index);
    if (!startPin || !endPin) return '';
    const start = center(startPin), end = center(endPin);
    return path(start.x, start.y, end.x, end.y, valueOf(parts.find(part => part.id === link.from)));
  }).join('');

  if (wireDrag && wirePoint) {
    const startPin = pinFor(parts.find(part => part.id === wireDrag.id), 'out');
    if (startPin) {
      const start = center(startPin), end = worldPoint(wirePoint.x, wirePoint.y);
      wires.insertAdjacentHTML('beforeend', path(start.x, start.y, end.x, end.y, false, 'preview'));
    }
  }

  world.querySelectorAll('.lamp').forEach(element => {
    const part = parts.find(candidate => candidate.id === +element.dataset.id);
    element.querySelector('.bulb').classList.toggle('on', Boolean(valueOf(part)));
    element.querySelector('b').textContent = `출력 ${valueOf(part)}`;
  });
}

function placePart(type, clientX, clientY) {
  const point = worldPoint(clientX, clientY);
  addPart(type, point.x, point.y);
  status.innerHTML = '<b>부품 추가됨</b> · 타일에 맞춰 배치됩니다.';
}

// Selection is shared by Delete and copy/paste, including marquee selections.
function removeSelected() {
  if (!selectedIds.size) return;
  const removed = selectedIds;
  parts = parts.filter(part => !removed.has(part.id));
  links = links.filter(link => !removed.has(link.from) && !removed.has(link.to));
  selectedIds = new Set();
  selectedId = null;
  render();
}

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
  tile = +event.target.value;
  document.querySelector('#tile-label').textContent = tile;
  parts.forEach(part => { part.x = snap(part.x); part.y = snap(part.y); });
  applyCamera();
  render();
};

document.querySelector('#reset').onclick = () => {
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
    renderWires();
  } else if (wireDrag) {
    wirePoint = { x: event.clientX, y: event.clientY };
    renderWires();
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
  world.querySelectorAll('.node').forEach(node => {
    const bounds = node.getBoundingClientRect();
    if (bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom) {
      selectedIds.add(+node.dataset.id);
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
  renderWires();
}, { passive: false });

document.querySelector('#theme').onclick = event => {
  document.body.classList.toggle('light');
  event.currentTarget.textContent = document.body.classList.contains('light') ? '다크 테마' : '라이트 테마';
};

window.addEventListener('keydown', event => {
  if (event.target.matches('textarea, input, [contenteditable="true"]')) return;
  const modifier = event.ctrlKey || event.metaKey;
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
