# logic

Electron 기반 논리 회로 시뮬레이터.

```sh
npm install
npm start
```

## 데스크톱 실행 파일 빌드

빌드 산출물은 저장소에 포함하지 않습니다. 의존성을 설치한 뒤 대상 OS에서 빌드하세요.

```sh
npm install
npm run dist:linux  # AppImage, deb
npm run dist:win    # NSIS 설치 파일, zip
npm run dist:mac    # dmg, zip
```

각 OS에서 저장소를 내려받고 해당 OS에서 직접 빌드합니다. Linux용은 Linux에서, Windows용은 Windows에서, macOS용은 macOS에서 실행하세요.

```sh
git clone https://github.com/choice0014/Logic.git
cd Logic
npm install
```

대상 OS에 맞춰 하나를 실행하면 결과물이 `dist/`에 생성됩니다.

```sh
npm run dist:linux  # Linux: AppImage, deb
npm run dist:win    # Windows: NSIS 설치 파일, zip
npm run dist:mac    # macOS: dmg, zip
```

Linux 앱은 현재 환경 호환을 위해 Chromium sandbox 없이 시작합니다.

Windows/macOS 코드 서명 인증서는 설정하지 않았습니다. 따라서 해당 OS에서 첫 실행 시 보안 확인이 표시될 수 있습니다.

오브젝트를 클릭해 선택한 뒤 `Delete`로 삭제하고 `Ctrl+C` / `Ctrl+V`로 복사·붙여넣기.
메모는 상단 제목 부분을 드래그해 이동하고, 본문에 입력.

## CLI

AI나 스크립트에서 `node logic-cli.cjs --json ...` 또는 `npm run cli -- --json ...`로 조작할 수 있습니다. 기본 회로 파일은 현재 디렉터리의 `logic-circuit.json`입니다.

```sh
node logic-cli.cjs reset
node logic-cli.cjs add input A 1
node logic-cli.cjs add input B 1
node logic-cli.cjs add gate G1 AND
node logic-cli.cjs add output L1
node logic-cli.cjs connect A.out G1.A
node logic-cli.cjs connect B.out G1.B
node logic-cli.cjs connect G1.out L1.in
node logic-cli.cjs --json eval
```

명령 없이 실행하면 대화형 CLI가 열립니다. `--file PATH`로 회로 파일을 바꿀 수 있습니다.
