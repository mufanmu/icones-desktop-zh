import { useCallback, useEffect, useRef } from "react";
import { Icon } from "@iconify/react";

// 预加载提前量:哨兵距视口底部 800px 内即触发下一批
const SENTINEL_MARGIN = 800;

interface Props {
  icons: string[]; // full "prefix:name"
  total: number;
  selected: string | null;
  onSelect: (name: string) => void;
  gridSize: number;
  loading: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  emptyHint?: string;
}

export function IconGrid({
  icons,
  total,
  selected,
  onSelect,
  gridSize,
  loading,
  loadingMore,
  onLoadMore,
  emptyHint,
}: Props) {
  const iconPx = Math.round(gridSize * 0.4);
  const hasMore = icons.length > 0 && icons.length < total;

  // 无限滚动:底部 1px 哨兵进入视口(底部提前 SENTINEL_MARGIN px)即加载下一批。
  // root 用默认 viewport:主内容滚动容器 .content 即窗口可视区,
  // IntersectionObserver 会按祖先 overflow 裁剪正确计算交集。
  // 注意:所有 hooks 必须在任何条件 return 之前调用(Rules of Hooks),
  // 否则 spinner/空态(0 hooks)与网格态(hooks)切换时 React 会抛
  // "Rendered more hooks than during the previous render" 崩溃。
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 哨兵是否落在预加载扩展区内(与 IO rootMargin 语义一致)
  const sentinelInView = useCallback(() => {
    const el = sentinelRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.top <= window.innerHeight + SENTINEL_MARGIN && rect.bottom >= 0;
  }, []);

  // 滚动触发:交叉状态变化(进入/离开扩展区)时回调。
  // loader/空态下 sentinel 未渲染(el 为 null)或 hasMore 为 false,直接跳过。
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore?.();
      },
      { rootMargin: `0px 0px ${SENTINEL_MARGIN}px 0px`, threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, onLoadMore]);

  // 数据更新后复查:一批增量不足以把哨兵推出扩展区时,IO 不会再有状态变化,
  // 加载会卡在"1,200 of 2,000"——这里在每次渲染后主动检查,若哨兵仍在
  // 扩展区内则继续加载,直到填满视口或 hasMore 结束。App 层 ref 锁保证链式
  // 加载每次只进一批(锁在搜索 effect 的 finally 释放)。
  useEffect(() => {
    if (!hasMore) return;
    const raf = requestAnimationFrame(() => {
      if (sentinelInView()) onLoadMore?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [icons.length, hasMore, onLoadMore, sentinelInView]);

  if (loading && icons.length === 0) {
    return (
      <div className="grid-state">
        <Icon icon="svg-spinners:90-ring-with-bg" className="spinner" />
      </div>
    );
  }

  if (icons.length === 0) {
    return (
      <div className="grid-state">
        <Icon icon="ph:magnifying-glass-duotone" />
        <p>{emptyHint ?? "No icons found"}</p>
      </div>
    );
  }

  return (
    <div className="grid-wrap">
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))` }}
      >
        {icons.map((name) => (
          <button
            key={name}
            className={`cell ${selected === name ? "selected" : ""}`}
            onClick={() => onSelect(name)}
            title={name}
          >
            <Icon icon={name} width={iconPx} height={iconPx} />
          </button>
        ))}
      </div>

      {hasMore && (
        <div className="grid-footer">
          <span>
            Showing {icons.length.toLocaleString()} of {total.toLocaleString()}
          </span>
          {loadingMore && (
            <Icon icon="svg-spinners:90-ring-with-bg" className="spinner-sm" />
          )}
        </div>
      )}
      {/* 哨兵始终渲染;observer 仅在 hasMore 时建立,加载完自动停止 */}
      <div ref={sentinelRef} className="grid-sentinel" aria-hidden="true" />
    </div>
  );
}
