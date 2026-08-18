import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { Sidebar, type PaletteFilter } from "./components/Sidebar";
import { Topbar, type ThemeMode } from "./components/Topbar";
import { IconGrid } from "./components/IconGrid";
import { VariantBar } from "./components/VariantBar";
import { ExportPanel } from "./components/ExportPanel";
import {
  fetchCollections,
  fetchCollection,
  searchIcons,
  searchIconsMulti,
  type CollectionMeta,
} from "./lib/api";
import { detectVariants, matchesVariant } from "./lib/variants";
import { isChinese, loadDict, translateChineseFull, filterCountryIconsForTerms, isCountryCode, planQuery, mergePlans, CJK } from "./lib/zhSearch";
import { rankIconsByRelevance, type RankGroup } from "./lib/rank";
import { getFavCollections, saveFavCollections, getFavIcons, saveFavIcons } from "./lib/favorites";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";

const PAGE = 200;
const DEFAULT_SET = "lucide";

export default function App() {
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  // activePrefix = 当前正在浏览的图标库（决定 query 为空时显示哪个库）
  const [activePrefix, setActivePrefix] = useState<string | null>(null);
  // scopePill = 搜索过滤 pill 所代表的库（null = 全局搜索）
  // 启动时为 null，搜索框无 pill，搜索走全局；点侧边栏某库后设为该库。
  const [scopePill, setScopePill] = useState<string | null>(null);
  const [scopeSelected, setScopeSelected] = useState(false); // pill 待删态
  const [query, setQuery] = useState("");
  // 当前库全量图标缓存（同时用于浏览与库内本地过滤）
  const [allIcons, setAllIcons] = useState<string[]>([]); // full "prefix:name"
  const [names, setNames] = useState<string[]>([]); // 当前展示结果
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  // 无限滚动:主内容滚动容器引用 + 增量加载状态 + 防重复触发锁
  const contentRef = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreLock = useRef(false);

  const [palette, setPalette] = useState<PaletteFilter>("all");
  const [gridSize, setGridSize] = useState(56);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem("icones_theme_mode") as ThemeMode) || "auto";
  });
  const [effectiveTheme, setEffectiveTheme] = useState<"dark" | "light">("dark");
  const [variant, setVariant] = useState<string | null>(null);

  // 收藏状态
  const [favCollections, setFavCollections] = useState<string[]>(() => getFavCollections());
  const [favIcons, setFavIcons] = useState<string[]>(() => getFavIcons());
  const [isFavView, setIsFavView] = useState(false);

  // 侧边栏收起（完全沉浸搜索）：收起图标库搜索+图标库列表，主区全宽
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    localStorage.getItem("icones_sidebar_collapsed") === "1",
  );

  useEffect(() => {
    localStorage.setItem("icones_sidebar_collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  // 启动加载 icon 集合索引并默认浏览第一个库，但不设搜索 pill。
  // 同时懒加载中文词典。
  useEffect(() => {
    fetchCollections()
      .then((list) => {
        setCollections(list);
        const initial = list.find((c) => c.prefix === DEFAULT_SET) ?? list[0];
        if (initial) setActivePrefix(initial.prefix);
      })
      .catch(() => setLoading(false));
    loadDict().catch(() => {});
  }, []);

  const toggleFavCollection = useCallback((prefix: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFavCollections((prev) => {
      const next = prev.includes(prefix)
        ? prev.filter((p) => p !== prefix)
        : [...prev, prefix];
      saveFavCollections(next);
      return next;
    });
  }, []);

  const toggleFavIcon = useCallback((iconName: string) => {
    setFavIcons((prev) => {
      const next = prev.includes(iconName)
        ? prev.filter((i) => i !== iconName)
        : [...prev, iconName];
      saveFavIcons(next);
      return next;
    });
  }, []);

  const searching = query.trim().length > 0;

  // activePrefix 变化时加载该库全量图标（浏览与库内过滤的数据源）
  useEffect(() => {
    let alive = true;
    if (!activePrefix) {
      setAllIcons([]);
      return;
    }
    fetchCollection(activePrefix)
      .then((info) => {
        if (!alive) return;
        setAllIcons(info.icons.map((n) => `${activePrefix}:${n}`));
      })
      .catch(() => {
        if (alive) setAllIcons([]);
      });
    return () => {
      alive = false;
    };
  }, [activePrefix]);

  // Resolve the visible icon list.
  useEffect(() => {
    let alive = true;
    setLoading(true);

    const run = async () => {
      try {
        if (searching) {
          const q = query.trim();
          const tokens = q.split(/\s+/).filter(Boolean);
          const multiKeyword = tokens.length > 1;
          // 词典懒加载（未命中词典时 plan 会回退为 raw token）
          await loadDict();
          // 每个关键词 token 独立翻译：中文+英文混输不丢词（"首页 wifi" → home + wifi）
          const qGroups = planQuery(q);
          // 排名用：每组 = 该关键词的全部检索词（主词→联想→fuzzy）
          const rankGroups: RankGroup[] = qGroups.map((g) => ({
            terms: [...g.plan.primary, ...g.plan.secondary, ...g.plan.fuzzy]
              .map((t) => t.toLowerCase())
              .filter(Boolean),
          }));
          const lowerTerms = [...new Set(rankGroups.flatMap((g) => g.terms))];
          const pureAscii = tokens.every((t) => !CJK.test(t));
          // 搜索用：跨 token 合并一份 primary/secondary/fuzzy（并集语义不变）
          const merged = mergePlans(qGroups);

          if (scopePill) {
            // 库内本地过滤；中文先翻译成英文检索词再匹配图标名
            const hasCountry = lowerTerms.some(isCountryCode);
            const matchesTerm = (full: string, t: string): boolean => {
              const [prefix, rawName] = full.split(":");
              const name = rawName.toLowerCase();
              if (isCountryCode(t)) {
                // 国旗精确匹配：短码严格等 或 flag 库带尺寸后缀；仅国旗库
                const head = name.split("-")[0];
                if (head !== t) return false;
                if (name === t) return ["cif", "circle-flags", "flag", "flagpack"].includes(prefix);
                if (prefix === "flag") {
                  const parts = name.split("-");
                  return parts.length === 2 && ["1x1", "4x3"].includes(parts[1]);
                }
                return false;
              }
              // 关键词内部用空格/下划线连接的（如 "arrow left"）归一化成段再匹配
              const tnorm = t.replace(/[\s_]+/g, "-");
              if (name.includes(tnorm)) return true;
              // 组合词拆词后须全部命中（arrow-left 命中 arrow 与 left）
              if (tnorm.includes("-")) {
                const segs = name.split("-");
                return tnorm.split("-").every((w) => name.includes(w) || segs.includes(w));
              }
              // 防止 includes(t) 与"国" 视觉上误吃其它国旗
              if (hasCountry) {
                const head = name.split("-")[0];
                return head === t || name === t;
              }
              return name.includes(t);
            };
            // 主词 + fuzzy 全量过滤（主导，fuzzy 恢复旧规模不被砍短）；
            // 联想词（类目混合词条）限量补充（每词前几个，总量 ≤12）。
            const coreTerms = [
              ...new Set(
                qGroups
                  .flatMap((g) => [
                    ...g.plan.primary.map((t) => t.toLowerCase()),
                    ...g.plan.fuzzy.map((t) => t.toLowerCase()),
                  ])
                  .filter(Boolean),
              ),
            ];
            const secTerms = [
              ...new Set(
                qGroups.flatMap((g) => g.plan.secondary.map((t) => t.toLowerCase())).filter(Boolean),
              ),
            ];
            let filtered: string[];
            if (coreTerms.length > 0) {
              const coreFiltered = allIcons.filter((full) =>
                coreTerms.some((t) => matchesTerm(full, t)),
              );
              const seen = new Set(coreFiltered);
              const extra: string[] = [];
              for (const t of secTerms) {
                if (extra.length >= 12) break;
                for (const full of allIcons) {
                  if (seen.has(full)) continue;
                  if (matchesTerm(full, t)) {
                    seen.add(full);
                    extra.push(full);
                  }
                  if (extra.length >= 12) break;
                }
              }
              filtered = [...coreFiltered, ...extra];
            } else {
              // 无主词（理论不出现：planQuery 对每个 token 都会回退 primary=[token]）
              filtered = allIcons.filter((full) =>
                lowerTerms.some((t) => matchesTerm(full, t)),
              );
            }
            if (!alive) return;
            // 相关度重排：关键词最关联的排最前；组合关键词先比覆盖数
            setNames(rankIconsByRelevance(filtered, rankGroups, { multiKeyword }));
            setTotal(filtered.length);
          } else {
            // 全局搜索
            let r;
            if (pureAscii) {
              // 英文输入也先查字典：品牌词（gpt/wechat/alipay）等能映射到词典词条做多词扩展
              const plan = translateChineseFull(q);
              if (plan.primary.length > 0 || plan.secondary.length > 0 || plan.fuzzy.length > 0) {
                r = await searchIconsMulti(plan.primary, plan.secondary, plan.fuzzy, limit);
              } else {
                // 无词典命中：整句一次 AND 搜索（"arrow left" 由 API 做组合匹配，
                // 避免拆词并集后把只命单个词的图标淹进来）
                r = await searchIcons(q, limit);
              }
            } else {
              // 中文/中英混合：各 token 翻译后并集搜索（首页 wifi → home ∪ wifi）
              r = await searchIconsMulti(merged.primary, merged.secondary, merged.fuzzy, limit);
            }
            if (!alive) return;
            // 国旗精确过滤：若翻译词含真实国家码，剔除伪装者
            const finalIcons = filterCountryIconsForTerms(r.icons, lowerTerms);
            // 相关度重排：关键词最关联的排最前；组合关键词先比覆盖数
            setNames(rankIconsByRelevance(finalIcons, rankGroups, { multiKeyword }));
            // “加载更多”需要真实总数：普通英文单词搜索用 API 返回的 total（可翻页到 200 以上）；
            // 中文多词并集 / 国旗过滤 / 已取尽（返回不足 limit）时无可靠服务端总数，用当前结果数。
            const noServerTotal =
              !pureAscii || lowerTerms.some(isCountryCode) || r.icons.length < limit;
            setTotal(noServerTotal ? finalIcons.length : r.total);
          }
        } else if (isFavView) {
        // 收藏视图
        if (!alive) return;
        setNames(favIcons);
        setTotal(favIcons.length);
      } else if (activePrefix) {
        // 浏览当前库
        if (!alive) return;
        setNames(allIcons);
        setTotal(allIcons.length);
      } else {
        setNames([]);
        setTotal(0);
      }
      } finally {
        // 无论成功/失败/中止都复位增量加载态并释放锁;旧的 run(alive=false)跳过,
        // 保证锁只由最新一次请求释放
        if (alive) {
          setLoading(false);
          setLoadingMore(false);
          loadMoreLock.current = false;
        }
      }
    };

    const t = setTimeout(run, searching && !scopePill ? 220 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, activePrefix, scopePill, searching, limit, allIcons, isFavView, favIcons]);

  // Reset paging + variant whenever the context changes.
  useEffect(() => {
    setLimit(PAGE);
    setVariant(null);
    // 上下文切换后回顶,避免停在上一个结果集的底部
    contentRef.current?.scrollTo({ top: 0 });
  }, [query, activePrefix, scopePill]);

  useEffect(() => setLimit(PAGE), [variant]);

  useEffect(() => {
    localStorage.setItem("icones_theme_mode", themeMode);

    const applyTheme = () => {
      let eff: "dark" | "light" = "dark";
      if (themeMode === "auto") {
        eff = window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      } else {
        eff = themeMode;
      }

      setEffectiveTheme(eff);
      document.documentElement.dataset.theme = eff;
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        getCurrentWindow().setTheme(eff).catch(() => {});
      }
    };

    applyTheme();

    if (themeMode === "auto") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme();
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, [themeMode]);

  // Variants only make sense when browsing a single set (not global search).
  const variants = useMemo(
    () => (searching && !scopePill ? [] : detectVariants(names)),
    [names, searching, scopePill],
  );

  const filtered = useMemo(
    () => (variant ? names.filter((n) => matchesVariant(n, variant)) : names),
    [names, variant],
  );

  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
  const displayTotal = variant ? filtered.length : total;

  const activeMeta = collections.find((c) => c.prefix === activePrefix);

  // 点侧边栏某库：切换"浏览的库" + 出现 pill 切到"库内搜索"
  const onSelectSet = useCallback((p: string) => {
    setIsFavView(false);
    setActivePrefix(p);
    setScopePill(p);
    setQuery("");
    setScopeSelected(false);
  }, []);

  const onSelectFavView = useCallback(() => {
    setIsFavView(true);
    setActivePrefix(null);
    setScopePill(null);
    setQuery("");
    setScopeSelected(false);
  }, []);

  // 点击 pill 主体：清 query 回到该 pill 库的浏览态（scopePill 保留，浏览同步过去）
  const onPillClick = useCallback(() => {
    if (scopePill) setActivePrefix(scopePill);
    setQuery("");
    setScopeSelected(false);
  }, [scopePill]);

  // 点击 pill 叉号：只移除搜索过滤 pill，回到全局搜索；浏览的库保持不变
  const onPillRemove = useCallback(() => {
    setScopePill(null);
    setQuery("");
    setScopeSelected(false);
  }, []);

  // Backspace 在空输入时：先选中 pill、再删 pill 回全局
  const inputRef = useRef<HTMLInputElement>(null);
  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Backspace") return;
      const v = (e.currentTarget as HTMLInputElement).value;
      if (v !== "") return;
      if (!scopePill) return;
      if (!scopeSelected) {
        e.preventDefault();
        setScopeSelected(true);
      } else {
        e.preventDefault();
        setScopePill(null);
        setScopeSelected(false);
      }
    },
    [scopePill, scopeSelected],
  );

  // 输入时取消 pill 选中态
  const onQueryChange = useCallback(
    (q: string) => {
      if (scopeSelected) setScopeSelected(false);
      setQuery(q);
    },
    [scopeSelected],
  );

  // 点击 ExportPanel 里的"切到该库"：等同于点侧边栏某库
  const onNavigateToSet = useCallback((p: string) => {
    setIsFavView(false);
    setActivePrefix(p);
    setScopePill(p);
    setQuery("");
    setScopeSelected(false);
    setSelected(null);
  }, []);

  // 收起/展开侧边栏：收起时清库过滤 pill 回全局，并聚焦主搜索框（沉浸搜索）
  const toggleSidebar = useCallback(() => {
    if (!sidebarCollapsed) {
      setScopePill(null);
      setScopeSelected(false);
    }
    setSidebarCollapsed(!sidebarCollapsed);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [sidebarCollapsed]);

  // 无限滚动:滚动到底部附近由哨兵触发,每批累加 PAGE;ref 锁防重复触发,
  // 锁在搜索 effect 的 finally 中释放(见上方 run)
  const handleLoadMore = useCallback(() => {
    if (loadMoreLock.current) return;
    loadMoreLock.current = true;
    setLoadingMore(true);
    setLimit((l) => l + PAGE);
  }, []);

  return (
    <div className={`app${sidebarCollapsed ? " collapse-sidebar" : ""}`}>
      {/* Overlay 标题栏：内容顶到窗口顶部，需显式全宽拖拽条，否则顶部无法拖动窗口。
          交通灯为原生层浮于其上仍可点击；下方搜索框在 34px 之下不受影响。 */}
      <div className="titlebar-drag" data-tauri-drag-region />
      {!sidebarCollapsed && (
        <Sidebar
          collections={collections}
          activePrefix={activePrefix}
          onSelect={onSelectSet}
          palette={palette}
          onPalette={setPalette}
          gridSize={gridSize}
          onGridSize={setGridSize}
          favCollections={favCollections}
          onToggleFavCollection={toggleFavCollection}
          isFavView={isFavView}
          onSelectFavView={onSelectFavView}
          onToggleCollapse={toggleSidebar}
        />
      )}
      {sidebarCollapsed && (
        <button
          className="sidebar-fab"
          onClick={toggleSidebar}
          title="展开侧边栏"
          aria-label="展开侧边栏"
        >
          <Icon icon="lucide:panel-left-open" />
        </button>
      )}

      <main className="main">
        <Topbar
          query={query}
          onQuery={onQueryChange}
          onInputKeyDown={onInputKeyDown}
          inputRef={inputRef}
          scope={scopePill}
          scopeName={activeMeta?.name ?? scopePill ?? ""}
          scopeSelected={scopeSelected}
          onPillClick={onPillClick}
          onPillRemove={onPillRemove}
          themeMode={themeMode}
          effectiveTheme={effectiveTheme}
          onThemeModeChange={setThemeMode}
        />

        <div className="content" ref={contentRef}>
          {isFavView && (
            <div className="fav-collections-section">
              <div className="fav-section-title">
                <span>收藏的图标库 ({favCollections.length})</span>
              </div>
              {favCollections.length === 0 ? (
                <div className="fav-empty-hint">未收藏任何图标库</div>
              ) : (
                <div className="fav-collections-grid">
                  {favCollections.map((prefix) => {
                    const meta = collections.find((c) => c.prefix === prefix);
                    return (
                      <div
                        key={prefix}
                        className="fav-collection-card"
                        onClick={() => onSelectSet(prefix)}
                      >
                        <div className="fav-card-header">
                          <span className="fav-card-name">{meta?.name ?? prefix}</span>
                          <span
                            className="fav-card-star active"
                            title="取消收藏"
                            onClick={(e) => toggleFavCollection(prefix, e)}
                          >
                            <Icon icon="ri:star-fill" />
                          </span>
                        </div>
                        <div className="fav-card-meta">
                          <span>{prefix}</span>
                          {meta?.total !== undefined && <span>{meta.total} 个图标</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="fav-section-title" style={{ marginTop: 24 }}>
                <span>收藏的图标 ({favIcons.length})</span>
              </div>
            </div>
          )}

          <VariantBar variants={variants} active={variant} onSelect={setVariant} />
          <IconGrid
            icons={visible}
            total={displayTotal}
            selected={selected}
            onSelect={setSelected}
            gridSize={gridSize}
            loading={loading}
            loadingMore={loadingMore}
            onLoadMore={handleLoadMore}
            emptyHint={
              searching
                ? scopePill
                  ? `在 “${activeMeta?.name ?? scopePill}” 中未找到 “${query.trim()}”`
                  : isChinese(query)
                    ? `未找到匹配 “${query}” 的图标`
                    : `No icons match "${query}"`
                : isFavView
                  ? "暂无收藏的图标"
                  : "Select a set to browse"
            }
          />
        </div>
      </main>

      {selected && (
        <ExportPanel
          name={selected}
          onClose={() => setSelected(null)}
          onNavigateToSet={onNavigateToSet}
          isFavIcon={favIcons.includes(selected)}
          onToggleFavIcon={toggleFavIcon}
        />
      )}
    </div>
  );
}