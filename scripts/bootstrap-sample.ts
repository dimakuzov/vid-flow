import { applyBootstrap } from "../src/lib/series/bootstrap";

const result = applyBootstrap({ overwriteDocs: true });
console.log(JSON.stringify(result, null, 2));
