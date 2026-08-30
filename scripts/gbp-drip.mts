/*
 * 過去ブログ記事を1件、本店GBPの「最新情報」へ投稿する（毎朝のcronから実行）。
 * 手動実行: docker compose -f docker-compose.prod.yml exec app npm run gbp:drip
 */
import { runGbpDrip } from "../src/server/pit/gbp/drip";
import { prisma } from "../src/lib/db";
runGbpDrip()
  .then((r) => console.log(r))
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
