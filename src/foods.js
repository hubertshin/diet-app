// 내장 음식 DB(1단계 수기 시드)와 검색. kcal는 1회 제공량 기준 근사값. 정식 DB(식약처)로 교체 예정 (PRD 12절 미결 #2).
// 항목: { id, name, serving, kcal } — serving은 사람이 읽는 1인분 표기.
import { EXTRA_FOODS } from './foods-data.js';

export const SEED_FOODS = Object.freeze([
  // 밥·죽·면
  ['rice', '흰쌀밥 1공기', '210g', 310], ['rice-brown', '현미밥 1공기', '210g', 300], ['rice-half', '흰쌀밥 반공기', '105g', 155],
  ['bibimbap', '비빔밥', '1인분', 560], ['kimbap', '김밥 1줄', '230g', 480], ['chamchi-kimbap', '참치김밥 1줄', '250g', 520],
  ['kimchi-bokkeumbap', '김치볶음밥', '1인분', 600], ['bokkeumbap', '볶음밥', '1인분', 580], ['omurice', '오므라이스', '1인분', 650],
  ['deopbap-jeyuk', '제육덮밥', '1인분', 720], ['deopbap-ojingeo', '오징어덮밥', '1인분', 620], ['curry-rice', '카레라이스', '1인분', 620],
  ['juk-hobak', '호박죽', '1그릇', 230], ['juk-jeonbok', '전복죽', '1그릇', 300], ['gukbap-sundae', '순대국밥', '1인분', 620],
  ['gukbap-dwaeji', '돼지국밥', '1인분', 650], ['seolleongtang', '설렁탕', '1인분', 480], ['galbitang', '갈비탕', '1인분', 520],
  ['samgyetang', '삼계탕', '1인분', 900], ['yukgaejang', '육개장', '1인분', 450],
  ['ramyeon', '라면 1봉', '120g', 500], ['ramyeon-egg', '라면+계란', '1인분', 575], ['cup-ramyeon', '컵라면 소', '65g', 290],
  ['jajangmyeon', '짜장면', '1인분', 700], ['jjamppong', '짬뽕', '1인분', 690], ['naengmyeon', '물냉면', '1인분', 520],
  ['bibim-naengmyeon', '비빔냉면', '1인분', 580], ['kalguksu', '칼국수', '1인분', 520], ['janchi-guksu', '잔치국수', '1인분', 450],
  ['udon', '우동', '1인분', 480], ['pasta-cream', '크림파스타', '1인분', 850], ['pasta-tomato', '토마토파스타', '1인분', 600],
  ['tteokbokki', '떡볶이 1인분', '300g', 480], ['rabokki', '라볶이', '1인분', 620], ['tteokguk', '떡국', '1인분', 480],
  ['mandu-guk', '만둣국', '1인분', 500],
  // 찌개·국·반찬
  ['kimchi-jjigae', '김치찌개', '1인분', 450], ['doenjang-jjigae', '된장찌개', '1인분', 380], ['sundubu', '순두부찌개', '1인분', 420],
  ['budae-jjigae', '부대찌개', '1인분', 650], ['miyeok-guk', '미역국', '1인분', 180], ['kongnamul-guk', '콩나물국', '1인분', 60],
  ['bukeo-guk', '북엇국', '1인분', 150], ['gyeran-guk', '계란국', '1인분', 110],
  ['kimchi', '배추김치', '50g', 15], ['kkakdugi', '깍두기', '50g', 20], ['gyeran-mari', '계란말이', '100g', 200],
  ['gyeran-fry', '계란후라이 1개', '55g', 95], ['gyeran-boiled', '삶은계란 1개', '50g', 75], ['dubu', '두부 반모', '150g', 130],
  ['dubu-kimchi', '두부김치', '1인분', 400], ['jeon-kimchi', '김치전', '1장', 350], ['jeon-pa', '파전', '1장', 450],
  ['jeon-gamja', '감자전', '1장', 260], ['japchae', '잡채', '1인분', 380], ['kongnamul-muchim', '콩나물무침', '70g', 50],
  ['sigeumchi', '시금치나물', '70g', 60], ['myeolchi', '멸치볶음', '30g', 90], ['jangjorim', '장조림', '50g', 100],
  ['gim', '김 5장', '10g', 20],
  // 고기·구이
  ['samgyeopsal', '삼겹살 1인분', '200g', 660], ['samgyeopsal-100', '삼겹살', '100g', 330], ['moksal', '목살 1인분', '200g', 500],
  ['galbi-pork', '돼지갈비 1인분', '200g', 560], ['galbi-beef', '소갈비 1인분', '200g', 620], ['bulgogi', '불고기 1인분', '200g', 420],
  ['beef-sirloin', '소등심', '100g', 250], ['chicken-breast', '닭가슴살', '100g', 110], ['chicken-fried', '후라이드치킨 1조각', '100g', 280],
  ['chicken-yangnyeom', '양념치킨 1조각', '110g', 320], ['chicken-half', '치킨 반마리', '450g', 1200], ['dakgalbi', '닭갈비 1인분', '300g', 640],
  ['jeyuk', '제육볶음 1인분', '200g', 480], ['bossam', '보쌈 1인분', '200g', 520], ['jokbal', '족발 1인분', '250g', 700],
  ['sundae', '순대 1인분', '200g', 380], ['tonkatsu', '돈가스', '1인분', 750], ['hamburg-steak', '함박스테이크', '1인분', 650],
  ['steak', '스테이크', '200g', 540], ['lamb', '양꼬치 10개', '200g', 600], ['dak-dori', '닭볶음탕 1인분', '300g', 520],
  // 해산물
  ['saengseon-gui', '생선구이(고등어)', '1토막', 250], ['yeoneo', '연어구이', '100g', 200], ['hoe', '회 1인분', '150g', 180],
  ['chobap', '초밥 10개', '300g', 520], ['ojingeo-bokkeum', '오징어볶음', '1인분', 350], ['saewoo-twigim', '새우튀김 3개', '90g', 240],
  ['chamchi-can', '참치캔 소', '100g', 150], ['haemul-pajeon', '해물파전', '1장', 520],
  // 빵·간식·패스트푸드
  ['bread', '식빵 1장', '35g', 95], ['toast', '토스트', '1개', 420], ['bagel', '베이글', '1개', 280], ['croissant', '크루아상', '1개', 300],
  ['sandwich', '샌드위치', '1개', 400], ['hamburger', '햄버거', '1개', 550], ['cheeseburger', '치즈버거', '1개', 600],
  ['burger-set', '햄버거 세트', '1세트', 1050], ['fries', '감자튀김 M', '115g', 350], ['pizza', '피자 1조각', '120g', 300],
  ['pizza-2', '피자 2조각', '240g', 600], ['hotdog', '핫도그', '1개', 300], ['donut', '도넛', '1개', 280], ['cake', '케이크 1조각', '100g', 350],
  ['cookie', '쿠키', '1개', 120], ['chocolate', '초콜릿', '30g', 160], ['chips', '감자칩 1봉', '60g', 330], ['saeukkang', '새우깡 1봉', '90g', 450],
  ['tteok', '떡 (인절미)', '100g', 220], ['hotteok', '호떡', '1개', 230], ['bungeoppang', '붕어빵', '1개', 140], ['gyeran-ppang', '계란빵', '1개', 180],
  ['tteokkochi', '떡꼬치', '1개', 200], ['gimari', '김말이 3개', '90g', 240], ['twigim', '튀김 모둠 3개', '120g', 330],
  ['samgak-kimbap', '삼각김밥', '1개', 180], ['bibim-samgak', '전주비빔 삼각김밥', '1개', 200], ['dosirak', '편의점 도시락', '1개', 700],
  ['gyeran-sandwich', '계란 샌드위치', '1개', 350], ['protein-bar', '단백질바', '1개', 200], ['siriel', '시리얼+우유', '1그릇', 300],
  ['gogooma', '고구마 1개', '150g', 190], ['gamja', '찐감자 1개', '130g', 110], ['oksusu', '옥수수 1개', '200g', 190],
  // 과일·채소
  ['apple', '사과 1개', '250g', 130], ['banana', '바나나 1개', '120g', 105], ['orange', '오렌지 1개', '200g', 90],
  ['tangerine', '귤 1개', '100g', 40], ['grape', '포도', '100g', 60], ['watermelon', '수박 1조각', '300g', 90], ['strawberry', '딸기 10개', '150g', 50],
  ['kiwi', '키위 1개', '80g', 50], ['tomato', '토마토 1개', '200g', 35], ['cherry-tomato', '방울토마토 10개', '150g', 25],
  ['salad', '샐러드 (드레싱 포함)', '1접시', 200], ['salad-plain', '채소 샐러드 (무드레싱)', '1접시', 50], ['avocado', '아보카도 반개', '70g', 110],
  // 유제품·음료·술
  ['milk', '우유 1컵', '200ml', 125], ['milk-low', '저지방우유 1컵', '200ml', 85], ['soymilk', '두유 1팩', '190ml', 120],
  ['yogurt', '요거트 1개', '85g', 80], ['greek-yogurt', '그릭요거트', '100g', 100], ['cheese', '치즈 1장', '20g', 65],
  ['americano', '아메리카노', '1잔', 10], ['latte', '카페라떼', '1잔', 180], ['vanilla-latte', '바닐라라떼', '1잔', 250],
  ['cola', '콜라 1캔', '355ml', 150], ['cola-zero', '제로콜라', '355ml', 0], ['cider', '사이다 1캔', '355ml', 145],
  ['juice-orange', '오렌지주스 1컵', '200ml', 90], ['ion', '이온음료', '500ml', 125], ['bubble-tea', '버블티', '1잔', 400],
  ['beer', '맥주 1잔', '500ml', 200], ['beer-can', '맥주 1캔', '355ml', 145], ['soju', '소주 1잔', '50ml', 65], ['soju-bottle', '소주 1병', '360ml', 410],
  ['makgeolli', '막걸리 1사발', '250ml', 130], ['wine', '와인 1잔', '150ml', 125], ['highball', '하이볼 1잔', '300ml', 150],
  ['water', '물', '500ml', 0], ['nuts', '견과류 한 줌', '30g', 180], ['almond', '아몬드 10알', '12g', 70],
  ['ice-cream', '아이스크림 1개', '90ml', 200], ['bingsu', '빙수', '1그릇', 600],
].map(([id, name, serving, kcal]) => Object.freeze({ id, name, serving, kcal })));

export const ALL_FOODS = Object.freeze([...SEED_FOODS, ...EXTRA_FOODS]);

// ---------- 한글 초성 검색 ----------
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export function toChosung(str) {
  let out = '';
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) out += CHO[Math.floor((code - 0xac00) / 588)];
    else out += ch;
  }
  return out;
}
function isChosungQuery(q) {
  return q.length > 0 && [...q].every(ch => CHO.includes(ch) || ch === ' ');
}
function norm(s) { return s.toLowerCase().replace(/\s+/g, ''); }

// 검색 동의어: 질의에 왼쪽 단어가 있으면 오른쪽 단어들로 바꾼 질의도 함께 시도한다 (이름 표기가 달라도 찾히게).
export const SYNONYMS = Object.freeze([
  ['스시', ['초밥']], ['초밥', ['스시']], ['사시미', ['회']], ['돈까스', ['돈가스', '카츠']], ['돈가스', ['돈까스', '카츠']], ['카츠', ['돈가스']],
  ['라멘', ['라면']], ['라면', ['라멘']], ['덮밥', ['동']], ['튀김', ['텐푸라', '카츠']], ['계란', ['달걀']], ['달걀', ['계란']],
  ['닭', ['치킨']], ['치킨', ['닭']], ['소고기', ['쇠고기', '우']], ['쇠고기', ['소고기']], ['커피', ['아메리카노', '라떼']], ['빵', ['베이글', '크루아상', '식빵']],
  ['콜라', ['코크']], ['맥주', ['비어']], ['고기', ['삼겹살', '목살', '갈비']],
]);
export function expandQuery(q, synonyms = SYNONYMS) {
  const out = new Set([q]);
  for (const [from, tos] of synonyms) if (q.includes(from)) for (const to of tos) out.add(q.replace(from, to));
  return [...out];
}

// 이름 일치 판정. synonyms 를 바꿔 끼우면 운동 DB(exercises.js)처럼 다른 사전에도 같은 검색(부분 일치·초성·동의어)을 쓸 수 있다.
export function matches(name, query, synonyms = SYNONYMS) {
  const q = norm(query);
  if (!q) return false;
  if (isChosungQuery(q)) return norm(toChosung(name)).includes(q);
  const n = norm(name);
  return expandQuery(q, synonyms).some(x => n.includes(x));
}

// 검색 정렬: 즐겨찾기 → 최근 → DB. recent/favorites는 음식 id 집합. customs는 사용자 직접 입력 항목.
export function searchFoods(query, { foods = ALL_FOODS, customs = [], favorites = new Set(), recent = new Set(), limit = 30 } = {}) {
  const all = [...customs, ...foods];
  const hits = all.filter(f => matches(f.name, query));
  const rank = f => (favorites.has(f.id) ? 0 : recent.has(f.id) ? 1 : 2);
  hits.sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length);
  return hits.slice(0, limit);
}

export function findFood(id, customs = []) {
  return customs.find(f => f.id === id) || ALL_FOODS.find(f => f.id === id) || null;
}
