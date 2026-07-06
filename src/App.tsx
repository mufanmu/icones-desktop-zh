import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sidebar, type PaletteFilter } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
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
import { isChinese, loadDict, translateChinese, filterCountryIconsForTerms, isCountryCode } from "./lib/zhSearch";
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

  const [palette, setPalette] = useState<PaletteFilter>("all");
  const [gridSize, setGridSize] = useState(56);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [variant, setVariant] = useState<string | null>(null);

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
      if (searching) {
        if (scopePill) {
          // 库内本地过滤；中文先翻译成英文检索词再匹配图标名
          const q = query.trim();
          let terms: string[];
          if (isChinese(q)) {
            await loadDict();
            terms = translateChinese(q);
          } else {
            terms = [q];
          }
          const lowerTerms = terms.map((t) => t.toLowerCase());
          const hasCountry = lowerTerms.some(isCountryCode);
          const filtered =
            lowerTerms.length === 0
              ? []
              : allIcons.filter((full) => {
                  const name = full.split(":").pop()!.toLowerCase();
                  const prefix = full.split(":")[0];
                  return lowerTerms.some((t) => {
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
                    // 普通词仍 includes；若词条里混入了国家Flag短码就当作FlagFlag看，已经返
                    // 防止 includes(t) 与"国" 视觉上误吃其它国旗
                    if (hasCountry) {
                      const head = name.split("-")[0];
                      return head === t || name === t;
                    }
                    return name.includes(t);
                  });
                });
          if (!alive) return;
          setNames(filtered);
          setTotal(filtered.length);
        } else {
          // 全局搜索
          let r;
          let terms: string[] = [];
          if (isChinese(query)) {
            await loadDict();
            terms = translateChinese(query);
            r = await searchIconsMulti(terms, limit);
          } else {
            terms = [query.trim()];
            r = await searchIcons(query, limit);
          }
          if (!alive) return;
          // 国旗精确过滤：若翻译词含短国家码，剔除伪装者
          const finalIcons = filterCountryIconsForTerms(r.icons, terms.map((t) => t.toLowerCase()));
          setNames(finalIcons);
          setTotal(finalIcons.length);
        }
      } else if (activePrefix) {
        // 浏览当前库
        if (!alive) return;
        setNames(allIcons);
        setTotal(allIcons.length);
      } else {
        setNames([]);
        setTotal(0);
      }
      if (alive) setLoading(false);
    };

    const t = setTimeout(run, searching && !scopePill ? 220 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, activePrefix, scopePill, searching, limit, allIcons]);

  // Reset paging + variant whenever the context changes.
  useEffect(() => {
    setLimit(PAGE);
    setVariant(null);
  }, [query, activePrefix, scopePill]);

  useEffect(() => setLimit(PAGE), [variant]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
  const breadcrumb = searching
    ? scopePill
      ? ["Icons", activeMeta?.name ?? scopePill, `"${query.trim()}"`]
      : ["Icons", "Search", `"${query.trim()}"`]
    : activeMeta
      ? ["Icons", activeMeta.category || "Sets", activeMeta.name]
      : ["Icons"];

  // 点侧边栏某库：切换"浏览的库" + 出现 pill 切到"库内搜索"
  const onSelectSet = useCallback((p: string) => {
    setActivePrefix(p);
    setScopePill(p);
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
    setActivePrefix(p);
    setScopePill(p);
    setQuery("");
    setScopeSelected(false);
    setSelected(null);
  }, []);

  return (
    <div className="app">
      <Sidebar
        collections={collections}
        activePrefix={activePrefix}
        onSelect={onSelectSet}
        palette={palette}
        onPalette={setPalette}
        gridSize={gridSize}
        onGridSize={setGridSize}
      />

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
          breadcrumb={breadcrumb}
          theme={theme}
          onTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        />

        <div className="content">
          <VariantBar variants={variants} active={variant} onSelect={setVariant} />
          <IconGrid
            icons={visible}
            total={displayTotal}
            selected={selected}
            onSelect={setSelected}
            gridSize={gridSize}
            loading={loading}
            onLoadMore={() => setLimit((l) => l + PAGE)}
            emptyHint={
              searching
                ? scopePill
                  ? `在 “${activeMeta?.name ?? scopePill}” 中未找到 “${query.trim()}”`
                  : isChinese(query)
                    ? `未找到匹配 “${query}” 的图标`
                    : `No icons match "${query}"`
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
        />
      )}
    </div>
  );
}