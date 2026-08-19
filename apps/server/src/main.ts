import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const staticRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
const app = createApp({ staticRoot });

try {
  await app.listen({ host: "127.0.0.1", port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
