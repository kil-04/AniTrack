const ENDPOINT = "https://graphql.anilist.co";
const MEDIA_FIELDS = `
  id title { romaji english } coverImage { large } bannerImage
  episodes status season seasonYear averageScore genres description(asHtml: false)
  startDate { year month day } nextAiringEpisode { airingAt episode }
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

getById(1535); // Death Note
