import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = join(serverRoot, "prisma", "schema.template.prisma");
const template = await readFile(templatePath, "utf8");

const targets = [
  { name: "sqlite", provider: "sqlite", longText: "" },
  { name: "mysql", provider: "mysql", longText: " @db.LongText" },
  { name: "postgresql", provider: "postgresql", longText: "" },
];

for (const target of targets) {
  const directory = join(serverRoot, "prisma", target.name);
  const schema = template
    .replaceAll("__PROVIDER__", target.provider)
    .replaceAll(
      "__OUTPUT__",
      `../../src/infrastructure/database/generated/${target.name}`,
    )
    .replaceAll("__LONG_TEXT__", target.longText);

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "schema.prisma"), schema, "utf8");
}
