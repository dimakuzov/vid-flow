// Отладка очереди ComfyUI без доски. Обычно очередь работает внутри процесса Next (npm run dev).
import { startComfyQueue } from "../src/lib/comfy/queue";
import { prepareDataRoot } from "../src/lib/series/paths";

console.warn(
  "ВНИМАНИЕ: это отладочный запуск очереди без доски. Вместе с `npm run dev` его не запускают: " +
    "доска уже обрабатывает data/comfy_queue сама, два процесса будут опрашивать ComfyUI.",
);
prepareDataRoot();
startComfyQueue();
console.log("comfy queue watches data/comfy_queue");
