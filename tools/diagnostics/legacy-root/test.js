const url1 = 'https://api.aniskip.com/v1/skip-times/40748/1?types=op';
const url2 = 'https://api.aniskip.com/v2/skip-times/40748/1?types[]=op';
const url3 = 'https://api.aniskip.com/api/v2/skip-times/40748/1';
const url4 = 'https://api.aniskip.com/v2/skip-times/40748/episodes/1?types[]=op';

async function t(url) {
  const r = await fetch(url);
  const text = await r.text();
  console.log(url, r.status, text.substring(0, 100));
}
Promise.all([t(url1), t(url2), t(url3), t(url4)]);
