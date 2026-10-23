import test from "node:test";
import assert from "node:assert/strict";
import {
  ANISONGS,
  anisongdbRefusal,
  baseTitle,
  bestScore,
  bestSource,
  isSongMedia,
  isSeasonQuery,
  parseAniSongs,
  parseCharts,
  kanaToRomaji,
  parseYouTubeSearch,
  readsAsJapanese,
  previousSeason,
  rankSongs,
  searchBody,
  seasonOf,
  songVideoUrl,
  songYouTubeViews,
  toThemeSong,
  withSongClips,
} from "../packages/shared/anisongs.ts";

// Shapes from anisongdb.com/api on 20 Oct 2026 (trimmed).
const row = (over) => ({
  annId: 13, annSongId: 25, amqSongId: 9596, animeENName: "Cowboy Bebop", animeJPName: "Cowboy Bebop",
  animeVintage: "Spring 1998", animeType: "TV", linked_ids: { myanimelist: 1, anidb: 23, anilist: 1, kitsu: 1 },
  songType: "Opening 1", songName: "Tank!", songArtist: "Seatbelts", songDifficulty: 85.0,
  songCategory: "Standard", isDub: false, isRebroadcast: false, HQ: "byvisp.webm", MQ: null, audio: "je3987.mp3",
  ...over,
});

test("anisongs: rows become songs with ids, season, kind, video and recognition", () => {
  const songs = parseAniSongs([
    row(),
    row({ annSongId: 26, songType: "Ending 1", songName: "THE REAL FOLK BLUES", songArtist: "Mai Yamane", songDifficulty: 44, HQ: null, MQ: "ffr7rh.webm" }),
    row({ annSongId: 27, songType: "Insert Song", songName: "Rush" }),
    row({ annSongId: 28, isDub: true }),
    row({ annSongId: 29, HQ: "../evil.webm", MQ: null, audio: null }),
    row(), // repeated row
  ]);
  assert.equal(songs.length, 2);
  assert.deepEqual(songs[0], {
    id: 25, anilistId: 1, malId: 1, anime: "Cowboy Bebop", animeJp: "Cowboy Bebop", season: "Spring 1998", year: 1998, format: "TV",
    kind: "OP", number: 1, title: "Tank!", artist: "Seatbelts", recognition: 85, video: "byvisp.webm", quality: "720p", audio: "je3987.mp3",
  });
  assert.equal(songs[1].kind, "ED");
  assert.equal(songs[1].quality, "480p");
  assert.equal(songVideoUrl(songs[0]), "https://naedist.animemusicquiz.com/byvisp.webm");
  assert.throws(() => parseAniSongs({ detail: "Not Found" }), /unreadable/);
});

test("anisongs: charts rank by recognition, once per song under its original show", () => {
  const songs = parseAniSongs([
    row({ annSongId: 1, songName: "crossing field", songArtist: "LiSA", animeENName: "Sword Art Online", animeVintage: "Summer 2012", songDifficulty: 80 }),
    row({ annSongId: 2, songName: "crossing field", songArtist: "LiSA", animeENName: "Sword Art Online: Extra Edition", animeVintage: "Winter 2014", songDifficulty: 88, songType: "Opening" }),
    row({ annSongId: 3, songName: "Tank!", songDifficulty: 85 }),
    row({ annSongId: 4, songName: "Quiet", songDifficulty: 10, songType: "Ending 2" }),
    row({ annSongId: 5, songName: "Unknown", songDifficulty: null }),
    row({ annSongId: 6, songName: "Audio only", songDifficulty: 99, HQ: null, MQ: null }),
  ]);
  const chart = rankSongs(songs, "OP");
  assert.deepEqual(chart.map((s) => [s.title, s.anime, s.recognition]), [
    ["crossing field", "Sword Art Online", 88],
    ["Tank!", "Cowboy Bebop", 85],
  ]);
  assert.deepEqual(rankSongs(songs, "ED").map((s) => s.title), ["Quiet"]);
  // Same year: the TV series, not its film, is the song's original show.
  const tie = parseAniSongs([
    row({ annSongId: 10, songName: "CHA-LA HEAD-CHA-LA", songArtist: "Hironobu Kageyama", animeENName: "Dragon Ball Z: Dead Zone", animeType: "Movie", animeVintage: "Summer 1989", songDifficulty: 86 }),
    row({ annSongId: 11, songName: "CHA-LA HEAD-CHA-LA", songArtist: "Hironobu Kageyama", animeENName: "Dragon Ball Z", animeType: "TV", animeVintage: "Spring 1989", songDifficulty: 84 }),
  ]);
  assert.deepEqual(rankSongs(tie).map((s) => [s.anime, s.recognition]), [["Dragon Ball Z", 86]]);
  // A show's versions of one song count once.
  const versions = parseAniSongs([
    row({ annSongId: 20, songType: "Ending 1", songName: "FLY ME TO THE MOON <YOKO TAKAHASHI Version>", songArtist: "Yoko Takahashi", animeENName: "Neon Genesis Evangelion", animeVintage: "Fall 1995", songDifficulty: 87, linked_ids: { anilist: 30 } }),
    row({ annSongId: 21, songType: "Ending 1", songName: "FLY ME TO THE MOON <Rei (#5) Remix Version>", songArtist: "Megumi Hayashibara", animeENName: "Neon Genesis Evangelion", animeVintage: "Fall 1995", songDifficulty: 87, linked_ids: { anilist: 30 } }),
  ]);
  assert.equal(rankSongs(versions, "ED").length, 1);
  assert.equal(baseTitle("crossing field ~TV ver.~"), "crossing field");
  assert.equal(baseTitle("Ora wa Ninkimono 25thMIX"), "ora wa ninkimono");
  assert.equal(baseTitle("Remix"), "remix");
  assert.equal(rankSongs(songs, null, 1).length, 1);
});

test("anisongs: best ranks what people listen to; kids' songs everyone knows drop", () => {
  const [sara, doraemon, unknown] = parseAniSongs([
    row({ annSongId: 30, songName: "SARA", songArtist: "Fence of Defense", animeENName: "City Hunter 2", animeVintage: "Spring 1988", songDifficulty: 27 }),
    row({ annSongId: 31, songName: "Doraemon no Uta", songArtist: "Kumiko Osugi", animeENName: "Doraemon", animeVintage: "Spring 1979", songDifficulty: 85 }),
    row({ annSongId: 32, songName: "Obscure", songArtist: "Nobody", animeENName: "Rare Show", animeVintage: "Fall 1987", songDifficulty: 40 }),
  ]);
  const songs = [{ ...sara, listeners: 2858 }, { ...doraemon, listeners: 27, kids: true }, unknown];
  assert.ok(Math.abs(bestScore(songs[0]) - 65.6) < 0.2);
  assert.ok(bestScore(songs[1]) < 20);
  assert.equal(bestScore(unknown), 20);
  assert.deepEqual(rankSongs(songs, "OP", 10, Infinity, "best").map((s) => s.title), ["SARA", "Obscure", "Doraemon no Uta"]);
  assert.deepEqual(rankSongs(songs, "OP", 10, Infinity, "known").map((s) => s.title), ["Doraemon no Uta", "Obscure", "SARA"]);
  // A licensed import's worldwide listeners don't count: it scores on its quiz recognition.
  const alone = { ...unknown, id: 33, title: "Alone Again", listeners: 539769, licensed: true, recognition: 29 };
  assert.equal(bestScore(alone), 14.5);
  assert.equal(rankSongs([songs[0], alone], "OP", 10, Infinity, "best")[0].title, "SARA");
});

test("anisongs: the player shape keeps only AnisongDB media hosts", () => {
  const theme = toThemeSong(parseAniSongs([row()])[0]);
  assert.equal(theme.slug, "OP1");
  assert.equal(theme.videoUrl, "https://naedist.animemusicquiz.com/byvisp.webm");
  assert.equal(theme.audioUrl, "https://naedist.animemusicquiz.com/je3987.mp3");
  assert.equal(isSongMedia(theme.videoUrl), true);
  assert.equal(isSongMedia("https://files.catbox.moe/byvisp.webm"), true);
  assert.equal(isSongMedia("http://naedist.animemusicquiz.com/byvisp.webm"), false);
  assert.equal(isSongMedia("https://evil.example/byvisp.webm"), false);
  assert.equal(isSongMedia("https://naedist.animemusicquiz.com/a/b.webm"), false);
});

test("anisongs: seasons, search bodies and chart files", () => {
  assert.deepEqual(seasonOf(new Date(Date.UTC(2026, 9, 20))), { season: "Fall", year: 2026 });
  assert.deepEqual(previousSeason("Winter", 2026), { season: "Fall", year: 2025 });
  assert.equal(isSeasonQuery("Spring", 1985, new Date(Date.UTC(2026, 9, 20))), true);
  assert.equal(isSeasonQuery("Spring", 1959), false);
  assert.equal(isSeasonQuery("Autumn", 1990), false);
  const body = searchBody("  LiSA ", "artist");
  assert.equal(body.artist_search_filter.search, "LiSA");
  assert.equal(body.anime_search_filter, undefined);
  assert.equal(body.insert_filter, false);
  const song = { ...parseAniSongs([row()])[0], cover: "https://s4.anilist.co/x.jpg", listeners: 34135 };
  const bad = { ...song, id: 2, video: "../x" };
  const charts = parseCharts({
    generatedAt: "2026-10-20T00:00:00Z",
    songs: [song, bad],
    decades: { 1990: { best: { OP: [25, 2, 999], ED: [] }, known: { OP: [25] } } },
    years: { 1998: { best: { OP: [25] } }, 1850: { best: { OP: [25] } }, x: {} },
    allTime: { known: { OP: [25] } },
  });
  assert.deepEqual(Object.keys(charts.years), ["1998"]);
  assert.equal(charts.years["1998"].best.OP[0].title, "Tank!");
  assert.equal(charts.decades["1990"].best.OP.length, 1);
  assert.equal(charts.decades["1990"].best.OP[0].cover, "https://s4.anilist.co/x.jpg");
  assert.equal(charts.decades["1990"].best.OP[0].listeners, 34135);
  assert.equal(charts.decades["1970"].known.OP.length, 0);
  assert.equal(charts.allTime.known.ED.length, 0);
  assert.deepEqual(ANISONGS.DECADES.slice(1, 4), [1970, 1980, 1990]);
});

test("anisongs: YouTube views add up everyone's uploads of the song, and only that song", () => {
  // A search page's ytInitialData, trimmed to its video renderers (YouTube, 21 Oct 2026).
  const video = (videoId, title, channel, views, length) => ({
    videoRenderer: { videoId, title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: channel }] }, viewCountText: { simpleText: views }, lengthText: { simpleText: length } },
  });
  const page = (...videos) => ({ contents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: videos } }] } } });
  const lum = parseYouTubeSearch(page(
    video("aaaaaaaaaa1", "LUM NO LOVE SONG [] Urusei Yatsura [] ENGLISH", "Frazana Chowdhury", "76,415 views", "1:30"),
    video("aaaaaaaaaa2", "ラムのラブソング", "Yuko Matsutani - Topic", "6,264,897 views", "2:44"),
    video("aaaaaaaaaa3", "Urusei Yatsura - Opening [HD Remastered]", "kakihara0", "2,289,204 views", "1:32"),
    video("aaaaaaaaaa4", "Lum no Love Song", "Yoshitakakun", "5,666,871 views", "1:31"),
    video("aaaaaaaaaa5", "Urusei Yatsura Lum no Love Song cover Sumire Uesaka full version", "Tebi", "176,669 views", "2:39"),
    video("aaaaaaaaaa6", "Urusei Yatsura BGM: Lum no Omoiyari", "Dr. Butte Fatman", "28,615 views", "1:50"),
    video("aaaaaaaaaa7", "Urusei Yatsura Intro but it's Pucca // Fan Animation Meme", "Ackella Mattis", "437,935 views", "0:33"),
    video("aaaaaaaaaa8", "Urusei Yatsura Opening 2 - Dancing Star", "someone", "300,000 views", "1:31"),
    video("aaaaaaaaaa9", "Top 100 80s anime openings", "lists", "9,000,000 views", "58:10"),
    { channelRenderer: { title: { simpleText: "not a video" } } },
  ));
  assert.equal(lum.length, 9);
  assert.deepEqual(lum[1], { id: "aaaaaaaaaa2", title: "ラムのラブソング", channel: "Yuko Matsutani - Topic", views: 6264897, seconds: 164 });
  const [song] = parseAniSongs([row({ annSongId: 40, songName: "Lum no Love Song", songArtist: "Yuko Matsutani", animeENName: "Urusei Yatsura", animeJPName: "Urusei Yatsura", animeVintage: "Fall 1981" })]);
  // Fan upload, official Topic upload, the show's opening 1 and a cover; not a bare "Lum no
  // Love Song" (a short name needs the show or artist beside it), the BGM, the meme, opening 2
  // or the countdown.
  assert.equal(songYouTubeViews(lum, song), 76415 + 6264897 + 2289204 + 176669);

  // Long vowels match either way: "Yuuko" is YouTube's "Yuko".
  const [yuuko] = parseAniSongs([row({ annSongId: 47, songName: "Lum no Love Song", songArtist: "Yuuko Matsutani", animeENName: "Urusei Yatsura", animeVintage: "Fall 1981" })]);
  assert.equal(songYouTubeViews(lum, yuuko), songYouTubeViews(lum, song));

  // A short name needs the show or the artist beside it.
  const [sara] = parseAniSongs([row({ annSongId: 41, songName: "SARA", songArtist: "Fence of Defense", animeENName: "City Hunter 2", animeJPName: "City Hunter 2", songType: "Opening 2", animeVintage: "Spring 1988" })]);
  const saraPage = parseYouTubeSearch(page(
    video("bbbbbbbbbb1", "City Hunter 2 (1988) Opening 2 - Sara", "RetroCrush", "554,471 views", "1:32"),
    video("bbbbbbbbbb2", "Sara", "Fence Of Defense - Topic", "26,048 views", "4:35"),
    video("bbbbbbbbbb3", "Sara Bareilles - Brave", "Sara Bareilles", "200,000,000 views", "4:00"),
    video("bbbbbbbbbb4", "City Hunter 2 Opening 1", "x", "100,000 views", "1:30"),
  ));
  assert.equal(songYouTubeViews(saraPage, sara), 554471 + 26048);

  // Particles can be missing, kana titles are read as romaji, and a band keeps its whole name.
  const [lupin, maruko] = parseAniSongs([
    row({ annSongId: 42, songName: "Lupin III no Theme", songArtist: "You & Explosion Band", animeENName: "Lupin III: Part II", animeJPName: "Lupin Sansei (1977)", animeVintage: "Fall 1977" }),
    row({ annSongId: 43, songName: "Odoru Ponpokorin", songArtist: "B.B.Queens", animeENName: "Chibi Maruko-chan", animeJPName: "Chibi Maruko-chan", songType: "Ending 1", animeVintage: "Winter 1990" }),
  ]);
  assert.equal(kanaToRomaji("おどるポンポコリン"), "odoruponpokorin");
  assert.equal(kanaToRomaji("ちびまる子ちゃん"), "chibimaru子chan");
  const lupinPage = parseYouTubeSearch(page(
    video("cccccccccc1", "Lupin III Theme '78", "You & Explosion Band - Topic", "3,000,000 views", "3:10"),
    video("cccccccccc2", "Lupin III (1977) Opening", "retro", "1,000,000 views", "1:40"),
    video("cccccccccc3", "Lupin III '80", "fan", "500,000 views", "3:00"),
  ));
  assert.equal(songYouTubeViews(lupinPage, lupin), 4_000_000);
  const marukoPage = parseYouTubeSearch(page(video("dddddddddd1", "ちびまる子ちゃん ED - B.B.クィーンズ「おどるポンポコリン」", "Being", "2,000,000 views", "4:20")));
  assert.equal(songYouTubeViews(marukoPage, maruko), 2_000_000);

  // Romaji that's really English ("Ai no Story") or a short Japanese name ("Jiyuu no Tsubasa")
  // needs the show or artist: AI's "Story" and Attack on Titan's song aren't God Mars' or Tylor's.
  assert.equal(readsAsJapanese("Ai no Story"), false);
  assert.equal(readsAsJapanese("YOU!YOU!YOU!"), true); // reads as romaji, but too short to stand alone
  const [tylor] = parseAniSongs([row({ annSongId: 46, songName: "Jiyuu no Tsubasa", songArtist: "T's WORK SHOP", animeENName: "The Irresponsible Captain Tylor", songType: "Ending 1", animeVintage: "Fall 1994" })]);
  const tylorPage = parseYouTubeSearch(page(video("hhhhhhhhhh1", "Attack on Titan Opening 2 | Jiyuu no Tsubasa by Linked Horizon", "Crunchyroll", "36,295,889 views", "1:30")));
  assert.equal(songYouTubeViews(tylorPage, tylor), 0);

  // A generic name needs the show or artist: Sia's "Cheap Thrills" isn't Dangaioh's.
  const [thrills] = parseAniSongs([row({ annSongId: 45, songName: "CHEAP THRILLS", songArtist: "Kenichi Takakura", animeENName: "Dangaioh", animeVintage: "Fall 1987" })]);
  const thrillsPage = parseYouTubeSearch(page(
    video("ffffffffff1", "Sia - Cheap Thrills (Official Lyric Video) ft. Sean Paul", "Sia", "2,000,000,000 views", "3:45"),
    video("ffffffffff2", "Dangaioh OP - Cheap Thrills", "retro", "40,000 views", "1:30"),
  ));
  assert.equal(songYouTubeViews(thrillsPage, thrills), 40_000);

  // A kanji title only counts once Spotify has told us the track's real name.
  const kanjiPage = parseYouTubeSearch(page(video("eeeeeeeeee1", "高橋洋子 - 残酷な天使のテーゼ", "King Records", "50,000,000 views", "4:05")));
  const [thesis] = parseAniSongs([row({ annSongId: 44, songName: "Zankoku na Tenshi no Thesis", songArtist: "Yoko Takahashi", animeENName: "Neon Genesis Evangelion", animeVintage: "Fall 1995" })]);
  assert.equal(songYouTubeViews(kanjiPage, thesis), 0);
  assert.equal(songYouTubeViews(kanjiPage, thesis, ["残酷な天使のテーゼ"]), 50_000_000);

  // A sequel's uploads often carry the first show's name: "City Hunter - Sara" for City Hunter 2.
  const saraByShow = parseYouTubeSearch(page(video("gggggggggg1", "City Hunter - Sara", "GODZAK81", "5,263,796 views", "4:33")));
  assert.equal(songYouTubeViews(saraByShow, sara), 5_263_796);

  // On one scale with Last.fm: whichever says more decides; licensed songs don't count.
  assert.ok(Math.abs(bestScore({ ...sara, views: 7_800_000 }) - 64.9) < 0.2);
  assert.ok(Math.abs(bestScore({ ...sara, views: 7_800_000, listeners: 180_000 }) - 99.8) < 0.3);
  assert.equal(bestSource({ ...sara, views: 7_800_000, listeners: 180_000 }), "listeners");
  assert.equal(bestSource({ ...sara, views: 7_800_000, listeners: 200 }), "views");
  assert.equal(bestScore({ ...sara, views: 900_000_000, licensed: true, recognition: 30 }), 15);
});

test("anisongs: title pages fill AnimeThemes' gaps with AnisongDB clips", () => {
  const clips = parseAniSongs([
    row({ annSongId: 50, songType: "Opening 1", songName: "Tank!", HQ: "aaaaaa.webm" }),
    row({ annSongId: 51, songType: "Ending 2", songName: "Blue", HQ: "bbbbbb.webm", audio: "cccccc.mp3" }),
  ]);
  const theme = (slug, videoUrl) => ({
    animeId: 1, animeTitle: "Cowboy Bebop", cover: null, slug, type: slug.slice(0, 2), title: slug, artists: [],
    episodes: null, spoiler: false, nsfw: false, audioUrl: "https://a.animethemes.moe/x.ogg", videoUrl,
  });
  const merged = withSongClips([theme("OP1", "https://v.animethemes.moe/x.webm"), theme("ED2-TV", null), theme("ED3", null)], clips);
  assert.equal(merged[0].videoUrl, "https://v.animethemes.moe/x.webm"); // creditless first
  assert.equal(merged[1].videoUrl, "https://naedist.animemusicquiz.com/bbbbbb.webm"); // ED2-TV → ED2's clip
  assert.equal(merged[2].videoUrl, null); // nothing to fill it with
  // A show AnimeThemes doesn't know: AnisongDB's songs alone.
  assert.deepEqual(withSongClips([], clips).map((s) => s.slug), ["OP1", "ED2"]);
  // Songs AnimeThemes doesn't list come after its own (God Mars has only its OP there).
  assert.deepEqual(withSongClips([theme("OP1", "https://v.animethemes.moe/x.webm")], clips).map((s) => s.slug), ["OP1", "ED2"]);
});

test("anisongs: AnisongDB's ranked-time pause reads as such, not as no songs", () => {
  assert.match(anisongdbRefusal({ detail: "Song name/artist/composer text search is disabled during ranked time" }), /ranked games/);
  assert.equal(anisongdbRefusal([]), null);
});
