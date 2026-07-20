"use client";

import { useMemo } from "react";

// 開発ツリーの階層表示（本部・代理店共用）。
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

  const render = (node: TreeNode, path: Set<string>): React.ReactNode => {
    const isCurrent = node.id === currentNodeId;
    const dup = renderedOnce.has(node.id);
    renderedOnce.add(node.id);
    const branches: { mark: string; cls: string; id: string | null }[] = [
      { mark: "✅", cls: "text-green-700", id: node.okNextId },
      { mark: "❌", cls: "text-red-700", id: node.ngNextId },
    ];
    return (
      <div key={`${node.id}-${path.size}`}>
        <div
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
            isCurrent ? "border-gold-400 bg-gold-50 font-bold" : "border-line bg-surface"
          }`}
        >
          {node.label}
          {isCurrent && <span className="rounded bg-gold-500 px-1 py-0.5 text-[9px] font-bold text-white">現在</span>}
          {showFileBadge && node.hasFile === false && <span className="text-[9px] text-red-600">未添付</span>}
        </div>
        {(node.okNextId || node.ngNextId) && (
          <div className="ml-3 mt-1 space-y-1 border-l-2 border-line pl-3">
            {branches
              .filter((b) => b.id)
              .map((b) => {
                const child = byId.get(b.id!);
                if (!child) return null;
                const loop = path.has(child.id);
                return (
                  <div key={`${node.id}-${b.mark}`} className="flex items-start gap-1">
                    <span className={`mt-1 text-[10px] font-bold ${b.cls}`}>{b.mark}→</span>
                    {loop || (dup && renderedOnce.has(child.id)) ? (
                      <span className="mt-0.5 text-[11px] text-ink-soft">「{child.label}」へ（↑既出）</span>
                    ) : (
                      render(child, new Set([...path, node.id]))
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface-2 p-2">
      {roots.map((r) => render(r, new Set()))}
    </div>
  );
}
