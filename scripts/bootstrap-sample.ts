import { applyBootstrap } from "../src/lib/series/bootstrap";

const result = applyBootstrap({
  overwriteDocs: true,
  episodeId: process.env.EPISODE_ID || "e01",
});
console.log(JSON.stringify(result, null, 2));
