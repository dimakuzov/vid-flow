import { startComfyQueue } from "../src/lib/comfy/queue";
import { prepareDataRoot } from "../src/lib/series/paths";

prepareDataRoot();
startComfyQueue();
console.log("comfy queue watches data/comfy_queue");
