"use client";

import { useMemo } from "react";

// 開発ツリーの階層表示（本部・代理店共用）。上下型レイアウト:
// ノードから右へ伸び、✅(良い)は上の枝、❌(ダメ)は下の枝に分かれる。
// ここでは意図的に「ラベルと分岐」だけを描画する。メモ(note)は本部の内部情報のため
// このコンポーネントには渡さない設計（代理店に専門情報を出さない方針）。
export type TreeNode = {
  id: string;
  label: string;
  okNextId: string | null;
  ngNextId: string | null;
  hasFile?: boolean;
};

export function DevTreeView({
  nodes,
  currentNodeId,
  showFileBadge = false, // 本部のみ「未添付」バッジを出す
}: {
  nodes: TreeNode[];
  currentNodeId: string | null;
  showFileBadge?: boolean;
}) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  // ルート = どのノードからも参照されていないノード（無ければ現在ノード）
  const roots = useMemo(() => {
    const referenced = new Set<string>();
    for (const n of nodes) {
      if (n.okNextId) referenced.add(n.okNextId);
      if (n.ngNextId) referenced.add(n.ngNextId);
    }
    const r = nodes.filter((n) => !referenced.has(n.id));
    if (r.length > 0) return r;
    const cur = currentNodeId ? byId.get(currentNodeId) : undefined;
    return cur ? [cur] : nodes.slice(0, 1);
  }, [nodes, byId, currentNodeId]);

  const renderedOnce = new Set<string>();

  const nodeBox = (node: TreeNode, isCurrent: boolean) => (
    <div
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border px-2 py-1 text-xs ${
        isCurrent ? "border-gold-400 bg-gold-50 font-bold" : "border-line bg-surface"
      }`}
    >
      {node.label}
      {isCurrent && <span className="rounded bg-gold-500 px-1 py-0.5 text-[9px] font-bold text-white">現在</span>}
      {showFileBadge && node.hasFile === false && <span className="text-[9px] text-red-600">未添付</span>}
    </div>
  );

  // 上下型: 親ノードの右に、上段=✅の枝 / 下段=❌の枝
  const render = (node: TreeNode, path: Set<string>): React.ReactNode => {
    const isCurrent = node.id === currentNodeId;
    renderedOnce.add(node.id);

    const branch = (mark: string, cls: string, childId: string | null) => {
      if (!childId) return null;
      const child = byId.get(childId);
      if (!child) return null;
      const loop = path.has(child.id) || renderedOnce.has(child.id);
      return (
        <div className="flex items-center gap-1">
          <span className={`shrink-0 text-[10px] font-bold ${cls}`}>{mark}→</span>
          {loop ? (
            <span className="whitespace-nowrap text-[11px] text-ink-soft">「{child.label}」へ（↑既出）</span>
          ) : (
            render(child, new Set([...path, node.id]))
          )}
        </div>
      );
    };

    const ok = branch("✅", "text-green-700", node.okNextId);
    const ng = branch("❌", "text-red-700", node.ngNextId);
    if (!ok && !ng) return nodeBox(node, isCurrent);

    return (
      <div className="flex items-center gap-1.5">
        {nodeBox(node, isCurrent)}
        <div className="flex flex-col justify-center gap-1.5 border-l-2 border-line pl-1.5">
          {ok}
          {ng}
        </div>
      </div>
    );
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-2">
      <div className="space-y-3">{roots.map((r) => render(r, new Set()))}</div>
    </div>
  );
}
