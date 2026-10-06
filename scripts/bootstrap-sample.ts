import { applyBootstrap } from "../src/lib/series/bootstrap";
import { prepareDataRoot } from "../src/lib/series/paths";

prepareDataRoot();

const result = applyBootstrap({
  overwriteDocs: true,
  episodeId: process.env.EPISODE_ID || "e01",
});
console.log(JSON.stringify(result, null, 2));
