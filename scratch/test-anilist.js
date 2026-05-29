const ENDPOINT = "https://graphql.anilist.co";
const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  description(asHtml: false)
  episodes
  duration
  status
  coverImage { extraLarge large color }
  bannerImage
  genres
  averageScore
  seasonYear
  studios(isMain: true) { nodes { name } }
`;

async function getById(id) {
  const query = `query($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`;
  const variables = { id };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  console.log("Status:", res.status);
  const json = await res.json();
  console.log("Response:", JSON.stringify(json, null, 2));
}

getById("1535"); // Death Note (string ID)
