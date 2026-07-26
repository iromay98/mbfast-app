import { prisma } from "@/lib/db";
import { notify } from "@/server/notifications";
import { parseTuningContentLabel, tuningContentLabel } from "@/lib/catalog/options";

/*
 * DL連動の納品処理。
 * 代理店が照合DL（/api/match/...）でファイルを実際に受け取った時点で、その記録の
 * 未返却リクエストのうち「DLした版と同一内容」または「バブリングのモード違い
 * （全モード⇄スポーツ）だけの内容」を納品(DELIVERED)にする。
 * 背景: 本店が依頼と少し違う構成で納品→代理店が代替DL、のケースで依頼が
 * 未返却のまま残るバグの対策。DLという行動を「代替で受け入れた」証拠とみなす。
 * 無関係な内容（ステージ違い・OP違い）の依頼は閉じない。
 */

export type DownloadedVariant = {
  stage: string;
  popsAndBangs: boolean;
  popsSport: boolean;
  optionTags: string[];
};

// 依頼ラベルが「DLした版で満たされた」とみなせるか。
// exact: 完全一致 / modeAlt: バブリングのモード違いのみ（resolveTuning の代替提示と同じ定義）。
export function requestSatisfiedByDownload(
  requestLabel: string,
  dl: DownloadedVariant,
): "exact" | "modeAlt" | null {
  const sel = parseTuningContentLabel(requestLabel);
  if (!sel) return null;
  const eqSet = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
  if (sel.stage !== dl.stage.trim()) return null;
  if (!eqSet(sel.optionTags, dl.optionTags)) return null;
  if (sel.pops === dl.popsAndBangs && sel.popsSport === (dl.popsAndBangs && dl.popsSport)) {
    return "exact";
  }
  if (sel.pops && dl.popsAndBangs && sel.popsSport !== dl.popsSport) return "modeAlt";
  return null;
}

export async function deliverOpenRequestsByDownload(opts: {
  recordId: string;
  dealerId: string;
  actorUserId: string; // DLした代理店ユーザー（RequestEvent の操作者として記録）
  variant: DownloadedVariant;
}): Promise<void> {
  try {
    const open = await prisma.fileRequest.findMany({
      where: {
        serviceRecordId: opts.recordId,
        status: { notIn: ["DELIVERED", "CANCELLED"] },
      },
      select: { id: true, title: true, requestNote: true },
    });
    if (open.length === 0) return;

    const dlLabel = tuningContentLabel(
      opts.variant.stage,
      opts.variant.popsAndBangs,
      opts.variant.optionTags,
      opts.variant.popsSport,
    );

    for (const req of open) {
      // リクエスト内容は requestNote の 「…」 に入っている（作成時の規約）
      const reqLabel = req.requestNote?.match(/「(.+?)」/)?.[1];
      if (!reqLabel) continue;
      const satisfied = requestSatisfiedByDownload(reqLabel, opts.variant);
      if (!satisfied) continue;

      await prisma.fileRequest.update({
        where: { id: req.id },
        data: {
          status: "DELIVERED",
          events: {
            create: {
              status: "DELIVERED",
              actorId: opts.actorUserId,
              comment:
                satisfied === "exact"
                  ? `代理店が「${dlLabel}」をDLしたため納品`
                  : `代理店が代替版「${dlLabel}」をDLしたため納品（依頼内容: 「${reqLabel}」）`,
            },
          },
        },
      });
      // 本店へ通知（依頼が自動で閉じたことを把握できるように）
      await notify({
        type: "REQUEST_STATUS_CHANGED",
        title: "依頼が納品になりました（代理店がDL）",
        message:
          satisfied === "exact"
            ? `「${dlLabel}」のDLにより自動で納品扱いにしました`
            : `代替版「${dlLabel}」のDL（依頼: 「${reqLabel}」）により自動で納品扱いにしました`,
        dealerId: null,
        link: `/hq/records/${opts.recordId}`,
      });
    }
  } catch (e) {
    // 納品ステータスの更新失敗でDL自体は止めない
    console.error("DL連動の納品処理に失敗しました", e);
  }
}
