import { AnimePaheProvider } from "../electron/services/providers/animepahe";

async function test() {
  const p = new AnimePaheProvider();
  try {
    const res = await p.getEpisodes("12850937-ff70-cccd-32d2-8b63e696f5b9", 1);
    console.log(res);
  } catch(e) {
    console.error(e);
  }
}

test();
