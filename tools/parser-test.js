// Проверка разбора сообщений: node tools/parser-test.js
// Загружает assets/app.js с заглушками DOM и прогоняет реальные сообщения из переписки.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function fakeElement() {
  const node = {
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    className: '',
    dataset: {},
    checked: false,
    addEventListener() {},
    appendChild() {},
    getAttribute() { return ''; },
    classList: { toggle() {}, add() {}, remove() {} }
  };
  return node;
}

const document = {
  addEventListener() {},
  getElementById: () => fakeElement(),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => fakeElement()
};

const window = {
  localStorage: { getItem: () => null, setItem() {} },
  scrollTo() {},
  addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} })
};
window.document = document;

const sandbox = { window, document, setTimeout, clearTimeout, console, Map, Set, Array, Math, String, parseInt, navigator: {} };
sandbox.window.window = sandbox.window;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'app.js'), 'utf8'), sandbox);

const P = sandbox.window.__parser;

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log('  ok  ' + name);
  } else {
    failed++;
    console.log('FAIL  ' + name + '\n      получили: ' + a + '\n      ожидали:  ' + e);
  }
}

const uniq = (list) => Array.from(new Set(list)).sort((a, b) => a - b);

console.log('\n— мусор не попадает в номера —');
check('время и дата', uniq(P.extractNumbers('У меня В наличии на 30.10: 201 210 11:43')), [201, 210]);
check('год и цена', uniq(P.extractNumbers('Наклейка panini рпл 2025-2026  11 ₽  — есть 358')), [358]);
check('диапазон', uniq(P.extractNumbers('нужны 120-125')), [120, 121, 122, 123, 124, 125]);
check('кратность', P.extractNumbers('16x2 и 18'), [16, 16, 18]);
check('большой диапазон', uniq(P.extractNumbers('вклеено 1-200, 250-252')).length, 203);
check('повтор = две штуки', P.extractNumbers('6, 16, 13, 10, 15, 16'), [6, 16, 13, 10, 15, 16]);
check('точка с запятой как разделитель', uniq(P.extractNumbers('3; 4; 14; 20;22, 25')), [3, 4, 14, 20, 22, 25]);

console.log('\n— разбор сообщения собеседника —');
const msg1 = [
  'Здравствуйте. Я не против.',
  '',
  'Я Ищу РПЛ 2025-2026',
  '',
  '6, 8, 15, 21, 27, 42, 43, 62',
  '',
  'У меня В наличии на 30.10:',
  '201 210 214 249 252 255 303 306'
].join('\n');
let r1 = P.splitMessage(msg1);
check('ищет', uniq(r1.need), [6, 8, 15, 21, 27, 42, 43, 62]);
check('есть', uniq(r1.have), [201, 210, 214, 249, 252, 255, 303, 306]);
check('без хвостов', r1.unknown, []);

const msg2 = [
  'Мне нужно 6, 15, 27, 43, 80, 87, 121',
  'Для вас есть 201, 214, 255, 306, 307, 310'
].join('\n');
let r2 = P.splitMessage(msg2);
check('нужно', uniq(r2.need), [6, 15, 27, 43, 80, 87, 121]);
check('для вас есть', uniq(r2.have), [201, 214, 255, 306, 307, 310]);

const msg3 = [
  'Мое наличие, посмотрите, что вам нужно',
  'Краснодар:',
  '6, 16, 13, 10, 15',
  'Зенит:',
  '43, 44, 45'
].join('\n');
let r3 = P.splitMessage(msg3);
check('наличие важнее «нужно» в той же строке', uniq(r3.have), [6, 10, 13, 15, 16, 43, 44, 45]);
check('список команд не создаёт хвостов', r3.unknown, []);

const msgOneLine = 'Ищу 6, 15, 27, 43, 80, 87, 121. В наличии: 201 214 255 306 310';
let rOne = P.splitMessage(msgOneLine);
check('одна строка, два раздела — ищет', uniq(rOne.need), [6, 15, 27, 43, 80, 87, 121]);
check('одна строка, два раздела — есть', uniq(rOne.have), [201, 214, 255, 306, 310]);

const msg4 = '12, 34, 56';
let r4 = P.splitMessage(msg4);
check('без ключевых слов — в «не понял»', uniq(r4.unknown), [12, 34, 56]);

console.log('\n— список из объявления: 232(3) — три штуки —');
const advert = [
  'Есть в наличии:',
  '2(2),10,13,22,25,30,38(2),44(2),46,47,52,59,76,78(2),81(2),83,85,87,90(2),92,93,94,96(2),101,102,104,105,',
  '114,115,119,121,123,128,135(2),140,141,142,150,154,157(2),171,174(2),178,191(2),192(2),197,198(2),201,211(2),',
  '212,215(2),217,218(4),219(2),220,221,223,225,232(3),238,243,247(2),248(2),249,251,256,261(2),262,264,',
  '266,267,271,273,275(3),278,282(3),284,288,295(2),298,303(3),306(4),307(2),308(2),310,311,313,314,316,',
  '317(2),320,321,328,330,333(3),338,339,344(3),351(2),354,356,357,358(2),363(2),366(2),371,374(2),375,',
  '376(2),377,381,383(3),385,391(2),392(2),393,395,400,401,403(5),405,408,410,412,413,416,418,419,421,',
  '424,429,432(2),434(2),436,441,444,445(2),447,452,453,454(3),460.'
].join('\n');
const rAd = P.splitMessage(advert);
const adHave = P.countMap(advert);
check('весь список — «у него есть»', [rAd.unknown.length, rAd.need.length], [0, 0]);
check('скобки не создают номера 3, 4, 5', [adHave.has(3), adHave.has(4), adHave.has(5)], [false, false, false]);
check('2(2) — две штуки', adHave.get(2), 2);
check('232(3) — три штуки', adHave.get(232), 3);
check('218(4) — четыре штуки', adHave.get(218), 4);
check('403(5) — пять штук', adHave.get(403), 5);

console.log('\n— форматирование —');
check('кратность в выводе', P.formatList(P.countMap('16 16 3')), '3, 16×2');

// то, что приложение написало само, оно должно и прочитать обратно без искажений
const tidied = P.formatList(adHave);
const reread = P.countMap(tidied);
check('свой же вывод читается обратно', [reread.size, reread.get(218), reread.get(403)],
  [adHave.size, 4, 5]);
check('знак × не плодит номера', [reread.has(3), reread.has(4), reread.has(5)], [false, false, false]);

console.log('');
if (failed) {
  console.log(failed + ' проверок не прошло');
  process.exit(1);
}
console.log('Все проверки прошли');
