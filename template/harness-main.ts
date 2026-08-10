// evenhub-dev-harness 부트스트랩 템플릿 — 프로젝트의 하니스 디렉터리로 복사해 사용.
// 필수: widgetEntry 를 자기 위젯 엔트리로 지정. 나머지 옵션은 템플릿 index.html 기본 id 와 일치(생략 가능).
//
// import 경로는 설치 방식에 따라:
//   - npm 설치(npm install <kit 경로>):  import { startHarness } from 'evenhub-dev-harness'
//   - 저장소 내 상대경로 소비:            import { startHarness } from '../../harness-kit/src/mockbridge'
import { startHarness } from 'evenhub-dev-harness'

// SPA 라우터를 쓰는 위젯이면 /harness/ 경로가 not-found 로 빠져 미마운트될 수 있다.
// 라우터에 경로를 등록하기 어려우면 아래 주석을 해제해 위젯이 루트 경로를 보게 한다.
// history.replaceState(null, '', '/')

await startHarness({
  widgetEntry: () => import('/src/main.ts'),   // ← 자기 위젯 엔트리로 변경
  // glass: '#glass', log: '#log', geoInput: '#geo',                 // 템플릿 기본값
  // buttons: { click: '#bClick', up: '#bUp', down: '#bDown', double: '#bDouble', geo: '#bGeo' },
  // capture: { containerID: 11, containerName: 'cap' },             // 위젯의 isEventCapture 컨테이너와 일치시킬 것
  // glassesInfo: { model: 'g2', sn: 'HARNESS-0001', status: { batteryLevel: 88, isWearing: true, sn: 'HARNESS-0001' } },
  // userInfo: { uid: 'harness', name: 'Harness', avatar: '', country: 'KR' },
  // defaultGeo: [37.5665, 126.978],
})
