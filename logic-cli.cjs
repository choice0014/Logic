#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const gates = new Set(['AND', 'OR', 'NOT', 'XOR']);
const args = process.argv.slice(2);
let file = path.resolve('logic-circuit.json'), json = false;
for (let i = 0; i < args.length;) {
  if (args[i] === '--file') { file = path.resolve(args[i + 1]); args.splice(i, 2); }
  else if (args[i] === '--json') { json = true; args.splice(i, 1); }
  else i++;
}

function load() {
  if (!fs.existsSync(file)) return { parts: [], links: [] };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.parts) || !Array.isArray(data.links)) throw Error('회로 파일 형식이 올바르지 않습니다.');
  return data;
}
let circuit = load();
const find = id => circuit.parts.find(p => p.id === id);
const save = () => fs.writeFileSync(file, JSON.stringify(circuit, null, 2) + '\n');
const fail = message => { throw Error(message); };

function evaluate(id, values, stack = []) {
  const part = find(id);
  if (!part) fail(`오브젝트를 찾을 수 없습니다: ${id}`);
  if (part.type === 'input') return values[part.id] ?? part.value;
  if (stack.includes(id)) fail(`순환 연결이 있습니다: ${[...stack, id].join(' → ')}`);
  const incoming = port => {
    const link = circuit.links.find(l => l.to === id && l.input === port);
    return link ? evaluate(link.from, values, [...stack, id]) : 0;
  };
  if (part.type === 'output') return incoming('in');
  const a = incoming('A'), b = incoming('B');
  return part.type === 'AND' ? +(!!a && !!b) : part.type === 'OR' ? +(!!a || !!b) : part.type === 'XOR' ? +(!!a !== !!b) : +!a;
}

function execute(words) {
  const [command, ...a] = words;
  if (!command || command === 'help') return { message: helpText };
  if (command === 'reset') { circuit = { parts: [], links: [] }; save(); return { message: '회로를 초기화했습니다.' }; }
  if (command === 'add') {
    const [kind, id, typeOrValue] = a;
    if (!kind || !id || find(id)) fail('사용법: add input ID [0|1] | add gate ID AND|OR|NOT|XOR | add output ID | add memo ID [내용]');
    let part;
    if (kind === 'input') part = { id, type: 'input', value: +(typeOrValue === '1') };
    else if (kind === 'gate' && gates.has((typeOrValue || '').toUpperCase())) part = { id, type: typeOrValue.toUpperCase() };
    else if (kind === 'output' || kind === 'lamp') part = { id, type: 'output' };
    else if (kind === 'memo') part = { id, type: 'memo', text: a.slice(2).join(' ') };
    else fail(`알 수 없는 부품 종류: ${kind}`);
    circuit.parts.push(part); save(); return { message: `${id} 추가됨`, part };
  }
  if (command === 'set') {
    const [id, bit] = a, p = find(id);
    if (!p || p.type !== 'input' || !['0', '1'].includes(bit)) fail('사용법: set INPUT_ID 0|1');
    p.value = +bit; save(); return { message: `${id} = ${bit}`, part: p };
  }
  if (command === 'connect') {
    const [from, to] = a, src = /^([^.]+)\.out$/i.exec(from || ''), dst = /^([^.]+)\.([^.]+)$/i.exec(to || '');
    if (!src || !dst) fail('사용법: connect SOURCE.out GATE.A|GATE.B|OUTPUT.in');
    const source = find(src[1]), target = find(dst[1]), input = dst[2].toUpperCase();
    if (!source || !target || source.type === 'output' || source.type === 'memo') fail('연결할 출력 또는 입력 오브젝트가 없습니다.');
    const valid = target.type === 'output' ? input === 'IN' : gates.has(target.type) && (input === 'A' || input === 'B' && target.type !== 'NOT');
    if (!valid || source.id === target.id) fail(`잘못된 연결 포트: ${to}`);
    circuit.links = circuit.links.filter(l => !(l.to === target.id && l.input === input));
    circuit.links.push({ from: source.id, to: target.id, input }); save();
    return { message: `${from} → ${to} 연결됨` };
  }
  if (command === 'disconnect') {
    const [port] = a, m = /^([^.]+)\.([^.]+)$/i.exec(port || '');
    if (!m || !find(m[1])) fail('사용법: disconnect OBJECT.out|OBJECT.A|OBJECT.B|OBJECT.in');
    const id = m[1], name = m[2].toUpperCase(), before = circuit.links.length;
    circuit.links = circuit.links.filter(l => name === 'OUT' ? l.from !== id : !(l.to === id && l.input === name));
    save(); return { message: `${before - circuit.links.length}개 연결 해제됨` };
  }
  if (command === 'delete') {
    const [id] = a;
    if (!find(id)) fail(`오브젝트를 찾을 수 없습니다: ${id}`);
    circuit.parts = circuit.parts.filter(p => p.id !== id);
    circuit.links = circuit.links.filter(l => l.from !== id && l.to !== id); save();
    return { message: `${id} 삭제됨` };
  }
  if (command === 'list') return { parts: circuit.parts, links: circuit.links };
  if (command === 'eval') {
    const outputs = Object.fromEntries(circuit.parts.filter(p => p.type === 'output').map(p => [p.id, evaluate(p.id)]));
    const gatesOut = Object.fromEntries(circuit.parts.filter(p => gates.has(p.type)).map(p => [p.id, evaluate(p.id)]));
    return { outputs, gates: gatesOut };
  }
  if (command === 'truth-table') {
    const inputs = circuit.parts.filter(p => p.type === 'input');
    if (inputs.length > 12) fail('진리표는 입력 12개 이하만 지원합니다.');
    const saved = Object.fromEntries(inputs.map(p => [p.id, p.value]));
    const rows = Array.from({ length: 2 ** inputs.length }, (_, n) => {
      const values = Object.fromEntries(inputs.map((p, i) => [p.id, n >> (inputs.length - i - 1) & 1]));
      return { ...values, ...Object.fromEntries(circuit.parts.filter(p => p.type === 'output').map(p => [p.id, evaluate(p.id, values)])) };
    });
    inputs.forEach(p => { p.value = saved[p.id]; });
    return { rows };
  }
  fail(`알 수 없는 명령: ${command}`);
}

const helpText = `logic CLI — state: ${file}
  add input A [0|1]        입력 추가
  add gate G1 AND|OR|NOT|XOR
  add output L1            출력 램프 추가
  add memo M1 [내용]       메모 추가
  connect A.out G1.A       출력에서 입력으로 연결
  disconnect G1.A          포트 연결 해제
  set A 1                  입력값 변경
  eval                     게이트와 램프 출력 계산
  truth-table              전체 입력 진리표 출력
  list                     부품 및 연결 목록
  delete G1                부품과 연결 삭제
  reset                    회로 초기화
  --json                   기계가 읽기 쉬운 JSON 출력
  --file PATH              회로 파일 지정`;

function run(words) {
  try {
    const result = execute(words);
    console.log(json ? JSON.stringify({ ok: true, ...result }) : result.message || JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(json ? JSON.stringify({ ok: false, error: error.message }) : `오류: ${error.message}`);
    if (process.argv.length > 2) process.exitCode = 1;
  }
}

if (args.length) run(args);
else if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'logic> ' });
  console.log(helpText); rl.prompt();
  rl.on('line', line => { if (line.trim() === 'exit' || line.trim() === 'quit') return rl.close(); run(line.match(/"[^"]*"|'[^']*'|\S+/g)?.map(s => s.replace(/^['"]|['"]$/g, '')) || []); rl.prompt(); });
} else console.log(helpText);
