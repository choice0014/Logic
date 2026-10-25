#!/usr/bin/env node
/* Persistent command-line interface for AI agents and shell scripts. */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const LogicCore = require('./src/circuit-core.js');

const gates = new Set(LogicCore.gateTypes);
const args = process.argv.slice(2);
let file = path.resolve('logic-circuit.json');
let json = false;

// Parse CLI-wide options before the circuit command.
for (let index = 0; index < args.length;) {
  if (args[index] === '--file') {
    file = path.resolve(args[index + 1]);
    args.splice(index, 2);
  } else if (args[index] === '--json') {
    json = true;
    args.splice(index, 1);
  } else {
    index++;
  }
}

function loadCircuit() {
  if (!fs.existsSync(file)) return { parts: [], links: [] };
  const circuit = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(circuit.parts) || !Array.isArray(circuit.links)) {
    throw new Error('회로 파일 형식이 올바르지 않습니다.');
  }
  return circuit;
}

// CLI state is persisted separately so each command can be run by an agent.
let circuit = loadCircuit();
const findPart = id => circuit.parts.find(part => part.id === id);
const saveCircuit = () => fs.writeFileSync(file, `${JSON.stringify(circuit, null, 2)}\n`);
const fail = message => { throw new Error(message); };

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

// Circuit commands. Mutating operations save immediately for one-command workflows.
function execute(words) {
  const [command, ...values] = words;
  if (!command || command === 'help') return { message: helpText };

  if (command === 'reset') {
    circuit = { parts: [], links: [] };
    saveCircuit();
    return { message: '회로를 초기화했습니다.' };
  }

  if (command === 'add') {
    const [kind, id, typeOrValue] = values;
    if (!kind || !id || findPart(id)) {
      fail('사용법: add input ID [0|1] | add gate ID AND|OR|NOT|XOR | add output ID | add memo ID [내용]');
    }

    let part;
    if (kind === 'input') {
      part = { id, type: 'input', value: +(typeOrValue === '1') };
    } else if (kind === 'gate' && gates.has((typeOrValue || '').toUpperCase())) {
      part = { id, type: typeOrValue.toUpperCase() };
    } else if (kind === 'output' || kind === 'lamp') {
      part = { id, type: 'output' };
    } else if (kind === 'memo') {
      part = { id, type: 'memo', text: values.slice(2).join(' ') };
    } else {
      fail(`알 수 없는 부품 종류: ${kind}`);
    }

    circuit.parts.push(part);
    saveCircuit();
    return { message: `${id} 추가됨`, part };
  }

  if (command === 'set') {
    const [id, bit] = values;
    const part = findPart(id);
    if (!part || part.type !== 'input' || !['0', '1'].includes(bit)) {
      fail('사용법: set INPUT_ID 0|1');
    }
    part.value = +bit;
    saveCircuit();
    return { message: `${id} = ${bit}`, part };
  }

  if (command === 'connect') {
    const [from, to] = values;
    const sourcePort = /^([^.]+)\.out$/i.exec(from || '');
    const targetPort = /^([^.]+)\.([^.]+)$/i.exec(to || '');
    if (!sourcePort || !targetPort) {
      fail('사용법: connect SOURCE.out GATE.A|GATE.B|OUTPUT.in');
    }

    const source = findPart(sourcePort[1]);
    const target = findPart(targetPort[1]);
    const input = targetPort[2].toUpperCase();
    if (!source || !target || source.type === 'output' || source.type === 'memo') {
      fail('연결할 출력 또는 입력 오브젝트가 없습니다.');
    }
    const valid = target.type === 'output'
      ? input === 'IN'
      : gates.has(target.type) && (input === 'A' || (input === 'B' && target.type !== 'NOT'));
    if (!valid || source.id === target.id) fail(`잘못된 연결 포트: ${to}`);

    circuit.links = circuit.links.filter(link => !(link.to === target.id && link.input === input));
    circuit.links.push({ from: source.id, to: target.id, input });
    saveCircuit();
    return { message: `${from} → ${to} 연결됨` };
  }

  if (command === 'disconnect') {
    const [port] = values;
    const match = /^([^.]+)\.([^.]+)$/i.exec(port || '');
    if (!match || !findPart(match[1])) {
      fail('사용법: disconnect OBJECT.out|OBJECT.A|OBJECT.B|OBJECT.in');
    }
    const id = match[1];
    const name = match[2].toUpperCase();
    const before = circuit.links.length;
    circuit.links = circuit.links.filter(link => name === 'OUT'
      ? link.from !== id
      : !(link.to === id && link.input === name));
    saveCircuit();
    return { message: `${before - circuit.links.length}개 연결 해제됨` };
  }

  if (command === 'delete') {
    const [id] = values;
    if (!findPart(id)) fail(`오브젝트를 찾을 수 없습니다: ${id}`);
    circuit.parts = circuit.parts.filter(part => part.id !== id);
    circuit.links = circuit.links.filter(link => link.from !== id && link.to !== id);
    saveCircuit();
    return { message: `${id} 삭제됨` };
  }

  if (command === 'list') return { parts: circuit.parts, links: circuit.links };

  if (command === 'eval') {
    const evaluate = LogicCore.createEvaluator(circuit);
    const outputs = Object.fromEntries(circuit.parts
      .filter(part => part.type === 'output')
      .map(part => [part.id, evaluate(part.id)]));
    const gateValues = Object.fromEntries(circuit.parts
      .filter(part => gates.has(part.type))
      .map(part => [part.id, evaluate(part.id)]));
    return { outputs, gates: gateValues };
  }

  if (command === 'truth-table') {
    const inputs = circuit.parts.filter(part => part.type === 'input');
    if (inputs.length > 12) fail('진리표는 입력 12개 이하만 지원합니다.');
    const rows = Array.from({ length: 2 ** inputs.length }, (_, row) => {
      const values = Object.fromEntries(inputs.map((part, index) => [
        part.id,
        row >> (inputs.length - index - 1) & 1
      ]));
      const evaluate = LogicCore.createEvaluator(circuit, values);
      const outputs = Object.fromEntries(circuit.parts
        .filter(part => part.type === 'output')
        .map(part => [part.id, evaluate(part.id)]));
      return { ...values, ...outputs };
    });
    return { rows };
  }

  fail(`알 수 없는 명령: ${command}`);
}

function run(words) {
  try {
    const result = execute(words);
    console.log(json ? JSON.stringify({ ok: true, ...result }) : result.message || JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(json ? JSON.stringify({ ok: false, error: error.message }) : `오류: ${error.message}`);
    if (process.argv.length > 2) process.exitCode = 1;
  }
}

if (args.length) {
  run(args);
} else if (process.stdin.isTTY) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'logic> ' });
  console.log(helpText);
  prompt.prompt();
  prompt.on('line', line => {
    if (line.trim() === 'exit' || line.trim() === 'quit') return prompt.close();
    const words = line.match(/"[^"]*"|'[^']*'|\S+/g)?.map(word => word.replace(/^['"]|['"]$/g, '')) || [];
    run(words);
    prompt.prompt();
  });
} else {
  console.log(helpText);
}
