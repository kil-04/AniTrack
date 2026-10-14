import test from "node:test";
import assert from "node:assert/strict";
import { mixRadio, parseThemesResponse, themesUrl } from "../packages/shared/anime-themes.ts";

const frieren = { id: 154587, title: "Frieren", cover: null };

// Trimmed from api.animethemes.moe (filter[external_id]=154587).
const response = {
  anime: [{
    name: "Sousou no Frieren",
    resources: [{ site: "MyAnimeList", external_id: 52991 }, { site: "AniList", external_id: 154587 }],
    animethemes: [
      { type: "ED", sequence: 1, slug: "ED1", song: { title: "Anytime Anywhere", artists: [{ name: "milet" }] },
        animethemeentries: [{ episodes: "1-14, 16", spoiler: false, nsfw: false, videos: [
          { link: "https://v.animethemes.moe/SousouNoFrieren-ED1.webm", nc: false, overlap: "None", resolution: 720,
            audio: { link: "https://a.animethemes.moe/SousouNoFrieren-ED1.ogg" } }] }] },
      { type: "OP", sequence: 1, slug: "OP1", song: { title: "Yuusha", artists: [{ name: "YOASOBI" }] },
        animethemeentries: [{ episodes: "1-16", spoiler: false, nsfw: false, videos: [
          { link: "https://v.animethemes.moe/SousouNoFrieren-OP1.webm", nc: false, overlap: "None", resolution: 720,
            audio: { link: "https://a.animethemes.moe/SousouNoFrieren-OP1-NCBD1080.ogg" } },
          { link: "https://v.animethemes.moe/SousouNoFrieren-OP1-NCBD1080.webm", nc: true, overlap: "None", resolution: 1080,
            audio: { link: "https://a.animethemes.moe/SousouNoFrieren-OP1-NCBD1080.ogg" } }] }] },
      { type: "OP", sequence: 2, slug: "OP2", song: null,
        animethemeentries: [{ episodes: "17-28", videos: [{ link: "https://evil.example/OP2.webm", audio: { link: "https://evil.example/OP2.ogg" } }] }] },
      { type: "IN", slug: "IN1", animethemeentries: [] },
    ],
  }],
};

test("parses openings first, with the creditless video and only AnimeThemes media", () => {
  const songs = parseThemesResponse(response, [frieren]).get(154587);
  assert.deepEqual(songs.map((song) => song.slug), ["OP1", "ED1"]);
  assert.equal(songs[0].title, "Yuusha");
  assert.deepEqual(songs[0].artists, ["YOASOBI"]);
  assert.equal(songs[0].videoUrl, "https://v.animethemes.moe/SousouNoFrieren-OP1-NCBD1080.webm");
  assert.equal(songs[0].audioUrl, "https://a.animethemes.moe/SousouNoFrieren-OP1-NCBD1080.ogg");
  assert.equal(songs[1].episodes, "1-14, 16");
});

test("asks for several shows in one request", () => {
  const url = themesUrl([1, 21]);
  assert.match(url, /filter\[external_id\]=1,21/);
  assert.match(url, /filter\[site\]=AniList/);
});

const song = (animeId, slug) => ({
  animeId, animeTitle: `Show ${animeId}`, cover: null, slug, type: slug.slice(0, 2), title: slug, artists: [],
  episodes: null, spoiler: false, nsfw: false, audioUrl: `https://a.animethemes.moe/${animeId}-${slug}.ogg`, videoUrl: null,
});

function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

test("the radio caps long shows and never plays a show twice in a row when it can avoid it", () => {
  const onePiece = Array.from({ length: 30 }, (_, i) => song(21, `OP${i + 1}`));
  const others = [song(1, "OP1"), song(1, "ED1"), song(5114, "OP1"), song(5114, "OP2"), song(20, "OP1")];
  for (let seed = 1; seed <= 200; seed++) {
    const mix = mixRadio([...onePiece, ...others], seeded(seed));
    assert.equal(mix.length, 9);
    assert.equal(mix.filter((s) => s.animeId === 21).length, 4);
    for (let i = 1; i < mix.length; i++) assert.notEqual(mix[i].animeId, mix[i - 1].animeId, `seed ${seed}`);
  }
});
