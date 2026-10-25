# logic

Electron 기반 논리 회로 시뮬레이터.

```sh
npm install
npm start
```

## 데스크톱 실행 파일 빌드

빌드 산출물은 저장소에 포함하지 않습니다. 저장소를 내려받은 뒤 각 OS에서 의존성을 설치하고 그 OS의 명령을 실행하세요.

```sh
git clone https://github.com/choice0014/Logic.git
cd Logic
npm install

npm run dist:linux  # Linux: AppImage, deb
npm run dist:win    # Windows: NSIS 설치 파일, zip
npm run dist:mac    # macOS: dmg, zip
```

Linux 앱은 현재 환경 호환을 위해 Chromium sandbox 없이 시작합니다.

Windows/macOS 코드 서명 인증서는 설정하지 않았습니다. 따라서 해당 OS에서 첫 실행 시 보안 확인이 표시될 수 있습니다.

오브젝트를 클릭해 선택한 뒤 `Delete`로 삭제하고 `Ctrl+C` / `Ctrl+V`로 복사·붙여넣기.
메모는 상단 제목 부분을 드래그해 이동하고, 본문에 입력.
`Ctrl+Z` / `Ctrl+Y`로 회로 편집을 실행 취소/다시 실행합니다. `Ctrl+S`는 처음 저장할 때 파일을 선택하고, 이후에는 현재 파일에 저장합니다. 열기/저장 버튼으로 JSON 회로 파일을 불러오거나 저장할 수도 있습니다. 방향키는 선택된 부품을 한 타일 이동하고, 선택이 없으면 캔버스를 이동합니다. 메모 편집 중에는 텍스트 편집기 단축키를 유지합니다.

상단의 **열기** / **저장** 버튼으로 JSON 회로 파일을 불러오거나 저장할 수 있습니다.

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

## 코드 구성

- `index.html`: 앱 화면 구조와 정적 문구
- `styles.css`: 화면 스타일과 테마
- `src/renderer.js`: 캔버스, 입력 처리, 오브젝트 표시
- `src/circuit-core.js`: CLI와 UI가 공유하는 회로 평가기
- `preload.cjs`: 회로 파일 대화상자 IPC의 최소 API
- `logic-cli.cjs`: 자동화용 명령줄 인터페이스
- `start.cjs`: OS별 Electron 개발 실행 옵션
- `main.cjs`: Electron 창과 앱 생명주기
